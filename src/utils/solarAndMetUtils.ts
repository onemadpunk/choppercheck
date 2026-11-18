import {
  AirframeLimitPreset,
  CorridorWaypointProfile,
  CustomRigOverride,
  DayFlightWindowSummary,
  FiveModelConsensusSummary,
  FlightOpsMode,
  InstallationOrAirport,
  MultiModelHourEntry,
  WeatherModelId,
} from '../types/radar';

export interface SolarDayWindow {
  sunriseUtcMin: number;
  sunsetUtcMin: number;
  civilDawnUtcMin: number;
  civilDuskUtcMin: number;
  caaDayStartUtcMin: number;
  caaDayEndUtcMin: number;
  sunriseLabel: string;
  sunsetLabel: string;
  civilDawnLabel: string;
  civilDuskLabel: string;
  caaDayWindowLabel: string;
  daylightDurationLabel: string;
  polarStatus: 'normal' | 'polar_day' | 'polar_night';
}

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

function formatUtcMinutes(totalMinutes: number): string {
  const m = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}

/**
 * NOAA Solar Calculation for exact UTC Sunrise, Sunset, Civil Twilight (-6°),
 * and UK CAA Night boundaries (30 min before sunrise / 30 min after sunset) at any lat/lon/date.
 */
export function computeSolarTimesUtc(
  lat: number,
  lon: number,
  dateInput: Date | string
): SolarDayWindow {
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const startOfYear = Date.UTC(d.getUTCFullYear(), 0, 0);
  const currentDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dayOfYear = Math.max(1, Math.min(366, Math.round((currentDay - startOfYear) / 86400000)));

  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1);
  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const decl =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  const latRad = (lat * Math.PI) / 180;

  const calcHourAngleDeg = (zenithDeg: number): number | null => {
    const zenithRad = (zenithDeg * Math.PI) / 180;
    const cosHa =
      Math.cos(zenithRad) / (Math.cos(latRad) * Math.cos(decl)) -
      Math.tan(latRad) * Math.tan(decl);
    if (cosHa > 1) return null; // Polar night
    if (cosHa < -1) return 180; // Midnight sun
    return (Math.acos(cosHa) * 180) / Math.PI;
  };

  const haSun = calcHourAngleDeg(90.833);
  const haCivil = calcHourAngleDeg(96.0);

  if (haSun === null) {
    return {
      sunriseUtcMin: 720,
      sunsetUtcMin: 720,
      civilDawnUtcMin: 720,
      civilDuskUtcMin: 720,
      caaDayStartUtcMin: 720,
      caaDayEndUtcMin: 720,
      sunriseLabel: '--:--',
      sunsetLabel: '--:--',
      civilDawnLabel: '--:--',
      civilDuskLabel: '--:--',
      caaDayWindowLabel: 'Polar Night',
      daylightDurationLabel: '0h 00m',
      polarStatus: 'polar_night',
    };
  }

  if (haSun >= 180) {
    return {
      sunriseUtcMin: 0,
      sunsetUtcMin: 1440,
      civilDawnUtcMin: 0,
      civilDuskUtcMin: 1440,
      caaDayStartUtcMin: 0,
      caaDayEndUtcMin: 1440,
      sunriseLabel: '00:00',
      sunsetLabel: '24:00',
      civilDawnLabel: '00:00',
      civilDuskLabel: '24:00',
      caaDayWindowLabel: '24h Daylight',
      daylightDurationLabel: '24h 00m',
      polarStatus: 'polar_day',
    };
  }

  const solarNoonMin = 720 - 4 * lon - eqTime;
  const sunriseMin = solarNoonMin - 4 * haSun;
  const sunsetMin = solarNoonMin + 4 * haSun;
  const civilDawnMin = haCivil !== null ? solarNoonMin - 4 * haCivil : sunriseMin - 35;
  const civilDuskMin = haCivil !== null ? solarNoonMin + 4 * haCivil : sunsetMin + 35;

  // UK CAA Night = 30 min after sunset to 30 min before sunrise
  const caaDayStartMin = sunriseMin - 30;
  const caaDayEndMin = sunsetMin + 30;
  const durMin = Math.max(0, Math.round(sunsetMin - sunriseMin));

  return {
    sunriseUtcMin: sunriseMin,
    sunsetUtcMin: sunsetMin,
    civilDawnUtcMin: civilDawnMin,
    civilDuskUtcMin: civilDuskMin,
    caaDayStartUtcMin: caaDayStartMin,
    caaDayEndUtcMin: caaDayEndMin,
    sunriseLabel: formatUtcMinutes(sunriseMin),
    sunsetLabel: formatUtcMinutes(sunsetMin),
    civilDawnLabel: formatUtcMinutes(civilDawnMin),
    civilDuskLabel: formatUtcMinutes(civilDuskMin),
    caaDayWindowLabel: `${formatUtcMinutes(caaDayStartMin)}–${formatUtcMinutes(caaDayEndMin)} UTC`,
    daylightDurationLabel: `${Math.floor(durMin / 60)}h ${pad2(durMin % 60)}m`,
    polarStatus: 'normal',
  };
}

