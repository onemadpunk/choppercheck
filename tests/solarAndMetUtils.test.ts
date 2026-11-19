import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBestRunwayWind,
  computeDeckHeightWind,
  computeEstimatedFpsoDeckMotion,
  computeFiveModelConsensus,
  computeSolarTimesUtc,
  computeWindOverDeckSector,
  decodeRawTafHighlights,
  deriveEffectiveLimits,
  evaluateFpsoSwellRisk,
  evaluateHourWithLimits,
  isCaaNightForHour,
  parseSeaStateFromMetar,
  parseMetarCloudBase,
  parseMetarWindVis,
} from '../src/utils/solarAndMetUtils.ts';
import {
  AIRFRAME_PRESETS,
  classifyNorthSeaConvection,
  computeMinus10IsothermFt,
  evaluateCorridorLightningBypass,
  buildCorridorTrackGeometry,
  WEATHER_MODELS_META,
} from '../src/services/multiModelWeatherService.ts';
import { resolveHeliAdminStopCode } from '../src/data/installationsAndAirports.ts';

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

test('Night keeps the CAA 60 kt / 6 m limits and uses the ARA 300 ft and HCA night deck-motion limits', () => {
  const s92 = AIRFRAME_PRESETS.S92;
  const day = deriveEffectiveLimits(s92, false, true, '24h_ops');
  const night = deriveEffectiveLimits(s92, true, true, '24h_ops');

  assert.equal(day.maxHelideckGustKts, 60);
  assert.equal(day.maxFpsoWaveHeightM, 6.0);
  assert.equal(day.minCloudCeilingFt, 200);
  assert.equal(day.maxPitchRollDeg, 3.0);
  assert.equal(day.maxInclinationDeg, 3.5);
  assert.equal(day.maxShrMs, 1.3);

  assert.equal(night.maxHelideckGustKts, 60);
  assert.equal(night.maxFpsoWaveHeightM, 6.0);
  assert.equal(night.minCloudCeilingFt, 300);
  assert.equal(night.maxPitchRollDeg, 2.0);
  assert.equal(night.maxInclinationDeg, 2.5);
  assert.equal(night.maxShrMs, 1.0);

  // HCA Rev 9c: Category A night limits on a Cat 1 semi-sub are wider than on an FPSO.
  const nightSemiSub = deriveEffectiveLimits(s92, true, true, '24h_ops', null, true);
  assert.equal(nightSemiSub.maxPitchRollDeg, 3.0);
  assert.equal(nightSemiSub.maxInclinationDeg, 3.5);
  assert.equal(nightSemiSub.maxShrMs, 1.0);

  // Category B (AW139 / H175 / H160) day and FPSO-night limits.
  const aw139Day = deriveEffectiveLimits(AIRFRAME_PRESETS.AW139, false, true, '24h_ops');
  assert.equal(aw139Day.maxPitchRollDeg, 4.0);
  assert.equal(aw139Day.maxInclinationDeg, 4.5);
  assert.equal(aw139Day.maxShrMs, 1.3);
  const aw139Night = deriveEffectiveLimits(AIRFRAME_PRESETS.AW139, true, true, '24h_ops');
  assert.equal(aw139Night.maxPitchRollDeg, 3.0);
  assert.equal(aw139Night.maxInclinationDeg, 3.5);
  assert.equal(aw139Night.maxShrMs, 1.0);
  assert.equal(AIRFRAME_PRESETS.H175.maxPitchRollDegDay, 4.0);

  // Hold only when a value goes over its limit, never when it equals it, day or night.
  const calm = { cloudCeilingFt: 2500, visibilityKm: 15, freezingLevelFt: 4500, precipMmHr: 0 };
  for (const isNight of [false, true]) {
    for (const isFpso of [false, true]) {
      assert.notEqual(
        evaluateHourWithLimits({ ...calm, windSpeed10mKts: 58, windGust10mKts: 60 }, 2, 8, isNight, isFpso, s92, '24h_ops').status,
        'HOLD'
      );
      assert.equal(
        evaluateHourWithLimits({ ...calm, windSpeed10mKts: 45, windGust10mKts: 61 }, 2, 8, isNight, isFpso, s92, '24h_ops').status,
        'HOLD'
      );
      assert.notEqual(
        evaluateHourWithLimits({ ...calm, windSpeed10mKts: 15, windGust10mKts: 20 }, 6.0, 8, isNight, isFpso, s92, '24h_ops').status,
        'HOLD'
      );
      assert.equal(
        evaluateHourWithLimits({ ...calm, windSpeed10mKts: 15, windGust10mKts: 20 }, 6.1, 8, isNight, isFpso, s92, '24h_ops').status,
        'HOLD'
      );
    }
  }

  const customOverride = deriveEffectiveLimits(s92, false, true, '24h_ops', {
    maxGustKts: 50,
    maxWaveM: 4.5,
    minCeilingFt: 300,
    maxPitchRollDeg: 2.0,
    maxInclinationDeg: 2.5,
    maxShrMs: 1.0,
  });
  assert.equal(customOverride.maxHelideckGustKts, 50);
  assert.equal(customOverride.maxFpsoWaveHeightM, 4.5);
  assert.equal(customOverride.minCloudCeilingFt, 300);
  assert.equal(customOverride.maxPitchRollDeg, 2.0);
  assert.equal(customOverride.maxInclinationDeg, 2.5);
  assert.equal(customOverride.maxShrMs, 1.0);

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

  // Dry cold air (precip = 0, showers = 0) must NEVER be flagged as Amber/Moderate triggered lightning
  const dryColdAir = classifyNorthSeaConvection({
    cape: 140,
    wmo: 2,
    precip: 0,
    showers: 0,
    freezeFt: 2200,
    minus10Ft: minus10,
    sstMinus500C: 37,
  });
  assert.equal(dryColdAir.risk, 'LOW');
  assert.equal(dryColdAir.type, 'NONE');
});

