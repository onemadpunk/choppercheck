import { AircraftTarget, HelideckWeatherState, HelicopterOperator, InstallationOrAirport, TrailPoint } from '../types/radar';
import { calculateBearingDeg, calculateDistanceNm, decodeAircraftType } from '../data/aircraftDecoder';

export const FLIGHT_API_ORIGIN = import.meta.env?.DEV ? '/live-api' : 'https://choppercheck-flight-api.ornatehinny4.chatgpt.site';
export const MAX_POSITION_AGE_MS = 45_000;
export const MAX_PREDICTION_MS = 10_000;
const history = new Map<string, TrailPoint[]>();
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export interface RawAdsbAircraft {
  hex?: string; type?: string; flight?: string; r?: string; t?: string; desc?: string;
  ownOp?: string; lat?: number; lon?: number; alt_baro?: number | 'ground'; alt_geom?: number;
  gs?: number; baro_rate?: number; geom_rate?: number; track?: number; true_heading?: number;
  squawk?: string; category?: string; seen_pos?: number;
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
  const isCoastguard = /^(SRG|RESCUE)/.test(callsign) || upperOwner.includes('COASTGUARD') || upperOwner.includes('BRISTOW SAR');
  const rotary = decoded.isRotary || raw.category === 'A7';
  let helicopterOperator: HelicopterOperator = 'Unknown';
  if (isCoastguard) helicopterOperator = 'HM Coastguard';
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
    operator, helicopterOperator, lat: raw.lat, lon: raw.lon, reportedLat: raw.lat, reportedLon: raw.lon,
    altitudeFt: Math.round(altitude), groundSpeedKts: Math.round(speed), groundSpeedMph: Math.round(speed * 1.15078),
    verticalRateFpm: Math.round(rate), trackDeg: Math.round(track), squawk: raw.squawk || 'Unknown',
    altitudeReported: finite(raw.alt_baro) || finite(raw.alt_geom), speedReported: finite(raw.gs) && raw.gs >= 0,
    trackReported, verticalRateReported: finite(raw.baro_rate) || finite(raw.geom_rate),
    originCode: 'Unknown', originName: 'Origin not reported', destinationCode: 'Unknown', destinationName: 'Destination not reported',
    scheduledDepTime: 'Unavailable', estimatedArrTime: 'Unavailable', etaToRefMinutes: null,
    status: 'position_reported', distanceFromRefNm: distance, distanceFromRefMiles: Math.round(distance * 1.15078 * 10) / 10,
    bearingFromRefDeg: calculateBearingDeg(facility.lat, facility.lon, raw.lat, raw.lon),
    source: 'live_adsb', provider, observedAt, trail: [...trail],
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

export async function fetchHybridRadarTraffic(lat: number, lon: number, facility: InstallationOrAirport,
  _tick: number, _includeSchedule: boolean, signal?: AbortSignal): Promise<{ flights: AircraftTarget[]; liveCount: number; feedAvailable: boolean; provider?: string }> {
  try {
    const url = FLIGHT_API_ORIGIN + '/api/flights?lat=' + lat.toFixed(1) + '&lon=' + lon.toFixed(1) + '&radius=250';
    const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error('Aircraft feed unavailable');
    const data = await response.json();
    const flights = normalizeTraffic(data, facility);
    return { flights, liveCount: flights.length, feedAvailable: true, provider: data.source };
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
  const station = facility.code.length === 4 && /^[A-Z]{4}$/.test(facility.code) ? facility.code : facility.primaryShoreBase;
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
  const station = /^[A-Z]{4}$/.test(facility.code) ? facility.code : facility.primaryShoreBase;
  try {
    const url = FLIGHT_API_ORIGIN + '/api/weather?lat=' + facility.lat.toFixed(2) + '&lon=' + facility.lon.toFixed(2) + '&icao=' + encodeURIComponent(station);
    const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!response.ok) throw new Error('Weather unavailable');
    return normalizeWeather(await response.json(), facility);
  } catch { return normalizeWeather(null, facility); }
}
