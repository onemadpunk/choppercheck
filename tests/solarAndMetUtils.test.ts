import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSolarTimesUtc,
  computeWindOverDeckSector,
  decodeRawTafHighlights,
  deriveEffectiveLimits,
  evaluateHourWithLimits,
  isCaaNightForHour,
} from '../src/utils/solarAndMetUtils.ts';
import {
  AIRFRAME_PRESETS,
  classifyNorthSeaConvection,
  computeMinus10IsothermFt,
  WEATHER_MODELS_META,
} from '../src/services/multiModelWeatherService.ts';

test('Glen Lyon winter daylight window is much shorter than summer daylight', () => {
  const winter = computeSolarTimesUtc(60.3589, -4.0652, new Date('2026-11-14T12:00:00Z'));
  const summer = computeSolarTimesUtc(60.3589, -4.0652, new Date('2026-06-21T12:00:00Z'));

  assert.equal(winter.polarStatus, 'normal');
  assert.equal(summer.polarStatus, 'normal');
  assert.ok(winter.sunsetUtcMin - winter.sunriseUtcMin < 480); // < 8 hours in mid-Nov at 60.36°N
  assert.ok(summer.sunsetUtcMin - summer.sunriseUtcMin > 1080); // > 18 hours in June at 60.36°N
  assert.equal(isCaaNightForHour('2026-11-14T02:00', winter), true);
  assert.equal(isCaaNightForHour('2026-11-14T12:00', winter), false);
});

test('Night operating limits tighten ceiling, visibility, gust and FPSO wave margins automatically', () => {
  const s92 = AIRFRAME_PRESETS.S92;
  const day = deriveEffectiveLimits(s92, false, true, '24h_ops');
  const night = deriveEffectiveLimits(s92, true, true, '24h_ops');

  assert.ok(night.minCloudCeilingFt > day.minCloudCeilingFt);
  assert.ok(night.minVisibilityKm > day.minVisibilityKm);
  assert.ok(night.maxHelideckGustKts < day.maxHelideckGustKts);
  assert.ok(night.maxFpsoWaveHeightM < day.maxFpsoWaveHeightM);

  const blockedDaylightOnly = evaluateHourWithLimits(
    {
      windSpeed10mKts: 15,
      windGust10mKts: 20,
      cloudCeilingFt: 2500,
      visibilityKm: 15,
      freezingLevelFt: 4500,
      precipMmHr: 0,
    },
    2.0,
    8.0,
    true,
    true,
    s92,
    'daylight_only'
  );
  assert.equal(blockedDaylightOnly.status, 'HOLD');
});

test('decodeRawTafHighlights extracts genuine gusts, low ceiling, reduced vis and fog/TS tags', () => {
  const taf =
    'TAF EGPB 141058Z 1412/1421 23030G42KT 9999 FEW014 BKN020 TEMPO 1412/1416 0800 FG BKN003 PROB40 TSRA';
  const highlights = decodeRawTafHighlights(taf);

  assert.ok(highlights.some((h) => h.includes('42 kt')));
  assert.ok(highlights.some((h) => h.includes('300 ft')));
  assert.ok(highlights.some((h) => h.includes('0.8 km')));
  assert.ok(highlights.some((h) => h.includes('Fog')));
  assert.ok(highlights.some((h) => h.includes('Thunderstorm')));
});

test('computeWindOverDeckSector distinguishes bow wind, beam crosswind, and aft turbulence', () => {
  assert.equal(computeWindOverDeckSector(240, 235).severity, 'OPTIMAL');
  assert.equal(computeWindOverDeckSector(320, 235).severity, 'CROSSWIND');
  assert.equal(computeWindOverDeckSector(55, 235).severity, 'AFT_TURBULENCE');
});

test('North Sea triggered-lightning physics separates winter triggered setup from natural thunderstorms', () => {
  const minus10 = computeMinus10IsothermFt(-3, 1400, -13, 2900, -28, 5400);
  assert.ok(minus10 > 6000 && minus10 < 9500);

  const winterTriggered = classifyNorthSeaConvection({
    cape: 210,
    wmo: 81,
    precip: 1.5,
    showers: 1.2,
    freezeFt: 2200,
    minus10Ft: minus10,
    sstMinus500C: 36,
  });
  assert.equal(winterTriggered.risk, 'HIGH');
  assert.equal(winterTriggered.type, 'TRIGGERED_WINTER');

  const naturalTs = classifyNorthSeaConvection({
    cape: 650,
    wmo: 95,
    precip: 5.0,
    showers: 5.0,
    freezeFt: 5500,
    minus10Ft: 11000,
    sstMinus500C: 28,
  });
  assert.equal(naturalTs.risk, 'HIGH');
  assert.equal(naturalTs.type, 'NATURAL_TS');
});

test('UKMO UKV 2km is registered as 5th model and handles convection-permitting precipitation', () => {
  assert.equal(WEATHER_MODELS_META.length, 5);
  assert.ok(WEATHER_MODELS_META.some((m) => m.id === 'ukmo_seamless' && m.shortName === 'UKMO UKV'));

  const ukvCell = classifyNorthSeaConvection({
    cape: 190,
    wmo: 71,
    precip: 1.6,
    showers: 0,
    freezeFt: 1800,
    minus10Ft: 8500,
    sstMinus500C: 35,
  });
  assert.equal(ukvCell.risk, 'HIGH');
  assert.equal(ukvCell.type, 'TRIGGERED_WINTER');
});
