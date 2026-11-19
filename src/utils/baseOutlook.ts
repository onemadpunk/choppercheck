/**
 * Shore base / heliport outlook: a quick 48-hour look at flying conditions around a base, for
 * crews checking from home before a shift or after a call-out.
 *
 * Everything here is an ESTIMATE built from forecast models and terrain data. It is not a
 * set of operating limits and does not replace the operator's own met briefing.
 */
import type { ModelPointSnapshot, MultiModelHourEntry, WeatherModelId } from '../types/radar';
import { NO_CEILING_FT } from './solarAndMetUtils';

const RAD = Math.PI / 180;
const NM_TO_KM = 1.852;
const M_TO_FT = 3.28084;

// ---------------------------------------------------------------------------
// Terrain around a base
// ---------------------------------------------------------------------------

/** Radii (NM) and number of bearings sampled for the "highest ground nearby" check. */
export const TERRAIN_RADII_NM = [3, 6, 10, 15, 20, 25] as const;
export const TERRAIN_BEARINGS = 16;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface TerrainSamplePoint extends LatLon {
  distanceNm: number;
  bearingDeg: number;
}

/** Point at a given distance and bearing (great-circle, spherical Earth). */
export function destinationPoint(lat: number, lon: number, distanceNm: number, bearingDeg: number): LatLon {
  const R = 6371; // km
  const d = (distanceNm * NM_TO_KM) / R;
  const brg = bearingDeg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(brg));
  const l2 = l1 + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 / RAD, lon: ((((l2 / RAD) + 540) % 360) - 180) };
}

/** Ring of sample points around a base (6 radii x 16 bearings = 96 points, under the API's 100). */
export function buildTerrainSamplePoints(lat: number, lon: number): TerrainSamplePoint[] {
  const pts: TerrainSamplePoint[] = [];
  for (const r of TERRAIN_RADII_NM) {
    for (let i = 0; i < TERRAIN_BEARINGS; i++) {
      const bearingDeg = (360 / TERRAIN_BEARINGS) * i;
      pts.push({ ...destinationPoint(lat, lon, r, bearingDeg), distanceNm: r, bearingDeg });
    }
  }
  return pts;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function compass8(bearingDeg: number): string {
  return COMPASS_8[Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8];
}

export interface TerrainHighPoint {
  heightFt: number;
  distanceNm: number;
  bearingDeg: number;
  direction: string;
}

export interface TerrainSummary {
  /** Highest sampled ground within 25 NM. */
  highest: TerrainHighPoint;
  /** Highest sampled ground within 10 NM (the local area around the base). */
  highestWithin10Nm: TerrainHighPoint;
  /** Highest ground in each of the 8 compass sectors, N first. */
  bySector: Array<TerrainHighPoint & { sector: string }>;
  sampleCount: number;
}

/**
 * Summarises sampled terrain heights. Sea points come back as 0 m. Returns null when there are
 * no usable heights.
 */
export function summariseTerrain(points: TerrainSamplePoint[], elevationsM: Array<number | null>): TerrainSummary | null {
  const rows = points
    .map((p, i) => ({ p, m: elevationsM[i] }))
    .filter((r): r is { p: TerrainSamplePoint; m: number } => typeof r.m === 'number' && Number.isFinite(r.m));
  if (rows.length === 0) return null;
  const toHigh = (r: { p: TerrainSamplePoint; m: number }): TerrainHighPoint => ({
    heightFt: Math.max(0, Math.round(r.m * M_TO_FT)),
    distanceNm: r.p.distanceNm,
    bearingDeg: r.p.bearingDeg,
    direction: compass8(r.p.bearingDeg),
  });
  const maxOf = (list: typeof rows) => list.reduce((a, b) => (b.m > a.m ? b : a), list[0]);
  const near = rows.filter((r) => r.p.distanceNm <= 10);
  const bySector = COMPASS_8.map((sector) => {
    const inSector = rows.filter((r) => compass8(r.p.bearingDeg) === sector);
    if (inSector.length === 0) return { sector, heightFt: 0, distanceNm: 0, bearingDeg: 0, direction: sector };
    return { sector, ...toHigh(maxOf(inSector)) };
  });
  return {
    highest: toHigh(maxOf(rows)),
    highestWithin10Nm: toHigh(maxOf(near.length ? near : rows)),
    bySector,
    sampleCount: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Moon (low-precision formulas after Meeus / SunCalc; good to about a degree)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const J1970 = 2440588;
const J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;

const toDays = (ms: number) => ms / DAY_MS - 0.5 + J1970 - J2000;
const rightAscension = (l: number, b: number) =>
  Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
const declination = (l: number, b: number) =>
  Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));

function sunCoords(d: number) {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  return { ra: rightAscension(l, b), dec: declination(l, b), distKm: 385001 - 20905 * Math.cos(M) };
}

/** Fraction of the Moon's disc that is lit (0 = new, 1 = full). */
export function moonIlluminationFraction(atMs: number): number {
  const d = toDays(atMs);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sunDistKm = 149598000;
  const phi = Math.acos(
    Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)
  );
  const inc = Math.atan2(sunDistKm * Math.sin(phi), m.distKm - sunDistKm * Math.cos(phi));
  return (1 + Math.cos(inc)) / 2;
}

