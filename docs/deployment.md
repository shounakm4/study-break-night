# Deployment status

Production: https://study-break-night.vercel.app

- Vercel project: `study-break-night`, under the Shounak account.
- Supabase project: `study-break-night`, under the Shounak organisation, Singapore region.
- Event: 12 November 2026, 7–9 pm Singapore time, COM1 foyer (assumed date supplied for this exercise).
- Attendees register without accounts. Approved organisers use Supabase Auth and event membership.
- The public `register-rsvp` function is deployed with its legacy JWT gateway check disabled. It validates the input and invokes the service-only reservation function; organiser access remains authenticated and protected by database policies.
- Resend uses a sending-only key in Supabase server secrets. No server credentials are included in frontend configuration or committed files.

## Email restriction

No sender domain has been verified. `onboarding@resend.dev` can send only to the email associated with the Resend account. The account owner confirmed receiving an isolated test confirmation in their inbox. Other attendees retain a valid on-screen ticket even when email is rejected. Verify a domain you control, then replace `EMAIL_FROM` with an address on that domain before promising email delivery to everyone.

## Future updates

The first deployment was uploaded with the Vercel CLI. Automatic deployments from GitHub have not been configured. After changing the app, run the usual checks and deploy to the linked Vercel project with `vercel deploy --prod`.

Both SQL migration files were applied through the SQL editor. They are not yet recorded as CLI migrations. Before using `supabase db push` on this project, inspect the database and mark versions `202611090001` and `202611090002` as applied using `supabase migration repair`; do not rerun the table-creation SQL against existing tables.

The dashboard deployment bundled the shared email validator into the registration function. Future CLI deployments use the checked-in function and its shared module directly.

The account owner successfully signed into the deployed organiser dashboard. Multi-phone Realtime updates and competing hosted requests still need verification. The local test suite and a hosted allocation transaction do not replace those checks.
