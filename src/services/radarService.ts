import { AircraftTarget, HelideckWeatherState, HelicopterOperator, InstallationOrAirport, TrailPoint } from '../types/radar';
import { calculateBearingDeg, calculateDistanceNm, decodeAircraftType } from '../data/aircraftDecoder';
import { regionsForView, TRACKING_REGIONS, ViewBounds } from '../utils/trackingRegions';
import { INSTALLATIONS_AND_AIRPORTS } from '../data/installationsAndAirports';
import { RecentTurnback, TurnbackTracker } from '../utils/turnbackDetection';

// Production relay. Set the GitHub repository variable FLIGHT_API_ORIGIN (e.g. the relay/ Worker's URL) to switch
// without a code change; until then the original relay is used.
export const FLIGHT_API_ORIGIN = import.meta.env?.DEV ? '/live-api'
  : (import.meta.env?.VITE_FLIGHT_API_ORIGIN || 'https://choppercheck-relay.one-mad-punk.workers.dev').replace(/\/+$/, '');
export const MAX_POSITION_AGE_MS = 45_000;
export const MAX_PREDICTION_MS = 10_000;
const history = new Map<string, TrailPoint[]>();
export const turnbackTracker = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
export const getRecentTurnbacks = (now = Date.now()): RecentTurnback[] => turnbackTracker.recentTurnbacks(now);

/** Runs each fresh observed position through the return-to-base detector and attaches any turnback. */
export function annotateTurnbacks(flights: AircraftTarget[]): AircraftTarget[] {
  return flights.map(f => {
    if (f.observedAt === undefined || !f.altitudeReported) return f;
    const turnback = turnbackTracker.update({ hex: f.hex, callsign: f.callsign, typeCode: f.typeCode, category: f.category,
      lat: f.reportedLat ?? f.lat, lon: f.reportedLon ?? f.lon, altFt: f.altitudeFt, speedKts: f.groundSpeedKts, timestamp: f.observedAt });
    return turnback ? { ...f, turnback } : f;
  });
}
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export interface RawAdsbAircraft {
  hex?: string; type?: string; flight?: string; r?: string; t?: string; desc?: string;
  ownOp?: string; lat?: number; lon?: number; alt_baro?: number | 'ground'; alt_geom?: number;
  gs?: number; ias?: number; tas?: number; mach?: number; wd?: number; ws?: number;
  oat?: number; tat?: number; roll?: number; mag_heading?: number; true_heading?: number;
  baro_rate?: number; geom_rate?: number; track?: number;
  nav_qnh?: number; nav_altitude_mcp?: number; nav_modes?: string[];
  squawk?: string; emergency?: string; category?: string; seen_pos?: number;
  rssi?: number; messages?: number; dbFlags?: number;
}

