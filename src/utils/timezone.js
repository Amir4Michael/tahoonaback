/**
 * Every "day boundary" calculation in this project (report date ranges,
 * "today"'s cashbox totals, activity/audit log filters, etc.) is meant to
 * mean a calendar day in EGYPT, since that's where this shop operates —
 * but plain `new Date(\`${from}T00:00:00\`)` / `date.setHours(0,0,0,0)`
 * both resolve against whatever timezone the Node process itself is
 * running in. That's invisible and correct on a machine set to Cairo time,
 * but silently wrong (by whatever the server's UTC offset is) on most
 * cloud hosting, which defaults to UTC — e.g. a sale made at 12:30am Cairo
 * time could still get counted as "yesterday" until the server's own
 * midnight arrives, hours later.
 *
 * This file is the single place that knows about Egypt's timezone, so
 * every date-range/day-boundary calculation in the codebase can anchor to
 * it explicitly instead of relying on the server's local clock.
 */

const CAIRO_TZ = 'Africa/Cairo';

/**
 * Egypt's current UTC offset (e.g. "+02:00"), resolved dynamically via
 * Intl so this stays correct even if Egypt's DST rules change in the
 * future (they have flip-flopped on this before) — NOT hardcoded, on
 * purpose. Falls back to the fixed offset Egypt has observed for most of
 * the last decade if the runtime's ICU data doesn't support
 * `timeZoneName: 'longOffset'` (older Node without full-icu).
 */
function cairoUtcOffset(date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: CAIRO_TZ,
      timeZoneName: 'longOffset',
    }).formatToParts(date);
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value; // e.g. "GMT+02:00"
    if (tzName && /^GMT[+-]\d{2}:\d{2}$/.test(tzName)) {
      return tzName.slice(3);
    }
  } catch {
    // fall through to the fixed fallback below
  }
  return '+02:00';
}

/** The calendar date (YYYY-MM-DD) it currently is in Cairo, regardless of the server's own clock/timezone. */
function cairoDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CAIRO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The UTC instant corresponding to 00:00:00.000 in Cairo on the given
 * YYYY-MM-DD calendar date (or "today in Cairo" if omitted) — the correct
 * replacement for `new Date(\`${dateStr}T00:00:00\`)`.
 */
export function cairoDayStart(dateStr) {
  const ymd = dateStr || cairoDateString();
  const offset = cairoUtcOffset(new Date(`${ymd}T00:00:00Z`));
  return new Date(`${ymd}T00:00:00.000${offset}`);
}

/**
 * The UTC instant corresponding to 23:59:59.999 in Cairo on the given
 * YYYY-MM-DD calendar date (or "today in Cairo" if omitted) — the correct
 * replacement for `new Date(\`${dateStr}T23:59:59\`)`.
 */
export function cairoDayEnd(dateStr) {
  const ymd = dateStr || cairoDateString();
  const offset = cairoUtcOffset(new Date(`${ymd}T23:59:59Z`));
  return new Date(`${ymd}T23:59:59.999${offset}`);
}

/** { start, end } for "today in Cairo" — the correct replacement for the setHours(0,0,0,0)/setHours(23,59,59,999) pattern. */
export function cairoTodayBounds() {
  const ymd = cairoDateString();
  return { start: cairoDayStart(ymd), end: cairoDayEnd(ymd) };
}

/**
 * { start, end } for "this calendar month in Cairo" — the correct
 * replacement for `new Date(now.getFullYear(), now.getMonth(), 1, ...)`,
 * which (like the day-boundary pattern above) resolves against the
 * server's own local time rather than Cairo's.
 */
export function cairoMonthBounds() {
  const ymd = cairoDateString(); // e.g. "2026-09-11"
  const [year, month] = ymd.split('-').map(Number); // month is 1-indexed here
  const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
  // Day 0 of next month == last day of this month (JS Date normalizes this
  // for the *server's* calendar, which is fine here since only the
  // day-of-month number is used, not the instant itself).
  const lastDayNum = new Date(year, month, 0).getDate();
  const lastDay = `${year}-${String(month).padStart(2, '0')}-${String(lastDayNum).padStart(2, '0')}`;
  return { start: cairoDayStart(firstDay), end: cairoDayEnd(lastDay) };
}

/**
 * Builds a MongoDB range match object ({ $gte, $lte }) from optional
 * YYYY-MM-DD `from`/`to` query strings, anchored to Cairo day boundaries.
 * Returns {} if neither is given (matches the existing dateRangeMatch
 * behavior this replaces across the codebase).
 */
export function cairoRangeMatch(from, to) {
  if (!from && !to) return {};
  const range = {};
  if (from) range.$gte = cairoDayStart(from);
  if (to) range.$lte = cairoDayEnd(to);
  return range;
}