export function isCaaNightForHour(
  hourIso: string,
  solar: SolarDayWindow
): boolean {
  if (solar.polarStatus === 'polar_day') return false;
  if (solar.polarStatus === 'polar_night') return true;
  const timePart = hourIso.split('T')[1] || '12:00';
  const [hh, mm] = timePart.split(':').map((x) => parseInt(x, 10) || 0);
  // Evaluate midpoint of the hour (:30) so boundary hours reflect actual daylight fraction
  const utcMin = hh * 60 + mm + 30;
  return utcMin < solar.caaDayStartUtcMin || utcMin > solar.caaDayEndUtcMin;
}

export interface EffectiveOperatingLimits {
  maxHelideckGustKts: number;
  cautionGustKts: number;
  minCloudCeilingFt: number;
  minVisibilityKm: number;
  minIcingFreezingLevelFt: number;
  maxFpsoWaveHeightM: number;
  isNightApplied: boolean;
  isOverrideApplied: boolean;
  daylightOnlyBlocked: boolean;
}

/**
 * Computes effective operational limits based on:
 * 1) Base airframe preset (S92 / AW189 / H175 / AW139 / H160)
 * 2) Day vs Night phase (stricter night ARA ceiling/vis + tighter floating deck pitch-roll/wind margin)
 * 3) Optional user-saved local HCA/HLL override for this rig/FPSO
 */
export function deriveEffectiveLimits(
  basePreset: AirframeLimitPreset,
  isNight: boolean,
  isFpso: boolean,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null
): EffectiveOperatingLimits {
  // Wind (SPA.HOFO.135, 60 kt incl. gusts) and sea state (CAA 6 m Hs) are the same day and night.
  // Night only raises the cloud/visibility margins (ARA MDH is 300 ft at night vs 200 ft by day).
  let maxGust = basePreset.maxHelideckGustKts;
  let cautionGust = isNight ? Math.max(30, basePreset.cautionGustKts - 3) : basePreset.cautionGustKts;
  let minCeil = isNight ? basePreset.minCloudCeilingFt + 150 : basePreset.minCloudCeilingFt;
  let minVis = isNight ? Number((basePreset.minVisibilityKm + 0.5).toFixed(1)) : basePreset.minVisibilityKm;
  let maxWave = basePreset.maxFpsoWaveHeightM;

  let isOverrideApplied = false;
  if (customOverride?.maxGustKts && customOverride.maxGustKts > 0 && customOverride.maxGustKts < maxGust) {
    maxGust = customOverride.maxGustKts;
    cautionGust = Math.min(cautionGust, Math.max(25, maxGust - 10));
    isOverrideApplied = true;
  }
  if (customOverride?.maxWaveM && customOverride.maxWaveM > 0 && customOverride.maxWaveM < maxWave) {
    maxWave = customOverride.maxWaveM;
    isOverrideApplied = true;
  }
  if (customOverride?.daylightOnlyDeck) {
    isOverrideApplied = true;
  }

  const daylightOnlyBlocked =
    isNight && (flightOpsMode === 'daylight_only' || Boolean(customOverride?.daylightOnlyDeck));

  return {
    maxHelideckGustKts: maxGust,
    cautionGustKts: cautionGust,
    minCloudCeilingFt: minCeil,
    minVisibilityKm: minVis,
    minIcingFreezingLevelFt: basePreset.minIcingFreezingLevelFt,
    maxFpsoWaveHeightM: maxWave,
    isNightApplied: isNight,
    isOverrideApplied,
    daylightOnlyBlocked,
  };
}

/**
 * Interpolates sustained wind and gusts from 10m sea level up to a helideck's real elevation (AMSL)
 * using live 80m model winds. Airports/shore pads (<= 45ft) stay at 10m surface wind.
 */
export function computeDeckHeightWind(
  windSpeed10mKts: number,
  windGust10mKts: number,
  windSpeed80mKts: number | null | undefined,
  elevationFt: number
): { deckWindSpeedKts: number; deckWindGustKts: number } {
  if (
    typeof windSpeed80mKts !== 'number' ||
    !Number.isFinite(windSpeed80mKts) ||
    elevationFt <= 45
  ) {
    return {
      deckWindSpeedKts: windSpeed10mKts,
      deckWindGustKts: windGust10mKts,
    };
  }
  const elevM = Math.max(10, Math.min(80, elevationFt * 0.3048));
  const frac = (elevM - 10) / 70;
  const upperWs = Math.max(windSpeed10mKts, windSpeed80mKts);
  const deckWindSpeedKts = Math.round(windSpeed10mKts + (upperWs - windSpeed10mKts) * frac);
  const baseGustRatio = windSpeed10mKts > 0 ? windGust10mKts / windSpeed10mKts : 1.25;
  const dampedRatio = Math.max(1.12, 1 + (baseGustRatio - 1) * (1 - 0.15 * frac));
  const deckWindGustKts = Math.max(
    windGust10mKts,
    Math.round(deckWindSpeedKts * dampedRatio)
  );
  return { deckWindSpeedKts, deckWindGustKts };
}

