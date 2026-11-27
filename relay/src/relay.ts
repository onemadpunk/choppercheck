/**
 * ChopperCheck flight relay. Same API as the old relay so the site needs no other change:
 *   GET /api/flights?regions=<north-sea|uk-ireland|south-uk>
 *   GET /api/weather?lat=<lat>&lon=<lon>&icao=<ICAO>
 * Aircraft sources are tried in order until one gives a fresh snapshot. Each answer is cached for a few
 * seconds so every visitor shares the same upstream request.
 */

export interface Env { FLYITALY_API_KEY?: string }

export interface CacheLike {
  match(key: string): Promise<Response | undefined>;
  put(key: string, response: Response): Promise<void>;
}

export interface Deps { fetch: typeof fetch; cache?: CacheLike; now?: () => number }

export const REGIONS: Record<string, { lat: number; lon: number; radiusNm: number }> = {
  'north-sea': { lat: 58.7, lon: -0.5, radiusNm: 250 },
  'uk-ireland': { lat: 54.2, lon: -5.8, radiusNm: 250 },
  'south-uk': { lat: 51.2, lon: -1.5, radiusNm: 250 },
};

export interface Source {
  id: string;
  attribution: string;
  url(lat: number, lon: number, nm: number): string;
  headers?(env: Env): Record<string, string> | null; // null = source not configured, skip it
}

export const SOURCES: Source[] = [
  { id: 'adsb.fi', attribution: 'adsb.fi (https://adsb.fi/)',
    url: (lat, lon, nm) => `https://opendata.adsb.fi/api/v3/lat/${lat}/lon/${lon}/dist/${nm}` },
  { id: 'airplanes.live', attribution: 'airplanes.live (https://airplanes.live/)',
    url: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${nm}` },
  { id: 'flyitalyadsb', attribution: 'Flight data: FlyItalyADSB (flyitalyadsb.com), CC BY-SA 4.0',
    url: (lat, lon, nm) => `https://api.flyitalyadsb.com/api/aircraft/v2/lat/${lat}/lon/${lon}/dist/${nm}/`,
    headers: env => env.FLYITALY_API_KEY ? { 'X-Api-Key': env.FLYITALY_API_KEY } : null },
  { id: 'adsb.lol', attribution: 'adsb.lol (https://www.adsb.lol/), ODbL 1.0',
    url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}` },
];

export const MAX_SNAPSHOT_AGE_MS = 45_000;
const FLIGHT_CACHE_S = 5;
const WEATHER_CACHE_S = 300;
const DEFAULT_COOLDOWN_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Per-instance cooldowns after a provider says "slow down" or fails. */
const cooldownUntil = new Map<string, number>();
export const resetCooldowns = () => cooldownUntil.clear();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
};

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Same server-side filtering as the old relay: real positions only, no towers/ground vehicles, no stale positions. */
export function filterAircraft(ac: any[]): any[] {
  return ac.filter(a => a && finite(a.lat) && finite(a.lon) && !String(a.category || '').startsWith('C') &&
    a.t !== 'TWR' && !(finite(a.seen_pos) && a.seen_pos > 120));
}

async function fetchWithTimeout(deps: Deps, url: string, headers: Record<string, string> = {}) {
  return deps.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'ChopperCheck relay (choppercheck.com)', ...headers },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
}

function retryAfterMs(response: Response): number {
  const seconds = Number(response.headers.get('Retry-After'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 3600) * 1000 : DEFAULT_COOLDOWN_MS;
}

/** Tries each configured source in order; returns the first fresh snapshot, or null. */
export async function fetchRegion(regionId: string, env: Env, deps: Deps) {
  const region = REGIONS[regionId];
  const now = (deps.now ?? Date.now)();
  const tried: string[] = [];
  for (const source of SOURCES) {
    if ((cooldownUntil.get(source.id) ?? 0) > now) continue;
    const headers = source.headers ? source.headers(env) : {};
    if (headers === null) continue;
    tried.push(source.id);
    try {
      const response = await fetchWithTimeout(deps, source.url(region.lat, region.lon, region.radiusNm), headers);
      if (response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403) {
        cooldownUntil.set(source.id, now + retryAfterMs(response));
        continue;
      }
      if (!response.ok) continue;
      const data: any = await response.json();
      const list = Array.isArray(data?.ac) ? data.ac : Array.isArray(data?.aircraft) ? data.aircraft : null;
      const providerTime = finite(data?.now) ? (data.now < 1e12 ? data.now * 1000 : data.now) : null;
      if (!list || providerTime === null || now - providerTime > MAX_SNAPSHOT_AGE_MS || providerTime > now + 30_000) continue;
      const ac = filterAircraft(list);
      return { ac, now: providerTime, total: ac.length, source: source.id, attribution: source.attribution,
        region: regionId, feedAvailable: true, tried };
    } catch {
      cooldownUntil.set(source.id, now + 15_000);
    }
  }
  return null;
}

async function cached(deps: Deps, key: string, ttlS: number, build: () => Promise<Response>): Promise<Response> {
  if (deps.cache) {
    const hit = await deps.cache.match(key);
    if (hit) return hit;
  }
  const response = await build();
  if (deps.cache && response.ok) {
    const copy = new Response(response.clone().body, response);
    copy.headers.set('Cache-Control', `public, max-age=${ttlS}`);
    await deps.cache.put(key, copy);
  }
  return response;
}

async function getJson(deps: Deps, url: string): Promise<any> {
  try {
    const response = await fetchWithTimeout(deps, url);
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

export async function handleWeather(params: URLSearchParams, deps: Deps): Promise<Response> {
  const lat = Number(params.get('lat')), lon = Number(params.get('lon'));
  const icao = (params.get('icao') || '').toUpperCase();
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (icao && !/^[A-Z]{4}$/.test(icao)))
    return json({ error: 'Use lat, lon and an optional 4-letter ICAO code' }, 400);
  const la = lat.toFixed(2), lo = lon.toFixed(2);
  const [weather, marine, metar] = await Promise.all([
    getJson(deps, `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&current=temperature_2m,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility&wind_speed_unit=kn&timeformat=unixtime`),
    getJson(deps, `https://marine-api.open-meteo.com/v1/marine?latitude=${la}&longitude=${lo}&current=wave_height,wave_period&timeformat=unixtime`),
    icao ? getJson(deps, `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&taf=true`) : Promise.resolve([]),
  ]);
  return json({ weather, marine, metar: Array.isArray(metar) ? metar : [] });
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'GET') return json({ error: 'GET only' }, 405);
  const url = new URL(request.url);
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, sources: SOURCES.map(s => s.id) });
  if (url.pathname === '/api/flights') {
    const regionId = url.searchParams.get('regions') || '';
    if (!REGIONS[regionId]) return json({ error: 'Ask for one region: ' + Object.keys(REGIONS).join(', ') }, 400);
    return cached(deps, `https://relay.cache/flights/${regionId}`, FLIGHT_CACHE_S, async () => {
      const snapshot = await fetchRegion(regionId, env, deps);
      return snapshot ? json(snapshot) : json({ feedAvailable: false, retryAfterMs: 10_000 }, 503, { 'Retry-After': '10' });
    });
  }
  if (url.pathname === '/api/weather') {
    const p = url.searchParams;
    const key = `https://relay.cache/weather/${Number(p.get('lat')).toFixed(2)}/${Number(p.get('lon')).toFixed(2)}/${(p.get('icao') || '').toUpperCase()}`;
    return cached(deps, key, WEATHER_CACHE_S, () => handleWeather(p, deps));
  }
  return json({ error: 'Not found' }, 404);
}
