import 'server-only';

// Today's date and the browser's time zone go into every prompt (BUILD-LEARNINGS rule 17
// and Part 8, Time). The month is spelled out, because "07/08" is ambiguous to a model.

/** IANA names only: letters, digits, "_", "+", "-" and "/". Nothing that could carry text into a prompt. */
const TIME_ZONE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/;

/** The canonical IANA name for a time zone the browser sent, or null when it is not one. */
export function resolveTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !TIME_ZONE_PATTERN.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? '';
}

/** "UTC+02:00" from Intl's "GMT+02:00"; plain "GMT" (UTC itself) becomes "UTC+00:00". */
function offsetOf(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'longOffset' }).formatToParts(now);
  const name = part(parts, 'timeZoneName');
  const offset = name.replace(/^GMT/, '');
  return `UTC${offset === '' ? '+00:00' : offset}`;
}

/**
 * The date line of a prompt, in the person's time zone: for example
 * "Wednesday 7 October 2026, 22:45 in the person's time zone (Europe/Paris, UTC+02:00)".
 * Throws a RangeError for a name that is not a time zone (check it with resolveTimeZone first).
 */
export function formatTurnDate(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const date = `${part(parts, 'weekday')} ${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
  const time = `${part(parts, 'hour')}:${part(parts, 'minute')}`;
  return `${date}, ${time} in the person's time zone (${timeZone}, ${offsetOf(now, timeZone)})`;
}
