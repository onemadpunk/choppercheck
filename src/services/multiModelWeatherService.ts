import {
  AirframeLimitPreset,
  AirframePresetId,
  CorridorWaypointProfile,
  DayFlightWindowSummary,
  InstallationOrAirport,
  ModelPointSnapshot,
  MultiModelHourEntry,
  NearbyStationMetar,
  SpatialWeatherGridPoint,
  WeatherModelId,
} from '../types/radar';
import { calculateBearingDeg, calculateDistanceNm } from '../data/aircraftDecoder';
import {
  ARA_MIN_DESCENT_HEIGHT_DAY_FT,
  assessIcing,
  NO_LOW_CEILING_FT,
  HOFO_MIN_VISIBILITY_DAY_KM,
  CAA_MAX_HELIDECK_WIND_KTS,
  CAA_MAX_SIGNIFICANT_WAVE_HEIGHT_M,
  computeDeckHeightWind,
  computeSolarTimesUtc,
  isCaaNightForHour,
  parseSeaStateFromMetar,
} from '../utils/solarAndMetUtils';
import { FLIGHT_API_ORIGIN } from './radarService';
import { buildTerrainSamplePoints, summariseTerrain, type TerrainSummary } from '../utils/baseOutlook';

/**
 * Moving-deck landing limits for Category 1 helidecks (semi-subs, FPSOs, tankers) from the
 * HCA "Standard Helideck Monitoring Systems" Rev 9c (2023), section 7.1 (mirrors HLL Part C).
 * Helicopter Category A = S92, EC225, AS332, AW189. Category B = AW139, EC175 (H175), EC155, AS365, AW169...
 */
const HCA_CAT_A_MOTION = {
  maxPitchRollDegDay: 3.0,
  maxInclinationDegDay: 3.5,
  maxShrMsDay: 1.3,
  maxPitchRollDegNight: 2.0, // Cat 1 "Other" (FPSO / tanker)
  maxInclinationDegNight: 2.5,
  maxShrMsNight: 1.0,
  maxPitchRollDegNightSemiSub: 3.0,
  maxInclinationDegNightSemiSub: 3.5,
  maxShrMsNightSemiSub: 1.0,
};
const HCA_CAT_B_MOTION = {
  maxPitchRollDegDay: 4.0,
  maxInclinationDegDay: 4.5,
  maxShrMsDay: 1.3,
  maxPitchRollDegNight: 3.0, // Cat 1 "Other" (FPSO / tanker)
  maxInclinationDegNight: 3.5,
  maxShrMsNight: 1.0,
  maxPitchRollDegNightSemiSub: 4.0,
  maxInclinationDegNightSemiSub: 4.5,
  maxShrMsNightSemiSub: 1.3,
};

const COMMON_LIMITS = {
  maxHelideckGustKts: CAA_MAX_HELIDECK_WIND_KTS,
  cautionGustKts: 48,
  minCloudCeilingFt: ARA_MIN_DESCENT_HEIGHT_DAY_FT,
  minVisibilityKm: HOFO_MIN_VISIBILITY_DAY_KM, // SPA.HOFO.130
  maxFpsoWaveHeightM: CAA_MAX_SIGNIFICANT_WAVE_HEIGHT_M,
};

export const AIRFRAME_PRESETS: Record<AirframePresetId, AirframeLimitPreset> = {
  S92: {
    id: 'S92',
    name: 'Sikorsky S-92A (Bristow / CHC)',
    ...COMMON_LIMITS,
    fullIceProtection: true, // FAA/EASA full icing certification
    ...HCA_CAT_A_MOTION,
  },
  AW189: {
    id: 'AW189',
    name: 'Leonardo AW189 (Bristow / CHC / SAR)',
    ...COMMON_LIMITS,
    fullIceProtection: true, // EASA Full Ice Protection System, 2016
    ...HCA_CAT_A_MOTION,
  },
  H175: {
    id: 'H175',
    name: 'Airbus H175 (NHV / OHS)',
    ...COMMON_LIMITS,
    fullIceProtection: false,
    // HCA lists the H175 (EC175) as Category B.
    ...HCA_CAT_B_MOTION,
  },
  AW139: {
    id: 'AW139',
    name: 'Leonardo AW139 (SNS / Irish Sea)',
    ...COMMON_LIMITS,
    fullIceProtection: false,
    ...HCA_CAT_B_MOTION,
  },
  H160: {
    id: 'H160',
    name: 'Airbus H160 Offshore',
    ...COMMON_LIMITS,
    fullIceProtection: false,
    // Not named in the HCA list; treated as Category B like the AS365/EC155 it replaces.
    ...HCA_CAT_B_MOTION,
  },
};

export const WEATHER_MODELS_META: Array<{
  id: WeatherModelId;
  shortName: string;
  agency: string;
  resolution: string;
}> = [
  {
    id: 'ukmo_seamless',
    shortName: 'UKMO UKV',
    agency: 'UK Met Office (2km UK / 10km Global)',
    resolution: '2 km UKV (48h) / 10 km',
  },
  {
    id: 'icon_seamless',
    shortName: 'DWD ICON-EU',
    agency: 'German Weather Service (DWD)',
    resolution: '6.5 km High-Res EU',
  },
  {
    id: 'ecmwf_ifs025',
    shortName: 'ECMWF IFS',
    agency: 'European Centre (Copernicus Open)',
    resolution: '9 km / 0.25° Synoptic',
  },
  {
    id: 'gfs_seamless',
    shortName: 'NOAA GFS',
    agency: 'US National Weather Service',
    resolution: '0.25° North Atlantic',
  },
  {
    id: 'gem_seamless',
    shortName: 'ECCC GEM',
    agency: 'Environment Canada Multiscale',
    resolution: '15 km Global Ensemble',
  },
];

/** Airfields and bases on land: no sea-state limit applies there. */
export const SHORE_ASSET_TYPES = new Set<InstallationOrAirport['assetType']>([
  'Shore Heliport',
  'SAR Base',
  'UK Airport',
  'Norwegian Hub',
  'Hospital Helipad',
]);

export function evaluateAirframeLimits(
  windSpeed10mKts: number,
  windGust10mKts: number,
  cloudCeilingFt: number,
  visibilityKm: number,
  freezingLevelFt: number,
  /** null = no sea data, or a shore point where the sea-state limit does not apply */
  waveHeightM: number | null,
  precipMmHr: number,
  isFpso: boolean,
  preset: AirframeLimitPreset,
  missingData: string[] = [],
  transitTempC?: number | null
): { status: 'GO' | 'CAUTION' | 'HOLD'; reason: string } {
  const hasWave = typeof waveHeightM === 'number' && Number.isFinite(waveHeightM);
  const wave = hasWave ? (waveHeightM as number) : 0;
  const waveTxt = hasWave ? `Wave ${wave}m` : 'no sea data';
  // Grid and route points have no transit-level temperature, so the freezing level stands in for it
  const icing = assessIcing({
    freezingLevelFt,
    transitTempC: transitTempC ?? null,
    cloudCeilingFt,
    precipMmHr,
    fullIceProtection: preset.fullIceProtection,
  });
  const icingHazard = icing.level !== 'NONE';

  if (Math.max(windSpeed10mKts, windGust10mKts) > preset.maxHelideckGustKts) {
    return {
      status: 'HOLD',
      reason: `NO-GO: Gusts ${windGust10mKts} kt exceed ${preset.id} ${preset.maxHelideckGustKts} kt helideck wind limit`,
    };
  }
  if (hasWave && wave > preset.maxFpsoWaveHeightM) {
    return {
      status: 'HOLD',
      reason: isFpso
        ? `NO-GO: Wave Hs ${wave}m exceeds CAA ${preset.maxFpsoWaveHeightM}m sea state limit (FPSO)`
        : `NO-GO: Wave Hs ${wave}m exceeds CAA ${preset.maxFpsoWaveHeightM}m sea state limit`,
    };
  }
  if (
    cloudCeilingFt < preset.minCloudCeilingFt ||
    visibilityKm < preset.minVisibilityKm
  ) {
    return {
      status: 'HOLD',
      reason: `NO-GO (Haar/Low Cloud): Ceiling ${cloudCeilingFt} ft / Vis ${visibilityKm} km below ARA minima`,
    };
  }
  if (icing.level === 'HOLD') {
    return { status: 'HOLD', reason: icing.reason };
  }

  if (
    windGust10mKts >= preset.cautionGustKts ||
    icingHazard ||
    cloudCeilingFt < preset.minCloudCeilingFt + 350 ||
    visibilityKm < preset.minVisibilityKm + 2.0 ||
    (hasWave && isFpso && wave >= preset.maxFpsoWaveHeightM - 1.2) ||
    (hasWave && !isFpso && wave >= preset.maxFpsoWaveHeightM - 0.8)
  ) {
    if (icingHazard) {
      return { status: 'CAUTION', reason: icing.reason };
    }
    if (hasWave && isFpso && wave >= preset.maxFpsoWaveHeightM - 1.2) {
      return {
        status: 'CAUTION',
        reason: `FPSO DECK MOTION CAUTION: Wave Hs ${wave}m near ${preset.maxFpsoWaveHeightM}m pitch/roll limit`,
      };
    }
    return {
      status: 'CAUTION',
      reason: `CAUTION: Gusts ${windGust10mKts} kt · Ceiling ${cloudCeilingFt.toLocaleString()} ft · ${waveTxt}`,
    };
  }
  if (missingData.length > 0) {
    return {
      status: 'CAUTION',
      reason: `NO DATA: the forecast has no ${missingData.join(', ')} here, so it is not counted as good to fly`,
    };
  }

  return {
    status: 'GO',
    reason: `GO (${preset.id} Within Limits) — Gusts ${windGust10mKts} kt · ${waveTxt} · 0°C at ${freezingLevelFt.toLocaleString()} ft`,
  };
}

export function evaluateGridPointStatus(
  pt: SpatialWeatherGridPoint,
  preset: AirframeLimitPreset
): 'GO' | 'CAUTION' | 'HOLD' {
  const base = evaluateAirframeLimits(
    pt.windSpeed10mKts,
    pt.windGust10mKts,
    pt.cloudCeilingFt,
    pt.visibilityKm,
    pt.freezingLevelFt,
    pt.waveHeightM,
    pt.precipMmHr ?? 0,
    true,
    preset,
    pt.missingData ?? []
  ).status;

  if (pt.lightningRisk === 'HIGH') return 'HOLD';
  if (pt.lightningRisk === 'MODERATE' && base === 'GO') return 'CAUTION';
  return base;
}

/** The forecast values each map layer is drawn from. */
const LAYER_INPUTS: Record<string, string[] | 'all'> = {
  triggered_lightning: ['temperature', 'freezing level'],
  wind_surface: ['wind'],
  wind_950hpa: ['wind'],
  wind_850hpa: ['wind'],
  wave_swell: [],
  go_nogo_matrix: 'all',
};

/**
 * True when a grid point has every value a map layer needs. A point is only left off a layer when
 * that layer's own inputs are missing: a gap in low cloud must not hide the lightning or wind layer.
 * Waves are checked separately (no waves over land).
 */
export function gridPointUsableForLayer(pt: Pick<SpatialWeatherGridPoint, 'missingData'>, layer: string): boolean {
  const gaps = pt.missingData ?? [];
  if (gaps.length === 0) return true;
  const needs = LAYER_INPUTS[layer] ?? 'all';
  if (needs === 'all') return false;
  return !gaps.some((g) => needs.includes(g));
}

/**
 * Interpolates live or forecast weather at any cursor/tap coordinate on the map (Ventusky-style spot readout).
 */
