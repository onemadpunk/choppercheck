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

test('uses adsb.fi first and filters towers and stale positions', async () => {
  resetCooldowns();
  const res = await handle(req('/api/flights?regions=north-sea'), {}, { fetch: fakeFetch({ 'opendata.adsb.fi': ok(snapshot()) }), now: () => NOW });
  const body: any = await res.json();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(body.source, 'adsb.fi');
  assert.deepEqual(body.ac.map((a: any) => a.hex), ['abc123']);
  assert.equal(body.now, NOW - 1000);
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
