import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Coffee,
  Download,
  ExternalLink,
  LoaderCircle,
  LogOut,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import {
  configurationError,
  getEventSummary,
  hasOrganiserAccess,
  loadRsvps,
  previewMode,
  recordAction,
  register,
  subscribeToRsvps,
  supabase,
} from './lib/api';
import { eventDate, eventTime, filterRsvps, getStats } from './lib/domain';
import type { EventSummary, Rsvp } from './lib/types';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}
function Busy() {
  return <LoaderCircle className="spin" size={18} aria-label="Loading" />;
}

function App() {
  const [summary, setSummary] = useState<EventSummary | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      setSummary(await getEventSummary());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (configurationError)
    return (
      <main className="fatal">
        <h1>Configuration needs a quick fix.</h1>
        <p>Set both the Supabase URL and public key, or remove both to use local preview mode.</p>
      </main>
    );
  const organiser = window.location.pathname.startsWith('/organiser');
  return (
    <>
      {previewMode && (
        <div className="preview-banner">
          <Sparkles size={13} />
          <span>Interactive preview · saved in this browser only · no emails sent</span>
        </div>
      )}
      {organiser && (
        <div className="organiser-nav wrap">
          <a href="/" className="organiser-brand">
            <img src="/comclub-logo.webp" alt="NUS Computing Club" />
            Study Break
          </a>
          <a href="/" className="back-link">
            <ArrowLeft size={15} /> Back to event
          </a>
        </div>
      )}
      {error && (
        <div className="wrap">
          <div className="notice error" role="alert">
            {error}
            <button onClick={() => void refresh()} className="text-button">
              Try again
            </button>
          </div>
        </div>
      )}
      {organiser ? (
        <OrganiserDesk summary={summary} />
      ) : (
        <AttendeePage summary={summary} refresh={refresh} />
      )}
      <footer className="site-footer wrap">
        <span className="footer-organiser">
          <img src="/comclub-logo.webp" alt="Computing Club logo" />
          <span>Organised by NUS Student's Computing Club</span>
        </span>
        {!organiser && <a href="/organiser">Organiser sign in</a>}
      </footer>
    </>
  );
}