export function interpolateSpotWeatherAtLatLon(
  lat: number,
  lon: number,
  gridPoints: SpatialWeatherGridPoint[],
  preset: AirframeLimitPreset
): {
  windSpeed10mKts: number;
  windGust10mKts: number;
  windDir10mDeg: number;
  windSpeed950hPaKts: number;
  waveHeightM: number | null;
  freezingLevelFt: number;
  cloudCeilingFt: number;
  seaSurfaceTempC: number | null;
  precipMmHr: number;
  capeJkg: number;
  lightningRisk: 'LOW' | 'MODERATE' | 'HIGH';
  lightningType: 'NONE' | 'TRIGGERED_WINTER' | 'CONVECTIVE_SHOWER' | 'NATURAL_TS';
  status: 'GO' | 'CAUTION' | 'HOLD';
} | null {
  // Points with gaps are left out rather than blended in with made-up values
  gridPoints = gridPoints.filter((p) => !p.missingData || p.missingData.length === 0);
  if (gridPoints.length === 0) return null;

  let wSum = 0;
  let waveW = 0;
  let sstW = 0;
  let ws10 = 0;
  let wg10 = 0;
  let wd10 = 0;
  let ws950 = 0;
  let wave = 0;
  let freeze = 0;
  let ceil = 0;
  let sst = 0;
  let precip = 0;
  let cape = 0;
  let ltScore = 0;
  let nearestPt = gridPoints[0];
  let nearestDistSq = Infinity;

  for (const pt of gridPoints) {
    const dLat = lat - pt.lat;
    const dLon = (lon - pt.lon) * 0.56;
    const rawDSq = dLat * dLat + dLon * dLon;
    if (rawDSq < nearestDistSq) {
      nearestDistSq = rawDSq;
      nearestPt = pt;
    }
    const dSq = rawDSq + 0.004;
    const w = 1 / (dSq * dSq);
    wSum += w;
    ws10 += pt.windSpeed10mKts * w;
    wg10 += pt.windGust10mKts * w;
    wd10 += pt.windDir10mDeg * w;
    ws950 += pt.windSpeed950hPaKts * w;
    if (pt.waveHeightM !== null) {
      wave += pt.waveHeightM * w;
      waveW += w;
    }
    freeze += pt.freezingLevelFt * w;
    ceil += pt.cloudCeilingFt * w;
    if (pt.seaSurfaceTempC !== null) {
      sst += pt.seaSurfaceTempC * w;
      sstW += w;
    }
    precip += (pt.precipMmHr ?? 0) * w;
    cape += (pt.capeJkg ?? 0) * w;
    const ptRiskScore =
      pt.lightningRisk === 'HIGH' ? 2 : pt.lightningRisk === 'MODERATE' ? 1 : 0;
    ltScore += ptRiskScore * w;
  }

  if (wSum === 0) return null;

  const finalWs10 = Math.round(ws10 / wSum);
  const finalWg10 = Math.round(wg10 / wSum);
  const finalWd10 = Math.round(wd10 / wSum);
  const finalWs950 = Math.round(ws950 / wSum);
  // Only report waves where the nearest point has sea data (no waves over land)
  const finalWave =
    waveW > 0 && nearestPt.waveHeightM !== null ? Number((wave / waveW).toFixed(1)) : null;
  const finalFreeze = Math.round(freeze / wSum);
  const finalCeil = Math.round(ceil / wSum);
  const finalSst = sstW > 0 && nearestPt.seaSurfaceTempC !== null ? Number((sst / sstW).toFixed(1)) : null;
  const finalPrecip = Number((precip / wSum).toFixed(1));
  const finalCape = Math.round(cape / wSum);
  const normLt = ltScore / wSum;
  const lightningRisk: 'LOW' | 'MODERATE' | 'HIGH' =
    normLt >= 1.35 ? 'HIGH' : normLt >= 0.45 ? 'MODERATE' : 'LOW';
  const lightningType =
    lightningRisk === 'LOW'
      ? 'NONE'
      : nearestPt.lightningType && nearestPt.lightningType !== 'NONE'
      ? nearestPt.lightningType
      : finalFreeze <= 3500
      ? 'TRIGGERED_WINTER'
      : 'CONVECTIVE_SHOWER';

  const ev = evaluateAirframeLimits(
    finalWs10,
    finalWg10,
    finalCeil,
    15,
    finalFreeze,
    finalWave,
    finalPrecip,
    true,
    preset
  );

  const status: 'GO' | 'CAUTION' | 'HOLD' =
    lightningRisk === 'HIGH'
      ? 'HOLD'
      : lightningRisk === 'MODERATE' && ev.status === 'GO'
      ? 'CAUTION'
      : ev.status;

  return {
    windSpeed10mKts: finalWs10,
    windGust10mKts: finalWg10,
    windDir10mDeg: finalWd10,
    windSpeed950hPaKts: finalWs950,
    waveHeightM: finalWave,
    freezingLevelFt: finalFreeze,
    cloudCeilingFt: finalCeil,
    seaSurfaceTempC: finalSst,
    precipMmHr: finalPrecip,
    capeJkg: finalCape,
    lightningRisk,
    lightningType,
    status,
  };
}

type RiskLevel = 'LOW' | 'MODERATE' | 'HIGH';

export interface CorridorLightningBypassAssessment {
  directRisk: RiskLevel;
  /** Risk on the detour to the left/right of the direct track; null when no route samples are loaded. */
  leftBypassRisk: RiskLevel | null;
  rightBypassRisk: RiskLevel | null;
  /** Compass direction of each detour from the direct track, e.g. "north-east". */
  leftSideLabel: string;
  rightSideLabel: string;
  directMidpoint: { lat: number; lon: number };
  leftMidpoint: { lat: number; lon: number };
  rightMidpoint: { lat: number; lon: number };
  offsetNm: number;
  /** route_samples: model sampled every few NM along each track. coarse_grid: background grid only. */
  dataSource: 'route_samples' | 'coarse_grid';
  recommendedRoute: 'DIRECT' | 'BYPASS_LEFT' | 'BYPASS_RIGHT' | 'NO_CLEAR_TRACK';
  summaryText: string;
}

export const CORRIDOR_BYPASS_OFFSET_NM = 18;
const CORRIDOR_SAMPLE_SPACING_NM = 8;
const CORRIDOR_MAX_SAMPLES_PER_TRACK = 14;

const COMPASS_8 = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

export function compassWord(bearingDeg: number): string {
  const idx = Math.round((((bearingDeg % 360) + 360) % 360) / 45) % 8;
  return COMPASS_8[idx];
}

export interface CorridorTrackGeometry {
  directMidpoint: { lat: number; lon: number };
  leftMidpoint: { lat: number; lon: number };
  rightMidpoint: { lat: number; lon: number };
  leftSideLabel: string;
  rightSideLabel: string;
  /** Sample points along each track (direct leg, and the two dog-legs via the offset midpoints). */
  direct: Array<{ lat: number; lon: number }>;
  left: Array<{ lat: number; lon: number }>;
  right: Array<{ lat: number; lon: number }>;
}

function samplesAlong(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
  count: number,
  includeEnd: boolean
): Array<{ lat: number; lon: number }> {
  const out: Array<{ lat: number; lon: number }> = [];
  const last = includeEnd ? count : count - 1;
  for (let i = 1; i <= last; i++) {
    const f = i / count;
    out.push({
      lat: Number((from.lat + (to.lat - from.lat) * f).toFixed(3)),
      lon: Number((from.lon + (to.lon - from.lon) * f).toFixed(3)),
    });
  }
  return out;
}

/**
 * Builds the direct shore-base -> rig track and two dog-leg detours offset 18 NM either side of the
 * midpoint, with sample points roughly every 8 NM. Detours are named by real compass direction.
 */
export function buildCorridorTrackGeometry(
  shoreBase: { lat: number; lon: number },
  targetRig: { lat: number; lon: number }
): CorridorTrackGeometry {
  const cosLat = Math.cos((((shoreBase.lat + targetRig.lat) / 2) * Math.PI) / 180);
  const midLat = (shoreBase.lat + targetRig.lat) / 2;
  const midLon = (shoreBase.lon + targetRig.lon) / 2;
  // Work in a local flat frame measured in degrees of latitude (1 deg lat = 60 NM)
  const dy = targetRig.lat - shoreBase.lat;
  const dx = (targetRig.lon - shoreBase.lon) * cosLat;
  const len = Math.hypot(dx, dy) || 1;
  // Left of track = rotate track vector 90 deg anticlockwise
  const leftX = -dy / len;
  const leftY = dx / len;
  const offsetDeg = CORRIDOR_BYPASS_OFFSET_NM / 60;
  const directMidpoint = { lat: Number(midLat.toFixed(3)), lon: Number(midLon.toFixed(3)) };
  const leftMidpoint = {
    lat: Number((midLat + leftY * offsetDeg).toFixed(3)),
    lon: Number((midLon + (leftX * offsetDeg) / (cosLat || 1)).toFixed(3)),
  };
  const rightMidpoint = {
    lat: Number((midLat - leftY * offsetDeg).toFixed(3)),
    lon: Number((midLon - (leftX * offsetDeg) / (cosLat || 1)).toFixed(3)),
  };
  const leftBearing = (Math.atan2(leftX, leftY) * 180) / Math.PI;
  const lengthNm = calculateDistanceNm(shoreBase.lat, shoreBase.lon, targetRig.lat, targetRig.lon);
  const perTrack = Math.max(
    3,
    Math.min(CORRIDOR_MAX_SAMPLES_PER_TRACK, Math.ceil(lengthNm / CORRIDOR_SAMPLE_SPACING_NM))
  );
  const half = Math.max(2, Math.ceil(perTrack / 2));
  const dogLeg = (mid: { lat: number; lon: number }) => [
    ...samplesAlong(shoreBase, mid, half, true),
    ...samplesAlong(mid, targetRig, half, false),
  ];
  return {
    directMidpoint,
    leftMidpoint,
    rightMidpoint,
    leftSideLabel: compassWord(leftBearing),
    rightSideLabel: compassWord(leftBearing + 180),
    direct: samplesAlong(shoreBase, targetRig, perTrack, false),
    left: dogLeg(leftMidpoint),
    right: dogLeg(rightMidpoint),
  };
}

/**
 * Samples the selected weather model directly along the direct track and both detours, so the
 * route check uses the model's own grid (UKV is about 2 km over the UK) instead of the coarse
 * background grid. Returns every sample point; match them back with buildCorridorTrackGeometry.
 */
export async function fetchCorridorTrackSamples(
  shoreBase: { lat: number; lon: number; code: string },
  targetRig: { lat: number; lon: number; code: string },
  modelId: WeatherModelId,
  selectedHourIso?: string
): Promise<SpatialWeatherGridPoint[]> {
  const geo = buildCorridorTrackGeometry(shoreBase, targetRig);
  const coords = [...geo.direct, ...geo.left, ...geo.right];
  return fetchWeatherPointsAt(
    coords,
    modelId,
    selectedHourIso,
    `route_${modelId}_${shoreBase.code}_${targetRig.code}`
  );
}

/**
 * Checks the shore base -> rig track for estimated lightning / shower risk.
 *
 * With route samples (the model sampled every ~8 NM along the direct track and an 18 NM detour on
 * each side) it can say whether a detour looks clear. With only the coarse background grid it
 * reports the area risk and gives no detour advice, because the grid cannot see shower cells.
 * Either way this is an estimate from forecast models, not an observation or an official product.
 */
