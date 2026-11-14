import {
  AirframeLimitPreset,
  AirframePresetId,
  CorridorWaypointProfile,
  DayFlightWindowSummary,
  InstallationOrAirport,
  ModelPointSnapshot,
  MultiModelHourEntry,
  SpatialWeatherGridPoint,
  WeatherModelId,
} from '../types/radar';
import { calculateBearingDeg, calculateDistanceNm } from '../data/aircraftDecoder';

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
 * Fetches a full 7-day (up to 168 hours) multi-model offshore forecast across all 4 meteorological models
 * (DWD ICON-EU, ECMWF IFS, NOAA GFS, ECCC GEM) + WaveWatch III / Copernicus Marine.
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
    'freezing_level_height',
    'visibility',
    'cloud_cover_low',
    'precipitation',
    'temperature_2m',
    'dew_point_2m',
    'surface_pressure',
  ].join(',');

  const modelsParam = 'icon_seamless,gfs_seamless,ecmwf_ifs025,gem_seamless';
  const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${facility.lat.toFixed(
    3
  )}&longitude=${facility.lon.toFixed(
    3
  )}&hourly=${hourlyVars}&models=${modelsParam}&wind_speed_unit=kn&forecast_days=7`;

  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${facility.lat.toFixed(
    3
  )}&longitude=${facility.lon.toFixed(
    3
  )}&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&forecast_days=7`;

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

    for (let idx = startIdx; idx < times.length; idx++) {
      const iso = times[idx];
      const [dayKey, timePart] = iso.split('T');
      const hourLabel = timePart?.slice(0, 5) || '00:00';

      const dt = new Date(iso + 'Z');
      const isToday = dayKey === todayDateKey;
      const dayNameShort = isToday ? 'Today' : SHORT_DAYS[dt.getUTCDay()];
      const dayNameFull = isToday
        ? `Today (${FULL_DAYS[dt.getUTCDay()]})`
        : FULL_DAYS[dt.getUTCDay()];
      const dateShort = `${dt.getUTCDate()} ${SHORT_MONTHS[dt.getUTCMonth()]}`;

      const waveHeightM = Number((marHourly.wave_height?.[idx] ?? 2.1).toFixed(1));
      const swellPeriodSec = Number((marHourly.wave_period?.[idx] ?? 8.2).toFixed(1));
      const swellDirDeg = Math.round(marHourly.wave_direction?.[idx] ?? 240);
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

        // Use native 950 hPa (ICON/GFS/GEM) or native 925 hPa (ECMWF WMO standard level)
        const ws950 = Math.round(
          rawVal('wind_speed_950hPa') ??
            rawVal('wind_speed_925hPa') ??
            Math.round(ws10 * 1.22)
        );
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
        const t925 = rawVal('temperature_925hPa') ?? t950;
        const z925 = rawVal('geopotential_height_925hPa') ?? 720;
        const t850 = rawVal('temperature_850hPa') ?? t925 - 4.0;
        const z850 = rawVal('geopotential_height_850hPa') ?? 1420;

        const freezingLevelFt = computeNativeFreezingLevelFt(
          rawVal('freezing_level_height'),
          temp2mC,
          t925,
          z925,
          t850,
          z850
        );

        const lowCloudPct = rawVal('cloud_cover_low') ?? 45;
        const precipMmHr = Number((rawVal('precipitation') ?? 0).toFixed(1));
        const qnhHpa = Math.round(rawVal('surface_pressure') ?? 1010);

        // Visibility: direct from model (ICON/GFS) or derived from physical RH / precipitation / mist when not in ECMWF/GEM surface table
        const directVisMeters = rawVal('visibility');
        let visibilityKm = 20.0;
        if (directVisMeters !== null) {
          visibilityKm = Number(
            Math.min(50, Math.max(0.2, directVisMeters / 1000)).toFixed(1)
          );
        } else {
          const spread = Math.max(0, temp2mC - dewPoint2mC);
          if (spread <= 0.6 && lowCloudPct >= 85) visibilityKm = 0.8;
          else if (spread <= 1.2) visibilityKm = 3.5;
          else if (precipMmHr >= 2.0) visibilityKm = 4.5;
          else if (precipMmHr > 0.2) visibilityKm = 9.0;
          else visibilityKm = Number(Math.min(35, 12 + spread * 4).toFixed(1));
        }

        const cloudCeilingFt = computePhysicalCloudCeilingFt(
          temp2mC,
          dewPoint2mC,
          lowCloudPct,
          visibilityKm
        );

        const evalResult = evaluateAirframeLimits(
          ws10,
          wg10,
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
        waveHeightM,
        swellPeriodSec,
        swellDirDeg,
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

    const wxUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_950hPa,wind_direction_950hPa,wind_speed_925hPa,wind_direction_925hPa,temperature_925hPa,geopotential_height_925hPa,wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,temperature_2m,dew_point_2m,cloud_cover_low,visibility,freezing_level_height,precipitation&wind_speed_unit=kn&forecast_days=7`;
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
      status: evalLim.status,
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
  const latSteps = [53.5, 55.5, 57.5, 59.5, 61.5];
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
