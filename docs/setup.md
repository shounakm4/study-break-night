# Connect the live backend

The frontend runs without accounts or secrets in labelled local preview mode. The following steps switch to a real shared database. No live Supabase project, organiser user, sender domain or Vercel deployment is created automatically.

## 1. Create a Supabase project

Create a project in your own Supabase account. Save its project URL and public anon/publishable key. Never put a service-role key in a `VITE_` variable.

Apply both files under `supabase/migrations/` in filename order, or use the Supabase CLI to apply pending migrations. The second migration adds exact `@u.nus.edu` validation and a database constraint. If upgrading a database containing non-NUS RSVPs, review those records first: the constraint will fail rather than silently delete attendees or change reservations. The migration creates one event with ID `11111111-1111-4111-8111-111111111111`. Its date is unset and registrations are closed.

The attendee list is protected with Row Level Security. Anonymous visitors can read only public event details and an aggregate reservation count. Only the server-side function can create an RSVP. Approved organisers can read attendee data and call the redemption function; they cannot directly rewrite arbitrary RSVP fields.

## 2. Configure the actual date

Once the organiser confirms the date, set the real timestamps with explicit Singapore offsets. Replace the example dates below; they are not the event date.

```sql
update public.events
set starts_at = '2026-11-26T19:00:00+08:00',
    ends_at = '2026-11-26T21:00:00+08:00'
where id = '11111111-1111-4111-8111-111111111111';
```

Keep `reservations_open = false` until the complete live path is tested. There is no snack stock field: the RSVP total is the snack-order estimate. The database enforces a maximum cup capacity of 150.

## 3. Add organiser accounts

Create individual users through Supabase Authentication, using the dashboard’s user/invite workflow. Share credentials through the organiser’s normal private channel, not the repository. Use the new user’s UUID in this SQL:

```sql
insert into public.organisers(event_id, user_id)
values ('11111111-1111-4111-8111-111111111111', 'ORGANISER-AUTH-USER-UUID');
```

Repeat for each organiser. Membership is scoped to the event. A user who can log in but is absent from this table must not be able to see or redeem tickets. Configure Supabase Auth redirect URLs to your actual site if using invitation/password-recovery links.

## 4. Deploy the public registration function

Install the official Supabase CLI, authenticate, and link this directory to your project:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase functions deploy register-rsvp
```

`supabase/config.toml` deliberately sets `verify_jwt = false` for this one public RSVP endpoint. Attendees do not log in. The function validates the payload and invokes a service-only database function; it exposes no generic database operations. Organiser redemption remains authenticated.

In **Edge Function Secrets**, set:

| Secret            | Value                                                                               |
| ----------------- | ----------------------------------------------------------------------------------- |
| `ALLOWED_ORIGIN`  | Exact frontend origin, without a trailing slash, e.g. `https://your-app.vercel.app` |
| `RATE_LIMIT_SALT` | A new random secret string for salted IP hashing                                    |
| `RESEND_API_KEY`  | Your email provider key, only if enabling email                                     |
| `EMAIL_FROM`      | A sender on your verified domain, e.g. `Study Break <events@your-domain.example>`   |

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted Edge Functions. These must never reach the browser. If the rate-limit salt is missing, registration fails closed.

The coarse limit is 300 new registrations per event / hashed IP / ten-minute bucket, deliberately allowing a shared campus network. It is a basic guardrail, not proof against automated abuse. Confirm your hosting proxy’s forwarded-IP behaviour and consider a CAPTCHA or stronger abuse control before a widely publicised event. Old rate buckets can be removed after the event.

## 5. Configure email

Create a Resend account and verify a sender domain you control. The testing sender cannot be assumed to deliver to arbitrary attendees. Configure the two provider secrets above.

RSVP reservation happens first. Email is attempted afterward with an idempotency key based on the RSVP ID. A provider failure does not delete the reservation. The response says whether sending was accepted, failed or not configured; accepted is not proof of inbox delivery. The web ticket remains available even when email fails. The initial version has no background email retry worker or attendee resend endpoint.

Registration retries reuse the client’s random request UUID. The same request can recover its own receipt; using an already registered email with a different request returns a generic duplicate message without exposing the existing ticket. Unverified email addresses still permit impersonation/reservation abuse; the prototype does not authenticate attendee identity.

## 6. Connect the React app

Copy `.env.example` to `.env.local` and fill:

```text
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_KEY
VITE_EVENT_ID=11111111-1111-4111-8111-111111111111
```

Restart Vite after changing environment variables. Both URL and public key are required. Supplying only one shows a configuration error rather than silently falling back to a local demo.

The organiser desk uses a Realtime subscription on `rsvps`, scoped by event and protected by RLS. It refetches after changes, on reconnection, and every 30 seconds as a fallback. The migration adds this table to the `supabase_realtime` publication when that publication exists.

## 7. Deploy the frontend to Vercel

Import `shounakm4/study-break-night` into your own Vercel account.

- Framework: Vite
- Build: `npm run build`
- Output directory: `dist`
- Set the three frontend variables above and redeploy.
- Set `ALLOWED_ORIGIN` in Supabase to the actual frontend origin.
- `vercel.json` lets `/organiser` load when opened or refreshed directly.

## 8. Verify live mode before opening RSVPs

Use a separate disposable test event and fictional records to check:

1. Anonymous visitors cannot list attendees or call redemption directly.
2. A logged-in non-organiser cannot access the desk’s data.
3. Two competing requests for the last cup produce one cup reservation and one attendance-only RSVP.
4. Retrying a request does not allocate another cup.
5. Two organisers redeeming the same ticket produce exactly one collection.
6. Arrival and drink collection remain separate; a drink cannot be collected before arrival.
7. Other phones receive refreshed counts, and offline/reconnecting screens do not report successful collection.
8. Email arrives at an actual permitted recipient; a provider failure leaves a usable web ticket.
9. Excel export contains only the current event’s data and is labelled as a snapshot.

Then open the real event with:

```sql
update public.events set reservations_open = true
where id = '11111111-1111-4111-8111-111111111111';
```

## Local verification limits

`npm test` executes the migration against PGlite’s embedded Postgres with Supabase Auth roles mocked for access tests. It checks allocation, retries, RLS and redemption. PGlite serialises queries on its local connection, so the allocation test is not a hosted multi-connection concurrency/load test. The production SQL uses row locks, but real competing sessions and cross-phone Realtime still need the live checks above. Edge email delivery requires external configuration and has not been established by local tests.

## Optional GitHub Actions

`docs/checks.workflow.yml` is a workflow template for type checking, formatting, tests and the build. It is not active. The available GitHub OAuth token cannot publish files under `.github/workflows` without the separate workflow scope. To enable Actions later, move the template to `.github/workflows/checks.yml` using GitHub’s web editor or a suitably authorised credential. No hosted CI success is claimed for this iteration.
