import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLiveAircraft, advanceAircraftPositionsSmoothly, normalizeTraffic, normalizeWeather } from '../src/services/radarService';
import { decodeAircraftType } from '../src/data/aircraftDecoder';
import { INSTALLATIONS_AND_AIRPORTS } from '../src/data/installationsAndAirports';
const facility = INSTALLATIONS_AND_AIRPORTS[0];
const now = Date.now();
const raw = { hex: 'unit-test', flight: 'ICE520', t: 'B38M', lat: facility.lat + 0.1, lon: facility.lon, alt_baro: 35000, gs: 450, track: 180, seen_pos: 2 };
test('real fixed-wing positions never acquire an offshore route or invented times', () => {
  const f = classifyLiveAircraft(raw, facility, now, 'test', now)!;
  assert.equal(f.destinationRigId, undefined); assert.equal(f.originCode, 'Unknown');
  assert.equal(f.destinationCode, 'Unknown'); assert.equal(f.scheduledDepTime, 'Unavailable');
  assert.equal(f.estimatedArrTime, 'Unavailable'); assert.equal(f.etaToRefMinutes, null);
  assert.equal(f.status, 'position_reported'); assert.equal(f.category, 'commercial_fixed_wing');
  assert.equal(f.trail.length, 1); assert.equal(f.trail[0].timestamp, now - 2000);
});
test('unknown helicopters are not Bristow and Coastguard identity is not an active rescue', () => {
  const heli = classifyLiveAircraft({ ...raw, hex: 'heli', flight: 'GABCD', t: 'S92' }, facility, now, 'test', now)!;
  assert.equal(heli.helicopterOperator, 'Unknown'); assert.equal(heli.operator, 'Operator not reported');
  assert.equal(heli.status, 'position_reported');
  const coastguard = classifyLiveAircraft({ ...raw, hex: 'coastguard', flight: 'SRG199', t: 'AW189' }, facility, now, 'test', now)!;
  assert.equal(coastguard.status, 'position_reported');
  assert.equal(decodeAircraftType('A124').isRotary, false);
});
test('missing telemetry and position age do not become fabricated measurements', () => {
  const f = classifyLiveAircraft({ hex: 'no-measurements', lat: 57, lon: 0, seen_pos: 1 }, facility, now, 'test', now)!;
  assert.equal(f.altitudeReported, false); assert.equal(f.speedReported, false); assert.equal(f.trackReported, false);
  assert.equal(classifyLiveAircraft({ hex: 'no-age', lat: 57, lon: 0 }, facility, now, 'test', now), null);
  assert.equal(classifyLiveAircraft({ ...raw, seen_pos: 46 }, facility, now, 'test', now), null);
  assert.throws(() => normalizeTraffic({ now: now - 60000, ac: [raw] }, facility, now));
});
test('predictions stop at ten seconds; failed feeds cannot keep targets alive or invent history', () => {
  const f = classifyLiveAircraft({ ...raw, hex: 'prediction-test', seen_pos: 0 }, facility, now, 'test', now)!;
  const at10 = advanceAircraftPositionsSmoothly([f], 2, facility, now + 10000)[0];
  const at30 = advanceAircraftPositionsSmoothly([at10], 2, facility, now + 30000)[0];
  assert.equal(at10.lat, at30.lat); assert.equal(at10.lon, at30.lon); assert.equal(at30.observedAt, now);
  assert.deepEqual(at30.trail, f.trail); assert.equal(at30.source, 'dead_reckoning');
  assert.equal(advanceAircraftPositionsSmoothly([at30], 2, facility, now + 46000).length, 0);
});
test('failed weather stays unavailable without synthetic METAR, ceiling, GO or motion readings', () => {
  const wx = normalizeWeather(null, facility, now);
  assert.equal(wx.windSpeedKts, null); assert.equal(wx.significantWaveHeightM, null);
  assert.equal(wx.rawMetar, undefined); assert.equal(wx.rawTaf, undefined); assert.equal(wx.cap437Status, 'UNAVAILABLE');
  assert.equal('cloudBaseFt' in wx, false); assert.equal('vesselPitchDeg' in wx, false);
});
test('airport reports remain separate from offshore model values and preserve observation time', () => {
  const wx = normalizeWeather({ weather: { current: { time: now/1000, pressure_msl: 1020, wind_speed_10m: null } },
    metar: [{ icaoId: facility.primaryShoreBase, obsTime: now/1000 - 1800, rawOb: 'REAL REPORT', fltCat: 'IFR' }] }, facility, now);
  assert.equal(wx.pressureMslHpa, 1020); assert.equal(wx.windSpeedKts, null); assert.equal(wx.rawMetar, 'REAL REPORT');
  assert.equal(wx.metarTime, now - 1800000); assert.equal(wx.flightCategory, 'IFR');
});

test('a direct model fallback preserves the genuine airport report when the shared forecast is unavailable', async () => {
  const { fetchHelideckWeather } = await import('../src/services/radarService');
  const saved = globalThis.fetch; const requests: string[] = [];
  try {
    globalThis.fetch = async input => {
      const url=String(input); requests.push(url);
      if(url.includes('/api/weather')) return Response.json({weather:null,metar:[{icaoId:facility.primaryShoreBase,rawOb:'ACTUAL AIRPORT REPORT',obsTime:Date.now()/1000}]});
      return Response.json({current:{time:Date.now()/1000,wind_speed_10m:11,pressure_msl:1037}});
    };
    const wx=await fetchHelideckWeather(facility);
    assert.equal(wx.windSpeedKts,11); assert.equal(wx.rawMetar,'ACTUAL AIRPORT REPORT');
    assert.equal(wx.rawTaf,undefined); assert.equal(requests.length,2);
  } finally {globalThis.fetch=saved;}
});