test('UKMO UKV 2km is registered as 5th model and handles convection-permitting precipitation', () => {
  assert.equal(WEATHER_MODELS_META.length, 5);
  assert.ok(WEATHER_MODELS_META.some((m) => m.id === 'ukmo_seamless' && m.shortName === 'UKMO UKV'));

  // A 1.6 mm/h cell is below the strong-cell threshold: moderate, not high
  const ukvCell = classifyNorthSeaConvection({
    cape: 190,
    wmo: 71,
    precip: 1.6,
    showers: 0,
    freezeFt: 1800,
    minus10Ft: 8500,
    sstMinus500C: 35,
  });
  assert.equal(ukvCell.risk, 'MODERATE');
  assert.equal(ukvCell.type, 'TRIGGERED_WINTER');

  const ukvStrongCell = classifyNorthSeaConvection({
    cape: 190,
    wmo: 71,
    precip: 2.6,
    showers: 0,
    freezeFt: 1800,
    minus10Ft: 8500,
    sstMinus500C: 35,
  });
  assert.equal(ukvStrongCell.risk, 'HIGH');
});

test('triggered lightning follows the research freezing-level and cruise-temperature bands', () => {
  const base = {
    cape: 220,
    wmo: 81,
    precip: 2.5,
    showers: 2.5,
    minus10Ft: 8000,
    sstMinus500C: 36,
  };
  // Core setup: freezing level 2,000 ft, -1 C at cruise height
  assert.equal(classifyNorthSeaConvection({ ...base, freezeFt: 2000, cruiseTempC: -1 }).risk, 'HIGH');
  // Cruise air too cold (-8 C) for the mixed-phase band: not a triggered setup
  const tooCold = classifyNorthSeaConvection({ ...base, freezeFt: 2000, cruiseTempC: -8 });
  assert.notEqual(tooCold.type, 'TRIGGERED_WINTER');
  // Freezing level right at the sea surface: below the 1,000 ft core band, so moderate at most
  assert.equal(classifyNorthSeaConvection({ ...base, freezeFt: 300, cruiseTempC: -3 }).risk, 'MODERATE');
  // Freezing level 3,300 ft: just outside the core, moderate
  assert.equal(classifyNorthSeaConvection({ ...base, freezeFt: 3300, cruiseTempC: 1.5 }).risk, 'MODERATE');
  // Weak shower (0.5 mm/h, slight shower code) in the core band: moderate, not high
  assert.equal(
    classifyNorthSeaConvection({ ...base, wmo: 80, precip: 0.5, showers: 0.5, freezeFt: 2000, cruiseTempC: -1 }).risk,
    'MODERATE'
  );
});

