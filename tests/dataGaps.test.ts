import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFiveModelConsensus,
  evaluateFacilityHour,
  evaluateHourWithLimits,
} from '../src/utils/solarAndMetUtils.ts';
import {
  AIRFRAME_PRESETS,
  evaluateAirframeLimits,
  interpolateSpotWeatherAtLatLon,
} from '../src/services/multiModelWeatherService.ts';
import type { ModelPointSnapshot, MultiModelHourEntry, SpatialWeatherGridPoint } from '../src/types/radar.ts';

const preset = AIRFRAME_PRESETS.S92;

const snap = (over: Partial<ModelPointSnapshot> = {}): ModelPointSnapshot => ({
  modelId: 'ukmo_seamless',
  modelShortName: 'UKMO UKV',
  resolutionLabel: '2 km',
  windSpeed10mKts: 14,
  windDir10mDeg: 240,
  windGust10mKts: 20,
  windSpeed950hPaKts: 20,
  windDir950hPaDeg: 250,
  temp950hPaC: 5,
  windSpeed850hPaKts: 25,
  windDir850hPaDeg: 260,
  freezingLevelFt: 6000,
  cloudCeilingFt: 3000,
  visibilityKm: 15,
  precipMmHr: 0,
  temp2mC: 9,
  qnhHpa: 1012,
  lightningRisk: 'LOW',
  lightningType: 'NONE',
  status: 'GO',
  statusReason: '',
  ...over,
});

const hour = (models: Partial<Record<string, ModelPointSnapshot>>, waveHeightM: number | null = 1.5): MultiModelHourEntry => ({
  hourIndex: 0,
  hourIso: '2026-11-19T12:00',
  hourLabel: '12:00',
  dayKey: '2026-11-19',
  dayNameShort: 'Thu',
  dayNameFull: 'Thursday',
  dateShort: '19 Nov',
  isNight: false,
  waveHeightM,
  swellPeriodSec: waveHeightM === null ? null : 7,
  swellDirDeg: waveHeightM === null ? null : 240,
  seaSurfaceTempC: waveHeightM === null ? null : 10,
  models: models as MultiModelHourEntry['models'],
});

test('an hour with missing forecast values is never GO', () => {
  const ok = evaluateHourWithLimits(snap(), 1.5, 7, false, false, preset, '24h_ops');
  assert.equal(ok.status, 'GO');
  const gap = evaluateHourWithLimits(snap({ missingData: ['wind', 'gusts'] }), 1.5, 7, false, false, preset, '24h_ops');
  assert.equal(gap.status, 'CAUTION');
  assert.match(gap.reason, /NO DATA/);
  // A real limit breach still shows as HOLD even with gaps elsewhere
  const hold = evaluateHourWithLimits(snap({ missingData: ['low cloud'], visibilityKm: 0.5 }), 1.5, 7, false, false, preset, '24h_ops');
  assert.equal(hold.status, 'HOLD');
});

test('no sea data skips the sea-state limit instead of inventing waves', () => {
  const ev = evaluateHourWithLimits(snap(), null, null, false, false, preset, '24h_ops');
  assert.equal(ev.status, 'GO');
  assert.doesNotMatch(ev.reason, /Wave \d/);
  // Shore airport leg of the route: no 6 m sea limit there
  assert.equal(evaluateAirframeLimits(14, 20, 3000, 15, 6000, null, 0, false, preset).status, 'GO');
  assert.equal(evaluateAirframeLimits(14, 20, 3000, 15, 6000, 7, 0, false, preset).status, 'HOLD');
  assert.equal(evaluateAirframeLimits(14, 20, 3000, 15, 6000, null, 0, false, preset, ['sea state']).status, 'CAUTION');
});

test('models with gaps are left out of the 5-model vote', () => {
  const h = hour({
    ukmo_seamless: snap(),
    icon_seamless: snap(),
    ecmwf_ifs025: snap({ missingData: ['wind'] }),
    gfs_seamless: snap({ missingData: ['low cloud'] }),
    gem_seamless: snap(),
  });
  const c = computeFiveModelConsensus(h, false, preset, '24h_ops');
  assert.equal(c.totalModels, 3);
  assert.equal(c.goCount, 3);
  assert.deepEqual(c.noDataModels.sort(), ['ECMWF', 'GFS']);

  const allGaps = computeFiveModelConsensus(
    hour({ ukmo_seamless: snap({ missingData: ['wind'] }) }),
    false,
    preset,
    '24h_ops'
  );
  assert.equal(allGaps.totalModels, 0);
  assert.notEqual(allGaps.consensusStatus, 'GO');
});

test('map card and panel share one evaluation: a red deck estimate turns GO into CAUTION', () => {
  // Search a range of sea states for one where the limits pass but the deck estimate is red
  let found = false;
  for (let hs = 1; hs <= 4.7 && !found; hs += 0.1) {
    for (const period of [6, 7, 8, 9]) {
      // Beam seas: swell from 240 on a vessel heading 150
      const h = { ...hour({}, Number(hs.toFixed(1))), swellPeriodSec: period };
      const override = { vesselHeadingDeg: 150 };
      const plain = evaluateHourWithLimits(snap(), h.waveHeightM, period, true, true, preset, '24h_ops', override);
      const full = evaluateFacilityHour({
        snap: snap(),
        hour: h,
        isNight: true,
        isFpso: true,
        isSemiSub: false,
        preset,
        flightOpsMode: '24h_ops',
        customOverride: override,
      });
      if (plain.status === 'GO' && full.deckMotion?.deckLightStatus === 'RED') {
        assert.equal(full.status, 'CAUTION');
        assert.equal(full.deckMotionRaisesCaution, true);
        found = true;
        break;
      }
      if (full.deckMotion?.deckLightStatus !== 'RED') assert.equal(full.status, plain.status);
    }
  }
  assert.ok(found, 'expected at least one sea state where only the deck estimate is red');
  // No sea data: no deck estimate at all
  const none = evaluateFacilityHour({
    snap: snap(),
    hour: hour({}, null),
    isNight: false,
    isFpso: true,
    isSemiSub: false,
    preset,
    flightOpsMode: '24h_ops',
  });
  assert.equal(none.deckMotion, null);
});

test('map spot readout ignores points with gaps and shows no waves over land', () => {
  const base: SpatialWeatherGridPoint = {
    lat: 56,
    lon: -4,
    windSpeed10mKts: 10,
    windDir10mDeg: 200,
    windGust10mKts: 15,
    windSpeed950hPaKts: 15,
    windDir950hPaDeg: 210,
    windSpeed850hPaKts: 20,
    windDir850hPaDeg: 220,
    freezingLevelFt: 5000,
    cloudCeilingFt: 3000,
    visibilityKm: 20,
    waveHeightM: null,
    waveDirDeg: null,
    seaSurfaceTempC: null,
  };
  const land = interpolateSpotWeatherAtLatLon(56, -4, [base, { ...base, lat: 56.1, windSpeed10mKts: 99, missingData: ['wind'] }], preset);
  assert.ok(land);
  assert.equal(land.waveHeightM, null);
  assert.equal(land.windSpeed10mKts, 10);
  assert.equal(interpolateSpotWeatherAtLatLon(56, -4, [{ ...base, missingData: ['wind'] }], preset), null);
});
