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
  computeDeckHeightWind,
  computeSolarTimesUtc,
  isCaaNightForHour,
  parseSeaStateFromMetar,
} from '../utils/solarAndMetUtils';
import { FLIGHT_API_ORIGIN } from './radarService';

export const AIRFRAME_PRESETS: Record<AirframePresetId, AirframeLimitPreset> = {
  S92: {
    id: 'S92',
    name: 'Sikorsky S-92A (Bristow / CHC)',
    maxHelideckGustKts: 60,
    cautionGustKts: 45,
    minCloudCeilingFt: 400,
    minVisibilityKm: 1.0,
    minIcingFreezingLevelFt: 1800,
    maxFpsoWaveHeightM: 5.8,
  },
  AW189: {
    id: 'AW189',
    name: 'Leonardo AW189 (Bristow / CHC / SAR)',
    maxHelideckGustKts: 55,
    cautionGustKts: 43,
    minCloudCeilingFt: 450,
    minVisibilityKm: 1.2,
    minIcingFreezingLevelFt: 2000,
    maxFpsoWaveHeightM: 5.5,
  },
  H175: {
    id: 'H175',
    name: 'Airbus H175 (NHV / OHS)',
    maxHelideckGustKts: 55,
    cautionGustKts: 43,
    minCloudCeilingFt: 450,
    minVisibilityKm: 1.2,
    minIcingFreezingLevelFt: 2200,
    maxFpsoWaveHeightM: 5.5,
  },
  AW139: {
    id: 'AW139',
    name: 'Leonardo AW139 (SNS / Irish Sea)',
    maxHelideckGustKts: 52,
    cautionGustKts: 42,
    minCloudCeilingFt: 500,
    minVisibilityKm: 1.5,
    minIcingFreezingLevelFt: 2500,
    maxFpsoWaveHeightM: 5.0,
  },
  H160: {
    id: 'H160',
    name: 'Airbus H160 Offshore',
    maxHelideckGustKts: 50,
    cautionGustKts: 40,
    minCloudCeilingFt: 500,
    minVisibilityKm: 1.5,
    minIcingFreezingLevelFt: 2500,
    maxFpsoWaveHeightM: 5.0,
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

export function evaluateAirframeLimits(
  windSpeed10mKts: number,
  windGust10mKts: number,
  cloudCeilingFt: number,
  visibilityKm: number,
  freezingLevelFt: number,
  waveHeightM: number,
  precipMmHr: number,
  isFpso: boolean,
  preset: AirframeLimitPreset
): { status: 'GO' | 'CAUTION' | 'HOLD'; reason: string } {
  const icingHazard =
    freezingLevelFt > 0 &&
    freezingLevelFt < preset.minIcingFreezingLevelFt &&
    (cloudCeilingFt < 2500 || precipMmHr > 0.2);

  if (
    windGust10mKts >= preset.maxHelideckGustKts ||
    windSpeed10mKts >= preset.maxHelideckGustKts - 5
  ) {
    return {
      status: 'HOLD',
      reason: `NO-GO: Gusts ${windGust10mKts} kt exceed ${preset.id} ${preset.maxHelideckGustKts} kt rotor limit`,
    };
  }
  if (isFpso && waveHeightM >= preset.maxFpsoWaveHeightM) {
    return {
      status: 'HOLD',
      reason: `NO-GO: Wave Hs ${waveHeightM}m exceeds FPSO helideck motion limit (${preset.maxFpsoWaveHeightM}m)`,
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
  if (icingHazard && freezingLevelFt < 1000) {
    return {
      status: 'HOLD',
      reason: `NO-GO (Severe Rotor Icing): 0°C Freezing Level at ${freezingLevelFt} ft with active moisture`,
    };
  }

  if (
    windGust10mKts >= preset.cautionGustKts ||
    icingHazard ||
    cloudCeilingFt < preset.minCloudCeilingFt + 350 ||
    visibilityKm < preset.minVisibilityKm + 2.0 ||
    (isFpso && waveHeightM >= preset.maxFpsoWaveHeightM - 1.3) ||
    (!isFpso && waveHeightM >= 5.2)
  ) {
    if (icingHazard) {
      return {
        status: 'CAUTION',
        reason: `ICING CAUTION: 0°C Freezing Level at ${freezingLevelFt.toLocaleString()} ft (Transit Band)`,
      };
    }
    if (isFpso && waveHeightM >= preset.maxFpsoWaveHeightM - 1.3) {
      return {
        status: 'CAUTION',
        reason: `FPSO DECK MOTION CAUTION: Wave Hs ${waveHeightM}m near ${preset.maxFpsoWaveHeightM}m pitch/roll limit`,
      };
    }
    return {
      status: 'CAUTION',
      reason: `CAUTION: Gusts ${windGust10mKts} kt · Ceiling ${cloudCeilingFt.toLocaleString()} ft · Wave ${waveHeightM}m`,
    };
  }

  return {
    status: 'GO',
    reason: `GO (${preset.id} Within Limits) — Gusts ${windGust10mKts} kt · Wave ${waveHeightM}m · 0°C at ${freezingLevelFt.toLocaleString()} ft`,
  };
}

export function evaluateGridPointStatus(
  pt: SpatialWeatherGridPoint,
  preset: AirframeLimitPreset
): 'GO' | 'CAUTION' | 'HOLD' {
  return evaluateAirframeLimits(
    pt.windSpeed10mKts,
    pt.windGust10mKts,
    pt.cloudCeilingFt,
    pt.visibilityKm,
    pt.freezingLevelFt,
    pt.waveHeightM,
    0,
    true,
    preset
  ).status;
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
  waveHeightM: number;
  freezingLevelFt: number;
  cloudCeilingFt: number;
  seaSurfaceTempC: number;
  status: 'GO' | 'CAUTION' | 'HOLD';
} | null {
  if (gridPoints.length === 0) return null;

  let wSum = 0;
  let ws10 = 0;
  let wg10 = 0;
  let wd10 = 0;
  let ws950 = 0;
  let wave = 0;
  let freeze = 0;
  let ceil = 0;
  let sst = 0;

  for (const pt of gridPoints) {
    const dLat = lat - pt.lat;
    const dLon = (lon - pt.lon) * 0.56;
    const dSq = dLat * dLat + dLon * dLon + 0.02;
    const w = 1 / (dSq * dSq);
    wSum += w;
    ws10 += pt.windSpeed10mKts * w;
    wg10 += pt.windGust10mKts * w;
    wd10 += pt.windDir10mDeg * w;
    ws950 += pt.windSpeed950hPaKts * w;
    wave += pt.waveHeightM * w;
    freeze += pt.freezingLevelFt * w;
    ceil += pt.cloudCeilingFt * w;
    sst += pt.seaSurfaceTempC * w;
  }

  if (wSum === 0) return null;

  const finalWs10 = Math.round(ws10 / wSum);
  const finalWg10 = Math.round(wg10 / wSum);
  const finalWd10 = Math.round(wd10 / wSum);
  const finalWs950 = Math.round(ws950 / wSum);
  const finalWave = Number((wave / wSum).toFixed(1));
  const finalFreeze = Math.round(freeze / wSum);
  const finalCeil = Math.round(ceil / wSum);
  const finalSst = Number((sst / wSum).toFixed(1));

  const ev = evaluateAirframeLimits(
    finalWs10,
    finalWg10,
    finalCeil,
    15,
    finalFreeze,
    finalWave,
    0,
    true,
    preset
  );

  return {
    windSpeed10mKts: finalWs10,
    windGust10mKts: finalWg10,
    windDir10mDeg: finalWd10,
    windSpeed950hPaKts: finalWs950,
    waveHeightM: finalWave,
    freezingLevelFt: finalFreeze,
    cloudCeilingFt: finalCeil,
    seaSurfaceTempC: finalSst,
    status: ev.status,
  };
}

/**
 * Computes physical Cloud Ceiling (ft AMSL) from real 2m Temperature, 2m Dewpoint, Low Cloud Cover %, and Visibility
 * using the WMO / FAA Espy Lifting Condensation Level (LCL) equation: LCL_ft = ((T - Td) / 2.5) * 1000.
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
    return Math.max(150, Math.min(5000, lclBaseFt));
  }

  // If low cloud is Scattered (25–49%), effective ceiling is higher than the scattered LCL puffs
  if (lowCloudPct >= 25) {
    return Math.max(1200, Math.round(lclBaseFt * 1.45));
  }

  // Few / Clear low clouds (< 25%): high ceiling
  return Math.max(2800, Math.round(lclBaseFt * 2.1));
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
 * Physics-based North Sea Triggered vs Natural Lightning classifier using:
 * - Natural TS: WMO 95/96/99 or deep thunderstorm CAPE >= 500 J/kg
 * - Winter Triggered Lightning: Low 0°C level (<= 3,200 ft) + -10°C charging layer (<= 11,500 ft)
 *   + active convective showers or maritime cold-air instability (SST - T500 >= 31-34°C)
 */
export function classifyNorthSeaConvection(params: {
  cape: number | null;
  wmo: number | null;
  precip: number;
  showers: number;
  freezeFt: number;
  minus10Ft: number;
  sstMinus500C: number;
}): {
  risk: 'LOW' | 'MODERATE' | 'HIGH';
  type: 'NONE' | 'TRIGGERED_WINTER' | 'CONVECTIVE_SHOWER' | 'NATURAL_TS';
} {
  const { cape, wmo, precip, showers, freezeFt, minus10Ft, sstMinus500C } = params;
  if (wmo !== null && [95, 96, 99].includes(wmo)) {
    return { risk: 'HIGH', type: 'NATURAL_TS' };
  }
  if (cape !== null && cape >= 500) {
    return { risk: 'HIGH', type: 'NATURAL_TS' };
  }

  const isShowerWmo = wmo !== null && [80, 81, 82, 85, 86].includes(wmo);
  // Convection-permitting models like UKMO UKV 2km place showers directly in precipitation rather than splitting showers
  const hasActiveShowers =
    isShowerWmo || showers >= 0.3 || (precip >= 1.0 && cape !== null && cape >= 120);
  const coldTopStrong = sstMinus500C >= 34 && minus10Ft <= 10500;
  const coldTopMod = sstMinus500C >= 31 && minus10Ft <= 11500;

  if (
    freezeFt <= 3000 &&
    minus10Ft <= 10500 &&
    (hasActiveShowers || precip >= 0.8) &&
    ((cape !== null && cape >= 180) || coldTopStrong)
  ) {
    return { risk: 'HIGH', type: 'TRIGGERED_WINTER' };
  }

  if (
    freezeFt <= 3500 &&
    (hasActiveShowers || (cape !== null && cape >= 120) || coldTopMod)
  ) {
    return { risk: 'MODERATE', type: 'TRIGGERED_WINTER' };
  }

  if (hasActiveShowers || (cape !== null && cape >= 300) || precip >= 4.0) {
    return { risk: 'MODERATE', type: 'CONVECTIVE_SHOWER' };
  }

  return { risk: 'LOW', type: 'NONE' };
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
export async function fetchMultiModelRigForecast(
  facility: InstallationOrAirport,
  preset: AirframeLimitPreset
): Promise<MultiModelHourEntry[]> {
  const isFpso = facility.assetType === 'FPSO' || facility.assetType === 'Semi-Sub';

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
    'surface_pressure',
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
    const [wxRes, marRes] = await Promise.allSettled([fetch(wxUrl), fetch(marineUrl)]);
    if (wxRes.status !== 'fulfilled' || !wxRes.value.ok) return [];

    const wxJson = await wxRes.value.json();
    const marJson =
      marRes.status === 'fulfilled' && marRes.value.ok ? await marRes.value.json() : null;

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

    const classifyFogSpread = (
      spreadC: number,
      visKm: number,
      lowCloudPct: number
    ): 'LOW' | 'MODERATE' | 'HIGH' => {
      if (visKm < 1.5 || (spreadC <= 1.2 && lowCloudPct >= 65)) return 'HIGH';
      if (visKm < 4.0 || spreadC <= 2.2) return 'MODERATE';
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

      const waveHeightM = Number((marHourly.wave_height?.[idx] ?? 2.1).toFixed(1));
      const swellPeriodSec = Number((marHourly.wave_period?.[idx] ?? 8.2).toFixed(1));
      const swellDirDeg = Math.round(marHourly.wave_direction?.[idx] ?? 240);
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
      const seaSurfaceTempC = Number(
        (marHourly.sea_surface_temperature?.[idx] ?? 9.8).toFixed(1)
      );

      const modelsRecord = {} as Record<WeatherModelId, ModelPointSnapshot>;

      for (const mMeta of WEATHER_MODELS_META) {
        const m = mMeta.id;
        const rawVal = (field: string): number | null => {
          const val = hourly[`${field}_${m}`]?.[idx];
          return typeof val === 'number' && !Number.isNaN(val) ? val : null;
        };

        const ws10 = Math.round(rawVal('wind_speed_10m') ?? 18);
        const wd10 = Math.round(rawVal('wind_direction_10m') ?? 230);
        const wg10 = Math.round(rawVal('wind_gusts_10m') ?? Math.round(ws10 * 1.28));
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
        const approachShearKts = Math.max(0, ws950 - ws10);
        const wd950 = Math.round(
          rawVal('wind_direction_950hPa') ??
            rawVal('wind_direction_925hPa') ??
            wd10
        );
        const t950 = Number(
          (
            rawVal('temperature_950hPa') ??
            rawVal('temperature_925hPa') ??
            4.5
          ).toFixed(1)
        );
        const ws850 = Math.round(
          rawVal('wind_speed_850hPa') ?? Math.round(ws950 * 1.15)
        );
        const wd850 = Math.round(rawVal('wind_direction_850hPa') ?? wd950);

        const temp2mC = Number((rawVal('temperature_2m') ?? 8.5).toFixed(1));
        const dewPoint2mC = Number((rawVal('dew_point_2m') ?? temp2mC - 2.5).toFixed(1));
        const dewSpreadC = Number(Math.max(0, temp2mC - dewPoint2mC).toFixed(1));
        const t925 = rawVal('temperature_925hPa') ?? t950;
        const z925 = rawVal('geopotential_height_925hPa') ?? 720;
        const t850 = rawVal('temperature_850hPa') ?? t925 - 4.0;
        const z850 = rawVal('geopotential_height_850hPa') ?? 1420;
        const t700 = rawVal('temperature_700hPa') ?? t850 - 9.0;
        const z700 = rawVal('geopotential_height_700hPa') ?? 2950;
        const t500 = rawVal('temperature_500hPa') ?? t700 - 15.0;
        const z500 = rawVal('geopotential_height_500hPa') ?? 5450;

        const freezingLevelFt = computeNativeFreezingLevelFt(
          rawVal('freezing_level_height'),
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
        const sstMinus500C = Number((seaSurfaceTempC - t500).toFixed(1));

        const lowCloudPct = rawVal('cloud_cover_low') ?? 45;
        const precipMmHr = Number((rawVal('precipitation') ?? 0).toFixed(1));
        const showersMm = Number((rawVal('showers') ?? 0).toFixed(1));
        const qnhHpa = Math.round(rawVal('surface_pressure') ?? 1010);
        const capeVal = rawVal('cape');
        const wmoCode = rawVal('weather_code');

        // Visibility: direct from model (ICON/GFS) or derived from physical RH / precipitation / mist when not in ECMWF/GEM surface table
        const directVisMeters = rawVal('visibility');
        let visibilityKm = 20.0;
        if (directVisMeters !== null) {
          visibilityKm = Number(
            Math.min(50, Math.max(0.2, directVisMeters / 1000)).toFixed(1)
          );
        } else {
          if (dewSpreadC <= 0.6 && lowCloudPct >= 85) visibilityKm = 0.8;
          else if (dewSpreadC <= 1.2) visibilityKm = 3.5;
          else if (precipMmHr >= 2.0) visibilityKm = 4.5;
          else if (precipMmHr > 0.2) visibilityKm = 9.0;
          else visibilityKm = Number(Math.min(35, 12 + dewSpreadC * 4).toFixed(1));
        }

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
        });
        const lightningRisk = conv.risk;
        const lightningType = conv.type;
        const fogSpreadRisk = classifyFogSpread(dewSpreadC, visibilityKm, lowCloudPct);

        const evalResult = evaluateAirframeLimits(
          deckWindSpeedKts,
          deckWindGustKts,
          cloudCeilingFt,
          visibilityKm,
          freezingLevelFt,
          waveHeightM,
          precipMmHr,
          isFpso,
          preset
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
    let maxWaveM = 0;
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
      if (h.waveHeightM > maxWaveM) maxWaveM = h.waveHeightM;
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
  { wxArr: unknown; marArr: unknown; fetchedAt: number }
>();

/**
 * Fetches a 3-point Shore-to-Rig Flight Corridor Profile (Shore Heliport -> Mid-Route -> Offshore Helideck)
 * for any selected forecast hour across the 7-day window.
 */
export async function fetchFlightCorridorProfile(
  shoreBase: InstallationOrAirport,
  targetRig: InstallationOrAirport,
  preset: AirframeLimitPreset,
  selectedHourIso?: string
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
    },
    {
      label: `Mid-Route (${Math.round(totalDistNm / 2)} NM)`,
      code: 'MID',
      lat: midLat,
      lon: midLon,
      distNm: Math.round(totalDistNm / 2),
      isFpso: false,
    },
    {
      label: `Helideck (${targetRig.code})`,
      code: targetRig.code,
      lat: targetRig.lat,
      lon: targetRig.lon,
      distNm: Math.round(totalDistNm),
      isFpso: targetRig.assetType === 'FPSO',
    },
  ];

  const cacheKey = `${shoreBase.id}_${targetRig.id}`;
  let cached = corridorRawCache.get(cacheKey);

  if (!cached || Date.now() - cached.fetchedAt > 300000) {
    const lats = points.map((p) => p.lat.toFixed(3)).join(',');
    const lons = points.map((p) => p.lon.toFixed(3)).join(',');

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_950hPa,wind_direction_950hPa,wind_speed_925hPa,wind_direction_925hPa,temperature_925hPa,geopotential_height_925hPa,wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,temperature_2m,dew_point_2m,cloud_cover_low,visibility,freezing_level_height,precipitation,cape,weather_code&wind_speed_unit=kn&forecast_days=7`;
    const marUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height&forecast_days=7`;

    try {
      const [wxRes, marRes] = await Promise.allSettled([fetch(wxUrl), fetch(marUrl)]);
      if (wxRes.status !== 'fulfilled' || !wxRes.value.ok) return [];

      const wxArr = await wxRes.value.json();
      const marArr =
        marRes.status === 'fulfilled' && marRes.value.ok ? await marRes.value.json() : [];

      cached = { wxArr, marArr, fetchedAt: Date.now() };
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

    const ws10 = Math.round(Number(w?.hourly?.wind_speed_10m?.[hrIdx] ?? 18));
    const wd10 = Math.round(Number(w?.hourly?.wind_direction_10m?.[hrIdx] ?? 230));
    const wg10 = Math.round(Number(w?.hourly?.wind_gusts_10m?.[hrIdx] ?? ws10 + 6));

    const ws950 = Math.round(
      Number(
        w?.hourly?.wind_speed_950hPa?.[hrIdx] ??
          w?.hourly?.wind_speed_925hPa?.[hrIdx] ??
          Math.round(ws10 * 1.25)
      )
    );
    const wd950 = Math.round(
      Number(
        w?.hourly?.wind_direction_950hPa?.[hrIdx] ??
          w?.hourly?.wind_direction_925hPa?.[hrIdx] ??
          wd10
      )
    );
    const ws850 = Math.round(
      Number(w?.hourly?.wind_speed_850hPa?.[hrIdx] ?? Math.round(ws950 * 1.15))
    );
    const wd850 = Math.round(Number(w?.hourly?.wind_direction_850hPa?.[hrIdx] ?? wd950));

    const angleRad = ((wd950 - outboundTrackDeg) * Math.PI) / 180;
    const headwind950Kts = Math.round(ws950 * Math.cos(angleRad));

    const t2m = Number(w?.hourly?.temperature_2m?.[hrIdx] ?? 8.5);
    const dp2m = Number(w?.hourly?.dew_point_2m?.[hrIdx] ?? t2m - 2.5);
    const t925 = Number(w?.hourly?.temperature_925hPa?.[hrIdx] ?? 4.0);
    const z925 = Number(w?.hourly?.geopotential_height_925hPa?.[hrIdx] ?? 720);
    const t850 = Number(w?.hourly?.temperature_850hPa?.[hrIdx] ?? 0.5);
    const z850 = Number(w?.hourly?.geopotential_height_850hPa?.[hrIdx] ?? 1420);
    const rawFreeze = w?.hourly?.freezing_level_height?.[hrIdx];

    const freezingLevelFt = computeNativeFreezingLevelFt(
      typeof rawFreeze === 'number' ? rawFreeze : null,
      t2m,
      t925,
      z925,
      t850,
      z850
    );

    const visKm = Number(
      Math.min(
        50,
        Math.max(0.2, Number(w?.hourly?.visibility?.[hrIdx] ?? 18000) / 1000)
      ).toFixed(1)
    );
    const lowCloud = Number(w?.hourly?.cloud_cover_low?.[hrIdx] ?? 40);
    const cloudCeilingFt = computePhysicalCloudCeilingFt(t2m, dp2m, lowCloud, visKm);
    const waveHeightM = Number(Number(m?.hourly?.wave_height?.[hrIdx] ?? 2.0).toFixed(1));
    const precip = Number(w?.hourly?.precipitation?.[hrIdx] ?? 0);
    const capeVal = typeof w?.hourly?.cape?.[hrIdx] === 'number' ? Number(w.hourly.cape[hrIdx]) : 0;
    const wmoCode = typeof w?.hourly?.weather_code?.[hrIdx] === 'number' ? Number(w.hourly.weather_code[hrIdx]) : 0;
    const dewSpreadC = Number(Math.max(0, t2m - dp2m).toFixed(1));
    const lightningRisk: 'LOW' | 'MODERATE' | 'HIGH' =
      [95, 96, 99].includes(wmoCode) || capeVal >= 600
        ? 'HIGH'
        : [80, 81, 82, 85, 86].includes(wmoCode) || capeVal >= 300
        ? 'MODERATE'
        : 'LOW';

    const evalLim = evaluateAirframeLimits(
      ws10,
      wg10,
      cloudCeilingFt,
      visKm,
      freezingLevelFt,
      waveHeightM,
      precip,
      pt.isFpso,
      preset
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
      status: effectiveStatus,
    };
  });
}

// Cache 7-day 25-point spatial grid per modelId so scrubbing across days/hours is instant on the map
const spatialGridRawCache = new Map<
  WeatherModelId,
  {
    coords: Array<{ lat: number; lon: number }>;
    wxArr: unknown;
    marArr: unknown;
    fetchedAt: number;
  }
>();

/**
 * Fetches a 5x5 (25-point) 2D spatial weather & marine grid across the UK, North Sea & West of Shetland
 * across all 7 forecast days so the Animated Streamlines & Go/No-Go Matrix work for both NOW and any future day (e.g. Monday).
 */
export async function fetchSpatialWeatherGrid(
  modelId: WeatherModelId,
  selectedHourIso?: string
): Promise<SpatialWeatherGridPoint[]> {
  const latSteps = [51.0, 53.75, 56.5, 59.0, 61.5];
  const lonSteps = [-5.5, -3.0, -0.5, 2.0, 4.5];

  const coords: Array<{ lat: number; lon: number }> = [];
  for (const lat of latSteps) {
    for (const lon of lonSteps) {
      coords.push({ lat, lon });
    }
  }

  let cached = spatialGridRawCache.get(modelId);

  if (!cached || Date.now() - cached.fetchedAt > 300000) {
    const lats = coords.map((c) => c.lat.toFixed(2)).join(',');
    const lons = coords.map((c) => c.lon.toFixed(2)).join(',');

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_950hPa,wind_direction_950hPa,wind_speed_925hPa,wind_direction_925hPa,temperature_925hPa,geopotential_height_925hPa,wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,temperature_2m,dew_point_2m,cloud_cover_low,visibility,freezing_level_height&models=${modelId}&wind_speed_unit=kn&forecast_days=7`;
    const marUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lats}&longitude=${lons}&hourly=wave_height,wave_direction,sea_surface_temperature&forecast_days=7`;

    try {
      const [wxRes, marRes] = await Promise.allSettled([fetch(wxUrl), fetch(marUrl)]);
      if (wxRes.status !== 'fulfilled' || !wxRes.value.ok) return [];

      const wxArr = await wxRes.value.json();
      const marArr =
        marRes.status === 'fulfilled' && marRes.value.ok ? await marRes.value.json() : [];

      cached = { coords, wxArr, marArr, fetchedAt: Date.now() };
      spatialGridRawCache.set(modelId, cached);
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

    const ws10 = Math.round(pickRaw('wind_speed_10m') ?? 18);
    const wd10 = Math.round(pickRaw('wind_direction_10m') ?? 235);
    const wg10 = Math.round(pickRaw('wind_gusts_10m') ?? Math.round(ws10 * 1.28));
    const ws950 = Math.round(
      pickRaw('wind_speed_950hPa') ??
        pickRaw('wind_speed_925hPa') ??
        Math.round(ws10 * 1.22)
    );
    const wd950 = Math.round(
      pickRaw('wind_direction_950hPa') ??
        pickRaw('wind_direction_925hPa') ??
        wd10
    );
    const ws850 = Math.round(
      pickRaw('wind_speed_850hPa') ?? Math.round(ws950 * 1.15)
    );
    const wd850 = Math.round(pickRaw('wind_direction_850hPa') ?? wd950);

    const t2m = pickRaw('temperature_2m') ?? 8.5;
    const dp2m = pickRaw('dew_point_2m') ?? t2m - 2.5;
    const t925 = pickRaw('temperature_925hPa') ?? 4.0;
    const z925 = pickRaw('geopotential_height_925hPa') ?? 720;
    const t850 = pickRaw('temperature_850hPa') ?? 0.5;
    const z850 = pickRaw('geopotential_height_850hPa') ?? 1420;

    const freezingLevelFt = computeNativeFreezingLevelFt(
      pickRaw('freezing_level_height'),
      t2m,
      t925,
      z925,
      t850,
      z850
    );

    const rawVis = pickRaw('visibility');
    const visKm =
      rawVis !== null
        ? Number(Math.min(50, Math.max(0.2, rawVis / 1000)).toFixed(1))
        : Number(Math.min(35, Math.max(1.5, 10 + (t2m - dp2m) * 4)).toFixed(1));
    const lowCloud = pickRaw('cloud_cover_low') ?? 45;
    const cloudCeilingFt = computePhysicalCloudCeilingFt(t2m, dp2m, lowCloud, visKm);

    const waveHeightM = Number(Number(marHourly.wave_height?.[hr] ?? 2.0).toFixed(1));
    const waveDirDeg = Math.round(Number(marHourly.wave_direction?.[hr] ?? wd10));
    const seaSurfaceTempC = Number(
      Number(marHourly.sea_surface_temperature?.[hr] ?? 9.5).toFixed(1)
    );

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
  { icao: 'ENQA', label: 'Statfjord A Platform', lat: 61.26, lon: 1.85 },
  { icao: 'ENOA', label: 'Oseberg A Platform', lat: 60.49, lon: 2.82 },
  { icao: 'ENJS', label: 'Johan Sverdrup Platform', lat: 58.83, lon: 2.54 },
  { icao: 'ENSL', label: 'Sleipner Platform', lat: 58.37, lon: 1.91 },
  { icao: 'ENDR', label: 'Draupner Platform', lat: 58.2, lon: 1.6 },
  { icao: 'ENWV', label: 'Valhall Platform', lat: 56.27, lon: 3.39 },
  { icao: 'ENFB', label: 'Balder / Ringhorne Area', lat: 59.5, lon: 2.2 },
  { icao: 'ENHE', label: 'Heidrun Platform', lat: 65.32, lon: 7.31 },
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
