import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventCalendar } from '../src/lib/calendar.ts';
import type { EventDetails } from '../src/lib/types.ts';

const event: EventDetails = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Study Break Night',
  starts_at: '2026-11-12T19:00:00+08:00',
  ends_at: '2026-11-12T21:00:00+08:00',
  location: 'COM1 foyer',
  cup_capacity: 150,
  reservations_open: true,
};
const now = new Date('2026-11-09T05:00:00Z');

test('calendar preserves Singapore event times as UTC and excludes private URL parameters', () => {
  const calendar = buildEventCalendar(
    event,
    'https://study-break-night.vercel.app/?ticket=private#code',
    now,
  )!;
  assert.ok(calendar.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(calendar.endsWith('END:VCALENDAR\r\n'));
  assert.ok(calendar.includes('DTSTART:20261112T110000Z\r\n'));
  assert.ok(calendar.includes('DTEND:20261112T130000Z\r\n'));
  assert.ok(calendar.includes('LOCATION:COM1 foyer\r\n'));
  assert.ok(calendar.includes('URL:https://study-break-night.vercel.app/\r\n'));
  assert.ok(!calendar.includes('private'));
});

test('calendar escapes text and folds Unicode lines within 75 bytes without injecting fields', () => {
  const title = 'Study Break 🧋'.repeat(12) + ', snacks; friends\\fun\nEND:VEVENT';
  const calendar = buildEventCalendar(
    { ...event, title },
    'https://study-break-night.vercel.app',
    now,
  )!;
  for (const line of calendar.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const unfolded = calendar.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('\\, snacks\\; friends\\\\fun\\nEND:VEVENT'));
  assert.equal(calendar.split('\r\n').filter((line) => line === 'END:VEVENT').length, 1);
  assert.ok(!calendar.includes('\uFFFD'));
});

test('calendar is unavailable for unconfirmed, invalid or reversed event dates', () => {
  for (const dates of [
    { starts_at: null },
    { ends_at: null },
    { starts_at: 'not a date' },
    { ends_at: event.starts_at },
    { starts_at: event.ends_at, ends_at: event.starts_at },
  ])
    assert.equal(
      buildEventCalendar({ ...event, ...dates }, 'https://study-break-night.vercel.app', now),
      null,
    );
});
