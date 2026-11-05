import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchHybridRadarTraffic } from '../src/services/radarService';
import { INSTALLATIONS_AND_AIRPORTS } from '../src/data/installationsAndAirports';

const facility = INSTALLATIONS_AND_AIRPORTS[0];
const load = (signal?: AbortSignal) => fetchHybridRadarTraffic(57, 0, facility, 0, false, signal);
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('real aircraft render while ground transmitters and old positions are excluded', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      json({
        ac: [
          { hex: 'abc123', flight: 'BAW123', t: 'A320', lat: 57, lon: 0, gs: 200, alt_baro: 18000 },
          { hex: 'tower1', t: 'TWR', lat: 57, lon: 0 },
          { hex: 'tower2', category: 'C3', lat: 57, lon: 0 },
          { hex: 'old', seen_pos: 500, lat: 57, lon: 0 },
        ],
      });
    const result = await load();
    assert.equal(result.feedAvailable, true);
    assert.equal(result.liveCount, 1);
    assert.equal(result.flights[0].callsign, 'BAW123');
  } finally {
    globalThis.fetch = saved;
  }
});

test('a successful zero-aircraft feed stops fallbacks rather than pretending it failed', async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      return json({ ac: [] });
    };
    assert.equal((await load()).feedAvailable, true);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = saved;
  }
});

test('blocked local API falls back to user relay; stale cached data is skipped', async () => {
  const saved = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.ok(options?.signal);
      calls++;
      if (calls === 1) return new Response('Not found', { status: 404 });
      if (calls === 2) return json({ ac: [], now: Date.now() - 300000 });
      return json({ contents: JSON.stringify({ ac: [], now: Date.now() }) });
    };
    assert.equal((await load()).feedAvailable, true);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = saved;
  }
});

test('all provider failures return unavailable, not a successful empty sky', async () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    const result = await load();
    assert.equal(result.feedAvailable, false);
    assert.equal(result.liveCount, 0);
  } finally {
    globalThis.fetch = saved;
  }
});

test('cancelling an obsolete request stops further fallback attempts', async () => {
  const saved = globalThis.fetch;
  const controller = new AbortController();
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      controller.abort();
      throw new Error('aborted');
    };
    await load(controller.signal);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = saved;
  }
});
