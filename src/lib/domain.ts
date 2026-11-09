import { isNusStudentEmail } from '../../supabase/functions/_shared/email';
import type { DeskStats, RegistrationInput, Rsvp } from './types';

export function normaliseInput(input: RegistrationInput): RegistrationInput {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const email = input.email.trim().toLowerCase();
  const telegram = input.telegram.trim().replace(/^@/, '');
  if (name.length < 2 || name.length > 80)
    throw new Error('Please enter a name between 2 and 80 characters.');
  if (!isNusStudentEmail(email))
    throw new Error('Please use your NUS student email ending in @u.nus.edu.');
  if (telegram && !/^[A-Za-z0-9_]{5,32}$/.test(telegram))
    throw new Error('Use a Telegram username with 5–32 letters, numbers or underscores.');
  if (!/^[0-9a-f-]{36}$/i.test(input.requestId)) throw new Error('Please refresh and try again.');
  return { name, email, telegram, requestId: input.requestId };
}

export function getStats(rows: Rsvp[], capacity: number): DeskStats {
  const reserved = rows.filter((row) => row.bubble_tea_reserved).length;
  const collected = rows.filter((row) => row.cup_collected_at).length;
  return {
    rsvps: rows.length,
    arrivals: rows.filter((row) => row.checked_in_at).length,
    reserved,
    collected,
    available: Math.max(0, capacity - reserved),
    uncollected: Math.max(0, reserved - collected),
    physical: Math.max(0, capacity - collected),
  };
}

export function filterRsvps(rows: Rsvp[], query: string, filter: string): Rsvp[] {
  const needle = query.trim().toLowerCase();
  return rows.filter((row) => {
    const matches = [row.name, row.email, row.ticket_code, row.telegram_handle ?? ''].some(
      (value) => value.toLowerCase().includes(needle),
    );
    return (
      matches &&
      (filter === 'all' ||
        (filter === 'waiting' && !row.checked_in_at) ||
        (filter === 'arrived' && !!row.checked_in_at) ||
        (filter === 'cups' && row.bubble_tea_reserved && !row.cup_collected_at))
    );
  });
}

export function eventDate(startsAt: string | null): string {
  if (!startsAt) return 'Date to be confirmed';
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
  }).format(new Date(startsAt));
}

export function eventTime(startsAt: string | null, endsAt: string | null): string {
  if (!startsAt || !endsAt) return '7–9 pm · Singapore time';
  const formatter = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${formatter.format(new Date(startsAt))}–${formatter.format(new Date(endsAt))} · Singapore time`;
}