export function classifyLiveAircraft(raw: RawAdsbAircraft, facility: InstallationOrAirport,
  providerTime = Date.now(), provider = 'ADS-B', now = Date.now()): AircraftTarget | null {
  if (!finite(raw.lat) || !finite(raw.lon) || Math.abs(raw.lat) > 90 || Math.abs(raw.lon) > 180 ||
    raw.category?.startsWith('C') || raw.t === 'TWR' || raw.r === 'TWR' ||
    raw.type === 'adsb_icao_nt' || raw.type === 'tisb_other' || raw.alt_baro === 'ground') return null;
  if (!finite(raw.seen_pos) || raw.seen_pos < 0) return null;
  const observedAt = Math.min(now, providerTime - raw.seen_pos * 1000);
  if (now - observedAt > MAX_POSITION_AGE_MS || providerTime > now + 30_000) return null;
  const hex = (raw.hex || '').trim().toUpperCase();
  if (!hex) return null;
  const callsign = (raw.flight || '').trim().toUpperCase() || (raw.r || '').trim().toUpperCase() || hex;
  if (callsign.startsWith('TXLU') || callsign.startsWith('ID424')) return null;
  const registration = (raw.r || '').trim().toUpperCase() || 'Unknown';
  const decoded = decodeAircraftType(raw.t, raw.desc);
  const owner = (raw.ownOp || '').trim();
  const upperOwner = owner.toUpperCase();
  // CAA SARG Policy 130: SRD = COASTGUARD, SRG = BRITISH RESCUE. FAA designators: CGI = COASTGUARD IRELAND.
  const identification = callsign.replace(/\s/g, '');
  const isUkCoastguard = /^(SRD|SRG)\d/.test(identification) || upperOwner.includes('HM COASTGUARD') || upperOwner.includes('MARITIME AND COASTGUARD AGENCY');
  const isIrishCoastguard = /^CGI\d/.test(identification) || upperOwner.includes('IRISH COAST GUARD') || upperOwner.includes('IRISH COASTGUARD');
  const isCoastguard = isUkCoastguard || isIrishCoastguard || /^RESCUE\d/.test(identification) || upperOwner.includes('COASTGUARD') || upperOwner.includes('COAST GUARD') || upperOwner.includes('BRISTOW SAR');
  const isMilitary = Boolean((raw.dbFlags && (raw.dbFlags & 1)) || hex.startsWith('43C') || /^(RRR|ASCOT|KRF|SHF|AAC|VYT|LOS|CWL|SYS|RAF|NAVY|NATO)\d/i.test(identification) || /ROYAL AIR FORCE|ROYAL NAVY|MINISTRY OF DEFENCE|US AIR FORCE|NATO/i.test(upperOwner));
  const rotary = decoded.isRotary || raw.category === 'A7';
  let helicopterOperator: HelicopterOperator = 'Unknown';
  if (isIrishCoastguard) helicopterOperator = 'Irish Coast Guard';
  else if (isUkCoastguard) helicopterOperator = 'HM Coastguard';
  else if (upperOwner.includes('BRISTOW') || callsign.startsWith('BHL')) helicopterOperator = 'Bristow';
  else if (upperOwner.includes('CHC') || upperOwner.includes('HELIKOPTER SERVICE') || callsign.startsWith('HKS')) helicopterOperator = 'CHC';
  else if (upperOwner.includes('NHV') || callsign.startsWith('NHZ')) helicopterOperator = 'NHV';
  else if (upperOwner.includes('OFFSHORE HELICOPTER') || callsign.startsWith('OHS')) helicopterOperator = 'OHS';
  const operator = owner || (helicopterOperator !== 'Unknown' ? helicopterOperator + ' (callsign identification)' : 'Operator not reported');
  const altitude = finite(raw.alt_baro) ? raw.alt_baro : finite(raw.alt_geom) ? raw.alt_geom : 0;
  const speed = finite(raw.gs) && raw.gs >= 0 ? raw.gs : 0;
  const trackReported = finite(raw.track);
  const track = trackReported ? ((raw.track! % 360) + 360) % 360 : 0;
  const rate = finite(raw.baro_rate) ? raw.baro_rate : finite(raw.geom_rate) ? raw.geom_rate : 0;
  const trail = history.get(hex) || [];
  const last = trail[trail.length - 1];
  if (finite(raw.alt_baro) || finite(raw.alt_geom)) {
    if (!last || observedAt > last.timestamp + 500) {
      trail.push({ lat: raw.lat, lon: raw.lon, altFt: altitude, timestamp: observedAt });
      while (trail.length > 120 || (trail[0] && observedAt - trail[0].timestamp > 20 * 60_000)) trail.shift();
      history.set(hex, trail);
    }
  }
  for (const [key, points] of history) if (!points.length || now - points[points.length - 1].timestamp > 20 * 60_000) history.delete(key);
  const distance = calculateDistanceNm(facility.lat, facility.lon, raw.lat, raw.lon);
  return {
    hex, callsign, flightNumber: callsign, registration, typeCode: decoded.code,
    typeFullName: decoded.fullName, category: isCoastguard ? 'coastguard_sar' : rotary ? 'offshore_heli' : 'commercial_fixed_wing',
    operator, helicopterOperator, isRotary: rotary, isMilitary, lat: raw.lat, lon: raw.lon, reportedLat: raw.lat, reportedLon: raw.lon,
    altitudeFt: Math.round(altitude), groundSpeedKts: Math.round(speed), groundSpeedMph: Math.round(speed * 1.15078),
    verticalRateFpm: Math.round(rate), trackDeg: Math.round(track), squawk: raw.squawk || 'Unknown',
    altitudeReported: finite(raw.alt_baro) || finite(raw.alt_geom), speedReported: finite(raw.gs) && raw.gs >= 0,
    trackReported, verticalRateReported: finite(raw.baro_rate) || finite(raw.geom_rate),
    originCode: 'Unknown', originName: 'Origin not reported', destinationCode: 'Unknown', destinationName: 'Destination not reported',
    scheduledDepTime: 'Unavailable', estimatedArrTime: 'Unavailable', etaToRefMinutes: null,
    status: 'position_reported', distanceFromRefNm: distance, distanceFromRefMiles: Math.round(distance * 1.15078 * 10) / 10,
    bearingFromRefDeg: calculateBearingDeg(facility.lat, facility.lon, raw.lat, raw.lon),
    source: 'live_adsb', provider, observedAt, trail: [...trail],
    altGeomFt: finite(raw.alt_geom) ? Math.round(raw.alt_geom) : undefined,
    iasKts: finite(raw.ias) && raw.ias > 0 ? Math.round(raw.ias) : undefined,
    tasKts: finite(raw.tas) && raw.tas > 0 ? Math.round(raw.tas) : undefined,
    mach: finite(raw.mach) && raw.mach > 0 ? Number(raw.mach.toFixed(2)) : undefined,
    windDirDeg: finite(raw.wd) ? Math.round(((raw.wd % 360) + 360) % 360) : undefined,
    windSpeedKts: finite(raw.ws) && raw.ws >= 0 ? Math.round(raw.ws) : undefined,
    oatC: finite(raw.oat) ? Math.round(raw.oat * 10) / 10 : undefined,
    tatC: finite(raw.tat) ? Math.round(raw.tat * 10) / 10 : undefined,
    rollDeg: finite(raw.roll) ? Math.round(raw.roll * 10) / 10 : undefined,
    magHeadingDeg: finite(raw.mag_heading) ? Math.round(((raw.mag_heading % 360) + 360) % 360) : undefined,
    trueHeadingDeg: finite(raw.true_heading) ? Math.round(((raw.true_heading % 360) + 360) % 360) : undefined,
    navQnhHpa: finite(raw.nav_qnh) ? Number(raw.nav_qnh.toFixed(1)) : undefined,
    navAltitudeMcpFt: finite(raw.nav_altitude_mcp) ? Math.round(raw.nav_altitude_mcp) : undefined,
    navModes: Array.isArray(raw.nav_modes) && raw.nav_modes.length > 0 ? raw.nav_modes : undefined,
    rssiDbfs: finite(raw.rssi) ? Number(raw.rssi.toFixed(1)) : undefined,
    messagesCount: finite(raw.messages) ? raw.messages : undefined,
    adsbSourceType: typeof raw.type === 'string' ? raw.type : undefined,
    emergency: typeof raw.emergency === 'string' && raw.emergency !== 'none' ? raw.emergency : undefined,
  };
}