export function evaluateFpsoSwellRisk(
  waveHeightM: number,
  swellPeriodSec: number,
  swellWaveHeightM?: number,
  swellWavePeriodSec?: number,
  isFpso = false
): {
  isResonantSwell: boolean;
  effectivePeriodSec: number;
  effectiveSwellM: number;
  label: string;
} {
  const effectivePeriodSec = Number(
    Math.max(swellPeriodSec || 0, swellWavePeriodSec || 0).toFixed(1)
  );
  const effectiveSwellM = Number((swellWaveHeightM ?? waveHeightM).toFixed(1));
  const isResonantSwell =
    isFpso && effectivePeriodSec >= 10.0 && (effectiveSwellM >= 1.5 || waveHeightM >= 2.5);
  const label = isResonantSwell
    ? `Resonant Atlantic swell (${effectiveSwellM}m @ ${effectivePeriodSec}s)`
    : `${effectiveSwellM}m @ ${effectivePeriodSec}s`;
  return {
    isResonantSwell,
    effectivePeriodSec,
    effectiveSwellM,
    label,
  };
}

export function evaluateHourWithLimits(
  snap: {
    windSpeed10mKts: number;
    windGust10mKts: number;
    deckWindSpeedKts?: number;
    deckWindGustKts?: number;
    approachShearKts?: number;
    cloudCeilingFt: number;
    visibilityKm: number;
    freezingLevelFt: number;
    precipMmHr: number;
    lightningRisk?: 'LOW' | 'MODERATE' | 'HIGH';
    lightningType?: 'NONE' | 'TRIGGERED_WINTER' | 'CONVECTIVE_SHOWER' | 'NATURAL_TS';
    fogSpreadRisk?: 'LOW' | 'MODERATE' | 'HIGH';
    dewSpreadC?: number;
  },
  waveHeightM: number,
  swellPeriodSec: number,
  isNight: boolean,
  isFpso: boolean,
  basePreset: AirframeLimitPreset,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null
): { status: 'GO' | 'CAUTION' | 'HOLD'; reason: string; limits: EffectiveOperatingLimits } {
  const limits = deriveEffectiveLimits(basePreset, isNight, isFpso, flightOpsMode, customOverride);
  const phaseLabel = isNight ? 'NIGHT' : 'DAY';
  const effWind = snap.deckWindSpeedKts ?? snap.windSpeed10mKts;
  const effGust = snap.deckWindGustKts ?? snap.windGust10mKts;

  if (limits.daylightOnlyBlocked) {
    const why = customOverride?.daylightOnlyDeck
      ? 'Deck set to Daylight Only (local restriction)'
      : 'Outside Daylight Crew-Change Window (CAA Night)';
    return {
      status: 'HOLD',
      reason: `NIGHT HOLD: ${why} · Gusts ${effGust}kt, Wave ${waveHeightM}m`,
      limits,
    };
  }

  const icingHazard =
    snap.freezingLevelFt > 0 &&
    snap.freezingLevelFt < limits.minIcingFreezingLevelFt &&
    (snap.cloudCeilingFt < 2500 || snap.precipMmHr > 0.2);

  if (snap.lightningRisk === 'HIGH') {
    const ltLabel =
      snap.lightningType === 'NATURAL_TS'
        ? 'Natural Thunderstorm (TS)'
        : 'Winter Triggered-Lightning Setup (Low 0°C + Convective Showers)';
    return {
      status: 'HOLD',
      reason: `NO-GO (${phaseLabel} ${ltLabel})`,
      limits,
    };
  }
  if (Math.max(effWind, effGust) > limits.maxHelideckGustKts) {
    return {
      status: 'HOLD',
      reason: `NO-GO (${phaseLabel}): Deck wind ${effWind}G${effGust} kt exceeds ${limits.maxHelideckGustKts} kt helideck wind limit`,
      limits,
    };
  }
  if (waveHeightM > limits.maxFpsoWaveHeightM) {
    return {
      status: 'HOLD',
      reason: `NO-GO (Sea State): Wave Hs ${waveHeightM}m exceeds ${limits.maxFpsoWaveHeightM}m CAA limit`,
      limits,
    };
  }
  if (
    snap.cloudCeilingFt < limits.minCloudCeilingFt ||
    snap.visibilityKm < limits.minVisibilityKm
  ) {
    return {
      status: 'HOLD',
      reason: `NO-GO (${phaseLabel} ARA Minima): Ceiling ${snap.cloudCeilingFt} ft / Vis ${snap.visibilityKm} km below ${limits.minCloudCeilingFt} ft / ${limits.minVisibilityKm} km`,
      limits,
    };
  }
  if (icingHazard && snap.freezingLevelFt < 1000) {
    return {
      status: 'HOLD',
      reason: `NO-GO (Severe Rotor Icing): 0°C at ${snap.freezingLevelFt} ft with active moisture`,
      limits,
    };
  }

  const longPeriodSwellCaution = isFpso && swellPeriodSec >= 10.0 && waveHeightM >= 2.5;
  const approachShearCaution = (snap.approachShearKts ?? 0) >= 20;

  if (
    effGust >= limits.cautionGustKts ||
    icingHazard ||
    snap.lightningRisk === 'MODERATE' ||
    snap.fogSpreadRisk === 'HIGH' ||
    longPeriodSwellCaution ||
    approachShearCaution ||
    snap.cloudCeilingFt < limits.minCloudCeilingFt + 350 ||
    snap.visibilityKm < limits.minVisibilityKm + 2.0 ||
    (isFpso && waveHeightM >= limits.maxFpsoWaveHeightM - 1.2) ||
    (!isFpso && waveHeightM >= limits.maxFpsoWaveHeightM - 0.8)
  ) {
    if (snap.lightningRisk === 'MODERATE') {
      const ltLabel =
        snap.lightningType === 'TRIGGERED_WINTER'
          ? 'WINTER TRIGGERED-LIGHTNING CAUTION: Low 0°C band + unstable convective showers'
          : 'CONVECTIVE SQUALL CAUTION: Heavy showers / instability forecast';
      return {
        status: 'CAUTION',
        reason: ltLabel,
        limits,
      };
    }
    if (icingHazard) {
      return {
        status: 'CAUTION',
        reason: `ICING CAUTION: 0°C Freezing Level at ${snap.freezingLevelFt.toLocaleString()} ft (Transit Band)`,
        limits,
      };
    }
    if (longPeriodSwellCaution) {
      return {
        status: 'CAUTION',
        reason: `FPSO SWELL PERIOD CAUTION: ${waveHeightM}m @ ${swellPeriodSec}s long Atlantic swell (Pitch/Roll risk)`,
        limits,
      };
    }
    if (approachShearCaution) {
      return {
        status: 'CAUTION',
        reason: `APPROACH SHEAR CAUTION: +${snap.approachShearKts} kt jump from 10m to 950hPa`,
        limits,
      };
    }
    if (snap.fogSpreadRisk === 'HIGH') {
      return {
        status: 'CAUTION',
        reason: `SEA HAAR / FOG CAUTION: Temp–Dewpoint spread ${snap.dewSpreadC ?? 1.0}°C`,
        limits,
      };
    }
    if (isFpso && waveHeightM >= limits.maxFpsoWaveHeightM - 1.2) {
      return {
        status: 'CAUTION',
        reason: `FPSO MOTION CAUTION (${phaseLabel}): Wave Hs ${waveHeightM}m near ${limits.maxFpsoWaveHeightM}m limit`,
        limits,
      };
    }
    return {
      status: 'CAUTION',
      reason: `CAUTION (${phaseLabel}): Gusts ${effGust} kt · Ceiling ${snap.cloudCeilingFt.toLocaleString()} ft · Wave ${waveHeightM}m`,
      limits,
    };
  }

  return {
    status: 'GO',
    reason: `GO (${basePreset.id} ${phaseLabel} Limits) — Deck gusts ${effGust} kt · Wave ${waveHeightM}m · 0°C ${snap.freezingLevelFt.toLocaleString()} ft`,
    limits,
  };
}

