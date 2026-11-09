-- the public demo account can only work with this fictional, closed event
insert into public.events(id,title,starts_at,ends_at,location,cup_capacity,reservations_open)
values ('55555555-5555-4555-8555-555555555555','Study Break demo (fictional attendees)',
 '2026-11-12T19:00:00+08:00','2026-11-12T21:00:00+08:00','COM1 foyer',150,false);

-- prevent real attendee registrations from appearing in the publicly accessible demo
alter table public.events add constraint demo_event_stays_closed
check (id <> '55555555-5555-4555-8555-555555555555' or not reservations_open);

insert into public.rsvps(event_id,name,email,request_id,ticket_code,bubble_tea_reserved,checked_in_at,cup_collected_at)
select '55555555-5555-4555-8555-555555555555', 'Demo Guest '||n,
 'demo-guest-'||n||'@u.nus.edu',gen_random_uuid(),'DEMO0000000'||n,true,
 case when n >= 2 then now() end,case when n = 3 then now() end
from generate_series(1,3) n;

create function public.reset_demo_event() returns void
language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_organiser('55555555-5555-4555-8555-555555555555') then
  raise exception 'Demo organiser access required.';
 end if;
 -- this function takes no event argument and never deletes real event records
 perform 1 from public.events where id='55555555-5555-4555-8555-555555555555' for update;
 delete from public.rsvps where event_id='55555555-5555-4555-8555-555555555555';
 insert into public.rsvps(event_id,name,email,request_id,ticket_code,bubble_tea_reserved,checked_in_at,cup_collected_at)
 select '55555555-5555-4555-8555-555555555555', 'Demo Guest '||n,
  'demo-guest-'||n||'@u.nus.edu',gen_random_uuid(),'DEMO0000000'||n,true,
  case when n >= 2 then now() end,case when n = 3 then now() end
 from generate_series(1,3) n;
end;
$$;
revoke all on function public.reset_demo_event() from public, anon, authenticated;
grant execute on function public.reset_demo_event() to authenticated;