// Predict only the short gap after a measured position. Never extend reported trails or timestamps.
export function advanceAircraftPositionsSmoothly(flights: AircraftTarget[], _dt: number,
  facility: InstallationOrAirport, now = Date.now()): AircraftTarget[] {
  return flights.filter(f => f.observedAt !== undefined && now - f.observedAt <= MAX_POSITION_AGE_MS).map(f => {
    const age = Math.max(0, now - f.observedAt!);
    const canPredict = f.speedReported && f.trackReported && f.groundSpeedKts >= 25;
    const seconds = canPredict ? Math.min(age, MAX_PREDICTION_MS) / 1000 : 0;
    const rad = f.trackDeg * Math.PI / 180;
    const distance = f.groundSpeedKts * seconds / 3600;
    const latitude = f.reportedLat ?? f.lat;
    const longitude = f.reportedLon ?? f.lon;
    const lat = latitude + distance * Math.cos(rad) / 60;
    const lon = longitude + distance * Math.sin(rad) / (60 * Math.max(0.1, Math.cos(latitude * Math.PI / 180)));
    const dist = calculateDistanceNm(facility.lat, facility.lon, lat, lon);
    return { ...f, lat, lon, source: seconds > 0 ? 'dead_reckoning' : 'live_adsb',
      distanceFromRefNm: dist, distanceFromRefMiles: Math.round(dist * 1.15078 * 10) / 10,
      bearingFromRefDeg: calculateBearingDeg(facility.lat, facility.lon, lat, lon) };
  });
}

export function normalizeTraffic(data: any, facility: InstallationOrAirport, now = Date.now()): AircraftTarget[] {
  const providerTime = finite(data?.now) ? (data.now < 1e12 ? data.now * 1000 : data.now) : null;
  if (providerTime === null || now - providerTime > MAX_POSITION_AGE_MS || providerTime > now + 30_000 || !Array.isArray(data?.ac)) throw new Error('Stale or invalid aircraft feed');
  const unique = new Map<string, AircraftTarget>();
  for (const raw of data.ac) {
    const flight = classifyLiveAircraft(raw, facility, providerTime, String(data.source || 'ADS-B'), now);
    if (flight) unique.set(flight.hex, flight);
  }
  return [...unique.values()];
}

