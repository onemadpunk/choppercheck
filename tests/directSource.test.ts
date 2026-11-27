import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRegionSnapshot, resetDirectCooldown, FLIGHT_API_ORIGIN } from '../src/services/radarService';

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

test('asks airplanes.live directly first and labels the source', async () => {
  resetDirectCooldown();
  const urls: string[] = [];
  const data = await fetchRegionSnapshot('north-sea', new AbortController().signal, (async (u: any) => { urls.push(String(u)); return ok({ now: 1, ac: [] }); }) as typeof fetch);
  assert.equal(data.source, 'airplanes.live');
  assert.deepEqual(urls, ['https://api.airplanes.live/v2/point/58.7/-0.5/250']);
});

test('falls back to the relay when airplanes.live refuses, and skips it during the cooldown', async () => {
  resetDirectCooldown();
  const urls: string[] = [];
  const fetcher = (async (u: any) => {
    urls.push(String(u));
    return String(u).includes('airplanes.live') ? new Response('', { status: 429, headers: { 'Retry-After': '30' } }) : ok({ now: 1, ac: [], source: 'flyitalyadsb' });
  }) as typeof fetch;
  const first = await fetchRegionSnapshot('uk-ireland', new AbortController().signal, fetcher, 1_000_000);
  assert.equal(first.source, 'flyitalyadsb');
  assert.equal(urls[1], FLIGHT_API_ORIGIN + '/api/flights?regions=uk-ireland');
  urls.length = 0;
  await fetchRegionSnapshot('uk-ireland', new AbortController().signal, fetcher, 1_010_000);
  assert.ok(!urls.some(u => u.includes('airplanes.live')));
});