function AttendeePage({
  summary,
  refresh,
}: {
  summary: EventSummary | null;
  refresh: () => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [ticket, setTicket] = useState<Rsvp | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('study-break-ticket') || 'null') as Rsvp | null;
    } catch {
      return null;
    }
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const requestId = useRef(sessionStorage.getItem('study-break-request') || crypto.randomUUID());
  const remaining = summary ? Math.max(0, summary.event.cup_capacity - summary.reserved) : null;
  useEffect(() => {
    sessionStorage.setItem('study-break-request', requestId.current);
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await register({ name, email, telegram, requestId: requestId.current });
      setTicket(result);
      // the backend result is valid even if saving the browser copy fails
      try {
        sessionStorage.setItem('study-break-ticket', JSON.stringify(result));
      } catch {
        /* keep the visible ticket */
      }
      await refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function startAgain() {
    setTicket(null);
    setName('');
    setEmail('');
    setTelegram('');
    setCopied(false);
    requestId.current = crypto.randomUUID();
    sessionStorage.removeItem('study-break-ticket');
    sessionStorage.setItem('study-break-request', requestId.current);
  }
  return (
    <main>
      <section className="hero wrap">
        <div className="hero-story">
          <h1 className="study-title">
            Study Break
            <svg className="title-underline" viewBox="0 0 360 18" aria-hidden="true">
              <path d="M5 13Q175 1 355 11" />
            </svg>
          </h1>
          <p className="event-organiser">Organised by NUS Student's Computing Club</p>
          <div className="event-pills">
            <span>
              <MapPin size={16} /> {summary?.event.location || 'COM1 foyer'}
            </span>
            <span>
              <Clock3 size={16} />{' '}
              {eventTime(summary?.event.starts_at ?? null, summary?.event.ends_at ?? null)}
            </span>
          </div>
          <div className="event-date">
            <CalendarDays size={16} /> {eventDate(summary?.event.starts_at ?? null)}
            {!summary?.event.starts_at && (
              <span>We’ll confirm the date before real RSVPs open.</span>
            )}
          </div>
          <img
            className="study-illustration"
            src="/study-break-students.svg"
            alt="Two students taking a break together with bubble tea"
          />
        </div>
        <div className="rsvp-column" id="rsvp">
          <div className="rsvp-card">
            <div className="card-topline">
              <span>
                <Ticket size={16} /> STUDY BREAK REGISTRATION
              </span>
              <span>FREE ENTRY</span>
            </div>
            {ticket ? (
              <div className="ticket-result" aria-live="polite">
                <div className="success-icon">
                  <Check size={28} />
                </div>
                <p className="eyebrow">YOU’RE ON THE LIST</p>
                <h2>
                  See you there,
                  <br />
                  {ticket.name.split(' ')[0]}.
                </h2>
                <p>
                  {ticket.bubble_tea_reserved
                    ? 'A bubble tea has your name on it. Bring this ticket to the organiser desk.'
                    : 'The bbt squad filled all 150 spots 🧋 You’re still welcome to join the break! No bubble tea is reserved for this ticket.'}
                </p>
                <div className="ticket-box">
                  <span>YOUR TICKET CODE</span>
                  <strong>{ticket.ticket_code}</strong>
                  <button
                    className="text-button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(ticket.ticket_code);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? 'Copied!' : 'Copy code'}
                  </button>
                </div>
                <p className="notice">
                  <strong>Screenshot your ticket before closing this page 📸</strong>
                  <br />
                  Show it to an organiser when you arrive.
                </p>
                <div className="ticket-entitlement">
                  <Coffee size={18} />
                  <span>
                    {ticket.bubble_tea_reserved
                      ? '1 bubble tea reserved'
                      : 'Attendance confirmed · no bubble tea reserved'}
                  </span>
                </div>
                <p className="small-note">
                  {previewMode
                    ? 'Preview ticket only. No email was sent.'
                    : ticket.email_status === 'accepted'
                      ? `Confirmation email requested for ${ticket.email}. Check spam too; keep this ticket if delivery is delayed.`
                      : ticket.email_status === 'not_configured'
                        ? 'Your RSVP is saved. Email confirmations are not set up yet; save this ticket code or take a screenshot.'
                        : 'Your RSVP is saved, but email could not be sent. Save this ticket code or take a screenshot.'}
                </p>
                <button className="button secondary full" onClick={startAgain}>
                  Register another person <ArrowRight size={16} />
                </button>
              </div>
            ) : (
              <>
                <div className="form-heading">
                  <h2>RSVP</h2>
                  <p>Enter your details to register.</p>
                </div>
                <div className={`availability ${remaining === 0 ? 'sold-out' : ''}`}>
                  <span className="availability-icon">
                    <Coffee size={21} />
                  </span>
                  <div>
                    <strong>
                      {remaining === null
                        ? 'Loading availability…'
                        : remaining === 0
                          ? 'All 150 bubble teas are reserved'
                          : `${remaining} bubble teas available`}
                    </strong>
                    <span>
                      {remaining === 0
                        ? 'You can still RSVP and join us for the break.'
                        : 'First 150 successful RSVPs get a reserved cup.'}
                    </span>
                  </div>
                </div>
                <form onSubmit={(event) => void submit(event)}>
                  <label htmlFor="name">
                    Your name <span>*</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    autoComplete="name"

                    required
                    minLength={2}
                    maxLength={80}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <label htmlFor="email">
                    NUS student email <span>*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    pattern={String.raw`[^\s@]+@[uU]\.[nN][uU][sS]\.[eE][dD][uU]`}
                    title="Use your NUS student email ending in @u.nus.edu."
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <small>
                    {previewMode
                      ? 'Use your @u.nus.edu address. Preview mode does not send email.'
                      : 'Use your @u.nus.edu address. Save the ticket shown after RSVP.'}
                  </small>
                  <label htmlFor="telegram">
                    Telegram handle <em>optional</em>
                  </label>
                  <input
                    id="telegram"
                    name="telegram"
                    autoComplete="off"
                    maxLength={33}
                    value={telegram}
                    onChange={(e) => setTelegram(e.target.value)}
                  />
                  <small>Only for organisers to contact you about this event.</small>
                  <label className="consent">
                    <input type="checkbox" required />
                    <span>
                      I’m happy for organisers to use these details for this event and its updates.
                    </span>
                  </label>
                  {error && (
                    <div className="notice error" role="alert">
                      {error}
                    </div>
                  )}
                  <button
                    className="button primary full"
                    disabled={busy || !summary || !summary.event.reservations_open}
                  >
                    {busy ? (
                      <Busy />
                    ) : (
                      <>
                        {summary && !summary.event.reservations_open
                          ? 'RSVPs haven’t opened yet'
                          : 'RSVP'}{' '}
                        <ArrowRight size={18} />
                      </>
                    )}
                  </button>
                  <div className="form-footnote">
                    <ShieldCheck size={13} /> Your details stay with the organising team.
                  </div>
                </form>
              </>
            )}
          </div>
          <p className="snack-note">RSVP numbers help the organisers plan the snack order.</p>
        </div>
      </section>
    </main>
  );
}

function OrganiserDesk({ summary }: { summary: EventSummary | null }) {
  const [allowed, setAllowed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<Rsvp[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [connected, setConnected] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  useEffect(() => {
    hasOrganiserAccess()
      .then(setAllowed)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setChecking(false));
  }, []);
  const refresh = useCallback(async () => {
    try {
      const result = await loadRsvps();
      setRows(result);
      setLastUpdated(new Date());
      setError('');
    } catch (e) {
      setError(errorMessage(e));
      setConnected(false);
    }
  }, []);
  useEffect(() => {
    if (!allowed) return;
    void refresh();
    const unsubscribe = subscribeToRsvps(() => void refresh(), setConnected);
    const offline = () => setConnected(false);
    const online = () => {
      if (previewMode) setConnected(true);
      void refresh();
    };
    const timer = window.setInterval(() => {
      if (navigator.onLine) void refresh();
    }, 30000);
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('offline', offline);
      window.removeEventListener('online', online);
    };
  }, [allowed, refresh]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { error: loginError } = await supabase!.auth.signInWithPassword({ email, password });
      if (loginError) throw new Error('Could not sign in. Check your email and password.');
      const access = await hasOrganiserAccess();
      if (!access) {
        await supabase!.auth.signOut();
        throw new Error('This account is not on the approved organiser list.');
      }
      setAllowed(true);
      setPassword('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(row: Rsvp, kind: 'arrive' | 'cup') {
    if (activeId || !navigator.onLine) return;
    setActiveId(row.id);
    setError('');
    setNotice('');
    try {
      await recordAction(row.id, kind);
      setNotice(`${row.name}: ${kind === 'arrive' ? 'checked in' : 'bubble tea collected'}.`);
      await refresh();
    } catch (e) {
      await refresh();
      setError(errorMessage(e));
    } finally {
      setActiveId(null);
    }
  }
  async function exportExcel() {
    setExporting(true);
    setError('');
    try {
      const snapshot = await loadRsvps();
      const { default: ExcelJS } = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('RSVPs');
      sheet.columns = [
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Email', key: 'email', width: 35 },
        { header: 'Telegram', key: 'telegram_handle', width: 22 },
        { header: 'Ticket', key: 'ticket_code', width: 18 },
        { header: 'Bubble tea reserved', key: 'bubble_tea_reserved', width: 22 },
        { header: 'Arrived (UTC)', key: 'checked_in_at', width: 28 },
        { header: 'Cup collected (UTC)', key: 'cup_collected_at', width: 28 },
        { header: 'RSVP created (UTC)', key: 'created_at', width: 28 },
      ];
      snapshot.forEach((row) =>
        sheet.addRow({ ...row, bubble_tea_reserved: row.bubble_tea_reserved ? 'Yes' : 'No' }),
      );
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF365486' } };
      sheet.views = [{ state: 'frozen', ySplit: 1 }];
      sheet.autoFilter = 'A1:H1';
      const buffer = await workbook.xlsx.writeBuffer();
      const url = URL.createObjectURL(
        new Blob([buffer as BlobPart], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `study-break-rsvps-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(
        `Exported ${snapshot.length} RSVPs. This file is a snapshot, not a live check-in system.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }
  if (checking)
    return (
      <main className="wrap desk-loading">
        <Busy /> Checking organiser access…
      </main>
    );
  if (!allowed)
    return (
      <main className="login-layout wrap">
        <div>
          <span className="eyebrow">BEHIND THE BUBBLE TEA</span>
          <h1>
            The organiser
            <br />
            <span>desk.</span>
          </h1>
          <p>
            One shared view of the night.
            <br />
            Fewer spreadsheets at the door.
          </p>
          <div className="login-perks">
            <p>
              <CheckCircle2 size={18} /> Live RSVPs and food-order numbers
            </p>
            <p>
              <CheckCircle2 size={18} /> Separate arrival and cup collection
            </p>
            <p>
              <CheckCircle2 size={18} /> One ticket, one drink
            </p>
          </div>
        </div>
        <section className="login-card">
          <ShieldCheck size={30} />
          <h2>{previewMode ? 'Try the organiser desk' : 'Organiser sign-in'}</h2>
          <p>
            {previewMode
              ? 'Explore with three fictional attendees. This is a browser-local preview, not a secured live dashboard.'
              : 'Only approved organisers can access attendee details.'}
          </p>
          {previewMode ? (
            <button
              className="button primary full"
              onClick={() => {
                sessionStorage.setItem('preview-organiser', 'yes');
                setAllowed(true);
              }}
            >
              Open demo desk <ArrowRight size={17} />
            </button>
          ) : (
            <form onSubmit={(e) => void login(e)}>
              <label htmlFor="staff-email">Organiser email</label>
              <input
                id="staff-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <label htmlFor="staff-password">Password</label>
              <input
                id="staff-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button className="button primary full" disabled={busy}>
                {busy ? <Busy /> : 'Sign in'}
              </button>
            </form>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
            </div>
          )}
          <p className="small-note">Attendees never need to log in.</p>
        </section>
      </main>
    );
  const stats = getStats(rows, summary?.event.cup_capacity ?? 150);
  const filtered = filterRsvps(rows, query, filter);
  return (
    <main className="wrap dashboard">
      <div className="desk-heading">
        <div>
          <span className="eyebrow">STUDY BREAK NIGHT / ORGANISER DESK</span>
          <h1>Let’s keep the queue moving.</h1>
          <p>{eventDate(summary?.event.starts_at ?? null)} · COM1 foyer · 7–9 pm</p>
        </div>
        <button
          className="button quiet"
          onClick={async () => {
            if (previewMode) sessionStorage.removeItem('preview-organiser');
            else await supabase!.auth.signOut();
            setAllowed(false);
            setRows([]);
          }}
        >
          <LogOut size={16} /> Sign out
        </button>
      </div>
      <div className="connection-line">
        <span className={connected ? 'connection online' : 'connection offline'}>
          {connected ? <Wifi size={14} /> : <WifiOff size={14} />}
          {connected
            ? previewMode
              ? 'Browser preview connected'
              : 'Live connection'
            : 'Reconnecting · verify counts before serving'}
        </span>
        <span>
          {lastUpdated
            ? `Updated ${lastUpdated.toLocaleTimeString('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' })}`
            : 'Loading attendees…'}
        </span>
        <button className="text-button" onClick={() => void refresh()}>
          <RefreshCw size={13} /> Refresh
        </button>
      </div>
      <div className="stats-grid">
        <Stat
          label="Total RSVPs"
          value={stats.rsvps}
          note="Use this for the snack order"
          icon={<Users size={20} />}
        />
        <Stat
          label="People arrived"
          value={stats.arrivals}
          note={`${Math.max(0, stats.rsvps - stats.arrivals)} still expected`}
          icon={<CheckCircle2 size={20} />}
        />
        <Stat
          label="Cups reserved"
          value={stats.reserved}
          note={`${stats.available} available to reserve`}
          icon={<Coffee size={20} />}
        />
        <Stat
          label="Cups collected"
          value={stats.collected}
          note={`${stats.uncollected} reserved, not collected`}
          icon={<Ticket size={20} />}
        />
      </div>
      <div className="stock-note">
        <Coffee size={17} />
        <span>
          <strong>{stats.physical} cups physically remaining.</strong> Uncollected reservations
          still belong to their ticket holders. Snacks are planned from the RSVP total, with no
          app-enforced quota.
        </span>
      </div>
      <section className="attendee-panel">
        <div className="panel-heading">
          <div>
            <h2>Guest list & check-in</h2>
            <p>Find the ticket. Confirm the name. Hand over the good stuff.</p>
          </div>
          <button
            className="button secondary"
            onClick={() => void exportExcel()}
            disabled={exporting}
          >
            {exporting ? <Busy /> : <Download size={16} />} Export Excel
          </button>
        </div>
        <div className="desk-toolbar">
          <label className="search-box">
            <Search size={18} />
            <span className="sr-only">Search attendees</span>
            <input
              placeholder="Name, email, Telegram or ticket code"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="filters" aria-label="Filter attendees">
            {[
              ['all', 'Everyone'],
              ['waiting', 'Not arrived'],
              ['arrived', 'Arrived'],
              ['cups', 'Cup pending'],
            ].map(([value, label]) => (
              <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice success" role="status">
            {notice}
          </div>
        )}
        <div className="list-summary">
          {filtered.length} {filtered.length === 1 ? 'attendee' : 'attendees'} shown
        </div>
        <div className="attendee-list">
          {filtered.map((row) => (
            <article className="attendee-row" key={row.id}>
              <div className="attendee-avatar" aria-hidden="true">
                {row.name
                  .split(' ')
                  .map((word) => word[0])
                  .slice(0, 2)
                  .join('')}
              </div>
              <div className="attendee-details">
                <h3>
                  {row.name}
                  <span className={`status-pill ${row.checked_in_at ? 'arrived' : ''}`}>
                    {row.checked_in_at ? 'Arrived' : 'Expected'}
                  </span>
                </h3>
                <p>{row.email}</p>
                <div className="attendee-meta">
                  <code>{row.ticket_code}</code>
                  {row.telegram_handle && (
                    <a
                      href={`https://t.me/${encodeURIComponent(row.telegram_handle)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      @{row.telegram_handle} <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              </div>
              <div className="cup-status">
                <Coffee size={16} />
                <span>
                  {row.cup_collected_at
                    ? 'Cup collected'
                    : row.bubble_tea_reserved
                      ? '1 cup reserved'
                      : 'No cup reserved'}
                </span>
              </div>
              <div className="row-actions">
                <button
                  className="button secondary"
                  disabled={!!row.checked_in_at || activeId !== null || !connected}
                  onClick={() => void action(row, 'arrive')}
                >
                  {row.checked_in_at ? <Check size={15} /> : null}
                  {row.checked_in_at ? 'Checked in' : 'Check in'}
                </button>
                {row.bubble_tea_reserved && (
                  <button
                    className="button primary"
                    disabled={
                      !row.checked_in_at ||
                      !!row.cup_collected_at ||
                      activeId !== null ||
                      !connected
                    }
                    onClick={() => void action(row, 'cup')}
                  >
                    {activeId === row.id ? (
                      <Busy />
                    ) : row.cup_collected_at ? (
                      <Check size={15} />
                    ) : (
                      <Coffee size={15} />
                    )}
                    {row.cup_collected_at ? 'Collected' : 'Give cup'}
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        {!filtered.length && (
          <div className="empty-state">
            <Search size={28} />
            <h3>{rows.length ? 'No matching tickets.' : 'The guest list starts here.'}</h3>
            <p>
              {rows.length
                ? 'Try a name, email or the code on the confirmation ticket.'
                : 'New RSVPs will appear here. No snack quantity needs to be set.'}
            </p>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  note,
  icon,
}: {
  label: string;
  value: number;
  note: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="stat-card">
      <span>
        {label}
        {icon}
      </span>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}

export default App;
