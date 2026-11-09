import { createClient } from 'npm:@supabase/supabase-js@2';
import { isNusStudentEmail } from '../_shared/email.ts';

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );

Deno.serve(async (request) => {
  const allowedOrigin = Deno.env.get('ALLOWED_ORIGIN');
  const origin = request.headers.get('origin');
  const headers = {
    'Access-Control-Allow-Origin': allowedOrigin || 'http://localhost:5174',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  };
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (origin && origin !== headers['Access-Control-Allow-Origin'])
    return respond({ error: 'This origin is not allowed.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { headers });
  if (request.method !== 'POST') return respond({ error: 'Use POST.' }, 405);
  if (Number(request.headers.get('content-length') || 0) > 4096)
    return respond({ error: 'Request too large.' }, 413);
  try {
    const text = await request.text();
    if (text.length > 4096) return respond({ error: 'Request too large.' }, 413);
    const body = JSON.parse(text);
    if (
      typeof body.name !== 'string' ||
      typeof body.email !== 'string' ||
      typeof body.telegram !== 'string' ||
      typeof body.requestId !== 'string' ||
      typeof body.eventId !== 'string'
    )
      return respond({ error: 'Please complete the RSVP form.' }, 400);
    const name = body.name.trim().replace(/\s+/g, ' ');
    const email = body.email.trim().toLowerCase();
    const telegram = body.telegram.trim().replace(/^@/, '');
    if (!isNusStudentEmail(email)) {
      return respond({ error: 'Please use your NUS student email ending in @u.nus.edu.' }, 400);
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      name.length < 2 ||
      name.length > 80 ||
      (telegram && !/^[A-Za-z0-9_]{5,32}$/.test(telegram)) ||
      !uuid.test(body.requestId) ||
      !uuid.test(body.eventId)
    ) {
      return respond({ error: 'Please check your name, email and Telegram username.' }, 400);
    }
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    if (!serviceKey || !supabaseUrl || !Deno.env.get('RATE_LIMIT_SALT'))
      return respond({ error: 'Registration is not configured yet.' }, 503);
    const client = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${Deno.env.get('RATE_LIMIT_SALT')}:${clientIp}`),
    );
    const hash = Array.from(new Uint8Array(bytes))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    const { data: row, error } = await client.rpc('reserve_rsvp', {
      p_event_id: body.eventId,
      p_name: name,
      p_email: email,
      p_telegram: telegram,
      p_request_id: body.requestId,
      p_client_hash: hash,
    });
    if (error) {
      const safe = [
        'RSVPs are not open yet.',
        'Please use your NUS student email ending in @u.nus.edu.',
        'Event not found.',
        'This email already has an RSVP. Check your confirmation ticket or ask an organiser.',
        'Too many registrations. Please try again shortly.',
      ];
      return respond(
        {
          error: safe.includes(error.message)
            ? error.message
            : 'Could not save your RSVP. Please try again.',
        },
        400,
      );
    }
    let status = row.email_status;
    const resendKey = Deno.env.get('RESEND_API_KEY');
    const sender = Deno.env.get('EMAIL_FROM');
    if (status !== 'accepted' && resendKey && sender) {
      status = 'failed';
      const { data: event } = await client
        .from('events')
        .select('*')
        .eq('id', row.event_id)
        .single();
      try {
        if (!event) throw new Error('Missing event details');
        const date = event.starts_at
          ? new Intl.DateTimeFormat('en-SG', {
              timeZone: 'Asia/Singapore',
              dateStyle: 'full',
              timeStyle: 'short',
            }).format(new Date(event.starts_at))
          : 'Date to be confirmed';
        const end = event.ends_at
          ? new Intl.DateTimeFormat('en-SG', {
              timeZone: 'Asia/Singapore',
              timeStyle: 'short',
            }).format(new Date(event.ends_at))
          : '9 pm';
        const entitlement = row.bubble_tea_reserved
          ? 'One bubble tea is reserved for you.'
          : 'No bubble tea is reserved, but you are welcome to join the break.';
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          signal: AbortSignal.timeout(8000),
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': `study-break-${row.id}`,
          },
          body: JSON.stringify({
            from: sender,
            to: [row.email],
            subject: `Your ticket for ${event.title}`,
            html: `<div style="font-family:Arial,sans-serif;color:#233b60;max-width:560px"><h1>You’re on the list, ${escapeHtml(row.name)} 🧋</h1><p>${escapeHtml(event.title)} · ${escapeHtml(event.location)}</p><p>${escapeHtml(date)} – ${escapeHtml(end)} (Singapore time)</p><p>${entitlement}</p><p>Your RSVP helps organisers plan the snack order. Snacks are subject to availability.</p><p>Your ticket code:</p><h2 style="letter-spacing:3px">${escapeHtml(row.ticket_code)}</h2><p>Show this message or your on-screen ticket to an organiser. They will check you in and record collection.</p><p>See you at the study break!</p></div>`,
          }),
        });
        if (response.ok) status = 'accepted';
      } catch {
        /* the RSVP remains valid when email is unavailable */
      }
      const { error: statusError } = await client
        .from('rsvps')
        .update({ email_status: status })
        .eq('id', row.id);
      if (statusError) console.error('Could not persist confirmation delivery status.');
    }
    // never return the idempotency key or other attendees' records
    const { request_id: _requestId, ...receipt } = row;
    return respond({ rsvp: { ...receipt, email_status: status } });
  } catch {
    return respond(
      { error: 'Could not process the request. Please retry with the same form.' },
      400,
    );
  }
});