test('Deck-height wind, FPSO long-swell risk, runway crosswind, WMO sea-state and 5-model consensus work cleanly', () => {
  const deckWind = computeDeckHeightWind(15, 21, 27, 180);
  assert.ok(deckWind.deckWindSpeedKts > 15 && deckWind.deckWindSpeedKts <= 27);
  assert.ok(deckWind.deckWindGustKts >= 21);

  const swell = evaluateFpsoSwellRisk(2.8, 11.5, 2.4, 11.5, true);
  assert.equal(swell.isResonantSwell, true);

  const rwy = computeBestRunwayWind('EGPD', 250, 22, 34);
  assert.ok(rwy !== null);
  assert.ok(rwy.crosswindKts >= 18);
  assert.equal(rwy.severity, 'HIGH');

  const sea = parseSeaStateFromMetar('METAR ENQA 151550Z AUTO 30017KT 9999 SCT042/// 06/M04 Q0993 W08/S6');
  assert.equal(sea.seaTempC, 8);
  assert.equal(sea.seaStateCode, 6);
  assert.ok(sea.seaStateLabel?.includes('Very Rough'));

  const baseSnap = {
    modelShortName: 'Test',
    resolutionLabel: 'Test',
    windSpeed10mKts: 15,
    windDir10mDeg: 240,
    windGust10mKts: 22,
    deckWindSpeedKts: 17,
    deckWindGustKts: 24,
    windSpeed950hPaKts: 25,
    windDir950hPaDeg: 245,
    temp950hPaC: 3,
    windSpeed850hPaKts: 28,
    windDir850hPaDeg: 250,
    freezingLevelFt: 4200,
    cloudCeilingFt: 2500,
    visibilityKm: 15,
    precipMmHr: 0,
    temp2mC: 8,
    qnhHpa: 1012,
    status: 'GO' as const,
    statusReason: 'GO',
  };
  const consensus = computeFiveModelConsensus(
    {
      hourIndex: 0,
      hourIso: '2026-11-15T12:00',
      hourLabel: '12:00',
      dayKey: '2026-11-15',
      dayNameShort: 'Today',
      dayNameFull: 'Today',
      dateShort: '15 Nov',
      isNight: false,
      waveHeightM: 2.0,
      swellPeriodSec: 7.5,
      swellDirDeg: 240,
      seaSurfaceTempC: 9,
      models: {
        ukmo_seamless: { ...baseSnap, modelId: 'ukmo_seamless', visibilityKm: 0.4, deckWindGustKts: 32 },
        icon_seamless: { ...baseSnap, modelId: 'icon_seamless' },
        ecmwf_ifs025: { ...baseSnap, modelId: 'ecmwf_ifs025' },
        gfs_seamless: { ...baseSnap, modelId: 'gfs_seamless' },
        gem_seamless: { ...baseSnap, modelId: 'gem_seamless' },
      },
    },
    true,
    AIRFRAME_PRESETS.S92,
    '24h_ops'
  );
  assert.equal(consensus.isSplit, true);
  assert.equal(consensus.goCount, 4);
  assert.equal(consensus.holdCount, 1);
  assert.ok(consensus.dissentingModels.some((d) => d.includes('UKMO UKV')));
});