export function evaluateCorridorLightningBypass(
  shoreBase: { lat: number; lon: number; code: string },
  targetRig: { lat: number; lon: number; code: string },
  gridPoints: SpatialWeatherGridPoint[],
  preset: AirframeLimitPreset,
  routeSamples?: SpatialWeatherGridPoint[]
): CorridorLightningBypassAssessment {
  const geo = buildCorridorTrackGeometry(shoreBase, targetRig);
  const rank = (r: RiskLevel) => (r === 'HIGH' ? 2 : r === 'MODERATE' ? 1 : 0);
  const fromRank = (n: number): RiskLevel => (n >= 2 ? 'HIGH' : n === 1 ? 'MODERATE' : 'LOW');
  const route = `${shoreBase.code} → ${targetRig.code}`;

  const expected = geo.direct.length + geo.left.length + geo.right.length;
  const hasRoute = Array.isArray(routeSamples) && routeSamples.length === expected;

  const base = {
    leftSideLabel: geo.leftSideLabel,
    rightSideLabel: geo.rightSideLabel,
    directMidpoint: geo.directMidpoint,
    leftMidpoint: geo.leftMidpoint,
    rightMidpoint: geo.rightMidpoint,
    offsetNm: CORRIDOR_BYPASS_OFFSET_NM,
  };

  if (!hasRoute) {
    // Coarse grid only: report the broad area risk along the direct track, no detour advice.
    let worst = 0;
    for (const s of geo.direct) {
      const sp = interpolateSpotWeatherAtLatLon(s.lat, s.lon, gridPoints, preset);
      if (sp) worst = Math.max(worst, rank(sp.lightningRisk));
    }
    const directRisk = fromRank(worst);
    return {
      ...base,
      directRisk,
      leftBypassRisk: null,
      rightBypassRisk: null,
      dataSource: 'coarse_grid',
      recommendedRoute: directRisk === 'LOW' ? 'DIRECT' : 'NO_CLEAR_TRACK',
      summaryText:
        directRisk === 'LOW'
          ? `${route}: no shower/lightning signal in the broad forecast (estimate)`
          : `${route}: ${directRisk.toLowerCase()} estimated shower/lightning risk in the area. Route check still loading, so no detour advice yet. Check the live rain radar.`,
    };
  }

  const samples = routeSamples as SpatialWeatherGridPoint[];
  const worstOf = (pts: SpatialWeatherGridPoint[]) =>
    fromRank(pts.reduce((m, p) => Math.max(m, rank(p.lightningRisk ?? 'LOW')), 0));
  const nD = geo.direct.length;
  const nL = geo.left.length;
  const directRisk = worstOf(samples.slice(0, nD));
  const leftBypassRisk = worstOf(samples.slice(nD, nD + nL));
  const rightBypassRisk = worstOf(samples.slice(nD + nL));

  let recommendedRoute: CorridorLightningBypassAssessment['recommendedRoute'] = 'DIRECT';
  let summaryText = `${route}: direct track clear of estimated shower/lightning risk`;
  if (directRisk !== 'LOW') {
    if (leftBypassRisk === 'LOW') {
      recommendedRoute = 'BYPASS_LEFT';
      summaryText = `${route}: estimated ${directRisk.toLowerCase()} risk on the direct track. The ${CORRIDOR_BYPASS_OFFSET_NM} NM detour to the ${geo.leftSideLabel} looks clear in the forecast.`;
    } else if (rightBypassRisk === 'LOW') {
      recommendedRoute = 'BYPASS_RIGHT';
      summaryText = `${route}: estimated ${directRisk.toLowerCase()} risk on the direct track. The ${CORRIDOR_BYPASS_OFFSET_NM} NM detour to the ${geo.rightSideLabel} looks clear in the forecast.`;
    } else {
      recommendedRoute = 'NO_CLEAR_TRACK';
      summaryText = `${route}: estimated ${directRisk.toLowerCase()} risk on the direct track and neither ${CORRIDOR_BYPASS_OFFSET_NM} NM detour looks clear.`;
    }
  }

  return {
    ...base,
    directRisk,
    leftBypassRisk,
    rightBypassRisk,
    dataSource: 'route_samples',
    recommendedRoute,
    summaryText,
  };
}

/**
 * ESTIMATES a cloud ceiling (ft) from model 2m temperature, dewpoint, low cloud cover % and visibility.
 * Models do not forecast a cloud base directly here, so this is an estimate; reported METAR
 * cloud is used instead where the app has it (see parseMetarCloudBase).
 * Uses the Espy Lifting Condensation Level (LCL) equation: LCL_ft = ((T - Td) / 2.5) * 1000.
 * Under ICAO/CAA rules, a "ceiling" exists when cloud cover is Broken (BKN, >= 50%) or Overcast (OVC, >= 88%).
 */
function computePhysicalCloudCeilingFt(
  temp2mC: number,
  dewPoint2mC: number,
  lowCloudPct: number,
  visibilityKm: number
): number {
  const spreadC = Math.max(0.1, temp2mC - dewPoint2mC);
  // Physical LCL cloud base of lowest condensation layer in feet
  const lclBaseFt = Math.round((spreadC / 2.5) * 1000);

  // If dense sea fog / haar is present (visibility < 1 km and spread <= 1.2°C), vertical visibility / ceiling is at surface/LCL
  if (visibilityKm < 1.0 && spreadC <= 1.5) {
    return Math.max(100, Math.min(350, lclBaseFt));
  }

  // If low cloud is Broken/Overcast (>= 50%), the ceiling is the physical LCL cloud base
  if (lowCloudPct >= 50) {
    return Math.max(150, Math.min(NO_LOW_CEILING_FT, lclBaseFt));
  }

  // Under 50% low cloud there is no broken/overcast layer in the low-cloud band (below about
  // 6,500 ft), so there is no low ceiling. Return a fixed "no low ceiling" value rather than
  // inventing a height.
  return NO_LOW_CEILING_FT;
}

/**
 * Computes exact 0°C Freezing Level (ft AMSL) from a model's native GRIB vertical profile
 * (using direct freezing_level_height when published by ICON/GFS, or linear vertical interpolation
 * across 2m, 925 hPa geopotential height, and 850 hPa geopotential height for ECMWF/GEM).
 */
function computeNativeFreezingLevelFt(
  directFreezeMeters: number | null,
  t2m: number,
  t925: number,
  z925Meters: number,
  t850: number,
  z850Meters: number
): number {
  if (typeof directFreezeMeters === 'number' && !Number.isNaN(directFreezeMeters)) {
    return Math.max(0, Math.round(directFreezeMeters * 3.28084));
  }
  let fzMeters = 1200;
  if (t2m <= 0) {
    fzMeters = 0;
  } else if (t925 <= 0 && t2m > t925) {
    fzMeters = (t2m / (t2m - t925)) * Math.max(100, z925Meters);
  } else if (t850 <= 0 && t925 > t850) {
    fzMeters =
      z925Meters + (t925 / (t925 - t850)) * Math.max(100, z850Meters - z925Meters);
  } else {
    // Above 850 hPa: standard moist adiabatic lapse rate (6.0°C / 1000m)
    fzMeters = z850Meters + (Math.max(0, t850) / 6.0) * 1000;
  }
  return Math.max(0, Math.round(fzMeters * 3.28084));
}

/**
 * Computes the -10°C Mixed-Phase Charging Altitude (ft AMSL) from native 850 hPa, 700 hPa, and 500 hPa levels.
 * In North Sea winter showers, helicopter triggered lightning peaks when convective cells bridge the 0°C to -10°C band.
 */
export function computeMinus10IsothermFt(
  t850: number,
  z850Meters: number,
  t700: number,
  z700Meters: number,
  t500: number,
  z500Meters: number
): number {
  let m10Meters = z700Meters;
  if (t850 <= -10) {
    m10Meters = z850Meters;
  } else if (t700 <= -10 && t850 > t700) {
    m10Meters =
      z850Meters + ((-10 - t850) / (t700 - t850)) * Math.max(200, z700Meters - z850Meters);
  } else if (t500 <= -10 && t700 > t500) {
    m10Meters =
      z700Meters + ((-10 - t700) / (t500 - t700)) * Math.max(200, z500Meters - z700Meters);
  } else {
    m10Meters = z500Meters + (Math.max(0, t500 + 10) / 6.5) * 1000;
  }
  return Math.max(0, Math.round(m10Meters * 3.28084));
}

/**
 * Helicopter-triggered lightning criteria from the Met Office algorithm.
 *
 * Source 1: Wilkinson, Wells, Field & Agnew (2013), "Investigation and prediction of
 * helicopter-triggered lightning over the North Sea", Meteorological Applications 20: 94-106,
 * doi:10.1002/met.1314. A grid point is at risk when:
 *   1. the average temperature between 2,000 and 3,000 ft is between -6 and -1 C,
 *   2. the total surface precipitation rate is 4 mm/h or more (4 km model), and
 *   3. the freezing level is between 1,000 and 4,500 ft.
 *
 * Source 2: J. Wilkinson, "Helicopter-triggered lightning strike forecasting", Met Office
 * presentation to the CAA Helicopter Safety Research Management Committee, 21 May 2013. The
 * operational trial product added Low / Medium / High levels with precipitation thresholds that
 * depend on the model grid, because coarser models spread shower rain out:
 *            4 km model   12 km model
 *   Low       2.0 mm/h     1.1 mm/h
 *   Medium    4.0 mm/h     2.7 mm/h
 *   High     10.0 mm/h     4.0 mm/h
 * The trial also blended in radar rain rates and added smoothing/hysteresis; ChopperCheck does
 * neither. The presentation quotes slightly tighter bands (-6 to -2 C, freezing level 1,000-3,000
 * ft) for the original 2011 system; the published paper's bands are used here.
 *
 * ChopperCheck maps Met Office Low -> MODERATE (caution) and Medium/High -> HIGH (hold).
 *
 * Source 3: Langvatn (2020), "Helicopter Triggered Lightning in Norway", MSc thesis, University of
 * Oslo. MET Norway's Helicopter Trigger Index scores temperature at about 2,500 ft as non-zero from
 * 0 to -6 C, and Norwegian strike cases clustered at -3 to 0 C (one helicopter strike forecast at
 * -0.7 C). So a layer average between -1 and 0 C (warmBandMaxC) is treated as a caution band: it
 * can raise the Low level but never Medium/High, which stay on the Met Office bands.
 */
export const TRIGGERED_LIGHTNING_CRITERIA = {
  layerBottomFt: 2000,
  layerTopFt: 3000,
  layerTempMinC: -6,
  layerTempMaxC: -1,
  /** Caution-only band above layerTempMaxC, from the Norwegian strike cases (Langvatn 2020). */
  warmBandMaxC: 0,
  freezeMinFt: 1000,
  freezeMaxFt: 4500,
  precipMmHr: {
    fine: { low: 2.0, medium: 4.0, high: 10.0 }, // models with a grid of about 5 km or finer
    coarse: { low: 1.1, medium: 2.7, high: 4.0 }, // 12 km table, also used for coarser models
  },
} as const;

/** Approximate grid spacing (km) of each model as served by Open-Meteo over the North Sea. */
export const MODEL_GRID_KM: Record<WeatherModelId, number> = {
  ukmo_seamless: 2,
  icon_seamless: 7,
  ecmwf_ifs025: 25,
  gfs_seamless: 25,
  gem_seamless: 25,
};

export type TriggeredLightningLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Average temperature over a height band (ft above sea level), by linear interpolation between
 * known (height, temperature) points, e.g. 2 m, 925 hPa and 850 hPa. Returns null if the band is
 * not covered by the points.
 */
export function averageTempInLayerC(
  points: Array<{ heightM: number; tempC: number | null }>,
  bottomFt: number,
  topFt: number
): number | null {
  const pts = points
    .filter((p) => typeof p.tempC === 'number' && Number.isFinite(p.tempC) && Number.isFinite(p.heightM))
    .map((p) => ({ h: p.heightM * 3.28084, t: p.tempC as number }))
    .sort((x, y) => x.h - y.h);
  if (pts.length < 2 || pts[0].h > bottomFt || pts[pts.length - 1].h < topFt) return null;
  const at = (ft: number) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = pts[i];
      const hi = pts[i + 1];
      if (ft >= lo.h && ft <= hi.h) {
        return hi.h === lo.h ? lo.t : lo.t + ((hi.t - lo.t) * (ft - lo.h)) / (hi.h - lo.h);
      }
    }
    return null;
  };
  const samples = [0, 0.25, 0.5, 0.75, 1].map((f) => at(bottomFt + (topFt - bottomFt) * f));
  if (samples.some((v) => v === null)) return null;
  return Number(((samples as number[]).reduce((sum, v) => sum + v, 0) / samples.length).toFixed(1));
}