const MODEL_SHORT_LABELS: Record<WeatherModelId, string> = {
  ukmo_seamless: 'UKMO UKV',
  icon_seamless: 'ICON-EU',
  ecmwf_ifs025: 'ECMWF',
  gfs_seamless: 'GFS',
  gem_seamless: 'GEM',
};

/**
 * Computes 5-model consensus and spread across UKMO UKV, ICON-EU, ECMWF, GFS, and GEM for any hour.
 */
export function computeFiveModelConsensus(
  hourEntry: MultiModelHourEntry,
  isFpso: boolean,
  basePreset: AirframeLimitPreset,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null
): FiveModelConsensusSummary {
  const modelIds = Object.keys(hourEntry.models) as WeatherModelId[];
  let goCount = 0;
  let cautionCount = 0;
  let holdCount = 0;
  let gustMinKts = 999;
  let gustMaxKts = 0;
  let freezeMinFt = 99999;
  let freezeMaxFt = 0;

  const perModel: Array<{ id: WeatherModelId; status: 'GO' | 'CAUTION' | 'HOLD' }> = [];

  for (const mId of modelIds) {
    const snap = hourEntry.models[mId];
    if (!snap) continue;
    const ev = evaluateHourWithLimits(
      snap,
      hourEntry.waveHeightM,
      hourEntry.swellPeriodSec,
      Boolean(hourEntry.isNight),
      isFpso,
      basePreset,
      flightOpsMode,
      customOverride
    );
    perModel.push({ id: mId, status: ev.status });
    if (ev.status === 'GO') goCount++;
    else if (ev.status === 'CAUTION') cautionCount++;
    else holdCount++;

    const g = snap.deckWindGustKts ?? snap.windGust10mKts;
    if (g < gustMinKts) gustMinKts = g;
    if (g > gustMaxKts) gustMaxKts = g;
    if (snap.freezingLevelFt < freezeMinFt) freezeMinFt = snap.freezingLevelFt;
    if (snap.freezingLevelFt > freezeMaxFt) freezeMaxFt = snap.freezingLevelFt;
  }

  const totalModels = perModel.length || 5;
  const consensusStatus: 'GO' | 'CAUTION' | 'HOLD' =
    holdCount >= Math.ceil(totalModels / 2)
      ? 'HOLD'
      : holdCount > 0 || cautionCount >= Math.ceil(totalModels / 2)
      ? 'CAUTION'
      : 'GO';

  const agreementCount =
    consensusStatus === 'HOLD'
      ? holdCount
      : consensusStatus === 'CAUTION'
      ? Math.max(cautionCount, totalModels - goCount)
      : goCount;

  const isSplit = goCount > 0 && (holdCount > 0 || cautionCount > 0);
  const dissentingModels = perModel
    .filter((p) => p.status !== consensusStatus)
    .map((p) => `${MODEL_SHORT_LABELS[p.id] || p.id} (${p.status})`);

  const headline = !isSplit
    ? `${agreementCount}/${totalModels} MODELS AGREE ${consensusStatus}`
    : `SPLIT (${goCount} GO · ${cautionCount} CAUT · ${holdCount} HOLD)`;

  return {
    totalModels,
    goCount,
    cautionCount,
    holdCount,
    agreementCount,
    consensusStatus,
    isSplit,
    headline,
    gustMinKts: gustMinKts === 999 ? 0 : gustMinKts,
    gustMaxKts,
    freezeMinFt: freezeMinFt === 99999 ? 0 : freezeMinFt,
    freezeMaxFt,
    dissentingModels,
  };
}

