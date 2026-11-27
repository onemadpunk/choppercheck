import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWeatherJson, relayUrlFor, resetWeatherFetch, getWeatherStaleSince, FRESH_MS } from '../src/services/weatherFetch';

const OM = 'https://api.open-meteo.com/v1/forecast?latitude=57.1&longitude=1.2&hourly=wind_speed_10m';
const realFetch = globalThis.fetch;
const realNow = Date.now;

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any) => { calls.push(String(input)); return handler(String(input)); }) as typeof fetch;
  return calls;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test.beforeEach(() => resetWeatherFetch('https://relay.example'));
test.afterEach(() => { globalThis.fetch = realFetch; Date.now = realNow; });

test('maps Open-Meteo URLs to the relay, and leaves other URLs alone', () => {
  assert.equal(relayUrlFor(OM, 'https://relay.example'), 'https://relay.example/api/om/forecast?latitude=57.1&longitude=1.2&hourly=wind_speed_10m');
  assert.equal(relayUrlFor('https://marine-api.open-meteo.com/v1/marine?latitude=1', 'https://r'), 'https://r/api/om/marine?latitude=1');
  assert.equal(relayUrlFor('https://aviationweather.gov/api/data/metar?ids=EGPD', 'https://r'), null);
  assert.equal(relayUrlFor(OM, null), null);
});

test('asks the relay first and reuses the answer for repeat requests', async () => {
  const calls = stubFetch(() => json({ ok: 1 }));
  const [a, b] = await Promise.all([fetchWeatherJson(OM), fetchWeatherJson(OM)]);
  const c = await fetchWeatherJson(OM);
  assert.deepEqual([a, b, c], [{ ok: 1 }, { ok: 1 }, { ok: 1 }]);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/api\/om\/forecast\?/);
});

test('falls back to Open-Meteo directly when the relay is down', async () => {
  const calls = stubFetch((url) => (url.includes('/api/om/') ? json({ error: 'busy' }, 503) : json({ direct: true })));
  assert.deepEqual(await fetchWeatherJson(OM), { direct: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], OM);
});

test('does not hammer Open-Meteo when it says slow down', async () => {
  const calls = stubFetch((url) => (url.includes('/api/om/') ? json({}, 503) : json({ reason: 'limit' }, 429)));
  assert.equal(await fetchWeatherJson(OM, 3), null);
  assert.equal(calls.filter((u) => u === OM).length, 1);
  // A different forecast within the minute goes nowhere near Open-Meteo directly
  await fetchWeatherJson(OM + '&x=1', 3);
  assert.equal(calls.filter((u) => u.startsWith('https://api.open-meteo.com')).length, 1);
});

test('shows the last good forecast, with its time, when nothing answers', async () => {
  let t = 1_800_000_000_000;
  Date.now = () => t;
  stubFetch(() => json({ first: true }));
  await fetchWeatherJson(OM);
  assert.equal(getWeatherStaleSince(), null);
  t += FRESH_MS + 1000;
  stubFetch(() => new Response('down', { status: 503 }));
  assert.deepEqual(await fetchWeatherJson(OM, 1), { first: true });
  assert.equal(getWeatherStaleSince(), 1_800_000_000_000);
  // When it answers again the notice clears
  stubFetch(() => json({ second: true }));
  assert.deepEqual(await fetchWeatherJson(OM), { second: true });
  assert.equal(getWeatherStaleSince(), null);
});
