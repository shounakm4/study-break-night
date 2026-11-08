import { createClient } from '@supabase/supabase-js';
import { normaliseInput } from './domain';
import { demoEvent, readDemo, registerDemo, updateDemo } from './demo';
import type { EventSummary, RegistrationInput, Rsvp } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configurationError = Boolean(url) !== Boolean(key);
export const previewMode = !url && !key;
export const supabase = url && key ? createClient(url, key) : null;
export const eventId = import.meta.env.VITE_EVENT_ID || demoEvent.id;

export async function getEventSummary(): Promise<EventSummary> {
  if (configurationError)
    throw new Error('Both Supabase environment variables must be configured.');
  if (previewMode)
    return {
      event: demoEvent,
      reserved: readDemo().rows.filter((row) => row.bubble_tea_reserved).length,
    };
  const { data, error } = await supabase!.rpc('get_event_summary', { p_event_id: eventId });
  if (error) throw new Error('Could not load the event. Please try again.');
  if (!data) throw new Error('This event is not configured.');
  return data as EventSummary;
}

export async function register(input: RegistrationInput): Promise<Rsvp> {
  const clean = normaliseInput(input);
  if (previewMode) return registerDemo(clean);
  const { data, error } = await supabase!.functions.invoke('register-rsvp', {
    body: { ...clean, eventId },
  });
  if (error) {
    let message =
      'Your RSVP could not be confirmed. Please retry; the same request will not reserve another cup.';
    try {
      const response = error.context as Response;
      const body = await response.json();
      if (body.error) message = body.error;
    } catch {
      /* retain the safe fallback */
    }
    throw new Error(message);
  }
  return data.rsvp as Rsvp;
}

export async function hasOrganiserAccess(): Promise<boolean> {
  if (previewMode) return sessionStorage.getItem('preview-organiser') === 'yes';
  const { data: session } = await supabase!.auth.getSession();
  if (!session.session) return false;
  const { data, error } = await supabase!.rpc('is_organiser', { p_event_id: eventId });
  if (error) throw new Error('Could not verify organiser access.');
  return data === true;
}

export async function loadRsvps(): Promise<Rsvp[]> {
  if (previewMode) return readDemo().rows;
  const { data, error } = await supabase!
    .from('rsvps')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false });
  if (error) throw new Error('Could not load attendees. Please reconnect and refresh.');
  return data as Rsvp[];
}

export async function recordAction(id: string, action: 'arrive' | 'cup'): Promise<Rsvp> {
  if (previewMode) return updateDemo(id, action);
  const { data, error } = await supabase!.rpc('redeem_ticket', { p_rsvp_id: id, p_action: action });
  if (error) throw new Error(error.message);
  return data as Rsvp;
}

export function subscribeToRsvps(
  refresh: () => void,
  connection: (online: boolean) => void,
): () => void {
  if (previewMode) {
    const update = () => refresh();
    window.addEventListener('storage', update);
    window.addEventListener('preview-change', update);
    connection(navigator.onLine);
    return () => {
      window.removeEventListener('storage', update);
      window.removeEventListener('preview-change', update);
    };
  }
  const channel = supabase!
    .channel(`desk-${eventId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rsvps', filter: `event_id=eq.${eventId}` },
      refresh,
    )
    .subscribe((status) => {
      const ready = status === 'SUBSCRIBED';
      connection(ready);
      if (ready) refresh();
    });
  return () => {
    void supabase!.removeChannel(channel);
  };
}