/** Moon altitude above the horizon in degrees. */
export function moonAltitudeDeg(atMs: number, lat: number, lon: number): number {
  const d = toDays(atMs);
  const m = moonCoords(d);
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) - lw - m.ra;
  const h = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H));
  return h / RAD;
}

// ---------------------------------------------------------------------------
// Hour rating
// ---------------------------------------------------------------------------

export type BaseOutlookLevel = 'GOOD' | 'MARGINAL' | 'POOR';

/** ChopperCheck's own rough guide. These are not SAR or operator limits. */
export const BASE_OUTLOOK_GUIDE = {
  poorCeilingFt: 500,
  poorVisKm: 1.5,
  poorGustKts: 50,
  marginalCeilingFt: 1000,
  marginalVisKm: 5,
  marginalGustKts: 35,
  /** Freezing level within this many feet above the hills counts as icing risk in cloud over them. */
  icingMarginFt: 1000,
} as const;

export interface BaseOutlookRow {
  hourIso: string;
  dayNameShort: string;
  hourLabel: string;
  isNight: boolean;
  level: BaseOutlookLevel;
  reasons: string[];
  /** Cloud base above the airfield (ft); null when there is no ceiling (under 5/8 low cloud). */
  ceilingFt: number | null;
  /** Cloud base above sea level (ft), for comparing with the hills. */
  cloudBaseAmslFt: number | null;
  hillsInCloud: boolean;
  freezingLevelFt: number;
  visibilityKm: number;
  windKts: number;
  windDirDeg: number;
  gustKts: number;
  wind1500ftKts: number;
  wind1500ftDirDeg: number;
  precipMmHr: number;
  lightning: 'LOW' | 'MODERATE' | 'HIGH';
  /** From the airport's own METAR rather than a model (current hour only). */
  reported: boolean;
  moonPercent: number | null;
  moonUp: boolean | null;
}

export interface ReportedNow {
  ceilingFt: number | null; // null = no ceiling
  visibilityKm: number | null;
  windKts: number | null;
  gustKts: number | null;
  windDirDeg: number | null;
}

export function rateBaseHour(params: {
  snap: ModelPointSnapshot;
  baseElevationFt: number;
  hillsFt: number | null;
  reported?: ReportedNow | null;
}): Pick<
  BaseOutlookRow,
  | 'level'
  | 'reasons'
  | 'ceilingFt'
  | 'cloudBaseAmslFt'
  | 'hillsInCloud'
  | 'visibilityKm'
  | 'windKts'
  | 'gustKts'
  | 'windDirDeg'
  | 'reported'
> {
  const { snap, baseElevationFt, hillsFt, reported } = params;
  const G = BASE_OUTLOOK_GUIDE;
  const rawCeiling = reported ? reported.ceilingFt : snap.cloudCeilingFt >= NO_CEILING_FT ? null : snap.cloudCeilingFt;
  const ceilingFt = typeof rawCeiling === 'number' && Number.isFinite(rawCeiling) ? rawCeiling : null;
  const visibilityKm = reported?.visibilityKm ?? snap.visibilityKm;
  const windKts = reported?.windKts ?? snap.windSpeed10mKts;
  const gustKts = Math.max(windKts, reported ? reported.gustKts ?? windKts : snap.windGust10mKts);
  const windDirDeg = reported ? reported.windDirDeg ?? snap.windDir10mDeg : snap.windDir10mDeg;
  const cloudBaseAmslFt = ceilingFt === null ? null : ceilingFt + Math.max(0, baseElevationFt);
  const hillsInCloud = hillsFt !== null && cloudBaseAmslFt !== null && cloudBaseAmslFt <= hillsFt;

  const poor: string[] = [];
  const marginal: string[] = [];
  if (ceilingFt !== null && ceilingFt < G.poorCeilingFt) poor.push(`cloud base ${ceilingFt} ft`);
  else if (ceilingFt !== null && ceilingFt < G.marginalCeilingFt) marginal.push(`cloud base ${ceilingFt} ft`);
  if (hillsInCloud && hillsFt !== null) marginal.push(`hills (${hillsFt.toLocaleString()} ft) in cloud`);
  if (visibilityKm < G.poorVisKm) poor.push(`visibility ${visibilityKm} km`);
  else if (visibilityKm < G.marginalVisKm) marginal.push(`visibility ${visibilityKm} km`);
  if (gustKts >= G.poorGustKts) poor.push(`gusts ${gustKts} kt`);
  else if (gustKts >= G.marginalGustKts) marginal.push(`gusts ${gustKts} kt`);
  const lightning = snap.lightningRisk ?? 'LOW';
  if (lightning === 'HIGH') poor.push(snap.lightningType === 'NATURAL_TS' ? 'thunderstorms' : 'triggered lightning risk');
  else if (lightning === 'MODERATE')
    marginal.push(snap.lightningType === 'TRIGGERED_WINTER' ? 'triggered lightning caution' : 'heavy showers');
  const wetOrCloudy = snap.precipMmHr >= 0.2 || (hillsFt !== null && cloudBaseAmslFt !== null && cloudBaseAmslFt <= hillsFt + G.icingMarginFt);
  if (hillsFt !== null && snap.freezingLevelFt > 0 && snap.freezingLevelFt <= hillsFt + G.icingMarginFt && wetOrCloudy) {
    marginal.push(`freezing level ${snap.freezingLevelFt.toLocaleString()} ft (icing in cloud over the hills)`);
  }

  const level: BaseOutlookLevel = poor.length ? 'POOR' : marginal.length ? 'MARGINAL' : 'GOOD';
  return {
    level,
    reasons: [...poor, ...marginal],
    ceilingFt,
    cloudBaseAmslFt,
    hillsInCloud,
    visibilityKm,
    windKts,
    gustKts,
    windDirDeg,
    reported: Boolean(reported),
  };
}

