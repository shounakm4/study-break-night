export type EmailStatus = 'not_configured' | 'accepted' | 'failed';

export interface EventDetails {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string;
  cup_capacity: number;
  reservations_open: boolean;
}

export interface Rsvp {
  id: string;
  event_id: string;
  name: string;
  email: string;
  telegram_handle: string | null;
  ticket_code: string;
  bubble_tea_reserved: boolean;
  checked_in_at: string | null;
  cup_collected_at: string | null;
  created_at: string;
  email_status: EmailStatus;
}

export interface RegistrationInput {
  name: string;
  email: string;
  telegram: string;
  requestId: string;
}

export interface EventSummary {
  event: EventDetails;
  reserved: number;
}

export interface DeskStats {
  rsvps: number;
  arrivals: number;
  reserved: number;
  collected: number;
  available: number;
  uncollected: number;
  physical: number;
}