/**
 * Re-computes 7-day daily summaries using dynamic Day/Night limits, FlightOpsMode, and CustomRigOverride.
 */
export function buildContextAwareSevenDaySummaries(
  hours: MultiModelHourEntry[],
  modelId: WeatherModelId,
  basePreset: AirframeLimitPreset,
  isFpso: boolean,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null
): DayFlightWindowSummary[] {
  const byDay = new Map<string, MultiModelHourEntry[]>();
  for (const h of hours) {
    const list = byDay.get(h.dayKey) || [];
    list.push(h);
    byDay.set(h.dayKey, list);
  }

  const summaries: DayFlightWindowSummary[] = [];

  for (const [dayKey, dayHours] of byDay.entries()) {
    // Crew-change windows focus on daylight hours when in daylight_only mode, or 07:00-18:00 UTC operational window
    const daylightHours = dayHours.filter((h) => !h.isNight);
    const daytimeWindow = dayHours.filter((h) => {
      const hrNum = parseInt(h.hourLabel.slice(0, 2), 10);
      return hrNum >= 7 && hrNum <= 18;
    });
    const evalSet =
      flightOpsMode === 'daylight_only' || customOverride?.daylightOnlyDeck
        ? daylightHours.length > 0
          ? daylightHours
          : daytimeWindow.length > 0
          ? daytimeWindow
          : dayHours
        : daytimeWindow.length > 0
        ? daytimeWindow
        : dayHours;

    let maxGustKts = 0;
    let maxWaveM = 0;
    let minCeilingFt = 99999;
    let minFreezingFt = 99999;
    let goCount = 0;
    let cautionCount = 0;
    let holdCount = 0;
    let lightningCount = 0;
    let worstReason = '';

    for (const h of evalSet) {
      const snap = h.models[modelId];
      if (!snap) continue;
      if (snap.lightningRisk === 'MODERATE' || snap.lightningRisk === 'HIGH') {
        lightningCount++;
      }
      const ev = evaluateHourWithLimits(
        snap,
        h.waveHeightM,
        h.swellPeriodSec,
        Boolean(h.isNight),
        isFpso,
        basePreset,
        flightOpsMode,
        customOverride
      );

      const gustReading = snap.deckWindGustKts ?? snap.windGust10mKts;
      if (gustReading > maxGustKts) maxGustKts = gustReading;
      if (h.waveHeightM > maxWaveM) maxWaveM = h.waveHeightM;
      if (snap.cloudCeilingFt < minCeilingFt) minCeilingFt = snap.cloudCeilingFt;
      if (snap.freezingLevelFt < minFreezingFt) minFreezingFt = snap.freezingLevelFt;

      if (ev.status === 'HOLD') {
        holdCount++;
        if (!worstReason || !worstReason.startsWith('NO-GO')) {
          worstReason = ev.reason;
        }
      } else if (ev.status === 'CAUTION') {
        cautionCount++;
        if (!worstReason) worstReason = ev.reason;
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

    const repHour =
      dayHours.find((h) => h.hourLabel.startsWith('11:') && !h.isNight) ||
      daylightHours[Math.floor(daylightHours.length / 2)] ||
      dayHours.find((h) => h.hourLabel.startsWith('11:')) ||
      evalSet[0] ||
      dayHours[0];

    const repConsensus = computeFiveModelConsensus(
      repHour,
      isFpso,
      basePreset,
      flightOpsMode,
      customOverride
    );
    const consensusBadge = repConsensus.isSplit
      ? `Split ${repConsensus.goCount}/${repConsensus.totalModels}`
      : `${repConsensus.agreementCount}/${repConsensus.totalModels}`;

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
      lightningHoursCount: lightningCount,
      hasLightningRisk: lightningCount > 0,
      consensusBadge,
      primaryRiskReason:
        worstReason ||
        `All ${evalSet.length} flight hours within limits (Max Gust ${maxGustKts} kt, Max Wave ${maxWaveM}m)`,
    });
  }

  return summaries;
}