/**
 * Classifies natural thunderstorm and helicopter-triggered lightning risk for one model point.
 * Triggered risk uses the published Met Office criteria above. Natural thunderstorm and the
 * general "convective shower" caution are ChopperCheck's own simpler rules.
 */
export function classifyNorthSeaConvection(params: {
  cape: number | null;
  wmo: number | null;
  precip: number;
  showers: number;
  freezeFt: number;
  minus10Ft?: number;
  sstMinus500C?: number;
  /** Average temperature between 2,000 and 3,000 ft (see averageTempInLayerC); null when unknown. */
  layerTempC?: number | null;
  /** Model grid spacing in km; picks the 4 km or 12 km precipitation table. Unknown = 12 km table. */
  gridKm?: number | null;
}): {
  risk: 'LOW' | 'MODERATE' | 'HIGH';
  type: 'NONE' | 'TRIGGERED_WINTER' | 'CONVECTIVE_SHOWER' | 'NATURAL_TS';
  triggeredLevel: TriggeredLightningLevel;
} {
  const { cape, wmo, precip, showers, freezeFt } = params;
  const C = TRIGGERED_LIGHTNING_CRITERIA;
  const layerTempC =
    typeof params.layerTempC === 'number' && Number.isFinite(params.layerTempC) ? params.layerTempC : null;
  const table =
    typeof params.gridKm === 'number' && params.gridKm <= 5 ? C.precipMmHr.fine : C.precipMmHr.coarse;

  if (wmo !== null && [95, 96, 99].includes(wmo)) {
    return { risk: 'HIGH', type: 'NATURAL_TS', triggeredLevel: 'NONE' };
  }
  if (cape !== null && cape >= 500 && (precip >= 0.25 || showers >= 0.15)) {
    return { risk: 'HIGH', type: 'NATURAL_TS', triggeredLevel: 'NONE' };
  }

  // The Met Office criteria use total surface precipitation rate
  const totalPrecip = Math.max(precip, showers);
  const tempOk = layerTempC !== null && layerTempC >= C.layerTempMinC && layerTempC <= C.layerTempMaxC;
  const freezeOk = freezeFt >= C.freezeMinFt && freezeFt <= C.freezeMaxFt;

  if (tempOk && freezeOk) {
    if (totalPrecip >= table.high) return { risk: 'HIGH', type: 'TRIGGERED_WINTER', triggeredLevel: 'HIGH' };
    if (totalPrecip >= table.medium) return { risk: 'HIGH', type: 'TRIGGERED_WINTER', triggeredLevel: 'MEDIUM' };
    if (totalPrecip >= table.low) return { risk: 'MODERATE', type: 'TRIGGERED_WINTER', triggeredLevel: 'LOW' };
  }
  // -1 to 0 C: outside the Met Office band but inside the Norwegian one, so caution only
  const warmBandOk =
    layerTempC !== null && layerTempC > C.layerTempMaxC && layerTempC <= C.warmBandMaxC;
  if (warmBandOk && freezeOk && totalPrecip >= table.low) {
    return { risk: 'MODERATE', type: 'TRIGGERED_WINTER', triggeredLevel: 'LOW' };
  }

  const isShowerWmo = wmo !== null && [80, 81, 82, 85, 86].includes(wmo);
  const hasActiveShowers = isShowerWmo || showers >= 0.3;
  if (hasActiveShowers || (cape !== null && cape >= 300) || precip >= 3.5) {
    return { risk: 'MODERATE', type: 'CONVECTIVE_SHOWER', triggeredLevel: 'NONE' };
  }

  return { risk: 'LOW', type: 'NONE', triggeredLevel: 'NONE' };
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FULL_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Fetches a full 7-day (up to 168 hours) multi-model offshore forecast across all 5 meteorological models
 * (UKMO UKV 2km, DWD ICON-EU, ECMWF IFS, NOAA GFS, ECCC GEM) + WaveWatch III / Copernicus Marine.
 */
/**
 * Fetches JSON, retrying a failed or timed-out request (weak offshore signal, brief API hiccup)
 * before giving up. Returns null only when every attempt fails.
 */
export async function fetchJsonWithRetry(url: string, tries = 3): Promise<any | null> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.ok) return await res.json();
      // 4xx other than rate limiting will not get better on retry
      if (res.status >= 400 && res.status < 500 && res.status !== 429) return null;
    } catch {
      // network error or timeout: retry
    }
    if (attempt < tries - 1) await new Promise((r) => setTimeout(r, 700 * (attempt + 1) ** 2));
  }
  return null;
}

/**
 * ECMWF IFS 0.25 and GEM publish no visibility, and the Met Office has it only on its UKV domain.
 * Grid and route checks request it from ICON and GFS alongside, so a gap is filled with a real
 * forecast value instead of being guessed. Returns the raw per-point responses (or null).
 */
