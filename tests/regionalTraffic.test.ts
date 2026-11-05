import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchHybridRadarTraffic } from '../src/services/radarService';
import { INSTALLATIONS_AND_AIRPORTS } from '../src/data/installationsAndAirports';
const facility = INSTALLATIONS_AND_AIRPORTS[0];

test('regional snapshots preserve individual observation times, deduplicate and report partial coverage', async () => {
  const saved = globalThis.fetch; const now = Date.now();
  try {
    globalThis.fetch = async url => {
      assert.ok(String(url).includes('regions=north-sea,uk-ireland,south-uk'));
      assert.ok(!String(url).includes('lat='));
      return Response.json({ source: 'adsb.fi + adsb.lol', partial: true, feedAvailable: true, feeds: [
        { now: now - 2000, source: 'adsb.fi', ac: [{ hex: 'regional', flight: 'SRD948', t: 'S92', lat: 55, lon: -4, seen_pos: 1 }] },
        { now, source: 'adsb.lol', ac: [{ hex: 'regional', flight: 'SRD948', t: 'S92', lat: 54.9, lon: -4, seen_pos: 2 }] },
      ] });
    };
    const result = await fetchHybridRadarTraffic(56,-3,facility,0,false,undefined,{south:49.5,north:61.5,west:-11,east:8});
    assert.equal(result.flights.length, 1); assert.equal(result.flights[0].lat, 54.9);
    assert.equal(result.flights[0].observedAt, now - 2000); assert.equal(result.flights[0].provider, 'adsb.lol');
    assert.equal(result.partial, true); assert.equal(result.flights[0].helicopterOperator, 'HM Coastguard');
  } finally { globalThis.fetch = saved; }
});