/**
 * Decodes official NOAA/Met Office raw TAF strings into concise plain-English hazard badges.
 */
export function decodeRawTafHighlights(rawTaf?: string): string[] {
  if (!rawTaf || typeof rawTaf !== 'string') return [];
  const clean = rawTaf.trim().toUpperCase();
  const badges: string[] = [];

  const gustMatches = [...clean.matchAll(/\d{3}\d{2}G(\d{2,3})KT/g)];
  if (gustMatches.length > 0) {
    const peakGust = Math.max(...gustMatches.map((m) => parseInt(m[1], 10) || 0));
    if (peakGust >= 35) badges.push(`Peak TAF gusts ${peakGust} kt`);
  }

  const lowCeilingMatches = [...clean.matchAll(/(?:BKN|OVC|VV)(\d{3})/g)];
  const lowCigs = lowCeilingMatches
    .map((m) => (parseInt(m[1], 10) || 99) * 100)
    .filter((ft) => ft <= 1500);
  if (lowCigs.length > 0) {
    badges.push(`Low ceiling forecast down to ${Math.min(...lowCigs)} ft`);
  }

  const visMatches = [...clean.matchAll(/\b(\d{4})\b/g)]
    .map((m) => parseInt(m[1], 10))
    .filter((v) => v > 0 && v <= 5000 && v % 50 === 0);
  if (visMatches.length > 0) {
    const minVis = Math.min(...visMatches);
    badges.push(`Reduced vis ${(minVis / 1000).toFixed(1)} km`);
  }

  if (/\b(FG|FZFG|BR|MIFG)\b/.test(clean)) {
    badges.push('Fog / Mist (FG/BR) in TAF');
  }
  if (/\b(TS|TSRA|VCTS|CB)\b/.test(clean)) {
    badges.push('Thunderstorm / CB risk in TAF');
  }
  if (/\b(SHSN|SN|FZRA|GR|GS)\b/.test(clean)) {
    badges.push('Winter / Hail / Freezing Precip');
  }
  if (clean.includes('TEMPO') || clean.includes('PROB40') || clean.includes('PROB30')) {
    if (badges.length === 0) badges.push('TEMPO/PROB intermittent weather changes');
  }

  return badges;
}

/**
 * Calculates wind-over-deck relative sector for an FPSO or vessel with a known heading.
 */
