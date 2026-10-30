// A brew's local calendar date (YYYY-MM-DD), for roast age: freeze dates and
// roast dates are local dates, so the brew must be too (docs/api/llm-contract.md
// §9). In order: the offset the logging device recorded (brew_logs.
// utc_offset_minutes), else the BREW_TIMEZONE fallback, else UTC.

export function localBrewDate(timestamp: Date, utcOffsetMinutes: number | null, fallbackZone: string | null): string {
  if (utcOffsetMinutes !== null) {
    return new Date(timestamp.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
  }
  if (fallbackZone) {
    // en-CA formats as YYYY-MM-DD.
    return new Intl.DateTimeFormat("en-CA", { timeZone: fallbackZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
  }
  return timestamp.toISOString().slice(0, 10);
}

// BREW_TIMEZONE must be an IANA zone ("America/Los_Angeles"); empty = unset.
export function parseTimeZone(value: string | undefined): string | null {
  const zone = value?.trim();
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(`BREW_TIMEZONE is not a valid time zone: ${zone} (use e.g. America/Los_Angeles)`);
  }
  return zone;
}