test('Blackpool EGNH, Irish Sea, Southern North Sea & UK SAR bases resolve and compute runway winds', () => {
  const blkRwy = computeBestRunwayWind('EGNH', 275, 22, 31);
  assert.ok(blkRwy);
  assert.equal(blkRwy.runwayLabel, 'RWY 28');
  assert.equal(blkRwy.headwindKts, 22);
  assert.equal(blkRwy.crosswindKts, 0);

  const iomRwy = computeBestRunwayWind('EGNS', 260, 20, 28);
  assert.ok(iomRwy);
  assert.equal(iomRwy.runwayLabel, 'RWY 26');

  const cpc1 = resolveHeliAdminStopCode('CPC1');
  assert.equal(cpc1?.primaryShoreBase, 'EGNH');
  assert.equal(cpc1?.sector, 'irish_sea');

  const clip = resolveHeliAdminStopCode('CLIP');
  assert.equal(clip?.primaryShoreBase, 'EGSH');
  assert.equal(clip?.sector, 'southern_north_sea');

  const caernarfon = resolveHeliAdminStopCode('EGCK');
  assert.equal(caernarfon?.assetType, 'SAR Base');

  const catcher = resolveHeliAdminStopCode('CAT');
  assert.equal(catcher?.assetType, 'FPSO');

  // Verify all 5 presets have 60kt wind, 6.0m sea state, and 200ft Day ARA ceiling
  for (const preset of Object.values(AIRFRAME_PRESETS)) {
    assert.equal(preset.maxHelideckGustKts, 60);
    assert.equal(preset.maxFpsoWaveHeightM, 6.0);
    assert.equal(preset.minCloudCeilingFt, 200);
  }

  // Verify wave-derived FPSO deck motion RAO estimator (Green deck vs Red deck)
  const calmMotion = computeEstimatedFpsoDeckMotion({
    waveHeightM: 2.2,
    swellPeriodSec: 8.5,
    swellWaveHeightM: 1.8,
    swellWavePeriodSec: 8.5,
    swellDirDeg: 240,
    windDirDeg: 240,
    maxPitchRollLimit: 3.0,
    maxInclinationLimit: 3.5,
    maxShrLimit: 1.3,
  });
  assert.equal(calmMotion.deckLightStatus, 'GREEN');
  assert.ok(calmMotion.estPitchRollDeg > 0 && calmMotion.estPitchRollDeg < 2.0);
  assert.ok(calmMotion.estShrMs > 0 && calmMotion.estShrMs < 1.0);

  const stormMotion = computeEstimatedFpsoDeckMotion({
    waveHeightM: 6.4,
    swellPeriodSec: 12.5,
    swellWaveHeightM: 5.8,
    swellWavePeriodSec: 12.5,
    swellDirDeg: 310,
    windDirDeg: 230,
    maxPitchRollLimit: 3.0,
    maxInclinationLimit: 3.5,
    maxShrLimit: 1.3,
  });
  assert.equal(stormMotion.deckLightStatus, 'RED');
  assert.ok(stormMotion.estPitchRollDeg >= 3.0);

  // Verify Triggered-Lightning Corridor & 18 NM Fly-Around Dog-Leg Bypass between EGPB Sumburgh and GL Glen Lyon
  const sumburgh = { lat: 59.8789, lon: -1.2956, code: 'EGPB' };
  const glenLyon = { lat: 60.3589, lon: -4.0652, code: 'GL' };
  const midLat = (sumburgh.lat + glenLyon.lat) / 2;
  const midLon = (sumburgh.lon + glenLyon.lon) / 2;

  const baseGridPt = {
    windSpeed10mKts: 22,
    windDir10mDeg: 250,
    windGust10mKts: 30,
    windSpeed950hPaKts: 28,
    windDir950hPaDeg: 255,
    windSpeed850hPaKts: 34,
    windDir850hPaDeg: 260,
    freezingLevelFt: 2400,
    cloudCeilingFt: 2800,
    visibilityKm: 25,
    waveHeightM: 2.6,
    waveDirDeg: 250,
    seaSurfaceTempC: 9.5,
    precipMmHr: 0,
    capeJkg: 40,
    lightningRisk: 'LOW' as const,
    lightningType: 'NONE' as const,
  };

  // Case 1: Clear corridor
  const clearGrid = [
    { ...baseGridPt, lat: midLat, lon: midLon },
    { ...baseGridPt, lat: midLat + 0.45, lon: midLon },
    { ...baseGridPt, lat: midLat - 0.45, lon: midLon },
  ];
  const clearBypass = evaluateCorridorLightningBypass(
    sumburgh,
    glenLyon,
    clearGrid,
    AIRFRAME_PRESETS.S92
  );
  assert.equal(clearBypass.directRisk, 'LOW');
  assert.equal(clearBypass.recommendedRoute, 'DIRECT');

  // Case 2: coarse grid only shows risk on the track -> no detour advice
  const cellOnTrackGrid = [
    { ...baseGridPt, lat: midLat, lon: midLon, lightningRisk: 'HIGH' as const },
  ];
  const coarse = evaluateCorridorLightningBypass(sumburgh, glenLyon, cellOnTrackGrid, AIRFRAME_PRESETS.S92);
  assert.equal(coarse.dataSource, 'coarse_grid');
  assert.equal(coarse.directRisk, 'HIGH');
  assert.equal(coarse.leftBypassRisk, null);
  assert.equal(coarse.recommendedRoute, 'NO_CLEAR_TRACK');
  assert.ok(!/detour to the/.test(coarse.summaryText));

  // Case 3: route samples: direct track HIGH, left detour clear -> recommend left, named by compass
  const geo = buildCorridorTrackGeometry(sumburgh, glenLyon);
  const mk = (pts: Array<{ lat: number; lon: number }>, risk: 'LOW' | 'MODERATE' | 'HIGH') =>
    pts.map((p) => ({ ...baseGridPt, ...p, lightningRisk: risk }));
  const routeSamples = [
    ...mk(geo.direct, 'HIGH'),
    ...mk(geo.left, 'LOW'),
    ...mk(geo.right, 'MODERATE'),
  ];
  const dogLeg = evaluateCorridorLightningBypass(sumburgh, glenLyon, [], AIRFRAME_PRESETS.S92, routeSamples);
  assert.equal(dogLeg.dataSource, 'route_samples');
  assert.equal(dogLeg.recommendedRoute, 'BYPASS_LEFT');
  assert.ok(dogLeg.summaryText.includes(`detour to the ${geo.leftSideLabel}`));

  // Case 4: a detour that is only MODERATE is never called clear
  const notClear = evaluateCorridorLightningBypass(sumburgh, glenLyon, [], AIRFRAME_PRESETS.S92, [
    ...mk(geo.direct, 'HIGH'),
    ...mk(geo.left, 'MODERATE'),
    ...mk(geo.right, 'MODERATE'),
  ]);
  assert.equal(notClear.recommendedRoute, 'NO_CLEAR_TRACK');
});

