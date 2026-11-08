-- event date stays unset and real registration stays closed until confirmed
create table public.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  location text not null default 'COM1 foyer',
  cup_capacity integer not null default 150 check (cup_capacity between 0 and 150),
  reservations_open boolean not null default false,
  check ((starts_at is null and ends_at is null) or
    (starts_at is not null and ends_at is not null and ends_at > starts_at)),
  check (not reservations_open or starts_at is not null)
);

create table public.organisers (
  event_id uuid not null references public.events(id),
  user_id uuid not null references auth.users(id),
  primary key (event_id, user_id)
);

create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id),
  name text not null check (char_length(name) between 2 and 80),
  email text not null check (char_length(email) <= 254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  telegram_handle text check (telegram_handle is null or telegram_handle ~ '^[A-Za-z0-9_]{5,32}$'),
  request_id uuid not null,
  ticket_code text not null default upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  bubble_tea_reserved boolean not null,
  checked_in_at timestamptz,
  checked_in_by uuid references auth.users(id),
  cup_collected_at timestamptz,
  cup_collected_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  email_status text not null default 'not_configured' check (email_status in ('not_configured', 'accepted', 'failed')),
  unique (event_id, email),
  unique (event_id, request_id),
  unique (ticket_code),
  check (email = lower(btrim(email))),
  check (cup_collected_at is null or (bubble_tea_reserved and checked_in_at is not null))
);
create index rsvps_event_created on public.rsvps(event_id, created_at desc);

-- only the registration function can touch these coarse anonymous abuse counters
create table public.registration_limits (
  event_id uuid not null references public.events(id),
  bucket timestamptz not null,
  client_hash text not null,
  attempts integer not null default 1,
  primary key (event_id, bucket, client_hash)
);

alter table public.events enable row level security;
alter table public.organisers enable row level security;
alter table public.rsvps enable row level security;
alter table public.registration_limits enable row level security;
revoke all on public.events, public.organisers, public.rsvps, public.registration_limits from anon, authenticated;
grant select on public.events to anon, authenticated;
grant select on public.organisers, public.rsvps to authenticated;
grant all on public.events, public.organisers, public.rsvps, public.registration_limits to service_role;
create policy event_details on public.events for select to anon, authenticated using (true);
create policy own_membership on public.organisers for select to authenticated using (user_id = (select auth.uid()));

create function public.is_organiser(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.organisers where event_id = p_event_id and user_id = (select auth.uid()));
$$;
revoke all on function public.is_organiser(uuid) from public, anon, authenticated;
grant execute on function public.is_organiser(uuid) to authenticated;
create policy organiser_attendees on public.rsvps for select to authenticated
  using ((select public.is_organiser(event_id)));

create function public.get_event_summary(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('event', to_jsonb(e), 'reserved',
    (select count(*) from public.rsvps r where r.event_id = e.id and r.bubble_tea_reserved))
  from public.events e where e.id = p_event_id;
$$;
revoke all on function public.get_event_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_event_summary(uuid) to anon, authenticated, service_role;

-- locking the event serialises cup allocations, including requests for different emails
create function public.reserve_rsvp(
  p_event_id uuid, p_name text, p_email text, p_telegram text, p_request_id uuid, p_client_hash text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_event public.events%rowtype;
  v_row public.rsvps%rowtype;
  v_reserved integer;
  v_attempts integer;
  v_bucket timestamptz;
begin
  select * into v_event from public.events where id = p_event_id for update;
  if not found then raise exception 'Event not found.'; end if;
  select * into v_row from public.rsvps where event_id = p_event_id and request_id = p_request_id;
  if found then return to_jsonb(v_row); end if;
  if not v_event.reservations_open then raise exception 'RSVPs are not open yet.'; end if;
  if exists (select 1 from public.rsvps where event_id = p_event_id and email = lower(btrim(p_email))) then
    raise exception 'This email already has an RSVP. Check your confirmation ticket or ask an organiser.';
  end if;
  if p_client_hash is null or p_client_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid request.'; end if;
  v_bucket := date_trunc('hour', now()) + floor(extract(minute from now()) / 10) * interval '10 minutes';
  insert into public.registration_limits(event_id, bucket, client_hash) values (p_event_id, v_bucket, p_client_hash)
  on conflict (event_id, bucket, client_hash) do update set attempts = public.registration_limits.attempts + 1
  returning attempts into v_attempts;
  if v_attempts > 300 then raise exception 'Too many registrations. Please try again shortly.'; end if;
  select count(*) into v_reserved from public.rsvps where event_id = p_event_id and bubble_tea_reserved;
  insert into public.rsvps(event_id, name, email, telegram_handle, request_id, bubble_tea_reserved)
  values (p_event_id, btrim(p_name), lower(btrim(p_email)), nullif(regexp_replace(btrim(p_telegram), '^@', ''), ''),
    p_request_id, v_reserved < v_event.cup_capacity) returning * into v_row;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.reserve_rsvp(uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_rsvp(uuid, text, text, text, uuid, text) to service_role;

create function public.redeem_ticket(p_rsvp_id uuid, p_action text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_row public.rsvps%rowtype;
begin
  select * into v_row from public.rsvps where id = p_rsvp_id for update;
  if not found or not public.is_organiser(v_row.event_id) then raise exception 'Organiser access required.'; end if;
  if p_action = 'arrive' then
    if v_row.checked_in_at is not null then raise exception 'Already checked in.'; end if;
    update public.rsvps set checked_in_at = now(), checked_in_by = auth.uid() where id = p_rsvp_id returning * into v_row;
  elsif p_action = 'cup' then
    if not v_row.bubble_tea_reserved then raise exception 'This ticket has no bubble tea reservation.'; end if;
    if v_row.checked_in_at is null then raise exception 'Check the attendee in before handing over their cup.'; end if;
    if v_row.cup_collected_at is not null then raise exception 'This cup was already collected.'; end if;
    update public.rsvps set cup_collected_at = now(), cup_collected_by = auth.uid() where id = p_rsvp_id returning * into v_row;
  else raise exception 'Unknown check-in action.';
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.redeem_ticket(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_ticket(uuid, text) to authenticated;

insert into public.events(id, title) values ('11111111-1111-4111-8111-111111111111', 'Study Break Night');

-- realtime is enabled only for the organiser-readable table
DO $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rsvps;
  end if;
end $$;
