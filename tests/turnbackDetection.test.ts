import assert from 'node:assert/strict';
import test from 'node:test';
import { INSTALLATIONS_AND_AIRPORTS } from '../src/data/installationsAndAirports';
import { TurnbackFix, TurnbackTracker, describeTurnback } from '../src/utils/turnbackDetection';
import { annotateTurnbacks, getRecentTurnbacks, turnbackTracker } from '../src/services/radarService';
import { AircraftTarget } from '../src/types/radar';

const ABZ = INSTALLATIONS_AND_AIRPORTS.find(f => f.code === 'EGPD')!;
const RIG = INSTALLATIONS_AND_AIRPORTS.find(f => f.assetType === 'FPSO' || f.assetType === 'Fixed Platform')!;
const T0 = Date.UTC(2026, 10, 19, 8, 0);

// Positions along a straight line between two points, one fix per 30 s.
function leg(from: { lat: number; lon: number }, to: { lat: number; lon: number }, steps: number, start: number, alt = 3000) {
  return Array.from({ length: steps + 1 }, (_, i) => ({
    lat: from.lat + (to.lat - from.lat) * i / steps, lon: from.lon + (to.lon - from.lon) * i / steps,
    altFt: i === 0 ? 500 : alt, timestamp: start + i * 30_000,
  }));
}
const eastOfAbz = (nm: number) => ({ lat: ABZ.lat, lon: ABZ.lon + nm / (60 * Math.cos(ABZ.lat * Math.PI / 180)) });
function fly(tracker: TurnbackTracker, points: { lat: number; lon: number; altFt: number; timestamp: number }[], extra: Partial<TurnbackFix> = {}) {
  return points.map(p => tracker.update({ hex: 'ABC123', callsign: 'BHL53A', typeCode: 'S92', category: 'offshore_heli', speedKts: 140, ...p, ...extra }));
}

test('flags a helicopter that heads 20 NM offshore and turns back to Aberdeen, then records its return', () => {
  const tracker = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const out = fly(tracker, leg(ABZ, eastOfAbz(20), 20, T0));
  assert.ok(out.every(r => r === undefined), 'no flag on the way out');
  const back = fly(tracker, leg(eastOfAbz(20), eastOfAbz(1), 19, T0 + 11 * 60_000).slice(1));
  const first = back.findIndex(Boolean);
  assert.ok(first >= 0 && first <= 6, 'flagged soon after turning');
  assert.equal(back[first]!.status, 'returning');
  assert.equal(back[first]!.baseCode, 'EGPD');
  assert.equal(back[first]!.maxDistanceNm, 20);
  const landed = fly(tracker, [{ ...eastOfAbz(0.5), altFt: 300, timestamp: T0 + 30 * 60_000 }])[0];
  assert.equal(landed?.status, 'landed');
  assert.match(describeTurnback(landed!), /returned to/);
  assert.equal(tracker.recentTurnbacks(T0 + 31 * 60_000).length, 1);
  assert.equal(tracker.recentTurnbacks(T0 + 5 * 3600_000).length, 0, 'recent list expires');
});

test('a normal round trip to a rig is not a turnback', () => {
  const tracker = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const out = leg(ABZ, RIG, 60, T0);
  const onDeck = { lat: RIG.lat, lon: RIG.lon, altFt: 200, timestamp: T0 + 61 * 30_000 };
  const home = leg(RIG, eastOfAbz(1), 60, T0 + 62 * 30_000).slice(1);
  const results = fly(tracker, [...out, onDeck, ...home, { ...eastOfAbz(0.5), altFt: 300, timestamp: T0 + 3 * 3600_000 }]);
  assert.ok(results.every(r => r === undefined));
});

test('turning round right over a rig without a seen landing is treated as a rig visit', () => {
  const tracker = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const results = fly(tracker, [...leg(ABZ, RIG, 60, T0), ...leg(RIG, ABZ, 60, T0 + 61 * 30_000).slice(1)]);
  assert.ok(results.every(r => r === undefined));
});

test('no flag when the departure was not seen, for coastguard, or after a long gap in coverage', () => {
  const midFlight = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  assert.ok(fly(midFlight, [...leg(eastOfAbz(15), eastOfAbz(20), 5, T0), ...leg(eastOfAbz(20), eastOfAbz(6), 14, T0 + 6 * 30_000).slice(1)]).every(r => !r));

  const sar = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const route = [...leg(ABZ, eastOfAbz(20), 20, T0), ...leg(eastOfAbz(20), eastOfAbz(1), 19, T0 + 11 * 60_000).slice(1)];
  assert.ok(fly(sar, route, { category: 'coastguard_sar' }).every(r => !r));

  const gap = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const out = leg(ABZ, eastOfAbz(20), 20, T0);
  const back = leg(eastOfAbz(20), eastOfAbz(1), 19, T0 + 60 * 60_000).slice(1);
  assert.ok(fly(gap, [...out, ...back]).every(r => !r));
});

test('a short dog-leg that carries on outbound clears the flag', () => {
  const tracker = new TurnbackTracker(INSTALLATIONS_AND_AIRPORTS);
  const out = fly(tracker, [...leg(ABZ, eastOfAbz(20), 20, T0), ...leg(eastOfAbz(20), eastOfAbz(12), 8, T0 + 10 * 60_000).slice(1)]);
  assert.equal(out.at(-1)?.status, 'returning');
  const again = fly(tracker, leg(eastOfAbz(12), eastOfAbz(30), 18, T0 + 15 * 60_000).slice(1));
  assert.equal(again.at(-1), undefined);
  assert.equal(tracker.recentTurnbacks(T0 + 30 * 60_000).length, 0);
});

test('the radar service attaches turnbacks to live aircraft and lists them', () => {
  turnbackTracker.clear();
  const route = [...leg(ABZ, eastOfAbz(20), 20, T0), ...leg(eastOfAbz(20), eastOfAbz(8), 12, T0 + 11 * 60_000).slice(1)];
  let last: AircraftTarget | undefined;
  for (const p of route) {
    const target = { hex: 'ABC123', callsign: 'BHL53A', typeCode: 'S92', category: 'offshore_heli', lat: p.lat, lon: p.lon,
      altitudeFt: p.altFt, altitudeReported: true, groundSpeedKts: 140, observedAt: p.timestamp } as AircraftTarget;
    last = annotateTurnbacks([target])[0];
  }
  assert.equal(last?.turnback?.status, 'returning');
  assert.equal(getRecentTurnbacks(T0 + 20 * 60_000)[0].callsign, 'BHL53A');
  turnbackTracker.clear();
});
