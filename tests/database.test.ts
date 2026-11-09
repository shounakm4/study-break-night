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
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611090002_nus_email.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.exec(
    readFileSync(
      new URL('../supabase/migrations/202611090003_demo_organiser.sql', import.meta.url),
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
    Array.from({ length: 151 }, (_, index) => reserve(id, `student${index}@u.nus.edu`)),
  );
  assert.equal(receipts.filter((row) => row.bubble_tea_reserved).length, 150);
  assert.equal(receipts.length, 151);
  assert.equal(receipts[150].bubble_tea_reserved, false);
});

test('database retries return one reservation and duplicate-email requests reveal no ticket', async () => {
  const id = await event(1);
  const request = crypto.randomUUID();
  const first = await reserve(id, 'student@u.nus.edu', request);
  const retry = await reserve(id, 'student@u.nus.edu', request);
  assert.equal(first.id, retry.id);
  await assert.rejects(() => reserve(id, ' STUDENT@U.NUS.EDU '), /already has an RSVP/);
  assert.equal((await reserve(id, 'second@u.nus.edu')).bubble_tea_reserved, false);
});

test('anonymous clients cannot read attendees or call reservation/redemption functions directly', async () => {
  const id = await event();
  await asUser('anon', '', async () => {
    await assert.rejects(() => db.query('select * from public.rsvps'), /permission denied/);
    await assert.rejects(() => reserve(id, 'blocked@u.nus.edu'), /permission denied/);
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
  const row = await reserve(id, 'private@u.nus.edu');
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
  const row = await reserve(id, 'arriving@u.nus.edu');
  const overflow = await reserve(id, 'overflow@u.nus.edu');
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
    () => reserve('11111111-1111-4111-8111-111111111111', 'closed@u.nus.edu'),
    /not open yet/,
  );
  await assert.rejects(
    () => db.exec('update public.events set reservations_open=true where starts_at is null'),
    /check constraint/,
  );
});

test('database rejects non-NUS domains and lookalikes without consuming cup capacity', async () => {
  const id = await event(1);
  for (const email of [
    'student@gmail.com',
    'student@nus.edu.sg',
    'student@sub.u.nus.edu',
    'student@u.nus.edu.evil.com',
    'student@@u.nus.edu',
    '@u.nus.edu',
  ]) {
    await assert.rejects(() => reserve(id, email), /@u\.nus\.edu/);
  }
  const rows = await db.query('select id from public.rsvps where event_id=$1', [id]);
  assert.equal(rows.rows.length, 0);
  assert.equal((await reserve(id, 'student@u.nus.edu')).bubble_tea_reserved, true);
});

test('database constraint also rejects a direct non-NUS insert', async () => {
  const id = await event();
  await assert.rejects(
    () =>
      db.query(
        `insert into public.rsvps(event_id,name,email,request_id,bubble_tea_reserved)
    values ($1,'Invalid Student','student@gmail.com',$2,true)`,
        [id, crypto.randomUUID()],
      ),
    /rsvps_nus_student_email/,
  );
});

const demoId = '55555555-5555-4555-8555-555555555555';
test('demo organiser only sees fictional attendees and cannot redeem a real ticket', async () => {
  const demoUser = '44444444-4444-4444-8444-444444444444';
  await db.query('insert into auth.users values ($1)', [demoUser]);
  await db.query('insert into public.organisers values ($1,$2)', [demoId, demoUser]);
  const realId = await event();
  const realTicket = await reserve(realId, 'private-real@u.nus.edu');
  await asUser('authenticated', demoUser, async () => {
    const visible = await db.query<{ event_id: string; id: string }>(
      'select * from public.rsvps order by ticket_code',
    );
    assert.equal(visible.rows.length, 3);
    assert.ok(visible.rows.every((row) => row.event_id === demoId));
    await assert.rejects(
      () => db.query('select public.redeem_ticket($1,$2)', [realTicket.id, 'arrive']),
      /Organiser access required/,
    );
    await assert.rejects(
      () => db.query('insert into public.organisers values ($1,$2)', [realId, demoUser]),
      /permission denied/,
    );
    await db.query('select public.redeem_ticket($1,$2)', [visible.rows[0].id, 'arrive']);
    await db.query('select public.redeem_ticket($1,$2)', [visible.rows[0].id, 'cup']);
    await db.query('select public.reset_demo_event()');
    const reset = await db.query<{
      event_id: string;
      checked_in_at: string | null;
      cup_collected_at: string | null;
    }>('select * from public.rsvps');
    assert.equal(reset.rows.length, 3);
    assert.equal(reset.rows.filter((row) => row.checked_in_at).length, 2);
    assert.equal(reset.rows.filter((row) => row.cup_collected_at).length, 1);
    assert.ok(reset.rows.every((row) => row.event_id === demoId));
  });
  assert.equal(
    (await db.query('select id from public.rsvps where id=$1', [realTicket.id])).rows.length,
    1,
  );
});

test('demo reset is blocked for anonymous and unrelated users, and demo registrations stay closed', async () => {
  await asUser('anon', '', async () => {
    await assert.rejects(() => db.query('select public.reset_demo_event()'), /permission denied/);
  });
  await asUser('authenticated', strangerId, async () => {
    await assert.rejects(
      () => db.query('select public.reset_demo_event()'),
      /Demo organiser access required/,
    );
  });
  await assert.rejects(() => reserve(demoId, 'new-person@u.nus.edu'), /not open yet/);
  await assert.rejects(
    () => db.query('update public.events set reservations_open=true where id=$1', [demoId]),
    /demo_event_stays_closed/,
  );
});