const VIS_BACKUP_MODELS = ['icon_seamless', 'gfs_seamless'] as const;
async function fetchVisibilityBackup(lats: string, lons: string): Promise<unknown | null> {
  return fetchJsonWithRetry(
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=visibility&models=${VIS_BACKUP_MODELS.join(',')}&forecast_days=7`,
    2
  );
}
/** Visibility in metres at one point and hour from the backup response, or null. */
function visibilityFromBackup(backup: unknown, idx: number, timeIso: string | undefined): number | null {
  if (!backup || !timeIso) return null;
  const entry = (Array.isArray(backup) ? backup[idx] : backup) as { hourly?: Record<string, unknown[]> } | undefined;
  const times = (entry?.hourly?.time as string[] | undefined) ?? [];
  const i = times.indexOf(timeIso);
  if (i < 0) return null;
  for (const m of VIS_BACKUP_MODELS) {
    const v = entry?.hourly?.[`visibility_${m}`]?.[i];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** True when a marine response has at least one real wave height. */
const hasSeaData = (j: any): boolean =>
  Array.isArray(j?.hourly?.wave_height) && j.hourly.wave_height.some((v: unknown) => typeof v === 'number');

export async function fetchMultiModelRigForecast(
  facility: InstallationOrAirport,
  preset: AirframeLimitPreset
): Promise<MultiModelHourEntry[]> {
  const isFpso = facility.assetType === 'FPSO' || facility.assetType === 'Semi-Sub';
  const isShoreFacility = SHORE_ASSET_TYPES.has(facility.assetType);

  const hourlyVars = [
    'wind_speed_10m',
    'wind_direction_10m',
    'wind_gusts_10m',
    'wind_speed_80m',
    'wind_direction_80m',
    'wind_speed_950hPa',
    'wind_direction_950hPa',
    'temperature_950hPa',
    'wind_speed_925hPa',
    'wind_direction_925hPa',
    'temperature_925hPa',
    'geopotential_height_925hPa',
    'wind_speed_850hPa',
    'wind_direction_850hPa',
    'temperature_850hPa',
    'geopotential_height_850hPa',
    'temperature_700hPa',
    'geopotential_height_700hPa',
    'temperature_500hPa',
    'geopotential_height_500hPa',
    'freezing_level_height',
    'visibility',
    'cloud_cover_low',
    'precipitation',
    'showers',
    'temperature_2m',
    'dew_point_2m',
    'pressure_msl',
    'cape',
    'weather_code',
  ].join(',');

  const modelsParam = 'ukmo_seamless,icon_seamless,gfs_seamless,ecmwf_ifs025,gem_seamless';
  const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${facility.lat.toFixed(
    3
  )}&longitude=${facility.lon.toFixed(
    3
  )}&hourly=${hourlyVars}&models=${modelsParam}&wind_speed_unit=kn&forecast_days=7`;

  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${facility.lat.toFixed(
    3
  )}&longitude=${facility.lon.toFixed(
    3
  )}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&forecast_days=7`;

  try {
    const [wxJson, marFirst] = await Promise.all([
      fetchJsonWithRetry(wxUrl),
      isShoreFacility ? Promise.resolve(null) : fetchJsonWithRetry(marineUrl),
    ]);
    if (!wxJson) return [];

    // Rigs close to the coast can fall on a land cell of the wave model. Then use the nearest
    // sea point (real data, labelled with its distance) rather than leaving waves empty.
    let marJson = marFirst;
    let seaDataNote: string | undefined;
    if (!isShoreFacility && !hasSeaData(marFirst)) {
      const offsets: Array<[number, number]> = [
        [0.1, 0], [-0.1, 0], [0, 0.18], [0, -0.18],
        [0.2, 0], [-0.2, 0], [0, 0.36], [0, -0.36],
      ];
      const pts = offsets.map(([dLat, dLon]) => ({ lat: facility.lat + dLat, lon: facility.lon + dLon }));
      const nearUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${pts
        .map((p) => p.lat.toFixed(3))
        .join(',')}&longitude=${pts
        .map((p) => p.lon.toFixed(3))
        .join(',')}&hourly=wave_height,wave_period,wave_direction,swell_wave_height,swell_wave_period,swell_wave_direction,sea_surface_temperature&forecast_days=7`;
      const near = await fetchJsonWithRetry(nearUrl, 2);
      const list = Array.isArray(near) ? near : near ? [near] : [];
      const idx = list.findIndex((j: any) => hasSeaData(j));
      if (idx >= 0) {
        marJson = list[idx];
        const nm = Math.round(calculateDistanceNm(facility.lat, facility.lon, pts[idx].lat, pts[idx].lon));
        seaDataNote = `Sea data from the nearest sea point, ${nm} NM away`;
      }
    }

    const hourly = wxJson?.hourly || {};
    const marHourly = marJson?.hourly || {};
    const times: string[] = Array.isArray(hourly.time) ? hourly.time : [];
    if (times.length === 0) return [];

    const nowMs = Date.now();
    let startIdx = 0;
    for (let i = 0; i < times.length; i++) {
      const tMs = new Date(times[i] + 'Z').getTime();
      if (tMs <= nowMs) startIdx = i;
    }

    const todayDateKey = times[startIdx]?.split('T')[0] || '';
    const entries: MultiModelHourEntry[] = [];
    const solarCache = new Map<string, ReturnType<typeof computeSolarTimesUtc>>();

    // Fog from real forecast values only:
    // - HIGH: forecast visibility under 1 km (the WMO / Met Office definition of fog);
    // - MODERATE: sea-fog (haar) set-up, when the air's dew point is at or above the sea temperature,
    //   so air moving over the sea is cooled to saturation (Met Office: warm moist air over a colder sea).
    const classifyFog = (
      visKm: number,
      dewPointC: number,
      sstC: number | null
    ): 'LOW' | 'MODERATE' | 'HIGH' => {
      if (visKm < 1.0) return 'HIGH';
      if (sstC !== null && dewPointC >= sstC) return 'MODERATE';
      return 'LOW';
    };

    for (let idx = startIdx; idx < times.length; idx++) {
      const iso = times[idx];
      const [dayKey, timePart] = iso.split('T');
      const hourLabel = timePart?.slice(0, 5) || '00:00';

      const dt = new Date(iso + 'Z');
      let solar = solarCache.get(dayKey);
      if (!solar) {
        solar = computeSolarTimesUtc(facility.lat, facility.lon, dt);
        solarCache.set(dayKey, solar);
      }
      const isNight = isCaaNightForHour(iso, solar);

      const isToday = dayKey === todayDateKey;
      const dayNameShort = isToday ? 'Today' : SHORT_DAYS[dt.getUTCDay()];
      const dayNameFull = isToday
        ? `Today (${FULL_DAYS[dt.getUTCDay()]})`
        : FULL_DAYS[dt.getUTCDay()];
      const dateShort = `${dt.getUTCDate()} ${SHORT_MONTHS[dt.getUTCMonth()]}`;

      // No sea data (inland point or failed marine request) stays null rather than a made-up value
      const marNum = (v: unknown): number | null =>
        typeof v === 'number' && Number.isFinite(v) ? v : null;
      const rawWave = marNum(marHourly.wave_height?.[idx]);
      const waveHeightM = rawWave === null ? null : Number(rawWave.toFixed(1));
      const rawPeriod = marNum(marHourly.wave_period?.[idx]);
      const swellPeriodSec = rawPeriod === null ? null : Number(rawPeriod.toFixed(1));
      const rawWaveDir = marNum(marHourly.wave_direction?.[idx]);
      const swellDirDeg = rawWaveDir === null ? null : Math.round(rawWaveDir);
      const swellWaveHeightM =
        typeof marHourly.swell_wave_height?.[idx] === 'number'
          ? Number(marHourly.swell_wave_height[idx].toFixed(1))
          : undefined;
      const swellWavePeriodSec =
        typeof marHourly.swell_wave_period?.[idx] === 'number'
          ? Number(marHourly.swell_wave_period[idx].toFixed(1))
          : undefined;
      const swellWaveDirDeg =
        typeof marHourly.swell_wave_direction?.[idx] === 'number'
          ? Math.round(marHourly.swell_wave_direction[idx])
          : undefined;
      const rawSst = marNum(marHourly.sea_surface_temperature?.[idx]);
      const seaSurfaceTempC = rawSst === null ? null : Number(rawSst.toFixed(1));

      const modelsRecord = {} as Record<WeatherModelId, ModelPointSnapshot>;

      for (const mMeta of WEATHER_MODELS_META) {
        const m = mMeta.id;
        const valOf = (field: string, model: WeatherModelId): number | null => {
          const val = hourly[`${field}_${model}`]?.[idx];
          return typeof val === 'number' && !Number.isNaN(val) ? val : null;
        };
        const rawVal = (field: string): number | null => valOf(field, m);
        // When this model has a gap, take the same hour's real value from the next model that has
        // it (UKV first, then ICON, ECMWF, GFS, GEM) and say so. Only if no model has it is the
        // value missing: then a placeholder keeps the maths running, the hour is never GO, and the
        // model is left out of the vote. Models with filled gaps are also left out of the vote.
        const missingData: string[] = [];
        const filledData: string[] = [];
        const fromOthers = (field: string): { v: number; by: string } | null => {
          for (const other of WEATHER_MODELS_META) {
            if (other.id === m) continue;
            const v = valOf(field, other.id);
            if (v !== null) return { v, by: other.shortName };
          }
          return null;
        };
        const core = (field: string, label: string, placeholder: number): number => {
          const v = rawVal(field);
          if (v !== null) return v;
          const alt = fromOthers(field);
          if (alt) {
            const note = `${label} from ${alt.by}`;
            if (!filledData.includes(note)) filledData.push(note);
            return alt.v;
          }
          if (!missingData.includes(label)) missingData.push(label);
          return placeholder;
        };

        const ws10 = Math.round(core('wind_speed_10m', 'wind', 0));
        const wd10 = Math.round(rawVal('wind_direction_10m') ?? fromOthers('wind_direction_10m')?.v ?? 0);
        const wg10 = Math.round(core('wind_gusts_10m', 'gusts', ws10));
        const rawWs80 = rawVal('wind_speed_80m');
        const ws80 = rawWs80 !== null ? Math.round(rawWs80) : undefined;
        const rawWd80 = rawVal('wind_direction_80m');
        const wd80 = rawWd80 !== null ? Math.round(rawWd80) : undefined;
        const { deckWindSpeedKts, deckWindGustKts } = computeDeckHeightWind(
          ws10,
          wg10,
          ws80,
          facility.elevationFt
        );

        // Use native 950 hPa (ICON/GFS/GEM) or native 925 hPa (ECMWF WMO standard level)
        const ws950 = Math.round(
          rawVal('wind_speed_950hPa') ??
            rawVal('wind_speed_925hPa') ??
            Math.round(ws10 * 1.22)
        );
        // Only work out approach shear when the model actually gave an upper wind
        const hasUpperWind = rawVal('wind_speed_950hPa') !== null || rawVal('wind_speed_925hPa') !== null;
        const approachShearKts = hasUpperWind ? Math.max(0, ws950 - ws10) : undefined;
        const wd950 = Math.round(
          rawVal('wind_direction_950hPa') ??
            rawVal('wind_direction_925hPa') ??
            wd10
        );
        // Transit-level temperature (icing check): this model's 950 hPa or 925 hPa value, else
        // another model's 950 hPa value; null when no model has one (icing then uses the freezing level)
        const t950Raw =
          rawVal('temperature_950hPa') ??
          rawVal('temperature_925hPa') ??
          fromOthers('temperature_950hPa')?.v ??
          null;
        const t950 = t950Raw === null ? null : Number(t950Raw.toFixed(1));
        const ws850 = Math.round(
          rawVal('wind_speed_850hPa') ?? Math.round(ws950 * 1.15)
        );
        const wd850 = Math.round(rawVal('wind_direction_850hPa') ?? wd950);

        const temp2mC = Number(core('temperature_2m', 'temperature', 5).toFixed(1));
        const dewPoint2mC = Number(core('dew_point_2m', 'dew point', temp2mC).toFixed(1));
        const dewSpreadC = Number(Math.max(0, temp2mC - dewPoint2mC).toFixed(1));
        // Freezing level: this model's own value or its upper-air temperatures, else another model's
        let borrowedFreezeM: number | null = null;
        if (
          rawVal('freezing_level_height') === null &&
          rawVal('temperature_925hPa') === null &&
          rawVal('temperature_850hPa') === null
        ) {
          const alt = fromOthers('freezing_level_height');
          if (alt) {
            borrowedFreezeM = alt.v;
            filledData.push(`freezing level from ${alt.by}`);
          } else {
            missingData.push('freezing level');
          }
        }
        const t925 = rawVal('temperature_925hPa') ?? t950 ?? temp2mC - 5;
        const z925 = rawVal('geopotential_height_925hPa') ?? 720;
        const t850 = rawVal('temperature_850hPa') ?? t925 - 4.0;
        const z850 = rawVal('geopotential_height_850hPa') ?? 1420;
        const t700 = rawVal('temperature_700hPa') ?? t850 - 9.0;
        const z700 = rawVal('geopotential_height_700hPa') ?? 2950;
        const t500 = rawVal('temperature_500hPa') ?? t700 - 15.0;
        const z500 = rawVal('geopotential_height_500hPa') ?? 5450;

        const freezingLevelFt = computeNativeFreezingLevelFt(
          rawVal('freezing_level_height') ?? borrowedFreezeM,
          temp2mC,
          t925,
          z925,
          t850,
          z850
        );
        const minus10IsothermFt = computeMinus10IsothermFt(
          t850,
          z850,
          t700,
          z700,
          t500,
          z500
        );
        const sstMinus500C =
          seaSurfaceTempC === null ? undefined : Number((seaSurfaceTempC - t500).toFixed(1));

        const lowCloudPct = core('cloud_cover_low', 'low cloud', 0);
        const precipMmHr = Number((rawVal('precipitation') ?? 0).toFixed(1));
        const showersMm = Number((rawVal('showers') ?? 0).toFixed(1));
        // QNH is pressure reduced to sea level, so use the model's mean-sea-level pressure
        const rawMsl = rawVal('pressure_msl');
        const qnhHpa = rawMsl === null ? null : Math.round(rawMsl);
        const capeVal = rawVal('cape');
        const wmoCode = rawVal('weather_code');

        // Visibility: this model's forecast, else another model's (labelled); never made up
        const directVisMeters = core('visibility', 'visibility', 20000);
        const visibilityKm = Number(Math.min(50, Math.max(0.2, directVisMeters / 1000)).toFixed(1));

        const cloudCeilingFt = computePhysicalCloudCeilingFt(
          temp2mC,
          dewPoint2mC,
          lowCloudPct,
          visibilityKm
        );

        const conv = classifyNorthSeaConvection({
          cape: capeVal,
          wmo: wmoCode,
          precip: precipMmHr,
          showers: showersMm,
          freezeFt: freezingLevelFt,
          minus10Ft: minus10IsothermFt,
          sstMinus500C,
          gridKm: MODEL_GRID_KM[m],
          layerTempC: averageTempInLayerC(
            [
              { heightM: 2, tempC: rawVal('temperature_2m') },
              { heightM: rawVal('geopotential_height_925hPa') ?? NaN, tempC: rawVal('temperature_925hPa') },
              { heightM: rawVal('geopotential_height_850hPa') ?? NaN, tempC: rawVal('temperature_850hPa') },
            ],
            TRIGGERED_LIGHTNING_CRITERIA.layerBottomFt,
            TRIGGERED_LIGHTNING_CRITERIA.layerTopFt
          ),
        });
        const lightningRisk = conv.risk;
        const lightningType = conv.type;
        const fogSpreadRisk = classifyFog(visibilityKm, dewPoint2mC, seaSurfaceTempC);

        const evalResult = evaluateAirframeLimits(
          deckWindSpeedKts,
          deckWindGustKts,
          cloudCeilingFt,
          visibilityKm,
          freezingLevelFt,
          isShoreFacility ? null : waveHeightM,
          precipMmHr,
          isFpso,
          preset,
          missingData,
          t950
        );

        modelsRecord[m] = {
          modelId: m,
          modelShortName: mMeta.shortName,
          resolutionLabel: mMeta.resolution,
          windSpeed10mKts: ws10,
          windDir10mDeg: wd10,
          windGust10mKts: wg10,
          windSpeed80mKts: ws80,
          windDir80mDeg: wd80,
          deckWindSpeedKts,
          deckWindGustKts,
          approachShearKts,
          windSpeed950hPaKts: ws950,
          windDir950hPaDeg: wd950,
          temp950hPaC: t950,
          windSpeed850hPaKts: ws850,
          windDir850hPaDeg: wd850,
          freezingLevelFt,
          cloudCeilingFt,
          visibilityKm,
          precipMmHr,
          temp2mC,
          dewPoint2mC,
          dewSpreadC,
          capeJkg: capeVal !== null ? Math.round(capeVal) : undefined,
          wmoWeatherCode: wmoCode !== null ? Math.round(wmoCode) : undefined,
          convectiveShowersMm: showersMm,
          minus10IsothermFt,
          sstMinus500C,
          lightningRisk,
          lightningType,
          fogSpreadRisk,
          qnhHpa,
          status: evalResult.status,
          statusReason: evalResult.reason,
          missingData: missingData.length ? missingData : undefined,
          filledData: filledData.length ? filledData : undefined,
        };
      }

      entries.push({
        hourIndex: entries.length,
        hourIso: iso,
        hourLabel,
        dayKey,
        dayNameShort,
        dayNameFull,
        dateShort,
        isNight,
        waveHeightM,
        swellPeriodSec,
        swellDirDeg,
        swellWaveHeightM,
        swellWavePeriodSec,
        swellWaveDirDeg,
        seaSurfaceTempC,
        seaDataNote,
        models: modelsRecord,
      });
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Computes 7 Daily Crew-Change Flight Window Summaries (focusing on 07:00–17:00 UTC offshore flying hours)
 * so crew on Glen Lyon, Forties, Culzean, etc. can immediately check if Monday/Tuesday/etc. flights will be delayed.
 */
export function buildSevenDayFlightWindowSummaries(
  hours: MultiModelHourEntry[],
  modelId: WeatherModelId
): DayFlightWindowSummary[] {
  const byDay = new Map<string, MultiModelHourEntry[]>();
  for (const h of hours) {
    const list = byDay.get(h.dayKey) || [];
    list.push(h);
    byDay.set(h.dayKey, list);
  }

  const summaries: DayFlightWindowSummary[] = [];

  for (const [dayKey, dayHours] of byDay.entries()) {
    // Focus on daylight offshore crew-change flying hours (07:00 to 17:00 UTC) if available
    const opsHours = dayHours.filter((h) => {
      const hrNum = parseInt(h.hourLabel.slice(0, 2), 10);
      return hrNum >= 7 && hrNum <= 17;
    });
    const evalSet = opsHours.length > 0 ? opsHours : dayHours;

    let maxGustKts = 0;
    let maxWaveM: number | null = null;
    let minCeilingFt = 99999;
    let minFreezingFt = 99999;
    let goCount = 0;
    let cautionCount = 0;
    let holdCount = 0;
    let worstReason = '';

    for (const h of evalSet) {
      const snap = h.models[modelId];
      if (!snap) continue;
      if (snap.windGust10mKts > maxGustKts) maxGustKts = snap.windGust10mKts;
      if (h.waveHeightM !== null && (maxWaveM === null || h.waveHeightM > maxWaveM)) maxWaveM = h.waveHeightM;
      if (snap.cloudCeilingFt < minCeilingFt) minCeilingFt = snap.cloudCeilingFt;
      if (snap.freezingLevelFt < minFreezingFt) minFreezingFt = snap.freezingLevelFt;

      if (snap.status === 'HOLD') {
        holdCount++;
        if (!worstReason || !worstReason.startsWith('NO-GO')) {
          worstReason = snap.statusReason;
        }
      } else if (snap.status === 'CAUTION') {
        cautionCount++;
        if (!worstReason) worstReason = snap.statusReason;
      } else {
        goCount++;
      }
    }

    const overallStatus: 'GO' | 'CAUTION' | 'HOLD' =
      holdCount >= 2
        ? 'HOLD'
        : holdCount >= 1 || cautionCount >= 2
        ? 'CAUTION'
        : 'GO';

    // Pick 11:00 UTC (peak offshore crew-change wave) as the default hour when clicking this day
    const repHour =
      dayHours.find((h) => h.hourLabel.startsWith('11:')) ||
      evalSet[0] ||
      dayHours[0];

    summaries.push({
      dayKey,
      dayNameShort: dayHours[0].dayNameShort,
      dayNameFull: dayHours[0].dayNameFull,
      dateShort: dayHours[0].dateShort,
      representativeHourIndex: repHour.hourIndex,
      overallStatus,
      maxGustKts,
      maxWaveM,
      minCeilingFt: minCeilingFt === 99999 ? 2500 : minCeilingFt,
      minFreezingFt: minFreezingFt === 99999 ? 4000 : minFreezingFt,
      goHoursCount: goCount,
      cautionHoursCount: cautionCount,
      holdHoursCount: holdCount,
      primaryRiskReason:
        worstReason ||
        `All ${evalSet.length} daytime flight hours within limits (Max Gust ${maxGustKts} kt, Max Wave ${maxWaveM}m)`,
    });
  }

  return summaries;
}

// Cache 7-day corridor raw response per ShoreBase+Rig so scrubbing hours is instantaneous
const corridorRawCache = new Map<
  string,
  { wxArr: unknown; marArr: unknown; visArr?: unknown; fetchedAt: number }
>();

/**
 * Fetches a 3-point Shore-to-Rig Flight Corridor Profile (Shore Heliport -> Mid-Route -> Offshore Helideck)
 * for any selected forecast hour across the 7-day window.
 */
export async function fetchFlightCorridorProfile(
  shoreBase: InstallationOrAirport,
  targetRig: InstallationOrAirport,
  preset: AirframeLimitPreset,
  selectedHourIso?: string,
  /** Same model as the one picked in the weather panel */
  modelId: WeatherModelId = 'ukmo_seamless'
): Promise<CorridorWaypointProfile[]> {
  const midLat = Number(((shoreBase.lat + targetRig.lat) / 2).toFixed(3));
  const midLon = Number(((shoreBase.lon + targetRig.lon) / 2).toFixed(3));
  const totalDistNm = calculateDistanceNm(
    shoreBase.lat,
    shoreBase.lon,
    targetRig.lat,
    targetRig.lon
  );
  const outboundTrackDeg = calculateBearingDeg(
    shoreBase.lat,
    shoreBase.lon,
    targetRig.lat,
    targetRig.lon
  );

  const points = [
    {
      label: `Shore Base (${shoreBase.code})`,
      code: shoreBase.code,
      lat: shoreBase.lat,
      lon: shoreBase.lon,
      distNm: 0,
      isFpso: false,
      isShore: SHORE_ASSET_TYPES.has(shoreBase.assetType),
    },
    {
      label: `Mid-Route (${Math.round(totalDistNm / 2)} NM)`,
      code: 'MID',
      lat: midLat,
      lon: midLon,
      distNm: Math.round(totalDistNm / 2),
      isFpso: false,
      // Overland when both ends are on land (e.g. base to hospital)
      isShore: SHORE_ASSET_TYPES.has(shoreBase.assetType) && SHORE_ASSET_TYPES.has(targetRig.assetType),
    },
    {
      label: `Helideck (${targetRig.code})`,
      code: targetRig.code,
      lat: targetRig.lat,
      lon: targetRig.lon,
      distNm: Math.round(totalDistNm),
      isFpso: targetRig.assetType === 'FPSO' || targetRig.assetType === 'Semi-Sub',
      isShore: SHORE_ASSET_TYPES.has(targetRig.assetType),
    },
  ];

  const cacheKey = `${shoreBase.id}_${targetRig.id}_${modelId}`;
  let cached = corridorRawCache.get(cacheKey);

  if (!cached || Date.now() - cached.fetchedAt > 300000) {
    const lats = points.map((p) => p.lat.toFixed(3)).join(',');
    const lons = points.map((p) => p.lon.toFixed(3)).join(',');

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_950hPa,wind_direction_950hPa,wind_speed_925hPa,wind_direction_925hPa,temperature_925hPa,geopotential_height_925hPa,wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,temperature_2m,dew_point_2m,cloud_cover_low,visibility,freezing_level_height,precipitation,showers,cape,weather_code&models=${modelId}&wind_speed_unit=kn&forecast_days=7`;
    const marUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height&forecast_days=7`;

    try {
      const [wxArr, marArrRaw, visArr] = await Promise.all([
        fetchJsonWithRetry(wxUrl),
        fetchJsonWithRetry(marUrl, 2),
        fetchVisibilityBackup(lats, lons),
      ]);
      if (!wxArr) return [];
      const marArr = marArrRaw ?? [];

      cached = { wxArr, marArr, visArr, fetchedAt: Date.now() };
      corridorRawCache.set(cacheKey, cached);
    } catch {
      return [];
    }
  }

  const wxArr = cached.wxArr as Array<Record<string, Record<string, unknown[]>>>;
  const marArr = cached.marArr as Array<Record<string, Record<string, unknown[]>>>;

  return points.map((pt, idx) => {
    const w = Array.isArray(wxArr) ? wxArr[idx] : wxArr;
    const m = Array.isArray(marArr) ? marArr[idx] : marArr;

    const times = (w?.hourly?.time as string[]) || [];
    let hrIdx = 0;
    if (selectedHourIso && times.length > 0) {
      const found = times.indexOf(selectedHourIso);
      if (found >= 0) hrIdx = found;
    } else if (times.length > 0) {
      const nowMs = Date.now();
      for (let i = 0; i < times.length; i++) {
        if (new Date(times[i] + 'Z').getTime() <= nowMs) hrIdx = i;
      }
    }

    // Single-model requests may come back with plain or model-suffixed field names
    const rawT = (f: string): number | null => {
      const v1 = w?.hourly?.[f]?.[hrIdx];
      if (typeof v1 === 'number' && Number.isFinite(v1)) return v1;
      const v2 = w?.hourly?.[`${f}_${modelId}`]?.[hrIdx];
      return typeof v2 === 'number' && Number.isFinite(v2) ? v2 : null;
    };
    const missingData: string[] = [];
    const core = (f: string, label: string, placeholder: number): number => {
      const v = rawT(f);
      if (v === null) {
        if (!missingData.includes(label)) missingData.push(label);
        return placeholder;
      }
      return v;
    };

    const ws10 = Math.round(core('wind_speed_10m', 'wind', 0));
    const wd10 = Math.round(rawT('wind_direction_10m') ?? 0);
    const wg10 = Math.round(core('wind_gusts_10m', 'gusts', ws10));

    const ws950 = Math.round(rawT('wind_speed_950hPa') ?? rawT('wind_speed_925hPa') ?? ws10);
    const wd950 = Math.round(rawT('wind_direction_950hPa') ?? rawT('wind_direction_925hPa') ?? wd10);
    const ws850 = Math.round(rawT('wind_speed_850hPa') ?? ws950);
    const wd850 = Math.round(rawT('wind_direction_850hPa') ?? wd950);

    const angleRad = ((wd950 - outboundTrackDeg) * Math.PI) / 180;
    const headwind950Kts = Math.round(ws950 * Math.cos(angleRad));

    const t2m = core('temperature_2m', 'temperature', 5);
    const dp2m = core('dew_point_2m', 'dew point', t2m);
    const t925 = rawT('temperature_925hPa') ?? t2m - 5;
    const z925 = rawT('geopotential_height_925hPa') ?? 760;
    const t850 = rawT('temperature_850hPa') ?? t925 - 4;
    const z850 = rawT('geopotential_height_850hPa') ?? 1460;
    const rawFreeze = rawT('freezing_level_height');
    if (rawFreeze === null && rawT('temperature_925hPa') === null && rawT('temperature_850hPa') === null) {
      missingData.push('freezing level');
    }

    const freezingLevelFt = computeNativeFreezingLevelFt(rawFreeze, t2m, t925, z925, t850, z850);

    // Visibility from the model, else ICON/GFS at the same point; a gap is marked, never made up
    const visM = rawT('visibility') ?? visibilityFromBackup(cached?.visArr, idx, times[hrIdx]);
    if (visM === null && !missingData.includes('visibility')) missingData.push('visibility');
    const visKm = Number(Math.min(50, Math.max(0.2, (visM ?? 20000) / 1000)).toFixed(1));
    const lowCloud = core('cloud_cover_low', 'low cloud', 0);
    const cloudCeilingFt = computePhysicalCloudCeilingFt(t2m, dp2m, lowCloud, visKm);
    // No sea-state limit at an airfield, and no made-up waves where there is no sea data
    const rawWave = m?.hourly?.wave_height?.[hrIdx];
    const waveHeightM =
      pt.isShore || typeof rawWave !== 'number' || !Number.isFinite(rawWave)
        ? null
        : Number(rawWave.toFixed(1));
    if (!pt.isShore && waveHeightM === null) missingData.push('sea state');
    const precip = rawT('precipitation') ?? 0;
    const capeRaw = rawT('cape');
    const capeVal = capeRaw ?? 0;
    const dewSpreadC = Number(Math.max(0, t2m - dp2m).toFixed(1));
    const lightningRisk: 'LOW' | 'MODERATE' | 'HIGH' = classifyNorthSeaConvection({
      cape: capeRaw,
      wmo: rawT('weather_code'),
      precip,
      showers: rawT('showers') ?? 0,
      freezeFt: freezingLevelFt,
      gridKm: MODEL_GRID_KM[modelId],
      layerTempC: averageTempInLayerC(
        [
          { heightM: 2, tempC: rawT('temperature_2m') },
          { heightM: rawT('geopotential_height_925hPa') ?? NaN, tempC: rawT('temperature_925hPa') },
          { heightM: rawT('geopotential_height_850hPa') ?? NaN, tempC: rawT('temperature_850hPa') },
        ],
        TRIGGERED_LIGHTNING_CRITERIA.layerBottomFt,
        TRIGGERED_LIGHTNING_CRITERIA.layerTopFt
      ),
    }).risk;

    const evalLim = evaluateAirframeLimits(
      ws10,
      wg10,
      cloudCeilingFt,
      visKm,
      freezingLevelFt,
      waveHeightM,
      precip,
      pt.isFpso,
      preset,
      missingData
    );

    const effectiveStatus: 'GO' | 'CAUTION' | 'HOLD' =
      lightningRisk === 'HIGH'
        ? 'HOLD'
        : lightningRisk === 'MODERATE' && evalLim.status === 'GO'
        ? 'CAUTION'
        : evalLim.status;

    return {
      label: pt.label,
      code: pt.code,
      lat: pt.lat,
      lon: pt.lon,
      distanceFromShoreNm: pt.distNm,
      windSpeed10mKts: ws10,
      windGust10mKts: wg10,
      windDir10mDeg: wd10,
      windSpeed950hPaKts: ws950,
      windDir950hPaDeg: wd950,
      windSpeed850hPaKts: ws850,
      windDir850hPaDeg: wd850,
      headwind950Kts,
      freezingLevelFt,
      cloudCeilingFt,
      visibilityKm: visKm,
      waveHeightM,
      dewSpreadC,
      capeJkg: Math.round(capeVal),
      lightningRisk,
      precipMmHr: precip,
      isFpso: pt.isFpso,
      status: effectiveStatus,
      ceilingSource: 'model_estimate',
      missingData: missingData.length ? missingData : undefined,
    };
  });
}

/**
 * Replaces a waypoint's model-estimated cloud ceiling with a reported (METAR) ceiling and
 * re-evaluates its status with the same rules the corridor uses.
 */
export function applyReportedCeilingToWaypoint(
  wp: CorridorWaypointProfile,
  reportedCeilingFt: number,
  stationIcao: string,
  preset: AirframeLimitPreset
): CorridorWaypointProfile {
  const evalLim = evaluateAirframeLimits(
    wp.windSpeed10mKts,
    wp.windGust10mKts,
    reportedCeilingFt,
    wp.visibilityKm,
    wp.freezingLevelFt,
    wp.waveHeightM,
    wp.precipMmHr ?? 0,
    Boolean(wp.isFpso),
    preset,
    wp.missingData ?? []
  );
  const status: 'GO' | 'CAUTION' | 'HOLD' =
    wp.lightningRisk === 'HIGH'
      ? 'HOLD'
      : wp.lightningRisk === 'MODERATE' && evalLim.status === 'GO'
      ? 'CAUTION'
      : evalLim.status;
  return {
    ...wp,
    cloudCeilingFt: reportedCeilingFt,
    ceilingSource: 'metar',
    ceilingStationIcao: stationIcao,
    status,
  };
}

// Cache 7-day point data per request key (grid or route) so scrubbing across days/hours is instant on the map
const spatialGridRawCache = new Map<
  string,
  {
    coords: Array<{ lat: number; lon: number }>;
    wxArr: unknown;
    marArr: unknown;
    visArr?: unknown;
    fetchedAt: number;
  }
>();

/**
 * Fetches an 8x6 (48-point) background weather & marine grid across Scotland, the North Sea,
 * West of Shetland & Irish Sea. Grid points are 55-110 NM apart, so this grid shows the broad
 * pattern only: it cannot resolve individual shower cells. Route-level checks use
 * fetchCorridorTrackSamples, which samples the model directly along each track.
 */
export async function fetchSpatialWeatherGrid(
  modelId: WeatherModelId,
  selectedHourIso?: string
): Promise<SpatialWeatherGridPoint[]> {
  const latSteps = [51.5, 53.3, 55.0, 56.4, 57.6, 58.8, 60.0, 61.3];
  const lonSteps = [-6.0, -4.2, -2.5, -1.0, 0.6, 2.4];

  const coords: Array<{ lat: number; lon: number }> = [];
  for (const lat of latSteps) {
    for (const lon of lonSteps) {
      coords.push({ lat, lon });
    }
  }
  return fetchWeatherPointsAt(coords, modelId, selectedHourIso, `grid_${modelId}`);
}

/**
 * Fetches model weather + marine data at an arbitrary list of points (one Open-Meteo multi-location
 * request each for weather and marine), cached for 5 minutes per cacheKey.
 */
export async function fetchWeatherPointsAt(
  coords: Array<{ lat: number; lon: number }>,
  modelId: WeatherModelId,
  selectedHourIso: string | undefined,
  cacheKey: string
): Promise<SpatialWeatherGridPoint[]> {
  if (coords.length === 0) return [];
  let cached = spatialGridRawCache.get(cacheKey);

  if (!cached || Date.now() - cached.fetchedAt > 300000) {
    const lats = coords.map((c) => c.lat.toFixed(2)).join(',');
    const lons = coords.map((c) => c.lon.toFixed(2)).join(',');

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_950hPa,wind_direction_950hPa,wind_speed_925hPa,wind_direction_925hPa,temperature_925hPa,geopotential_height_925hPa,wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,temperature_700hPa,geopotential_height_700hPa,temperature_500hPa,geopotential_height_500hPa,temperature_2m,dew_point_2m,cloud_cover_low,visibility,freezing_level_height,precipitation,showers,cape,weather_code&models=${modelId}&wind_speed_unit=kn&forecast_days=7`;
    const marUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,wave_direction,sea_surface_temperature&forecast_days=7`;

    try {
      const [wxArr, marArrRaw, visArr] = await Promise.all([
        fetchJsonWithRetry(wxUrl),
        fetchJsonWithRetry(marUrl, 2),
        fetchVisibilityBackup(lats, lons),
      ]);
      if (!wxArr) return [];
      const marArr = marArrRaw ?? [];

      cached = { coords, wxArr, marArr, visArr, fetchedAt: Date.now() };
      spatialGridRawCache.set(cacheKey, cached);
      if (spatialGridRawCache.size > 24) {
        const oldestKey = spatialGridRawCache.keys().next().value;
        if (oldestKey !== undefined) spatialGridRawCache.delete(oldestKey);
      }
    } catch {
      return [];
    }
  }

  const wxArr = cached.wxArr as Array<Record<string, Record<string, unknown[]>>>;
  const marArr = cached.marArr as Array<Record<string, Record<string, unknown[]>>>;

  return coords.map((c, idx) => {
    const w = Array.isArray(wxArr) ? wxArr[idx] : wxArr;
    const m = Array.isArray(marArr) ? marArr[idx] : marArr;

    const hourly = w?.hourly || {};
    const marHourly = m?.hourly || {};
    const times = (hourly.time as string[]) || [];

    let hr = 0;
    if (selectedHourIso && times.length > 0) {
      const found = times.indexOf(selectedHourIso);
      if (found >= 0) hr = found;
    } else if (times.length > 0) {
      const nowMs = Date.now();
      for (let i = 0; i < times.length; i++) {
        if (new Date(times[i] + 'Z').getTime() <= nowMs) hr = i;
      }
    }

    const pickRaw = (field: string): number | null => {
      const v1 = hourly[field]?.[hr];
      if (typeof v1 === 'number' && !Number.isNaN(v1)) return v1;
      const v2 = hourly[`${field}_${modelId}`]?.[hr];
      if (typeof v2 === 'number' && !Number.isNaN(v2)) return v2;
      return null;
    };

    const missingData: string[] = [];
    const core = (field: string, label: string, placeholder: number): number => {
      const v = pickRaw(field);
      if (v === null) {
        if (!missingData.includes(label)) missingData.push(label);
        return placeholder;
      }
      return v;
    };
    const ws10 = Math.round(core('wind_speed_10m', 'wind', 0));
    const wd10 = Math.round(pickRaw('wind_direction_10m') ?? 0);
    const wg10 = Math.round(core('wind_gusts_10m', 'gusts', ws10));
    const ws950 = Math.round(pickRaw('wind_speed_950hPa') ?? pickRaw('wind_speed_925hPa') ?? ws10);
    const wd950 = Math.round(
      pickRaw('wind_direction_950hPa') ??
        pickRaw('wind_direction_925hPa') ??
        wd10
    );
    const ws850 = Math.round(
      pickRaw('wind_speed_850hPa') ?? Math.round(ws950 * 1.15)
    );
    const wd850 = Math.round(pickRaw('wind_direction_850hPa') ?? wd950);

    const t2m = core('temperature_2m', 'temperature', 5);
    const dp2m = core('dew_point_2m', 'dew point', t2m);
    if (
      pickRaw('freezing_level_height') === null &&
      pickRaw('temperature_925hPa') === null &&
      pickRaw('temperature_850hPa') === null
    ) {
      missingData.push('freezing level');
    }
    const t925 = pickRaw('temperature_925hPa') ?? t2m - 5;
    const z925 = pickRaw('geopotential_height_925hPa') ?? 720;
    const t850 = pickRaw('temperature_850hPa') ?? t925 - 4;
    const z850 = pickRaw('geopotential_height_850hPa') ?? 1420;
    const t700 = pickRaw('temperature_700hPa') ?? t850 - 7.5;
    const z700 = pickRaw('geopotential_height_700hPa') ?? 2950;
    const t500 = pickRaw('temperature_500hPa') ?? t700 - 15.0;
    const z500 = pickRaw('geopotential_height_500hPa') ?? 5480;

    const freezingLevelFt = computeNativeFreezingLevelFt(
      pickRaw('freezing_level_height'),
      t2m,
      t925,
      z925,
      t850,
      z850
    );
    const minus10IsothermFt = computeMinus10IsothermFt(
      t850,
      z850,
      t700,
      z700,
      t500,
      z500
    );

    // Visibility from the model, else ICON/GFS at the same point; a gap is marked, never made up
    const visM = pickRaw('visibility') ?? visibilityFromBackup(cached?.visArr, idx, times[hr]);
    if (visM === null && !missingData.includes('visibility')) missingData.push('visibility');
    const visKm = Number(Math.min(50, Math.max(0.2, (visM ?? 20000) / 1000)).toFixed(1));
    const lowCloud = core('cloud_cover_low', 'low cloud', 0);
    const cloudCeilingFt = computePhysicalCloudCeilingFt(t2m, dp2m, lowCloud, visKm);

    // Land points have no sea data: leave waves empty rather than inventing them
    const marNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const rawWave = marNum(marHourly.wave_height?.[hr]);
    const waveHeightM = rawWave === null ? null : Number(rawWave.toFixed(1));
    const rawWaveDir = marNum(marHourly.wave_direction?.[hr]);
    const waveDirDeg = rawWaveDir === null ? null : Math.round(rawWaveDir);
    const rawSst = marNum(marHourly.sea_surface_temperature?.[hr]);
    const seaSurfaceTempC = rawSst === null ? null : Number(rawSst.toFixed(1));

    const precipMmHr = Number((pickRaw('precipitation') ?? 0).toFixed(1));
    const showersMm = Number((pickRaw('showers') ?? 0).toFixed(1));
    const rawCape = pickRaw('cape');
    const rawWmo = pickRaw('weather_code');
    const sstMinus500C = seaSurfaceTempC === null ? undefined : Number((seaSurfaceTempC - t500).toFixed(1));

    const conv = classifyNorthSeaConvection({
      cape: rawCape,
      wmo: rawWmo,
      precip: precipMmHr,
      showers: showersMm,
      freezeFt: freezingLevelFt,
      minus10Ft: minus10IsothermFt,
      sstMinus500C,
      gridKm: MODEL_GRID_KM[modelId],
      layerTempC: averageTempInLayerC(
        [
          { heightM: 2, tempC: pickRaw('temperature_2m') },
          { heightM: pickRaw('geopotential_height_925hPa') ?? NaN, tempC: pickRaw('temperature_925hPa') },
          { heightM: pickRaw('geopotential_height_850hPa') ?? NaN, tempC: pickRaw('temperature_850hPa') },
        ],
        TRIGGERED_LIGHTNING_CRITERIA.layerBottomFt,
        TRIGGERED_LIGHTNING_CRITERIA.layerTopFt
      ),
    });

    return {
      lat: c.lat,
      lon: c.lon,
      windSpeed10mKts: ws10,
      windDir10mDeg: wd10,
      windGust10mKts: wg10,
      windSpeed950hPaKts: ws950,
      windDir950hPaDeg: wd950,
      windSpeed850hPaKts: ws850,
      windDir850hPaDeg: wd850,
      freezingLevelFt,
      cloudCeilingFt,
      visibilityKm: visKm,
      waveHeightM,
      waveDirDeg,
      seaSurfaceTempC,
      precipMmHr,
      capeJkg: rawCape !== null ? Math.round(rawCape) : 0,
      wmoWeatherCode: rawWmo !== null ? Math.round(rawWmo) : 0,
      minus10IsothermFt,
      lightningRisk: conv.risk,
      lightningType: conv.type,
      missingData: missingData.length ? missingData : undefined,
    };
  });
}

export interface RainViewerRadarFrame {
  tileUrlTemplate: string;
  frameTimeIso: string;
}

/**
 * Fetches the last 6 genuine live precipitation radar frames (~60 min loop) from RainViewer (free, CORS-enabled).
 */
export async function fetchRainViewerRadarFrames(): Promise<RainViewerRadarFrame[]> {
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json', {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const past = Array.isArray(json?.radar?.past) ? json.radar.past : [];
    if (!json?.host || past.length === 0) return [];
    return past
      .slice(-6)
      .filter((f: { path?: string; time?: number }) => Boolean(f?.path))
      .map((f: { path: string; time?: number }) => ({
        tileUrlTemplate: `${json.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`,
        frameTimeIso: new Date((f.time || Math.floor(Date.now() / 1000)) * 1000)
          .toISOString()
          .slice(11, 16),
      }));
  } catch {
    return [];
  }
}

export async function fetchRainViewerRadarFrame(): Promise<RainViewerRadarFrame | null> {
  const frames = await fetchRainViewerRadarFrames();
  return frames[frames.length - 1] ?? null;
}

const VERIFIED_METAR_STATIONS: Array<{
  icao: string;
  label: string;
  lat: number;
  lon: number;
}> = [
  // Norwegian offshore installations that issue METAR / AUTOMETAR (Luftfartstilsynet AIC I 03/25).
  // These are distributed internationally, so they reach aviationweather.gov. UK installations send
  // their observations to HeliMet (login only), so none are listed here. Positions are approximate.
  { icao: 'ENLE', label: 'Ekofisk L Platform (NO)', lat: 56.55, lon: 3.21 },
  { icao: 'ENWV', label: 'Valhall PH Platform (NO)', lat: 56.28, lon: 3.39 },
  { icao: 'ENLA', label: 'Ula Platform (NO)', lat: 57.11, lon: 2.85 },
  { icao: 'ENSL', label: 'Sleipner A Platform (NO)', lat: 58.37, lon: 1.91 },
  { icao: 'ENDP', label: 'Draupner Platform (NO)', lat: 58.19, lon: 2.47 },
  { icao: 'ENJS', label: 'Johan Sverdrup Platform (NO)', lat: 58.84, lon: 2.6 },
  { icao: 'ENWG', label: 'Gudrun Platform (NO)', lat: 58.85, lon: 1.72 },
  { icao: 'ENXW', label: 'Grane Platform (NO)', lat: 59.17, lon: 2.49 },
  { icao: 'ENOA', label: 'Oseberg A Platform (NO)', lat: 60.49, lon: 2.83 },
  { icao: 'ENQA', label: 'Troll A Platform (NO)', lat: 60.64, lon: 3.73 },
  { icao: 'ENQM', label: 'Martin Linge Platform (NO)', lat: 60.8, lon: 1.97 },
  { icao: 'ENGC', label: 'Gullfaks C Platform (NO)', lat: 61.21, lon: 2.27 },
  { icao: 'ENSF', label: 'Statfjord A Platform (NO)', lat: 61.26, lon: 1.85 },
  { icao: 'ENFB', label: 'Statfjord B Platform (NO)', lat: 61.2, lon: 1.83 },
  { icao: 'ENSE', label: 'Snorre A Platform (NO)', lat: 61.45, lon: 2.15 },
  { icao: 'ENHE', label: 'Heidrun Platform (NO)', lat: 65.32, lon: 7.32 },
  { icao: 'EGPB', label: 'Sumburgh Airport', lat: 59.88, lon: -1.29 },
  { icao: 'EGPO', label: 'Stornoway (Hebrides)', lat: 58.21, lon: -6.33 },
  { icao: 'EGPL', label: 'Benbecula (Outer Hebrides)', lat: 57.48, lon: -7.36 },
  { icao: 'EKVG', label: 'Vágar (Faroe Islands)', lat: 62.06, lon: -7.28 },
  { icao: 'EGPD', label: 'Aberdeen Airport', lat: 57.2, lon: -2.2 },
  { icao: 'EGSH', label: 'Norwich Airport', lat: 52.68, lon: 1.28 },
  { icao: 'EGNJ', label: 'Humberside Airport', lat: 53.57, lon: -0.35 },
  { icao: 'EGNS', label: 'Isle of Man (Ronaldsway)', lat: 54.08, lon: -4.62 },
  { icao: 'EGGP', label: 'Liverpool Airport', lat: 53.33, lon: -2.85 },
  { icao: 'EGNR', label: 'Hawarden / Dee Estuary', lat: 53.18, lon: -2.98 },
  { icao: 'EGCC', label: 'Manchester Airport', lat: 53.35, lon: -2.28 },
  { icao: 'EGCK', label: 'Caernarfon SAR (Wales)', lat: 53.1, lon: -4.34 },
  { icao: 'EGPK', label: 'Prestwick SAR Base', lat: 55.51, lon: -4.59 },
  { icao: 'EGPE', label: 'Inverness SAR Base', lat: 57.54, lon: -4.05 },
  { icao: 'EGNV', label: 'Teesside Airport', lat: 54.51, lon: -1.43 },
  { icao: 'EGNT', label: 'Newcastle Airport', lat: 55.04, lon: -1.69 },
  { icao: 'EGAA', label: 'Belfast International', lat: 54.66, lon: -6.22 },
  { icao: 'EGHQ', label: 'Newquay SAR Base', lat: 50.44, lon: -5.0 },
  { icao: 'EGFF', label: 'Cardiff (Bristol Channel)', lat: 51.4, lon: -3.34 },
  { icao: 'EGHI', label: 'Southampton / Solent', lat: 50.95, lon: -1.36 },
  { icao: 'EGMD', label: 'Lydd SAR Base', lat: 50.96, lon: 0.94 },
  { icao: 'ENZV', label: 'Stavanger Airport', lat: 58.88, lon: 5.64 },
];

const nearbyMetarCache = new Map<
  string,
  { fetchedAt: number; stations: NearbyStationMetar[] }
>();

/**
 * Fetches live real-time ICAO METARs (and offshore WMO sea states) from the 3 nearest verified
 * offshore platforms or upwind Atlantic islands surrounding the target facility.
 */
export async function fetchNearbyOffshoreOrUpwindMetars(
  facility: InstallationOrAirport,
  excludeIcao?: string
): Promise<NearbyStationMetar[]> {
  const cacheKey = `${facility.id}_${excludeIcao || ''}`;
  const cached = nearbyMetarCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60 * 1000) {
    return cached.stations;
  }

  const candidates = VERIFIED_METAR_STATIONS.filter(
    (s) => s.icao !== excludeIcao?.toUpperCase() && s.icao !== facility.code.toUpperCase()
  )
    .map((s) => ({
      ...s,
      distanceNm: Math.round(calculateDistanceNm(facility.lat, facility.lon, s.lat, s.lon)),
      bearingDeg: Math.round(calculateBearingDeg(facility.lat, facility.lon, s.lat, s.lon)),
    }))
    .filter((s) => s.distanceNm <= 280)
    .sort((a, b) => a.distanceNm - b.distanceNm)
    .slice(0, 3);

  const results = await Promise.allSettled(
    candidates.map(async (st): Promise<NearbyStationMetar | null> => {
      const url = `${FLIGHT_API_ORIGIN}/api/weather?lat=${st.lat.toFixed(
        2
      )}&lon=${st.lon.toFixed(2)}&icao=${encodeURIComponent(st.icao)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return null;
      const json = await res.json();
      const metar = Array.isArray(json?.metar)
        ? json.metar.find(
            (m: { icaoId?: string; rawOb?: string }) =>
              m.icaoId === st.icao && typeof m.rawOb === 'string' && m.rawOb.trim().length > 0
          )
        : null;
      if (!metar) return null;
      const sea = parseSeaStateFromMetar(metar.rawOb);
      const fltCat = ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(metar.fltCat)
        ? (metar.fltCat as NearbyStationMetar['flightCategory'])
        : undefined;
      const obsMs =
        typeof metar.obsTime === 'number'
          ? metar.obsTime < 1e12
            ? metar.obsTime * 1000
            : metar.obsTime
          : undefined;
      return {
        icao: st.icao,
        label: st.label,
        distanceNm: st.distanceNm,
        bearingDeg: st.bearingDeg,
        rawOb: metar.rawOb,
        rawTaf: typeof metar.rawTaf === 'string' ? metar.rawTaf : undefined,
        flightCategory: fltCat,
        seaTempC: sea.seaTempC,
        seaStateCode: sea.seaStateCode,
        seaStateLabel: sea.seaStateLabel,
        obsTimeMs: obsMs,
      };
    })
  );

  const stations = results
    .filter(
      (r): r is PromiseFulfilledResult<NearbyStationMetar | null> => r.status === 'fulfilled'
    )
    .map((r) => r.value)
    .filter((v): v is NearbyStationMetar => v !== null);

  nearbyMetarCache.set(cacheKey, { fetchedAt: Date.now(), stations });
  return stations;
}

// ============================================================================
// Terrain around a shore base (free Open-Meteo elevation API, Copernicus 90 m DEM)
// ============================================================================

const terrainMemoryCache = new Map<string, TerrainSummary | null>();

/**
 * Samples ground height on rings out to 25 NM around a base and returns the highest ground.
 * Terrain does not change, so results are cached in memory and in localStorage. The 90 m data
 * smooths summits slightly, so the real tops can be a little higher; returns null on failure.
 */
export async function fetchTerrainAroundBase(lat: number, lon: number): Promise<TerrainSummary | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (terrainMemoryCache.has(key)) return terrainMemoryCache.get(key) ?? null;
  const storageKey = `choppercheck_terrain_v1_${key}`;
  try {
    const cached = localStorage.getItem(storageKey);
    if (cached) {
      const parsed = JSON.parse(cached) as TerrainSummary;
      if (parsed?.highest && typeof parsed.highest.heightFt === 'number') {
        terrainMemoryCache.set(key, parsed);
        return parsed;
      }
    }
  } catch {
    // storage unavailable
  }
  const points = buildTerrainSamplePoints(lat, lon);
  const url = `https://api.open-meteo.com/v1/elevation?latitude=${points
    .map((p) => p.lat.toFixed(4))
    .join(',')}&longitude=${points.map((p) => p.lon.toFixed(4)).join(',')}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const json = await res.json();
    const elevations: Array<number | null> = Array.isArray(json?.elevation)
      ? json.elevation.map((v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
      : [];
    if (elevations.length !== points.length) return null;
    const summary = summariseTerrain(points, elevations);
    terrainMemoryCache.set(key, summary);
    if (summary) {
      try {
        localStorage.setItem(storageKey, JSON.stringify(summary));
      } catch {
        // storage full or blocked
      }
    }
    return summary;
  } catch {
    return null;
  }
}