export function computeWindOverDeckSector(
  windDirDeg: number,
  vesselHeadingDeg: number
): {
  relativeDeg: number;
  sectorLabel: string;
  severity: 'OPTIMAL' | 'CROSSWIND' | 'AFT_TURBULENCE';
} {
  const diff = (((windDirDeg - vesselHeadingDeg) % 360) + 360) % 360;
  const rel = diff > 180 ? diff - 360 : diff;
  const absRel = Math.abs(rel);
  const side = rel >= 0 ? 'Stbd' : 'Port';

  if (absRel <= 40) {
    return {
      relativeDeg: Math.round(rel),
      sectorLabel: `Clean bow wind (${Math.round(absRel)}° ${side})`,
      severity: 'OPTIMAL',
    };
  }
  if (absRel <= 125) {
    return {
      relativeDeg: Math.round(rel),
      sectorLabel: `Beam / quartering wind (${Math.round(absRel)}° ${side})`,
      severity: 'CROSSWIND',
    };
  }
  return {
    relativeDeg: Math.round(rel),
    sectorLabel: `Stern / aft-plume sector (${Math.round(absRel)}° ${side})`,
    severity: 'AFT_TURBULENCE',
  };
}

export function formatCrewOutlookSummary(params: {
  facility: InstallationOrAirport;
  shoreBase: InstallationOrAirport;
  preset: AirframeLimitPreset;
  modelName: string;
  flightOpsMode: FlightOpsMode;
  solarWindow?: SolarDayWindow | null;
  daySummaries: DayFlightWindowSummary[];
  corridorWaypoints: CorridorWaypointProfile[];
  customOverride?: CustomRigOverride | null;
}): string {
  const {
    facility,
    shoreBase,
    preset,
    modelName,
    flightOpsMode,
    solarWindow,
    daySummaries,
    corridorWaypoints,
    customOverride,
  } = params;

  const lines: string[] = [
    `ChopperCheck Outlook — ${facility.name} (${facility.code})`,
    `Limits: ${preset.id} | ${
      flightOpsMode === 'daylight_only' ? 'Daylight Ops Only' : '24h / Day+Night Auto Limits'
    } | Model: ${modelName}`,
  ];

  if (solarWindow && solarWindow.polarStatus === 'normal') {
    lines.push(
      `Daylight (${facility.code}): Sunrise ${solarWindow.sunriseLabel} UTC · Sunset ${solarWindow.sunsetLabel} UTC (CAA Day ${solarWindow.caaDayWindowLabel})`
    );
  }

  if (customOverride && (customOverride.maxGustKts || customOverride.maxWaveM || customOverride.daylightOnlyDeck)) {
    lines.push(
      `Local Deck Restriction Active:${
        customOverride.daylightOnlyDeck ? ' Daylight Only' : ''
      }${customOverride.maxGustKts ? ` Max Gust ${customOverride.maxGustKts}kt` : ''}${
        customOverride.maxWaveM ? ` Max Wave ${customOverride.maxWaveM}m` : ''
      }`
    );
  }

  if (corridorWaypoints.length >= 3) {
    lines.push(
      `Route (${shoreBase.code} → ${facility.code}): Base ${corridorWaypoints[0].status} | Mid ${corridorWaypoints[1].status} (0°C ${corridorWaypoints[1].freezingLevelFt}ft) | Rig ${corridorWaypoints[2].status}`
    );
  }

  lines.push('');
  lines.push('7-Day Window (Model Guidance):');
  for (const d of daySummaries.slice(0, 7)) {
    lines.push(
      `• ${d.dayNameShort} ${d.dateShort}: ${d.overallStatus} (Max ${d.maxGustKts}kt, ${d.maxWaveM}m, ${d.goHoursCount}h GO)`
    );
  }
  lines.push('');
  lines.push('Note: Automated NWP weather guidance only — always verify official HLO & pilot brief.');

  return lines.join('\n');
}

export const SHORE_AIRPORT_RUNWAYS: Record<
  string,
  Array<{ name: string; hdg1: number; hdg2: number }>
