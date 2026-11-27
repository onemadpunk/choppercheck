/**
 * One place where every Open-Meteo forecast is fetched.
 *
 * Open-Meteo limits each internet address (600 weighted calls a minute, 10,000 a day). A whole rig often shares
 * one address, and one visit weighs a few hundred calls (the map grid alone is about 300), so crews hit the
 * limit and weather went blank. So, in order:
 *   1. a forecast fetched in the last few minutes is reused (also stops duplicate requests when switching rigs);
 *   2. the relay is asked first: it fetches each forecast once and shares it with everyone for 10 minutes;
 *   3. if the relay can't answer, Open-Meteo is asked directly (no fast retries when it says "slow down");
 *   4. if that fails too, the last forecast this phone downloaded (up to 12 hours old) is shown, labelled with
 *      its time, rather than nothing.
 */
import { OPEN_METEO_RELAY_ORIGIN } from './apiOrigin';

export const FRESH_MS = 8 * 60 * 1000;
export const STALE_LIMIT_MS = 12 * 60 * 60 * 1000;
const PERSIST_CACHE = 'choppercheck-weather-v1';
const MEMORY_MAX = 40;

type Entry = { data: unknown; fetchedAt: number };
const memory = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown | null>>();

let relayOrigin: string | null = OPEN_METEO_RELAY_ORIGIN;

const RELAY_PATHS: Record<string, string> = {
  'api.open-meteo.com/v1/forecast': '/api/om/forecast',
  'marine-api.open-meteo.com/v1/marine': '/api/om/marine',
  'api.open-meteo.com/v1/elevation': '/api/om/elevation',
};

/** The relay address for an Open-Meteo URL, or null if it isn't one the relay serves. */
export function relayUrlFor(url: string, origin: string | null = relayOrigin): string | null {
  if (!origin) return null;
  try {
    const u = new URL(url);
    const path = RELAY_PATHS[u.hostname + u.pathname];
    return path ? origin + path + u.search : null;
  } catch {
    return null;
  }
}

// ---- "showing an older forecast" notice -------------------------------------------------------------
const staleServed = new Map<string, number>();
const listeners = new Set<() => void>();
let staleSince: number | null = null;
function updateStale() {
  const next = staleServed.size ? Math.min(...staleServed.values()) : null;
  if (next === staleSince) return;
  staleSince = next;
  listeners.forEach((l) => l());
}
/** Time of the oldest saved forecast currently on screen because the weather service couldn't be reached. */
export const getWeatherStaleSince = () => staleSince;
export function subscribeWeatherStale(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---- saved copies (survive a reload or losing signal) -----------------------------------------------
async function openPersist(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(PERSIST_CACHE);
  } catch {
    return null;
  }
}
async function readSaved(url: string): Promise<Entry | null> {
  try {
    const cache = await openPersist();
    const hit = cache && (await cache.match(url));
    if (!hit) return null;
    const fetchedAt = Number(hit.headers.get('x-fetched-at'));
    return Number.isFinite(fetchedAt) ? { data: await hit.json(), fetchedAt } : null;
  } catch {
    return null;
  }
}
async function save(url: string, body: string, fetchedAt: number) {
  try {
    const cache = await openPersist();
    await cache?.put(url, new Response(body, { headers: { 'Content-Type': 'application/json', 'x-fetched-at': String(fetchedAt) } }));
  } catch {
    // storage full or blocked: the in-memory copy still works
  }
}

function keep(url: string, entry: Entry) {
  memory.delete(url);
  memory.set(url, entry);
  if (memory.size > MEMORY_MAX) memory.delete(memory.keys().next().value as string);
}

/** After Open-Meteo says "slow down", don't ask it directly again for a minute. */
let directCooldownUntil = 0;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetches JSON text, or reports why not. 'limited' = the service said slow down; don't retry it now. */
async function getText(url: string, timeoutMs: number): Promise<{ text: string } | 'limited' | 'failed' | 'refused'> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return { text: await res.text() };
    if (res.status === 429) return 'limited';
    return res.status >= 400 && res.status < 500 ? 'refused' : 'failed';
  } catch {
    return 'failed';
  }
}

async function load(url: string, tries: number): Promise<unknown | null> {
  const now = Date.now();
  const relayUrl = relayUrlFor(url);
  let text: string | null = null;

  if (relayUrl) {
    const r = await getText(relayUrl, 15000);
    if (typeof r === 'object') text = r.text;
  }
  for (let attempt = 0; text === null && attempt < tries && Date.now() >= directCooldownUntil; attempt++) {
    const r = await getText(url, 15000);
    if (typeof r === 'object') text = r.text;
    else if (r === 'limited') {
      directCooldownUntil = Date.now() + 60_000; // retrying now only uses up more of the limit
      break;
    } else if (r === 'refused') break;
    else if (attempt < tries - 1) await wait(700 * (attempt + 1) ** 2);
  }

  if (text !== null) {
    try {
      const data = JSON.parse(text);
      keep(url, { data, fetchedAt: now });
      void save(url, text, now);
      if (staleServed.delete(url)) updateStale();
      return data;
    } catch {
      // not JSON: treat as a failure below
    }
  }

  const saved = memory.get(url) ?? (await readSaved(url));
  if (saved && Date.now() - saved.fetchedAt < STALE_LIMIT_MS) {
    staleServed.set(url, saved.fetchedAt);
    updateStale();
    return saved.data;
  }
  return null;
}

/**
 * Fetches a weather JSON URL with sharing, caching and fallbacks (see top of file). Returns null only when
 * there is no live answer and no saved copy from the last 12 hours.
 */
export function fetchWeatherJson(url: string, tries = 3): Promise<unknown | null> {
  const hit = memory.get(url);
  if (hit && Date.now() - hit.fetchedAt < FRESH_MS && !staleServed.has(url)) return Promise.resolve(hit.data);
  const pending = inFlight.get(url);
  if (pending) return pending;
  const p = load(url, tries).finally(() => inFlight.delete(url));
  inFlight.set(url, p);
  return p;
}

/** For tests: clears every cache, optionally with a relay address to use. */
export function resetWeatherFetch(relay: string | null = null) {
  relayOrigin = relay;
  memory.clear();
  inFlight.clear();
  staleServed.clear();
  staleSince = null;
  directCooldownUntil = 0;
}
