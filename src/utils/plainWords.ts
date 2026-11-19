/**
 * Plain words for the simple view, so someone with no aviation background can read the forecast.
 * The numbers stay available underneath in small print and in Pro view.
 */

/** Forecast hours are UTC ("2026-11-19T12:00"). Returns the UK clock time, e.g. "12:00" or "13:00" in summer. */
export function ukLocalTime(hourIsoUtc: string): string {
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(hourIsoUtc) ? hourIsoUtc : `${hourIsoUtc}Z`);
  if (Number.isNaN(d.getTime())) return hourIsoUtc.slice(11, 16);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** Wind gusts in knots → "Light wind" … "Very strong wind". */
export function windWords(gustKts: number | null): string {
  if (gustKts === null) return 'Not known';
  if (gustKts < 15) return 'Light wind';
  if (gustKts < 28) return 'Breezy';
  if (gustKts < 42) return 'Windy';
  if (gustKts < 55) return 'Strong wind';
  return 'Very strong wind';
}

/** Significant wave height in metres → "Calm sea" … "Very rough sea". */
export function seaWords(waveM: number | null, isShore: boolean): string {
  if (waveM === null) return isShore ? 'Not at sea' : 'Not known';
  if (waveM < 1) return 'Calm sea';
  if (waveM < 2.5) return 'Moderate sea';
  if (waveM < 4) return 'Rough sea';
  if (waveM < 6) return 'Very rough sea';
  return 'Huge waves';
}

/** Cloud base in feet → plain words. */
export function cloudWords(ceilingFt: number | null, noLowCloud = false): string {
  if (noLowCloud) return 'No low cloud';
  if (ceilingFt === null) return 'Not known';
  if (ceilingFt < 300) return 'Fog or very low cloud';
  if (ceilingFt < 800) return 'Low cloud';
  if (ceilingFt < 2000) return 'Some cloud';
  return 'Cloud high enough';
}
