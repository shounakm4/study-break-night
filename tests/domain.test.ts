import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseInput, getStats, filterRsvps, eventDate } from '../src/lib/domain.ts';
import { initialDemoState, reserveInState, updateInState } from '../src/lib/demo.ts';

const input = (email = 'student@example.com') => ({
  name: '  Jamie   Tan  ',
  email,
  telegram: '@jamie_tan',
  requestId: crypto.randomUUID(),
});

test('normalises email and optional Telegram without inventing identity verification', () => {
  const result = normaliseInput(input(' STUDENT@EXAMPLE.COM '));
  assert.equal(result.email, 'student@example.com');
  assert.equal(result.name, 'Jamie Tan');
  assert.equal(result.telegram, 'jamie_tan');
  assert.equal(normaliseInput({ ...input(), telegram: '' }).telegram, '');
  assert.throws(() => normaliseInput({ ...input(), email: 'no-email' }));
  assert.throws(() => normaliseInput({ ...input(), telegram: 'https://t.me/name' }));
});

test('preview retries reserve once, but another request cannot recover a ticket by guessing email', () => {
  const state = initialDemoState();
  const request = input();
  const receipt = reserveInState(state, request, 150);
  assert.equal(reserveInState(state, request, 150).id, receipt.id);
  assert.equal(state.rows.length, 4);
  assert.throws(
    () => reserveInState(state, { ...request, requestId: crypto.randomUUID() }, 150),
    /already has/,
  );
});

test('last preview cup is reserved once and overflow RSVPs remain welcome', () => {
  const state = { rows: [], requests: {} };
  const first = reserveInState(state, input('one@example.com'), 1);
  const second = reserveInState(state, input('two@example.com'), 1);
  assert.equal(first.bubble_tea_reserved, true);
  assert.equal(second.bubble_tea_reserved, false);
  assert.equal(getStats(state.rows, 1).rsvps, 2);
  assert.equal(getStats(state.rows, 1).available, 0);
});

test('arrival and cup collection are separate, and duplicate redemption is rejected', () => {
  const state = { rows: [], requests: {} };
  const row = reserveInState(state, input(), 1);
  assert.throws(() => updateInState(state, row.id, 'cup'), /Check the attendee in/);
  updateInState(state, row.id, 'arrive');
  updateInState(state, row.id, 'cup');
  assert.throws(() => updateInState(state, row.id, 'cup'), /already collected/);
  assert.throws(() => updateInState(state, row.id, 'arrive'), /Already checked/);
  const stats = getStats(state.rows, 1);
  assert.equal(stats.physical, 0);
  assert.equal(stats.uncollected, 0);
  assert.equal(stats.arrivals, 1);
});

test('search and filters use ticket, email, handle and actual collection status', () => {
  const state = initialDemoState();
  assert.equal(filterRsvps(state.rows, 'STUDENT2@EXAMPLE.COM', 'all')[0].name, 'Alex Lim');
  assert.equal(filterRsvps(state.rows, 'demo00000003', 'all')[0].name, 'Riley Lee');
  assert.equal(filterRsvps(state.rows, '', 'waiting').length, 1);
  assert.equal(filterRsvps(state.rows, '', 'cups').length, 2);
});

test('event date stays unconfirmed until set and formats explicitly in Singapore', () => {
  assert.equal(eventDate(null), 'Date to be confirmed');
  assert.match(eventDate('2026-11-25T17:00:00Z'), /26 November/);
});