/**
 * Builds the outlook from the hour containing `nowMs`, for `hours` hours, every `stepHours`.
 * `reportedNow` (from the base's own fresh METAR) replaces the model for the current hour only.
 */
export function buildBaseOutlook(params: {
  hourly: MultiModelHourEntry[];
  modelId: WeatherModelId;
  lat: number;
  lon: number;
  baseElevationFt: number;
  hillsFt: number | null;
  nowMs: number;
  hours?: number;
  stepHours?: number;
  reportedNow?: ReportedNow | null;
}): BaseOutlookRow[] {
  const { hourly, modelId, lat, lon, baseElevationFt, hillsFt, nowMs, reportedNow } = params;
  const hours = params.hours ?? 48;
  const step = Math.max(1, params.stepHours ?? 3);
  const startOf = (h: MultiModelHourEntry) => new Date(h.hourIso + 'Z').getTime();
  let startIdx = hourly.findIndex((h) => nowMs >= startOf(h) && nowMs < startOf(h) + 3600_000);
  if (startIdx < 0) startIdx = hourly.findIndex((h) => startOf(h) >= nowMs);
  if (startIdx < 0) return [];

  const rows: BaseOutlookRow[] = [];
  for (let i = startIdx; i < Math.min(hourly.length, startIdx + hours); i += step) {
    const h = hourly[i];
    const snap = h.models[modelId];
    if (!snap) continue;
    const isCurrent = i === startIdx && nowMs >= startOf(h) && nowMs < startOf(h) + 3600_000;
    const rated = rateBaseHour({
      snap,
      baseElevationFt,
      hillsFt,
      reported: isCurrent ? reportedNow ?? null : null,
    });
    const isNight = Boolean(h.isNight);
    const midMs = startOf(h) + 1800_000;
    rows.push({
      hourIso: h.hourIso,
      dayNameShort: h.dayNameShort,
      hourLabel: h.hourLabel,
      isNight,
      ...rated,
      freezingLevelFt: snap.freezingLevelFt,
      wind1500ftKts: snap.windSpeed950hPaKts,
      wind1500ftDirDeg: snap.windDir950hPaDeg,
      precipMmHr: snap.precipMmHr,
      lightning: snap.lightningRisk ?? 'LOW',
      moonPercent: isNight ? Math.round(moonIlluminationFraction(midMs) * 100) : null,
      moonUp: isNight ? moonAltitudeDeg(midMs, lat, lon) > 0 : null,
    });
  }
  return rows;
}

/** One-line summary of the whole outlook, e.g. "Good now, marginal from Thu 18:00 (hills in cloud)." */
export function summariseBaseOutlook(rows: BaseOutlookRow[]): string {
  if (rows.length === 0) return 'No forecast available.';
  const label = (l: BaseOutlookLevel) => (l === 'GOOD' ? 'good' : l === 'MARGINAL' ? 'marginal' : 'poor');
  const cap = (t: string) => t[0].toUpperCase() + t.slice(1);
  const first = rows[0];
  const why = first.reasons.length ? ` (${first.reasons[0]})` : '';
  const change = rows.findIndex((r) => r.level !== first.level);
  if (change < 0) {
    const ms = (r: BaseOutlookRow) => new Date(r.hourIso + 'Z').getTime();
    const step = rows.length > 1 ? ms(rows[1]) - ms(rows[0]) : 3600_000;
    const spanH = Math.round((ms(rows[rows.length - 1]) - ms(first) + step) / 3600_000);
    return `${cap(label(first.level))}${why} for the next ${spanH} hours.`;
  }
  const next = rows[change];
  const nextWhy = next.reasons.length ? ` (${next.reasons[0]})` : '';
  return `${cap(label(first.level))}${why} now, ${label(next.level)} from ${next.dayNameShort} ${next.hourLabel}${nextWhy}.`;
}
