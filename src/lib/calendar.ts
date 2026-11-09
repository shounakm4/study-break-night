import type { EventDetails } from './types';

const timestamp = (date: Date) => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
const escapeText = (text: string) =>
  text
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/[,;]/g, '\\$&');

// fold by UTF-8 bytes without splitting an emoji or other multi-byte character
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  let result = '';
  let bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) {
      result += '\r\n ';
      bytes = 1;
    }
    result += character;
    bytes += size;
  }
  return result;
}

export function buildEventCalendar(
  event: EventDetails,
  pageUrl: string,
  now = new Date(),
): string | null {
  if (!event.starts_at || !event.ends_at) return null;
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
    return null;
  // use a public event link, without query parameters or attendee ticket details
  const url = new URL('/', pageUrl);
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Study Break//Event Calendar//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${escapeText(event.id)}@${url.hostname}`,
      `DTSTAMP:${timestamp(now)}`,
      `DTSTART:${timestamp(start)}`,
      `DTEND:${timestamp(end)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `LOCATION:${escapeText(event.location)}`,
      `DESCRIPTION:${escapeText("Organised by NUS Student's Computing Club.\nRSVP separately and keep your ticket for check-in.")}`,
      `URL:${url.href}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ]
      .map(foldLine)
      .join('\r\n') + '\r\n'
  );
}