> = {
  EGPD: [{ name: '16/34', hdg1: 162, hdg2: 342 }],
  EGPB: [
    { name: '09/27', hdg1: 90, hdg2: 270 },
    { name: '15/33', hdg1: 148, hdg2: 328 },
  ],
  EGSH: [{ name: '09/27', hdg1: 90, hdg2: 270 }],
  EGNJ: [{ name: '02/20', hdg1: 24, hdg2: 204 }],
  EGNH: [
    { name: '10/28', hdg1: 95, hdg2: 275 },
    { name: '13/31', hdg1: 127, hdg2: 307 },
  ],
  EGNS: [
    { name: '08/26', hdg1: 79, hdg2: 259 },
    { name: '03/21', hdg1: 29, hdg2: 209 },
  ],
  EGGP: [{ name: '09/27', hdg1: 86, hdg2: 266 }],
  EGCC: [{ name: '05L/23R', hdg1: 51, hdg2: 231 }],
  EGPK: [
    { name: '12/30', hdg1: 121, hdg2: 301 },
    { name: '02/20', hdg1: 24, hdg2: 204 },
  ],
  EGPE: [
    { name: '05/23', hdg1: 49, hdg2: 229 },
    { name: '11/29', hdg1: 110, hdg2: 290 },
  ],
  EGNV: [{ name: '05/23', hdg1: 48, hdg2: 228 }],
  EGNT: [{ name: '07/25', hdg1: 65, hdg2: 245 }],
  EGAA: [
    { name: '07/25', hdg1: 65, hdg2: 245 },
    { name: '17/35', hdg1: 162, hdg2: 342 },
  ],
  EGAC: [{ name: '04/22', hdg1: 35, hdg2: 215 }],
  EGCK: [
    { name: '07/25', hdg1: 71, hdg2: 251 },
    { name: '02/20', hdg1: 13, hdg2: 193 },
  ],
  EGHQ: [{ name: '12/30', hdg1: 117, hdg2: 297 }],
  EGDX: [{ name: '07/25', hdg1: 70, hdg2: 250 }],
  EGMD: [{ name: '03/21', hdg1: 31, hdg2: 211 }],
  EGHF: [{ name: '05/23', hdg1: 45, hdg2: 225 }],
  EGSM: [{ name: '09/27', hdg1: 93, hdg2: 273 }],
  EGPO: [
    { name: '18/36', hdg1: 178, hdg2: 358 },
    { name: '06/24', hdg1: 64, hdg2: 244 },
  ],
  ENZV: [
    { name: '18/36', hdg1: 180, hdg2: 360 },
    { name: '11/29', hdg1: 108, hdg2: 288 },
  ],
  ENBR: [{ name: '17/35', hdg1: 170, hdg2: 350 }],
  EKVG: [{ name: '12/30', hdg1: 120, hdg2: 300 }],
};

export function computeBestRunwayWind(
  icao: string,
  windDirDeg: number,
  windSpeedKts: number,
  windGustKts: number
): {
  runwayLabel: string;
  headwindKts: number;
  crosswindKts: number;
  gustCrosswindKts: number;
  severity: 'LOW' | 'MODERATE' | 'HIGH';
} | null {
  const rwys = SHORE_AIRPORT_RUNWAYS[icao.toUpperCase()];
  if (!rwys || rwys.length === 0) return null;

  let best: {
    runwayLabel: string;
    headwindKts: number;
    crosswindKts: number;
    gustCrosswindKts: number;
  } | null = null;

  for (const r of rwys) {
    const [n1, n2] = r.name.split('/');
    for (const cand of [
      { label: `RWY ${n1}`, hdg: r.hdg1 },
      { label: `RWY ${n2}`, hdg: r.hdg2 },
    ]) {
      const diffRad = ((windDirDeg - cand.hdg) * Math.PI) / 180;
      const hw = Math.round(windSpeedKts * Math.cos(diffRad));
      const xw = Math.round(Math.abs(windSpeedKts * Math.sin(diffRad)));
      const gxw = Math.round(Math.abs(windGustKts * Math.sin(diffRad)));
      if (!best || hw > best.headwindKts) {
        best = {
          runwayLabel: cand.label,
          headwindKts: hw,
          crosswindKts: xw,
          gustCrosswindKts: gxw,
        };
      }
    }
  }

  if (!best) return null;
  const severity: 'LOW' | 'MODERATE' | 'HIGH' =
    best.gustCrosswindKts >= 30 || best.crosswindKts >= 22
      ? 'HIGH'
      : best.gustCrosswindKts >= 20 || best.crosswindKts >= 15
      ? 'MODERATE'
      : 'LOW';

  return { ...best, severity };
}

const WMO_SEA_STATE_LABELS: Record<number, string> = {
  0: 'Calm (0m)',
  1: 'Calm (0–0.1m)',
  2: 'Smooth (0.1–0.5m)',
  3: 'Slight (0.5–1.25m)',
  4: 'Moderate (1.25–2.5m)',
  5: 'Rough (2.5–4.0m)',
  6: 'Very Rough (4.0–6.0m)',
  7: 'High (6.0–9.0m)',
  8: 'Very High (9.0–14m)',
  9: 'Phenomenal (>14m)',
};

export function parseSeaStateFromMetar(rawOb?: string): {
  seaTempC?: number;
  seaStateCode?: number;
  seaStateLabel?: string;
} {
  if (!rawOb) return {};
  const m = rawOb.toUpperCase().match(/\bW(M?\d{2}|\/{2,3})\/S(\d)\b/);
  if (!m) return {};
  let seaTempC: number | undefined;
  if (!m[1].includes('/')) {
    seaTempC = m[1].startsWith('M') ? -parseInt(m[1].slice(1), 10) : parseInt(m[1], 10);
  }
  const seaStateCode = parseInt(m[2], 10);
  return {
    seaTempC,
    seaStateCode,
    seaStateLabel: WMO_SEA_STATE_LABELS[seaStateCode],
  };
}
