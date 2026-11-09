# Study Break Night 🧋

**[Open the repository](https://github.com/shounakm4/study-break-night)** · Local preview: `http://127.0.0.1:5174`

A phone-friendly RSVP and check-in app for a NUS Students’ Computing Club study break at COM1 foyer, 7–9 pm. Attendees do not create accounts. Organisers share a private, live dashboard.

Built for the Events Tech recruitment exercise. This is a student prototype, not an official club deployment. The event date must be confirmed before opening real registrations.

**Current status:** the app runs in browser-local preview mode. The shared Supabase backend and email integration are written but still need configuration and live verification. Preview RSVPs send no email, and different phones do not share preview data.

## Why I chose this approach

I chose this setup because the organiser needs a simple registration and RSVP workflow. Attendees should be able to read the event details, register and get their ticket without creating an account. React handles the page, and Supabase provides the shared database and organiser login once connected.

The Telegram messaging part would have added too much setup for the short time frame, so I chose confirmation emails to NUS student addresses instead. The email integration is prepared but is not sending messages in the current preview. The form still takes an optional Telegram handle in case an organiser needs to contact someone about the event, for example to check whether a late attendee is still coming.

I kept the page simple and added a few fun elements, including bubble tea and students taking a break. The illustrations are AI-generated. I expect someone to spend around two minutes on the RSVP page to register and get the event information, so I wanted the form to stay easy to find and quick to complete.

The organiser dashboard gives the committee RSVP numbers for estimating snack quantities and a way to check people in on the day. Only organisers need to log in, and they can also use the dashboard beforehand for planning. They search for an attendee by name, email or ticket code, confirm the matching ticket, then record arrival and cup collection. Searching a name alone does not authenticate someone. With more time, I would add a QR code to the confirmation email so organisers could scan tickets at the door.

## Attendee flow

1. Open the event page and read the date, venue and reservation policy.
2. Enter a name, NUS student email ending in `@u.nus.edu`, and optional Telegram handle. The handle is for manual event-related contact by organisers; no Telegram bot is used.
3. Submit an RSVP without logging in.
4. The backend atomically reserves one cup if fewer than 150 active cup reservations exist. Total RSVPs help organisers decide how many snacks to order; snacks have no app-enforced quota.
5. See a ticket code and exact entitlements immediately. Once email delivery is configured, receive the same event details and ticket by email.
6. Show the ticket at the door. Organisers record arrival and food collection separately.
7. If cups are fully reserved, attendance is still allowed. The confirmation clearly says no bubble tea is reserved; it does not promise unavailable snacks.

A lost email does not cancel the RSVP. Retrying the same request must not create a second reservation. An unrelated request using an already registered email must not reveal the existing ticket.

## Organiser flow

1. Open **Organiser desk** and log in with an individually approved organiser account.
2. See total RSVPs, arrivals, cup reservations and collected bubble tea.
3. Search by name, email or ticket code. See the optional Telegram handle for manual contact.
4. Verify the attendee’s ticket and reservation status. Record arrival.
5. Mark a cup collected when handed over. The backend rejects repeat redemption, including simultaneous attempts from two phones.
6. Other organisers’ screens refresh from shared database changes. After reconnecting, reload authoritative data before continuing.
7. Download an Excel snapshot for planning or records. The spreadsheet is not used to redeem tickets or allocate stock.

Only approved organisers can read personal RSVP data. Logging in alone does not grant organiser access.

## How it works

```mermaid
flowchart TD
  Attendee[Public React RSVP page] --> Register[Supabase registration Edge Function]
  Register --> Reserve[Atomic Postgres reservation function]
  Reserve --> DB[(Supabase Postgres)]
  Register --> Email[Resend confirmation email]
  Staff[React organiser desk] --> Auth[Supabase Auth + organiser membership]
  Auth --> DB
  Staff --> Redeem[Authorised atomic check-in / collection functions]
  Redeem --> DB
  DB --> Realtime[Realtime updates + reconnect refresh]
  Realtime --> Staff
  Staff --> Excel[Excel snapshot]
```

- **Frontend:** React, TypeScript and Vite; deployable to Vercel.
- **Database:** Supabase Postgres. SQL functions enforce allocation and collection rules in transactions; React never decides whether the last cup is available.
- **Access:** Supabase Auth for organisers, membership checks and Row Level Security. Attendees submit through a narrow public endpoint and cannot list RSVP records.
- **Email:** a Supabase Edge Function calls Resend after reserving successfully. Provider secrets remain on the server. Email status distinguishes accepted, failed and not configured; accepted is not a guarantee of inbox delivery.
- **Live counts:** authenticated database subscriptions trigger fresh reads. Live UI updates do not replace transactional correctness.
- **Exports:** an on-demand .xlsx snapshot of the organiser’s current event data.

## Registration and check-in logic

1. **Validate the form.** A name, an email ending in exactly `@u.nus.edu`, and consent are required. The Telegram handle is optional. The email is trimmed and converted to lowercase, so capitalisation or surrounding spaces cannot create another RSVP.
2. **Prevent duplicates.** Each event allows one RSVP per normalised email. Retrying the same submission returns its existing receipt without using another cup. A new submission with an already registered email is rejected without revealing that attendee’s ticket.
3. **Allocate the cup in the database.** In live mode, the registration function locks the event row while checking capacity and saving the RSVP. Requests for the final cup are processed in order, so two successful registrations cannot both reserve it. The first 150 successful RSVPs receive one reserved cup each.
4. **Keep counting after cups run out.** Further RSVPs are accepted without a bubble-tea reservation. They still count toward attendance estimates. There is no snack quota or guaranteed snack reservation; the committee uses the total RSVP count to plan its order.
5. **Save first, then attempt email.** In configured live mode, the server saves the RSVP before asking Resend to email the event details, ticket code and cup reservation status. The page displays the ticket even if email fails or is not configured. An email failure does not erase the RSVP or allocate another cup on retry. The page distinguishes email accepted, failed and not configured.
6. **Record arrival separately from collection.** An approved organiser checks the ticket and marks the attendee as arrived. When a reserved cup is handed over, they mark it collected. The live database checks permissions and prevents that ticket from collecting a second cup, including when two organisers try at once.
7. **Refresh the organiser dashboard.** In live mode, Supabase Realtime notifications trigger fresh reads of the shared data. Excel downloads are snapshots for planning or records; editing an exported file does not change registrations or stock.

Preview mode uses browser storage to demonstrate these flows. Its duplicate and capacity checks apply only within that browser; the shared database rules apply once Supabase is connected. The live locking behaviour still needs testing with competing requests and multiple phones.

## Counts and reservation rules

| Count                       | Meaning                                                       |
| --------------------------- | ------------------------------------------------------------- |
| RSVPs                       | People registered, including people without a cup reservation |
| Arrivals                    | People recorded at the door                                   |
| Cups available to reserve   | 150 minus active cup reservations                             |
| Reserved cups not collected | Reserved cups minus cups collected                            |
| Physical cups remaining     | Initial stock minus actual cups distributed                   |

Cup reservations are first-successful-RSVP-first-reserved. Registration order is determined in the database, not by who loaded the page first. Email and Telegram handle are not proof of student identity. Only the exact `@u.nus.edu` domain is accepted, with whitespace trimmed and case normalised. One RSVP per event/email is enforced in Postgres. The form and Edge Function also validate the domain, and the database has its own constraint. Domain validation does not prove mailbox ownership; email verification is not implemented, so someone could still enter another student’s address or use aliases.

A reservation belongs to its ticket. Uncollected cups are not automatically free stock for walk-ins. Cancellation and no-show release policy need organiser agreement; automatic releases are outside the initial version.

Snacks have no quantity limit in this app. Organisers use the RSVP total to plan the snack order. Snack availability is not a database-backed reservation or guarantee.

## First iteration and preview mode

The first iteration includes an attendee page, reservation result, organiser desk, browser-local preview data, Supabase SQL/functions, and Excel export. Preview mode is explicitly labelled and uses synthetic example.com attendees. It sends no email and is not a real authenticated organiser system.

Supabase live mode requires project configuration, migrations, an approved organiser account, and function deployment. Real email additionally requires a Resend account and verified sender domain. These external services are not provisioned by running the frontend.

The UI follows the supplied club website reference: white background, navy `#365486`, light blue `#61afef`, and the user-provided Computing Club logo. The Study Break title uses Georgia italic to match the supplied reference, with the organiser subtitle directly below it. A lightweight SVG shows students sharing a study break and bubble tea, and the footer pairs the supplied club logo with the organiser credit. No official endorsement is implied.

## Local development

```bash
npm install
npm run dev
```

Without Supabase environment variables, the app runs in clearly labelled local preview mode. Use fictional information only. Browser storage is device-local and can be cleared; it is not suitable for a real event across multiple phones.

```bash
npm run check
npm run format:check
npm test
npm run build
```

## Live setup

See [docs/setup.md](docs/setup.md) for the database, organiser provisioning, Edge Function, email and Vercel steps. Never commit .env files or a service-role key.

Frontend variables contain only the Supabase URL, publishable/anon key and event ID. Service-role and email-provider keys belong only in Supabase Edge Function secrets.

## Scope and limitations

- The event date is initially unconfirmed. Snack quantities are planned by organisers from RSVP totals.
- No Telegram automation, stamp rally, QR scanning, payments, cancellation workflow or offline redemption. Ticket codes are searchable; QR scanning can follow later.
- A ticket is a bearer credential; one-time redemption prevents reuse, not sharing before first collection. Organisers can compare the displayed name with the attendee.
- Email may be delayed or filtered. The on-screen ticket remains valid.
- Public RSVP endpoints need abuse controls; capacity transactions do not prove identity.
- The live deployment must be tested with two organiser phones and competing requests before real use. Local tests do not establish hosted service performance or email deliverability.

## AI note

To be very honest, I completely vibe coded this app with Codex, using iterative UI and logic development and repeatedly testing the local preview page. Codex helped write the React UI, database migrations, backend functions, tests and documentation, including helping me edit this note. This was substantial code generation, not just autocomplete.

As an events tech member with limited time (especially with a pile of my own tutorials waiting for me 😭), this is the workflow I would go for, provided I can understand the backend logic and test that the app achieves the organiser’s objective. This would not have been possible in the intended 2–3 hour window without my best friend, Codex. I directed the design changes and behaviour through feedback, including the club colours, simpler form, email restrictions and dashboard workflow.

One assumption I corrected during development was snack allocation: the app initially treated snacks as a limited reservation, but the organiser needs RSVP numbers to decide how much food to order. I removed the snack quota while keeping the 150-cup reservation limit.

I have tested the local preview through registration and check-in, and Codex ran the automated checks listed below. Testing the preview repeatedly is different from testing a live event with multiple users. Supabase, actual email delivery and cross-phone updates still need to be configured and verified before I can claim that workflow works in real use. I am responsible for understanding and reviewing the generated code, including the allocation, duplicate-email and organiser-access rules.

## References

- [Supabase database functions](https://supabase.com/docs/guides/database/functions)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes)
- [Sending email from Supabase](https://supabase.com/docs/guides/functions/examples/send-emails)
- [Vite on Vercel](https://vercel.com/docs/frameworks/frontend/vite)

## Verified in the first iteration

- 16 local tests pass, including the SQL migration in embedded Postgres, access restrictions, retry safety, NUS-only email validation, capacity allocation and duplicate redemption.
- TypeScript checking and the production build pass.
- Browser preview exercised RSVP → ticket → organiser search → arrival → cup collection.
- A downloaded Excel file was reopened and checked for the expected attendee and reservation data.
- Attendee and organiser pages were visually checked at 390px phone width with no horizontal overflow.
- Live Supabase, actual email delivery, cross-device hosted updates and Vercel deployment remain unverified until those accounts are configured.
