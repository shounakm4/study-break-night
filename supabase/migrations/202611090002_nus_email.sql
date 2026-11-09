-- exact domain validation also applies to direct database writes
-- existing non-NUS records must be reviewed before this migration is applied
alter table public.rsvps
  add constraint rsvps_nus_student_email
  check (email ~ '^[^[:space:]@]+@u[.]nus[.]edu$');

create or replace function public.reserve_rsvp(
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
  if p_email is null or lower(btrim(p_email)) !~ '^[^[:space:]@]+@u[.]nus[.]edu$' then
    raise exception 'Please use your NUS student email ending in @u.nus.edu.';
  end if;
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
