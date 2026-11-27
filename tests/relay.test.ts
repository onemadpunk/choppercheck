import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, resetCooldowns } from '../relay/src/relay';

const NOW = 1_800_000_000_000;
const snapshot = (n = 2) => ({ now: NOW - 1000, ac: [
  { hex: 'abc123', lat: 57.1, lon: 1.2, seen_pos: 1, t: 'S92', category: 'A7' },
  { hex: 'tower1', lat: 57.1, lon: 1.2, seen_pos: 1, t: 'TWR' },
  { hex: 'old111', lat: 57.1, lon: 1.2, seen_pos: 300 },
].slice(0, n + 1) });

function fakeFetch(routes: Record<string, () => Response>, calls: { url: string; headers: any }[] = []) {
  return (async (input: any, init?: any) => {
    const url = String(input);
    calls.push({ url, headers: init?.headers });
    const host = new URL(url).hostname;
    const route = routes[host];
    return route ? route() : new Response('down', { status: 503 });
  }) as typeof fetch;
}
const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });
const req = (path: string) => new Request('https://relay.example' + path);

test('uses adsb.fi and filters towers and stale positions', async () => {
  resetCooldowns();
  const res = await handle(req('/api/flights?regions=north-sea'), {}, { fetch: fakeFetch({ 'opendata.adsb.fi': ok(snapshot()) }), now: () => NOW });
  const body: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(body.source, 'adsb.fi');
  assert.deepEqual(body.feeds[0].ac.map((a: any) => a.hex), ['abc123']);
  assert.equal(body.feeds[0].now, NOW - 1000);
});

test('falls back to airplanes.live, then FlyItalyADSB with the key, when earlier sources rate-limit', async () => {
  resetCooldowns();
  const limited = () => new Response('slow down', { status: 429, headers: { 'Retry-After': '30' } });
  const calls: any[] = [];
  const res = await handle(req('/api/flights?regions=uk-ireland'), { FLYITALY_API_KEY: 'test-key' }, {
    fetch: fakeFetch({ 'opendata.adsb.fi': limited, 'api.airplanes.live': limited, 'api.flyitalyadsb.com': ok(snapshot()) }, calls), now: () => NOW });
  const body: any = await res.json();
  assert.equal(body.source, 'flyitalyadsb');
  assert.match(body.attribution, /CC BY-SA 4\.0/);
  const fia = calls.find(c => c.url.includes('flyitalyadsb'));
  assert.equal(fia.headers['X-Api-Key'], 'test-key');
  assert.ok(fia.url.includes('/lat/54.2/lon/-5.8/dist/250'));
  // The key never appears in the answer.
  assert.ok(!JSON.stringify(body).includes('test-key'));
});

test('skips FlyItalyADSB when no key is set and rejects stale snapshots', async () => {
  resetCooldowns();
  const calls: any[] = [];
  const stale = ok({ now: NOW - 120_000, ac: [] });
  const res = await handle(req('/api/flights?regions=south-uk'), {}, {
    fetch: fakeFetch({ 'opendata.adsb.fi': stale, 'api.airplanes.live': stale, 'api.adsb.lol': ok(snapshot()) }, calls), now: () => NOW });
  assert.equal(((await res.json()) as any).source, 'adsb.lol');
  assert.ok(!calls.some(c => c.url.includes('flyitalyadsb')));
});

test('a cooled-down source is skipped on the next request', async () => {
  resetCooldowns();
  const calls: any[] = [];
  const routes = { 'opendata.adsb.fi': () => new Response('', { status: 429, headers: { 'Retry-After': '60' } }), 'api.airplanes.live': ok(snapshot()) };
  await handle(req('/api/flights?regions=north-sea'), {}, { fetch: fakeFetch(routes, calls), now: () => NOW });
  calls.length = 0;
  await handle(req('/api/flights?regions=north-sea'), {}, { fetch: fakeFetch(routes, calls), now: () => NOW + 5000 });
  assert.ok(!calls.some(c => c.url.includes('adsb.fi')));
});

test('all sources down gives 503 with Retry-After; bad region gives 400', async () => {
  resetCooldowns();
  const res = await handle(req('/api/flights?regions=north-sea'), { FLYITALY_API_KEY: 'k' }, { fetch: fakeFetch({}), now: () => NOW });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('Retry-After'), '10');
  assert.equal((await handle(req('/api/flights?regions=north-sea,uk-ireland'), {}, { fetch: fakeFetch({}) })).status, 400);
});

test('weather returns forecast, marine and METAR in the shape the site reads', async () => {
  const calls: any[] = [];
  const res = await handle(req('/api/weather?lat=57.20&lon=-2.20&icao=egpd'), {}, { fetch: fakeFetch({
    'api.open-meteo.com': ok({ current: { time: 1, wind_speed_10m: 20 } }),
    'marine-api.open-meteo.com': ok({ current: { time: 1, wave_height: 2.5 } }),
    'aviationweather.gov': ok([{ icaoId: 'EGPD', rawOb: 'EGPD 271950Z 24015KT 9999 FEW020 08/03 Q1002', fltCat: 'VFR', obsTime: 1 }]),
  }, calls) });
  const body: any = await res.json();
  assert.equal(body.weather.current.wind_speed_10m, 20);
  assert.equal(body.marine.current.wave_height, 2.5);
  assert.equal(body.metar[0].icaoId, 'EGPD');
  assert.ok(calls.some(c => c.url.includes('ids=EGPD')));
  assert.equal((await handle(req('/api/weather?lat=x&lon=1'), {}, { fetch: fakeFetch({}) })).status, 400);
});

