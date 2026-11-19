import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBaseOutlook,
  buildTerrainSamplePoints,
  destinationPoint,
  moonIlluminationFraction,
  moonAltitudeDeg,
  rateBaseHour,
  summariseBaseOutlook,
  summariseTerrain,
} from '../src/utils/baseOutlook.ts';
import type { ModelPointSnapshot, MultiModelHourEntry } from '../src/types/radar.ts';

const snap = (over: Partial<ModelPointSnapshot> = {}): ModelPointSnapshot => ({
  modelId: 'ukmo_seamless',
  modelShortName: 'UKMO UKV',
  resolutionLabel: '2 km',
  windSpeed10mKts: 15,
  windDir10mDeg: 240,
  windGust10mKts: 22,
  windSpeed950hPaKts: 25,
  windDir950hPaDeg: 250,
  temp950hPaC: 3,
  windSpeed850hPaKts: 35,
  windDir850hPaDeg: 260,
  freezingLevelFt: 6000,
  cloudCeilingFt: 3500,
  visibilityKm: 10,
  precipMmHr: 0,
  temp2mC: 8,
  qnhHpa: 1010,
  lightningRisk: 'LOW',
  lightningType: 'NONE',
  status: 'GO',
  statusReason: '',
  ...over,
});

test('terrain ring stays under the 100-point elevation API limit and lands at the right distance', () => {
  const pts = buildTerrainSamplePoints(55.51, -4.59);
  assert.ok(pts.length <= 100);
  // 25 NM due north of Prestwick is about 0.416 degrees of latitude
  const north = destinationPoint(55.51, -4.59, 25, 0);
  assert.ok(Math.abs(north.lat - 55.51 - 25 / 60) < 0.01, `got ${north.lat}`);
  assert.ok(Math.abs(north.lon + 4.59) < 1e-6);
});

test('summariseTerrain finds the highest ground, its direction, and treats sea as 0 ft', () => {
  const pts = buildTerrainSamplePoints(55.51, -4.59);
  const elev = pts.map((p) => (p.distanceNm === 20 && p.bearingDeg === 270 ? 874 : p.bearingDeg >= 180 ? 0 : 150));
  const t = summariseTerrain(pts, elev);
  assert.ok(t);
  assert.equal(t.highest.heightFt, Math.round(874 * 3.28084)); // Goatfell is 874 m
  assert.equal(t.highest.direction, 'W');
  assert.equal(t.highest.distanceNm, 20);
  assert.equal(t.highestWithin10Nm.heightFt, Math.round(150 * 3.28084));
  assert.equal(summariseTerrain(pts, pts.map(() => null)), null);
});

test('moon illumination matches known full and new moons', () => {
  assert.ok(moonIlluminationFraction(Date.UTC(2024, 3, 23, 23, 49)) > 0.97); // full moon 23 Apr 2024
  assert.ok(moonIlluminationFraction(Date.UTC(2024, 3, 8, 18, 21)) < 0.03); // new moon (eclipse) 8 Apr 2024
  const half = moonIlluminationFraction(Date.UTC(2024, 3, 15, 19, 13)); // first quarter 15 Apr 2024
  assert.ok(half > 0.4 && half < 0.6, `got ${half}`);
  const alt = moonAltitudeDeg(Date.UTC(2024, 3, 23, 23, 49), 55.5, -4.6);
  assert.ok(alt > -90 && alt < 90);
});

test('rateBaseHour: hills in cloud and icing over the hills are marginal; very low cloud is poor', () => {
  const good = rateBaseHour({ snap: snap(), baseElevationFt: 65, hillsFt: 2867 });
  assert.equal(good.level, 'GOOD');

  const hills = rateBaseHour({ snap: snap({ cloudCeilingFt: 1800 }), baseElevationFt: 65, hillsFt: 2867 });
  assert.equal(hills.level, 'MARGINAL');
  assert.equal(hills.hillsInCloud, true);

  const icing = rateBaseHour({
    snap: snap({ freezingLevelFt: 2500, precipMmHr: 1.2, cloudCeilingFt: 2500 }),
    baseElevationFt: 65,
    hillsFt: 2867,
  });
  assert.equal(icing.level, 'MARGINAL');
  assert.ok(icing.reasons.some((r) => r.includes('icing')));

  const poor = rateBaseHour({ snap: snap({ cloudCeilingFt: 300, visibilityKm: 1 }), baseElevationFt: 65, hillsFt: null });
  assert.equal(poor.level, 'POOR');

  // No ceiling from the model (under 5/8 low cloud) is never "hills in cloud"
  const clear = rateBaseHour({ snap: snap({ cloudCeilingFt: 5000 }), baseElevationFt: 65, hillsFt: 2867 });
  assert.equal(clear.ceilingFt, null);
  assert.equal(clear.hillsInCloud, false);

  // A fresh METAR replaces the model for the current hour
  const reported = rateBaseHour({
    snap: snap({ cloudCeilingFt: 3500 }),
    baseElevationFt: 65,
    hillsFt: 2867,
    reported: { ceilingFt: 400, visibilityKm: 3, windKts: 20, gustKts: 31, windDirDeg: 250 },
  });
  assert.equal(reported.level, 'POOR');
  assert.equal(reported.reported, true);
  assert.equal(reported.gustKts, 31);
});

test('buildBaseOutlook starts at the current hour, steps every 3 h and summarises the change', () => {
  const start = Date.UTC(2026, 10, 19, 12, 0);
  const hourly: MultiModelHourEntry[] = Array.from({ length: 72 }, (_, i) => {
    const iso = new Date(start + i * 3600_000).toISOString().slice(0, 16);
    const s = snap(i >= 9 ? { cloudCeilingFt: 1500 } : {});
    return {
      hourIndex: i,
      hourIso: iso,
      hourLabel: iso.slice(11, 16),
      dayKey: iso.slice(0, 10),
      dayNameShort: 'Thu',
      dayNameFull: 'Thursday',
      dateShort: '19 Nov',
      isNight: i % 24 >= 5 && i % 24 <= 19,
      waveHeightM: 0,
      swellPeriodSec: 0,
      swellDirDeg: 0,
      seaSurfaceTempC: 10,
      models: { ukmo_seamless: s } as MultiModelHourEntry['models'],
    };
  });
  const rows = buildBaseOutlook({
    hourly,
    modelId: 'ukmo_seamless',
    lat: 55.51,
    lon: -4.59,
    baseElevationFt: 65,
    hillsFt: 2867,
    nowMs: start + 20 * 60_000,
  });
  assert.equal(rows.length, 16);
  assert.equal(rows[0].hourIso, '2026-11-19T12:00');
  assert.equal(rows[1].hourIso, '2026-11-19T15:00');
  assert.equal(rows[0].level, 'GOOD');
  assert.equal(rows[3].level, 'MARGINAL');
  assert.ok(rows.find((r) => r.isNight)?.moonPercent !== null);
  assert.match(summariseBaseOutlook(rows), /^Good now, marginal from Thu 21:00 \(hills/);
});