test('corridor detours are named by real compass direction', () => {
  // Route due north: detours must be west (left) and east (right), not north/south
  const ns = buildCorridorTrackGeometry({ lat: 57, lon: -2 }, { lat: 59, lon: -2 });
  assert.equal(ns.leftSideLabel, 'west');
  assert.equal(ns.rightSideLabel, 'east');
  assert.ok(ns.leftMidpoint.lon < -2 && ns.rightMidpoint.lon > -2);
  // Route due east: left is north
  const ew = buildCorridorTrackGeometry({ lat: 57, lon: -2 }, { lat: 57, lon: 1 });
  assert.equal(ew.leftSideLabel, 'north');
  assert.ok(ew.leftMidpoint.lat > 57);
  // Offset is ~18 NM
  const offNm = Math.hypot(ns.leftMidpoint.lat - 58, (ns.leftMidpoint.lon + 2) * Math.cos((58 * Math.PI) / 180)) * 60;
  assert.ok(Math.abs(offNm - 18) < 0.5, `offset ${offNm}`);
});


test('parseMetarCloudBase reads the reported ceiling', () => {
  const bkn = parseMetarCloudBase('EGPD 191050Z 24015KT 9999 FEW006 BKN012 OVC030 08/06 Q1002');
  assert.equal(bkn?.ceilingFt, 1200);
  assert.equal(bkn?.lowestLayerFt, 600);
  assert.equal(bkn?.ceilingGroup, 'BKN012');
  const fog = parseMetarCloudBase('EGPB 191050Z 18005KT 0300 FG VV001 09/09 Q1010');
  assert.equal(fog?.ceilingFt, 100);
  const cavok = parseMetarCloudBase('EGPD 191050Z 24010KT CAVOK 10/02 Q1020');
  assert.equal(cavok?.ceilingFt, null);
  assert.equal(cavok?.noCeiling, true);
  const sct = parseMetarCloudBase('EGPD 191050Z 24010KT 9999 SCT015CB 10/02 Q1020');
  assert.equal(sct?.ceilingFt, null);
  assert.equal(sct?.lowestLayerFt, 1500);
  // Trend groups are forecasts, not observations
  const trend = parseMetarCloudBase('EGPD 191050Z 24010KT 9999 SCT030 10/02 Q1020 TEMPO BKN008');
  assert.equal(trend?.ceilingFt, null);
  assert.equal(parseMetarCloudBase(undefined), null);
  assert.equal(parseMetarCloudBase('EGPD 191050Z 24010KT 9999 10/02 Q1020'), null);
});

test('parseMetarWindVis reads reported wind and visibility', () => {
  const a = parseMetarWindVis('EGPD 191050Z 24025G38KT 210V270 4000 -SHRA BKN012 08/06 Q1002');
  assert.deepEqual(a, { windDirDeg: 240, windSpeedKts: 25, windGustKts: 38, visibilityKm: 4 });
  const b = parseMetarWindVis('ENLE 191050Z AUTO 19010MPS 9999NDV OVC015 08/06 Q1002');
  assert.equal(b?.windSpeedKts, 19);
  assert.equal(b?.visibilityKm, 10);
  const c = parseMetarWindVis('EGPB 191050Z VRB02KT CAVOK 10/02 Q1020');
  assert.equal(c?.windDirDeg, null);
  assert.equal(c?.visibilityKm, 10);
  // Trend visibility is a forecast, not an observation
  const d = parseMetarWindVis('EGPD 191050Z 24010KT 9999 SCT030 10/02 Q1020 TEMPO 2000 SHRA');
  assert.equal(d?.visibilityKm, 10);
});
