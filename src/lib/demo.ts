import { normaliseInput } from './domain';
import type { EventDetails, RegistrationInput, Rsvp } from './types';

const STORAGE_KEY = 'study-break-preview-v1';
export const demoEvent: EventDetails = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Study Break Night',
  starts_at: null,
  ends_at: null,
  location: 'COM1 foyer',
  cup_capacity: 150,
  reservations_open: true,
};
interface DemoState {
  rows: Rsvp[];
  requests: Record<string, string>;
}

function sampleRow(index: number, name: string, arrived = false, collected = false): Rsvp {
  const time = '2026-11-09T11:00:00.000Z';
  return {
    id: `sample-${index}`,
    event_id: demoEvent.id,
    name,
    email: `student${index}@example.com`,
    telegram_handle: null,
    ticket_code: `DEMO0000000${index}`,
    bubble_tea_reserved: true,
    checked_in_at: arrived ? time : null,
    cup_collected_at: collected ? time : null,
    created_at: time,
    email_status: 'not_configured',
  };
}

export function initialDemoState(): DemoState {
  return {
    rows: [
      sampleRow(1, 'Jamie Tan'),
      sampleRow(2, 'Alex Lim', true),
      sampleRow(3, 'Riley Lee', true, true),
    ],
    requests: {},
  };
}

export function readDemo(): DemoState {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return initialDemoState();
  try {
    const value = JSON.parse(raw) as DemoState;
    if (!Array.isArray(value.rows) || typeof value.requests !== 'object' || value.requests === null)
      throw new Error();
    return value;
  } catch {
    throw new Error(
      'Preview data could not be read. Clear this site’s preview storage to start again.',
    );
  }
}

function saveDemo(value: DemoState) {
  // report storage failures instead of claiming the reservation was saved
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  window.dispatchEvent(new Event('preview-change'));
}

async function locked<T>(action: () => T): Promise<T> {
  if (navigator.locks) return navigator.locks.request(STORAGE_KEY, action);
  return action();
}

export function reserveInState(state: DemoState, raw: RegistrationInput, capacity: number): Rsvp {
  const input = normaliseInput(raw);
  const existingRequest = state.rows.find((row) => row.id === state.requests[input.requestId]);
  if (existingRequest) return existingRequest;
  if (state.rows.some((row) => row.email === input.email))
    throw new Error(
      'This email already has an RSVP. Check your confirmation ticket or ask an organiser.',
    );
  const row: Rsvp = {
    id: crypto.randomUUID(),
    event_id: demoEvent.id,
    name: input.name,
    email: input.email,
    telegram_handle: input.telegram || null,
    ticket_code: crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase(),
    bubble_tea_reserved: state.rows.filter((row) => row.bubble_tea_reserved).length < capacity,
    checked_in_at: null,
    cup_collected_at: null,
    created_at: new Date().toISOString(),
    email_status: 'not_configured',
  };
  state.rows.unshift(row);
  state.requests[input.requestId] = row.id;
  return row;
}

export async function registerDemo(input: RegistrationInput): Promise<Rsvp> {
  return locked(() => {
    const state = readDemo();
    const row = reserveInState(state, input, demoEvent.cup_capacity);
    saveDemo(state);
    return row;
  });
}

export function updateInState(state: DemoState, id: string, action: 'arrive' | 'cup'): Rsvp {
  const row = state.rows.find((value) => value.id === id);
  if (!row) throw new Error('Ticket not found. Refresh and try again.');
  if (action === 'arrive') {
    if (row.checked_in_at) throw new Error('Already checked in.');
    row.checked_in_at = new Date().toISOString();
  } else {
    if (!row.bubble_tea_reserved) throw new Error('This ticket has no bubble tea reservation.');
    if (!row.checked_in_at) throw new Error('Check the attendee in before handing over their cup.');
    if (row.cup_collected_at) throw new Error('This cup was already collected.');
    row.cup_collected_at = new Date().toISOString();
  }
  return row;
}

export async function updateDemo(id: string, action: 'arrive' | 'cup'): Promise<Rsvp> {
  return locked(() => {
    const state = readDemo();
    const row = updateInState(state, id, action);
    saveDemo(state);
    return row;
  });
}
