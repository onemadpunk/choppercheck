/**
 * ChopperCheck flight relay. Same API as the old relay so the site needs no other change:
 *   GET /api/flights?regions=<north-sea|uk-ireland|south-uk>
 *   GET /api/weather?lat=<lat>&lon=<lon>&icao=<ICAO>
 *   GET /api/om/<forecast|marine|elevation>?<Open-Meteo query>  (shared, cached Open-Meteo pass-through)
 * Aircraft sources are tried in order until one gives a fresh snapshot. Each answer is cached for a few
 * seconds so every visitor shares the same upstream request.
 */

export interface Env { FLYITALY_API_KEY?: string; ADSB_LOL_API_KEY?: string }

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
    url: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`,
    // Without a key adsb.lol allows 500 requests/day per IP, shared by everything on Cloudflare's IPs; a feeder key allows 7,200/day.
    headers: (env): Record<string, string> => env.ADSB_LOL_API_KEY ? { 'x-api-key': env.ADSB_LOL_API_KEY } : {} },
];

export const MAX_SNAPSHOT_AGE_MS = 45_000;
const FLIGHT_CACHE_S = 5;
const WEATHER_CACHE_S = 300;
const DEFAULT_COOLDOWN_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Per-instance cooldowns after a provider says "slow down" or fails. */
const cooldownUntil = new Map<string, number>();
export const resetCooldowns = () => { cooldownUntil.clear(); lastOutcome.clear(); clearMemoryCache(); };

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

/** Last result from each source, shown on /health so a blocked or failing source is visible. */
const lastOutcome = new Map<string, { result: string; at: string }>();
export const sourceStatus = () => Object.fromEntries(lastOutcome);

/** adsb.fi and airplanes.live each cover the whole UK/North Sea well; FlyItalyADSB and adsb.lol are thinner. */
const FULL_COVERAGE = new Set(['adsb.fi', 'airplanes.live']);

type Snapshot = { ac: any[]; now: number; total: number; source: string; attribution: string };

async function trySource(source: Source, regionId: string, env: Env, deps: Deps, now: number): Promise<Snapshot | null> {
  const region = REGIONS[regionId];
  const note = (result: string) => lastOutcome.set(source.id, { result, at: new Date(now).toISOString() });
  if ((cooldownUntil.get(source.id) ?? 0) > now) return null;
  const headers = source.headers ? source.headers(env) : {};
  if (headers === null) { note('not configured'); return null; }
  try {
    const response = await fetchWithTimeout(deps, source.url(region.lat, region.lon, region.radiusNm), headers);
    if (response.status === 429 || response.status >= 500 || response.status === 401 || response.status === 403) {
      cooldownUntil.set(source.id, now + retryAfterMs(response));
      note('HTTP ' + response.status); return null;
    }
    if (!response.ok) { note('HTTP ' + response.status); return null; }
    const data: any = await response.json();
    const list = Array.isArray(data?.ac) ? data.ac : Array.isArray(data?.aircraft) ? data.aircraft : null;
    const providerTime = finite(data?.now) ? (data.now < 1e12 ? data.now * 1000 : data.now) : null;
    if (!list || providerTime === null || now - providerTime > MAX_SNAPSHOT_AGE_MS || providerTime > now + 30_000) {
      note('stale or invalid snapshot'); return null;
    }
    const ac = filterAircraft(list);
    note('ok, ' + ac.length + ' aircraft');
    return { ac, now: providerTime, total: ac.length, source: source.id, attribution: source.attribution };
  } catch (error) {
    cooldownUntil.set(source.id, now + 15_000);
    note('network error: ' + String((error as Error)?.name || error));
    return null;
  }
}

/**
 * Uses the first full-coverage source that answers. If neither does, asks every remaining source and returns
 * all their snapshots together (each keeps its own timestamp and credit), since each alone sees fewer aircraft.
 */
export async function fetchRegion(regionId: string, env: Env, deps: Deps) {
  const now = (deps.now ?? Date.now)();
  for (const source of SOURCES.filter(s => FULL_COVERAGE.has(s.id))) {
    const snap = await trySource(source, regionId, env, deps, now);
    if (snap) return { ...snap, region: regionId, feedAvailable: true };
  }
  const backups = (await Promise.all(SOURCES.filter(s => !FULL_COVERAGE.has(s.id))
    .map(s => trySource(s, regionId, env, deps, now)))).filter((x): x is Snapshot => x !== null);
  if (!backups.length) return null;
  if (backups.length === 1) return { ...backups[0], region: regionId, feedAvailable: true };
  // Top-level fields describe the combined answer; the site reads each entry of feeds separately.
  const freshest = Math.max(...backups.map(b => b.now));
  return { ac: [], now: freshest, total: backups.reduce((n, b) => n + b.total, 0),
    source: backups.map(b => b.source).join(' + '), attribution: backups.map(b => b.attribution).join(' · '),
    feeds: backups, region: regionId, feedAvailable: true };
}

/**
 * In-memory copy of recent answers. Cloudflare's Cache API does nothing on a workers.dev address, so without
 * this every visitor's request would go upstream. Each Worker instance keeps its own copy; bounded by size.
 */
const memory = new Map<string, { body: string; status: number; headers: [string, string][]; expires: number }>();
const MEMORY_MAX_BYTES = 40_000_000;
let memoryBytes = 0;
export const clearMemoryCache = () => { memory.clear(); memoryBytes = 0; };

function remember(key: string, body: string, response: Response, ttlS: number, now: number) {
  const old = memory.get(key);
  if (old) { memoryBytes -= old.body.length; memory.delete(key); }
  if (body.length > MEMORY_MAX_BYTES / 4) return;
  memory.set(key, { body, status: response.status, headers: [...response.headers], expires: now + ttlS * 1000 });
  memoryBytes += body.length;
  for (const [k, v] of memory) {
    if (memoryBytes <= MEMORY_MAX_BYTES && v.expires > now) continue;
    memory.delete(k); memoryBytes -= v.body.length;
    if (memoryBytes <= MEMORY_MAX_BYTES) break;
  }
}

async function cached(deps: Deps, key: string, ttlS: number, build: () => Promise<Response>): Promise<Response> {
  const now = (deps.now ?? Date.now)();
  const mem = memory.get(key);
  if (mem && mem.expires > now) return new Response(mem.body, { status: mem.status, headers: mem.headers });
  if (deps.cache) {
    const hit = await deps.cache.match(key);
    if (hit) return hit;
  }
  const response = await build();
  if (response.ok) {
    const body = await response.text();
    remember(key, body, response, ttlS, now);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', `public, max-age=${ttlS}`);
    if (deps.cache) await deps.cache.put(key, new Response(body, { status: response.status, headers }));
    return new Response(body, { status: response.status, headers });
  }
  return response;
}

/**
 * Open-Meteo limits each IP address (600 weighted calls a minute, 10,000 a day). A whole rig often shares one
 * internet address, and the map grid alone weighs about 300 calls, so crews ran out and weather went blank.
 * The relay fetches each forecast once and serves it to everyone from Cloudflare's cache for 10 minutes.
 */
export const OPEN_METEO_ROUTES: Record<string, string> = {
  '/api/om/forecast': 'https://api.open-meteo.com/v1/forecast',
  '/api/om/marine': 'https://marine-api.open-meteo.com/v1/marine',
  '/api/om/elevation': 'https://api.open-meteo.com/v1/elevation',
};
const OPEN_METEO_CACHE_S = 600;
const OPEN_METEO_MAX_QUERY = 6000;

export async function handleOpenMeteo(url: URL, deps: Deps): Promise<Response> {
  const upstreamBase = OPEN_METEO_ROUTES[url.pathname];
  if (!upstreamBase) return json({ error: 'Not found' }, 404);
  if (!url.search || url.search.length > OPEN_METEO_MAX_QUERY) return json({ error: 'Bad query' }, 400);
  const host = new URL(upstreamBase).hostname;
  const now = (deps.now ?? Date.now)();
  // While Open-Meteo has told the relay to slow down, the browser asks Open-Meteo itself instead
  if ((cooldownUntil.get(host) ?? 0) > now) return json({ error: 'busy' }, 503, { 'Retry-After': '60' });
  return cached(deps, `https://relay.cache/om${url.pathname}${url.search}`, OPEN_METEO_CACHE_S, async () => {
    try {
      const response = await deps.fetch(upstreamBase + url.search, {
        headers: { Accept: 'application/json', 'User-Agent': 'ChopperCheck relay (choppercheck.com)' },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.status === 429) {
        cooldownUntil.set(host, now + retryAfterMs(response));
        return json({ error: 'busy' }, 503, { 'Retry-After': '60' });
      }
      const body = await response.text();
      return new Response(body, { status: response.status, headers: { 'Content-Type': 'application/json', ...CORS } });
    } catch {
      return json({ error: 'upstream unavailable' }, 502);
    }
  });
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
  if (url.pathname === '/' || url.pathname === '/health') return json({ ok: true, sources: SOURCES.map(s => s.id), lastResult: sourceStatus() });
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
  if (url.pathname.startsWith('/api/om/')) return handleOpenMeteo(url, deps);
  return json({ error: 'Not found' }, 404);
}