test('when both full-coverage sources fail, FlyItalyADSB and adsb.lol are combined as separate feeds', async () => {
  resetCooldowns();
  const blocked = () => new Response('blocked', { status: 403 });
  const res = await handle(req('/api/flights?regions=north-sea'), { FLYITALY_API_KEY: 'k' }, { fetch: fakeFetch({
    'opendata.adsb.fi': blocked, 'api.airplanes.live': blocked,
    'api.flyitalyadsb.com': ok(snapshot()), 'api.adsb.lol': ok({ now: NOW - 3000, ac: [{ hex: 'def456', lat: 58, lon: 1, seen_pos: 2 }] }),
  }), now: () => NOW });
  const body: any = await res.json();
  assert.equal(body.source, 'flyitalyadsb + adsb.lol');
  assert.deepEqual(body.feeds.map((f: any) => [f.source, f.now, f.ac.length]), [['flyitalyadsb', NOW - 1000, 1], ['adsb.lol', NOW - 3000, 1]]);
  const health: any = await (await handle(req('/health'), {}, { fetch: fakeFetch({}) })).json();
  assert.equal(health.lastResult['adsb.fi'].result, 'HTTP 403');
  assert.equal(health.lastResult['adsb.lol'].result, 'ok, 1 aircraft');
  assert.ok(!JSON.stringify(health).includes('"k"'));
});

test('passes Open-Meteo requests through once and serves repeats from memory', async () => {
  resetCooldowns();
  const calls: any[] = [];
  const deps = { fetch: fakeFetch({ 'api.open-meteo.com': ok({ hourly: { time: ['t'] } }) }, calls), now: () => NOW };
  const path = '/api/om/forecast?latitude=57.1,58.2&longitude=1.2,1.5&hourly=wind_speed_10m';
  const first = await handle(req(path), {}, deps);
  const second = await handle(req(path), {}, deps);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), { hourly: { time: ['t'] } });
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.open-meteo.com/v1/forecast?latitude=57.1,58.2&longitude=1.2,1.5&hourly=wind_speed_10m');
});

test('routes marine requests to the marine API and refuses other paths', async () => {
  resetCooldowns();
  const calls: any[] = [];
  const deps = { fetch: fakeFetch({ 'marine-api.open-meteo.com': ok({ hourly: {} }) }, calls), now: () => NOW };
  assert.equal((await handle(req('/api/om/marine?latitude=57&longitude=1&hourly=wave_height'), {}, deps)).status, 200);
  assert.equal(calls[0].url.startsWith('https://marine-api.open-meteo.com/v1/marine?'), true);
  assert.equal((await handle(req('/api/om/archive?latitude=57'), {}, deps)).status, 404);
  assert.equal((await handle(req('/api/om/forecast'), {}, deps)).status, 400);
});

test('when Open-Meteo says slow down, answers busy without asking again for a minute', async () => {
  resetCooldowns();
  const calls: any[] = [];
  let now = NOW;
  const deps = { fetch: fakeFetch({ 'api.open-meteo.com': () => new Response('limit', { status: 429 }) }, calls), now: () => now };
  const a = await handle(req('/api/om/forecast?latitude=1&longitude=1'), {}, deps);
  const b = await handle(req('/api/om/forecast?latitude=2&longitude=2'), {}, deps);
  assert.equal(a.status, 503);
  assert.equal(b.status, 503);
  assert.equal(calls.length, 1);
  now += 61_000;
  await handle(req('/api/om/forecast?latitude=3&longitude=3'), {}, deps);
  assert.equal(calls.length, 2);
});

test('pools every source that answers, and asks adsb.lol at most every 40 s per region', async () => {
  resetCooldowns();
  const calls: any[] = [];
  const routes = {
    'opendata.adsb.fi': ok(snapshot()), 'api.airplanes.live': () => new Response('', { status: 403 }),
    'api.flyitalyadsb.com': ok({ now: NOW - 500, ac: [{ hex: 'fia111', lat: 59, lon: 1, seen_pos: 1 }] }),
    'api.adsb.lol': ok({ now: NOW - 2000, ac: [{ hex: 'lol222', lat: 59, lon: 1, seen_pos: 1 }] }),
  };
  const body: any = await (await handle(req('/api/flights?regions=north-sea'), { FLYITALY_API_KEY: 'k' }, { fetch: fakeFetch(routes, calls), now: () => NOW })).json();
  assert.equal(body.source, 'adsb.fi + flyitalyadsb + adsb.lol');
  assert.deepEqual(body.feeds.map((f: any) => f.source), ['adsb.fi', 'flyitalyadsb', 'adsb.lol']);
  calls.length = 0;
  const again: any = await (await handle(req('/api/flights?regions=north-sea'), { FLYITALY_API_KEY: 'k' }, { fetch: fakeFetch(routes, calls), now: () => NOW + 20_000 })).json();
  assert.ok(!calls.some(c => c.url.includes('adsb.lol')));
  assert.ok(again.feeds.some((f: any) => f.source === 'adsb.lol')); // reused, still under 45 s old
  calls.length = 0;
  await handle(req('/api/flights?regions=north-sea'), { FLYITALY_API_KEY: 'k' }, { fetch: fakeFetch(routes, calls), now: () => NOW + 41_000 });
  assert.ok(calls.some(c => c.url.includes('adsb.lol')));
});
