import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const staffId = '22222222-2222-4222-8222-222222222222';
const strangerId = '33333333-3333-4333-8333-333333333333';
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth, public to anon, authenticated, service_role;
    insert into auth.users values ('${staffId}'), ('${strangerId}');`);
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611090001_initial.sql', import.meta.url),
      'utf8',
    ),
  );
});
after(() => db.close());

async function event(capacity = 150) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into public.events(id,title,starts_at,ends_at,cup_capacity,reservations_open)
    values ($1,'Test event','2026-11-26T11:00:00Z','2026-11-26T13:00:00Z',$2,true)`,
    [id, capacity],
  );
  return id;
}
async function reserve(id: string, email: string, request = crypto.randomUUID()) {
  const result = await db.query<{ receipt: Record<string, unknown> }>(
    'select public.reserve_rsvp($1,$2,$3,$4,$5,$6) as receipt',
    [id, 'Test Student', email, '', request, 'a'.repeat(64)],
  );
  return result.rows[0].receipt;
}
async function asUser<T>(role: string, userId: string, run: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
  try {
    return await run();
  } finally {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

test('database allocates exactly 150 cups across 151 submissions, with no snack quota', async () => {
  const id = await event();
  const receipts = await Promise.all(
    Array.from({ length: 151 }, (_, index) => reserve(id, `student${index}@example.com`)),
  );
  assert.equal(receipts.filter((row) => row.bubble_tea_reserved).length, 150);
  assert.equal(receipts.length, 151);
  assert.equal(receipts[150].bubble_tea_reserved, false);
});

test('database retries return one reservation and duplicate-email requests reveal no ticket', async () => {
  const id = await event(1);
  const request = crypto.randomUUID();
  const first = await reserve(id, 'student@example.com', request);
  const retry = await reserve(id, 'student@example.com', request);
  assert.equal(first.id, retry.id);
  await assert.rejects(() => reserve(id, ' STUDENT@EXAMPLE.COM '), /already has an RSVP/);
  assert.equal((await reserve(id, 'second@example.com')).bubble_tea_reserved, false);
});

test('anonymous clients cannot read attendees or call reservation/redemption functions directly', async () => {
  const id = await event();
  await asUser('anon', '', async () => {
    await assert.rejects(() => db.query('select * from public.rsvps'), /permission denied/);
    await assert.rejects(() => reserve(id, 'blocked@example.com'), /permission denied/);
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [crypto.randomUUID(), 'arrive']),
      /permission denied/,
    );
    const result = await db.query<{ summary: { reserved: number; event: object } }>(
      'select public.get_event_summary($1) as summary',
      [id],
    );
    assert.equal(result.rows[0].summary.reserved, 0);
    assert.deepEqual(Object.keys(result.rows[0].summary).sort(), ['event', 'reserved']);
  });
});

test('logged-in non-organisers cannot read or redeem another event’s attendees', async () => {
  const id = await event();
  const row = await reserve(id, 'private@example.com');
  await asUser('authenticated', strangerId, async () => {
    assert.equal((await db.query('select * from public.rsvps')).rows.length, 0);
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [row.id, 'arrive']),
      /Organiser access required/,
    );
    await assert.rejects(
      () => db.query("update public.rsvps set name='Changed'"),
      /permission denied/,
    );
  });
});

test('approved organisers redeem a reserved cup once, after arrival, with audit IDs', async () => {
  const id = await event(1);
  const row = await reserve(id, 'arriving@example.com');
  const overflow = await reserve(id, 'overflow@example.com');
  await db.query('insert into public.organisers values ($1,$2)', [id, staffId]);
  await asUser('authenticated', staffId, async () => {
    assert.equal(
      (await db.query('select * from public.rsvps where event_id=$1', [id])).rows.length,
      2,
    );
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [row.id, 'cup']),
      /Check the attendee in/,
    );
    await db.query('select public.redeem_ticket($1,$2)', [row.id, 'arrive']);
    const result = await db.query<{ receipt: Record<string, unknown> }>(
      'select public.redeem_ticket($1,$2) as receipt',
      [row.id, 'cup'],
    );
    assert.equal(result.rows[0].receipt.cup_collected_by, staffId);
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [row.id, 'cup']),
      /already collected/,
    );
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [overflow.id, 'cup']),
      /no bubble tea reservation/,
    );
  });
});

test('real event remains closed until a date is configured', async () => {
  await assert.rejects(
    () => reserve('11111111-1111-4111-8111-111111111111', 'closed@example.com'),
    /not open yet/,
  );
  await assert.rejects(
    () => db.exec('update public.events set reservations_open=true where starts_at is null'),
    /check constraint/,
  );
});