// airplanes.live answers browsers directly (CORS allowed, 1 request/second per visitor's own connection), but
// blocks requests from the Cloudflare relay. So each visitor asks it directly first and uses the relay only if
// that fails. Its terms: non-commercial use, credit airplanes.live.
const DIRECT_URL = (lat: number, lon: number, nm: number) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}`;
let directCooldownUntil = 0, lastDirectAt = 0;
export const resetDirectCooldown = () => { directCooldownUntil = 0; lastDirectAt = 0; };
const DIRECT_SPACING_MS = 1100;

export async function fetchRegionSnapshot(regionId: string, signal: AbortSignal, fetcher: typeof fetch = fetch, now = Date.now()): Promise<any> {
  const region = TRACKING_REGIONS.find(r => r.id === regionId);
  if (region && now >= directCooldownUntil) {
    try {
      const wait = lastDirectAt + DIRECT_SPACING_MS - Date.now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      lastDirectAt = Date.now();
      const response = await fetcher(DIRECT_URL(region.lat, region.lon, region.radiusNm),
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      if (response.ok) {
        const data: any = await response.json();
        if (Array.isArray(data?.ac) && finite(data?.now)) return { ...data, source: 'airplanes.live' };
      } else {
        const seconds = Number(response.headers.get('Retry-After'));
        directCooldownUntil = now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000);
      }
    } catch (error) {
      if (signal.aborted) throw error;
      directCooldownUntil = now + 60_000;
    }
  }
  const response = await fetcher(FLIGHT_API_ORIGIN + '/api/flights?regions=' + regionId, { signal });
  if (!response.ok) {
    const seconds = Number(response.headers.get('Retry-After'));
    throw Object.assign(new Error('Region unavailable'), { retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10000 });
  }
  return response.json();
}

export async function fetchHybridRadarTraffic(lat: number, lon: number, facility: InstallationOrAirport,
  _tick: number, _includeSchedule: boolean, signal?: AbortSignal, bounds?: ViewBounds): Promise<{ flights: AircraftTarget[]; liveCount: number; feedAvailable: boolean; provider?: string; retryAfterMs?: number; partial?: boolean; coverageLabel?: string }> {
  try {
    const regions = regionsForView(lat, lon, bounds);
    if (!regions.length) return { flights: [], liveCount: 0, feedAvailable: true, coverageLabel: 'Outside UK/Ireland tracking coverage' };
    // Ask for one region at a time, nearest first. The backend answers a single-region request reliably but
    // fails combined or simultaneous multi-region requests, which emptied the map once it zoomed out.
    const nearest = regionsForView(lat, lon)[0];
    const ordered = nearest ? [nearest, ...regions.filter(r => r !== nearest)] : regions;
    const results: PromiseSettledResult<any>[] = [];
    let pauseMs = 0;
    for (const region of ordered) {
      if (signal?.aborted) break;
      if (pauseMs) await new Promise(resolve => setTimeout(resolve, pauseMs));
      try {
        const timeout = signal ? AbortSignal.any([signal, AbortSignal.timeout(12_000)]) : AbortSignal.timeout(12_000);
        const data = await fetchRegionSnapshot(region, timeout);
        results.push({ status: 'fulfilled', value: data });
        pauseMs = finite(data?.retryAfterMs) ? Math.min(2000, Math.max(0, data.retryAfterMs)) : 0;
      } catch (reason) {
        results.push({ status: 'rejected', reason });
        pauseMs = 1000;
      }
    }
    const responses = results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []);
    if (!responses.length) {
      const retry = results.map(r => r.status === 'rejected' ? (r.reason as any)?.retryAfterMs : undefined).find(finite);
      return { flights: [], liveCount: 0, feedAvailable: false, retryAfterMs: retry ?? 10000 };
    }
    // Each regional snapshot retains its own provider, timestamp and position age.
    const feeds = responses.flatMap((data: any) => Array.isArray(data.feeds) ? data.feeds : [data]);
    const unique = new Map<string, AircraftTarget>(); let invalidFeed = false, validFeeds = 0;
    for (const feed of feeds) {
      try {
        const normalized = normalizeTraffic(feed, facility); validFeeds++;
        for (const flight of normalized) {
          const prior = unique.get(flight.hex);
          if (!prior || (flight.observedAt || 0) > (prior.observedAt || 0)) unique.set(flight.hex, flight);
        }
      } catch { invalidFeed = true; }
    }
    if (!validFeeds) throw new Error('No fresh regional positions');
    const flights = annotateTurnbacks([...unique.values()]);
    const retries = responses.map((data: any) => data.retryAfterMs).filter(finite);
    return { flights, liveCount: flights.length, feedAvailable: responses.some((data: any) => data.feedAvailable !== false),
      provider: [...new Set(responses.map((data: any) => data.source).filter(Boolean))].join(' + ') || undefined,
      partial: responses.length < regions.length || invalidFeed || responses.some((data: any) => data.partial || data.unavailableRegions?.length),
      coverageLabel: 'UK / Ireland / North Sea', retryAfterMs: retries.length ? Math.min(...retries) : undefined };
  } catch {
    return { flights: [], liveCount: 0, feedAvailable: false };
  }
}

const numberOrNull = (value: unknown) => finite(value) ? value : null;
const epoch = (value: unknown): number | null => {
  if (finite(value)) return value < 1e12 ? value * 1000 : value;
  if (typeof value !== 'string') return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
};
export function normalizeWeather(data: any, facility: InstallationOrAirport, now = Date.now()): HelideckWeatherState {
  const wx = data?.weather?.current;
  const marine = data?.marine?.current;
  const weatherTime = epoch(wx?.time);
  const marineTime = epoch(marine?.time);
  const currentWx = weatherTime !== null && now - weatherTime <= 2 * 3600_000 && weatherTime <= now + 15 * 60_000 ? wx : null;
  const currentMarine = marineTime !== null && now - marineTime <= 2 * 3600_000 && marineTime <= now + 15 * 60_000 ? marine : null;
  const station = ['Map reference', 'GPS location', 'Custom location'].includes(facility.assetType) ? '' : facility.code.length === 4 && /^[A-Z]{4}$/.test(facility.code) ? facility.code : facility.primaryShoreBase;
  const metar = Array.isArray(data?.metar) ? data.metar.find((m: any) => m.icaoId === station && typeof m.rawOb === 'string') : null;
  const metarTime = epoch(metar?.obsTime);
  const category = ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(metar?.fltCat) ? metar.fltCat : undefined;
  return {
    windSpeedKts: numberOrNull(currentWx?.wind_speed_10m), windGustKts: numberOrNull(currentWx?.wind_gusts_10m),
    windDirectionDeg: numberOrNull(currentWx?.wind_direction_10m), temperatureC: numberOrNull(currentWx?.temperature_2m),
    pressureMslHpa: numberOrNull(currentWx?.pressure_msl), visibilityKm: finite(currentWx?.visibility) ? currentWx.visibility / 1000 : null,
    significantWaveHeightM: numberOrNull(currentMarine?.wave_height), swellPeriodSec: numberOrNull(currentMarine?.wave_period),
    weatherTime: currentWx ? weatherTime : null, marineTime: currentMarine ? marineTime : null,
    shoreBaseIcao: station, rawMetar: metar?.rawOb, rawTaf: typeof metar?.rawTaf === 'string' ? metar.rawTaf : undefined,
    metarTime, flightCategory: category, cap437Status: 'UNAVAILABLE',
    cap437Reason: 'Helideck operating status is not available from these sources.',
    updatedAt: new Date(now).toISOString(),
  };
}

export async function fetchHelideckWeather(facility: InstallationOrAirport): Promise<HelideckWeatherState> {
  const station = ['Map reference', 'GPS location', 'Custom location'].includes(facility.assetType) ? '' : /^[A-Z]{4}$/.test(facility.code) ? facility.code : facility.primaryShoreBase;
  let data: any = {};
  try {
    const url = FLIGHT_API_ORIGIN + '/api/weather?lat=' + facility.lat.toFixed(2) + '&lon=' + facility.lon.toFixed(2) + '&icao=' + encodeURIComponent(station);
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (response.ok) data = await response.json();
  } catch { /* Keep independent sources available when one provider fails. */ }
  // Open-Meteo supports browser requests. Avoid shared server-IP restrictions when its forecast request fails.
  if (!data?.weather?.current) {
    try {
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + facility.lat.toFixed(2) + '&longitude=' + facility.lon.toFixed(2) + '&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&wind_speed_unit=kn&timeformat=unixtime';
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (response.ok) data = { ...data, weather: await response.json() };
    } catch { /* Missing model values remain null, without changing the airport report. */ }
  }
  return normalizeWeather(data, facility);
}
