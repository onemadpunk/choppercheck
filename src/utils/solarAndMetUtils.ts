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

/**
 * UK offshore limits that apply to every helicopter type, day and night:
 * - Wind: UK Reg 965/2012 SPA.HOFO.135 — helideck wind "not more than 60 knots including gusts".
 * - Sea state: UK CAA (CAP 1145 / safety directive, 2014) — no flights when significant wave height
 *   is greater than 6 m en route or at the offshore location (or the type's certificated ditching
 *   performance, if lower).
 * - Cloud: AMC1 SPA.HOFO.125 ARA minimum descent height "not lower than 200 ft by day; or 300 ft by night".
 * Individual decks can be more restrictive via the HCA Helideck Limitations List (use the rig override).
 */
export const CAA_MAX_HELIDECK_WIND_KTS = 60;
export const CAA_MAX_SIGNIFICANT_WAVE_HEIGHT_M = 6.0;
export const ARA_MIN_DESCENT_HEIGHT_DAY_FT = 200;
export const ARA_MIN_DESCENT_HEIGHT_NIGHT_FT = 300;

export interface EffectiveOperatingLimits {
  maxHelideckGustKts: number;
  cautionGustKts: number;
  minCloudCeilingFt: number;
  minVisibilityKm: number;
  minIcingFreezingLevelFt: number;
  maxFpsoWaveHeightM: number;
  maxPitchRollDeg: number;
  maxInclinationDeg: number;
  maxShrMs: number;
  isNightApplied: boolean;
  isOverrideApplied: boolean;
  daylightOnlyBlocked: boolean;
}

/**
 * Computes effective operational limits based on:
 * 1) Base airframe preset (S92 / AW189 / H175 / AW139 / H160)
 * 2) Day vs Night phase (AMC1 SPA.HOFO.125 ARA MDH 200ft Day / 300ft Night + HCA HMS Rev 9c night deck motion limits)
 * 3) Optional user-saved local HCA HLL / HeliMet override for this rig/FPSO
 */
export function deriveEffectiveLimits(
  basePreset: AirframeLimitPreset,
  isNight: boolean,
  isFpso: boolean,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null,
  isSemiSub = false
): EffectiveOperatingLimits {
  // Wind (SPA.HOFO.135, 60 kt incl. gusts) and sea state (CAA, 6 m Hs) are the same day and night.
  // Night raises the ARA cloud minimum to 300 ft (AMC1 SPA.HOFO.125) and uses the HCA night
  // deck-motion limits, which differ for semi-submersibles and other Category 1 vessels.
  let maxGust = basePreset.maxHelideckGustKts;
  let cautionGust = isNight ? Math.max(30, basePreset.cautionGustKts - 3) : basePreset.cautionGustKts;
  let minCeil = isNight ? ARA_MIN_DESCENT_HEIGHT_NIGHT_FT : basePreset.minCloudCeilingFt;
  let minVis = isNight ? Number((basePreset.minVisibilityKm + 0.5).toFixed(1)) : basePreset.minVisibilityKm;
  let maxWave = basePreset.maxFpsoWaveHeightM;
  let maxPitchRoll = !isNight
    ? basePreset.maxPitchRollDegDay
    : isSemiSub
    ? basePreset.maxPitchRollDegNightSemiSub
    : basePreset.maxPitchRollDegNight;
  let maxInclination = !isNight
    ? basePreset.maxInclinationDegDay
    : isSemiSub
    ? basePreset.maxInclinationDegNightSemiSub
    : basePreset.maxInclinationDegNight;
  let maxShr = !isNight
    ? basePreset.maxShrMsDay
    : isSemiSub
    ? basePreset.maxShrMsNightSemiSub
    : basePreset.maxShrMsNight;

  let isOverrideApplied = false;
  if (customOverride?.maxGustKts && customOverride.maxGustKts > 0) {
    maxGust = customOverride.maxGustKts;
    cautionGust = Math.min(cautionGust, Math.max(25, maxGust - 10));
    isOverrideApplied = true;
  }
  if (customOverride?.maxWaveM && customOverride.maxWaveM > 0) {
    maxWave = customOverride.maxWaveM;
    isOverrideApplied = true;
  }
  if (customOverride?.minCeilingFt && customOverride.minCeilingFt > 0) {
    minCeil = customOverride.minCeilingFt;
    isOverrideApplied = true;
  }
  if (customOverride?.maxPitchRollDeg && customOverride.maxPitchRollDeg > 0) {
    maxPitchRoll = customOverride.maxPitchRollDeg;
    isOverrideApplied = true;
  }
  if (customOverride?.maxInclinationDeg && customOverride.maxInclinationDeg > 0) {
    maxInclination = customOverride.maxInclinationDeg;
    isOverrideApplied = true;
  }
  if (customOverride?.maxShrMs && customOverride.maxShrMs > 0) {
    maxShr = customOverride.maxShrMs;
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
    maxPitchRollDeg: maxPitchRoll,
    maxInclinationDeg: maxInclination,
    maxShrMs: maxShr,
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

export interface EstimatedFpsoDeckMotion {
  estPitchRollDeg: number;
  estInclinationDeg: number;
  estShrMs: number;
  encounterAngleDeg: number;
  periodFactor: number;
  deckLightStatus: 'GREEN' | 'AMBER' | 'RED';
  summaryLabel: string;
}

/**
 * Rough rule-of-thumb estimate of floating helideck motion (pitch/roll ±°, inclination °, and
 * significant heave rate m/s) from forecast wave height (Hs), swell height, swell period and the
 * swell's angle to the vessel heading.
 *
 * The multipliers are generic tuning factors, not a real response model for any vessel: actual
 * motion depends on each hull, its loading and mooring, and is measured by the vessel's own
 * helideck monitoring system (HMS). Semi-subs use the same factors, which will over- or
 * under-state their motion. Treat the result as a hint only.
 */
export function computeEstimatedFpsoDeckMotion(params: {
  waveHeightM: number;
  swellPeriodSec: number;
  swellWaveHeightM?: number;
  swellWavePeriodSec?: number;
  swellDirDeg?: number;
  windDirDeg?: number;
  vesselHeadingDeg?: number;
  maxPitchRollLimit?: number;
  maxInclinationLimit?: number;
  maxShrLimit?: number;
}): EstimatedFpsoDeckMotion {
  const hs = Math.max(0, params.waveHeightM || 0);
  const swellH = Math.max(0, params.swellWaveHeightM ?? hs * 0.8);
  const tp = Math.max(4, params.swellWavePeriodSec || params.swellPeriodSec || 7.5);
  // Effective excitation wave height combines total Hs with long-period swell energy
  const hEff = hs * 0.72 + swellH * 0.28;

  // Hull RAO resonance factor (250-270m FPSO filters short <7s chop, resonates in >=10-14s Atlantic swell)
  let periodFactor = 0.75;
  if (tp >= 13.0) {
    periodFactor = 1.38;
  } else if (tp >= 11.0) {
    periodFactor = 1.22;
  } else if (tp >= 9.5) {
    periodFactor = 1.05;
  } else if (tp >= 8.0) {
    periodFactor = 0.9;
  }

  // Relative swell encounter angle: use locked FPSO heading if provided, else turret weathervaning (~windDirDeg)
  const refHeading =
    typeof params.vesselHeadingDeg === 'number' && Number.isFinite(params.vesselHeadingDeg)
      ? params.vesselHeadingDeg
      : typeof params.windDirDeg === 'number' && Number.isFinite(params.windDirDeg)
      ? params.windDirDeg
      : params.swellDirDeg ?? 0;
  const swellDir =
    typeof params.swellDirDeg === 'number' && Number.isFinite(params.swellDirDeg)
      ? params.swellDirDeg
      : refHeading;
  const rawDiff = Math.abs(((swellDir - refHeading + 540) % 360) - 180);
  // Turret-moored FPSO typically aligns within 0-90° of dominant wind/wave
  const encounterAngleDeg = Math.round(Math.min(90, rawDiff));
  const beamSwellFactor = 1 + 0.32 * Math.sin((encounterAngleDeg * Math.PI) / 180);

  const estPitchRollDeg = Number(
    Math.min(6.0, 0.43 * hEff * periodFactor * beamSwellFactor).toFixed(1)
  );
  const estInclinationDeg = Number(
    Math.min(6.8, estPitchRollDeg * 1.15 + (hEff > 0.3 ? 0.1 : 0)).toFixed(1)
  );
  const estShrMs = Number(
    Math.min(2.5, 0.2 * hEff * periodFactor * (1 + 0.15 * Math.sin((encounterAngleDeg * Math.PI) / 180))).toFixed(2)
  );

  const maxPR = params.maxPitchRollLimit ?? 3.0;
  const maxInc = params.maxInclinationLimit ?? 3.5;
  const maxShr = params.maxShrLimit ?? 1.3;

  const prRatio = estPitchRollDeg / maxPR;
  const incRatio = estInclinationDeg / maxInc;
  const shrRatio = estShrMs / maxShr;
  const peakRatio = Math.max(prRatio, incRatio, shrRatio);

  const deckLightStatus: 'GREEN' | 'AMBER' | 'RED' =
    peakRatio > 1.0 ? 'RED' : peakRatio >= 0.78 ? 'AMBER' : 'GREEN';

  const summaryLabel =
    deckLightStatus === 'RED'
      ? 'ESTIMATE: deck motion may exceed limits'
      : deckLightStatus === 'AMBER'
      ? 'ESTIMATE: deck motion near limits'
      : 'ESTIMATE: deck motion within limits';

  return {
    estPitchRollDeg,
    estInclinationDeg,
    estShrMs,
    encounterAngleDeg,
    periodFactor,
    deckLightStatus,
    summaryLabel,
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
    missingData?: string[];
  },
  /** null = no sea data or not applicable (shore base); sea-state checks are then skipped. */
  waveHeightM: number | null,
  swellPeriodSec: number | null,
  isNight: boolean,
  isFpso: boolean,
  basePreset: AirframeLimitPreset,
  flightOpsMode: FlightOpsMode,
  customOverride?: CustomRigOverride | null,
  isSemiSub = false
): { status: 'GO' | 'CAUTION' | 'HOLD'; reason: string; limits: EffectiveOperatingLimits } {
  const limits = deriveEffectiveLimits(basePreset, isNight, isFpso, flightOpsMode, customOverride, isSemiSub);
  const phaseLabel = isNight ? 'NIGHT' : 'DAY';
  const effWind = snap.deckWindSpeedKts ?? snap.windSpeed10mKts;
  const effGust = snap.deckWindGustKts ?? snap.windGust10mKts;
  const hasWave = typeof waveHeightM === 'number' && Number.isFinite(waveHeightM);
  const wave = hasWave ? (waveHeightM as number) : 0;
  const waveTxt = hasWave ? `Wave ${waveHeightM}m` : 'no sea data';

  if (limits.daylightOnlyBlocked) {
    const why = customOverride?.daylightOnlyDeck
      ? 'Deck set to Daylight Only (local restriction)'
      : 'Outside Daylight Crew-Change Window (CAA Night)';
    return {
      status: 'HOLD',
      reason: `NIGHT HOLD: ${why} · Gusts ${effGust}kt, ${waveTxt}`,
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
        : 'Triggered-Lightning Conditions (Met Office criteria: −6 to −1°C at 2–3,000 ft, freezing level 1–4,500 ft, heavy showers)';
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
  if (hasWave && wave > limits.maxFpsoWaveHeightM) {
    return {
      status: 'HOLD',
      reason: `NO-GO (${phaseLabel} Sea State): Wave Hs ${wave}m exceeds ${limits.maxFpsoWaveHeightM}m CAA sea state limit`,
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

  const longPeriodSwellCaution = isFpso && hasWave && (swellPeriodSec ?? 0) >= 10.0 && wave >= 2.5;
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
    (hasWave && wave >= limits.maxFpsoWaveHeightM - 1.2)
  ) {
    if (snap.lightningRisk === 'MODERATE') {
      const ltLabel =
        snap.lightningType === 'TRIGGERED_WINTER'
          ? 'TRIGGERED-LIGHTNING CAUTION: flight-level temperature (−6 to 0°C at 2–3,000 ft) and freezing level in the risk band, with showers at the “Low” level'
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
        reason: `FPSO SWELL PERIOD CAUTION: ${wave}m @ ${swellPeriodSec}s long Atlantic swell (Pitch/Roll risk)`,
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
    if (isFpso && hasWave && wave >= limits.maxFpsoWaveHeightM - 1.2) {
      return {
        status: 'CAUTION',
        reason: `FPSO MOTION CAUTION (${phaseLabel}): Wave Hs ${wave}m near ${limits.maxFpsoWaveHeightM}m limit`,
        limits,
      };
    }
    return {
      status: 'CAUTION',
      reason: `CAUTION (${phaseLabel}): Gusts ${effGust} kt · Ceiling ${snap.cloudCeilingFt.toLocaleString()} ft · ${waveTxt}`,
      limits,
    };
  }

  if (snap.missingData && snap.missingData.length > 0) {
    return {
      status: 'CAUTION',
      reason: `NO DATA: the forecast has no ${snap.missingData.join(', ')} for this hour, so it is not counted as good to fly`,
      limits,
    };
  }

  return {
    status: 'GO',
    reason: `GO (${basePreset.id} ${phaseLabel} Limits) — Deck gusts ${effGust} kt · ${waveTxt} · 0°C ${snap.freezingLevelFt.toLocaleString()} ft`,
    limits,
  };
}

/**
 * The status the app shows for one hour at one facility: the limit check plus the wave-derived
 * deck motion estimate on FPSOs and semi-subs. A red deck estimate turns GO into CAUTION (never
 * HOLD, because it is only an estimate). The map card and the weather panel both use this, so
 * they always agree.
 */
export function evaluateFacilityHour(params: {
  snap: Parameters<typeof evaluateHourWithLimits>[0] & { windDir10mDeg?: number };
  hour: Pick<
    MultiModelHourEntry,
    'waveHeightM' | 'swellPeriodSec' | 'swellWaveHeightM' | 'swellWavePeriodSec' | 'swellDirDeg'
  >;
  isNight: boolean;
  isFpso: boolean;
  isSemiSub: boolean;
  preset: AirframeLimitPreset;
  flightOpsMode: FlightOpsMode;
  customOverride?: CustomRigOverride | null;
}): {
  status: 'GO' | 'CAUTION' | 'HOLD';
  reason: string;
  limits: EffectiveOperatingLimits;
  deckMotion: EstimatedFpsoDeckMotion | null;
  deckMotionRaisesCaution: boolean;
} {
  const { snap, hour, isNight, isFpso, isSemiSub, preset, flightOpsMode, customOverride } = params;
  const ev = evaluateHourWithLimits(
    snap,
    hour.waveHeightM,
    hour.swellPeriodSec,
    isNight,
    isFpso,
    preset,
    flightOpsMode,
    customOverride,
    isSemiSub
  );
  const deckMotion =
    isFpso && hour.waveHeightM !== null
      ? computeEstimatedFpsoDeckMotion({
          waveHeightM: hour.waveHeightM,
          swellPeriodSec: hour.swellPeriodSec ?? 0,
          swellWaveHeightM: hour.swellWaveHeightM,
          swellWavePeriodSec: hour.swellWavePeriodSec,
          swellDirDeg: hour.swellDirDeg ?? undefined,
          windDirDeg: snap.windDir10mDeg,
          vesselHeadingDeg: customOverride?.vesselHeadingDeg,
          maxPitchRollLimit: ev.limits.maxPitchRollDeg,
          maxInclinationLimit: ev.limits.maxInclinationDeg,
          maxShrLimit: ev.limits.maxShrMs,
        })
      : null;
  const deckMotionRaisesCaution = ev.status === 'GO' && deckMotion?.deckLightStatus === 'RED';
  return {
    status: deckMotionRaisesCaution ? 'CAUTION' : ev.status,
    reason: deckMotionRaisesCaution
      ? `DECK MOTION CAUTION (estimate): wave-derived pitch/roll/heave may exceed the ${
          isSemiSub ? 'semi-sub' : 'FPSO'
        } limits. Check the live HMS deck status.`
      : ev.reason,
    limits: ev.limits,
    deckMotion,
    deckMotionRaisesCaution,
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
  customOverride?: CustomRigOverride | null,
  isSemiSub = false
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
  const noDataModels: string[] = [];

  for (const mId of modelIds) {
    const snap = hourEntry.models[mId];
    if (!snap) continue;
    // A model with gaps for this hour does not get a vote
    if (snap.missingData && snap.missingData.length > 0) {
      noDataModels.push(MODEL_SHORT_LABELS[mId] || mId);
      continue;
    }
    const ev = evaluateHourWithLimits(
      snap,
      hourEntry.waveHeightM,
      hourEntry.swellPeriodSec,
      Boolean(hourEntry.isNight),
      isFpso,
      basePreset,
      flightOpsMode,
      customOverride,
      isSemiSub
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

  const totalModels = perModel.length;
  if (totalModels === 0) {
    return {
      totalModels: 0,
      goCount: 0,
      cautionCount: 0,
      holdCount: 0,
      agreementCount: 0,
      consensusStatus: 'CAUTION',
      isSplit: false,
      headline: 'NO COMPLETE MODEL DATA FOR THIS HOUR',
      gustMinKts: 0,
      gustMaxKts: 0,
      freezeMinFt: 0,
      freezeMaxFt: 0,
      dissentingModels: [],
      noDataModels,
    };
  }
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
      ? cautionCount
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
    noDataModels,
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
    let maxWaveM: number | null = null;
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
      if (h.waveHeightM !== null && (maxWaveM === null || h.waveHeightM > maxWaveM)) maxWaveM = h.waveHeightM;
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
      `• ${d.dayNameShort} ${d.dateShort}: ${d.overallStatus} (Max ${d.maxGustKts}kt, ${d.maxWaveM === null ? "no sea data" : `${d.maxWaveM}m`}, ${d.goHoursCount}h GO)`
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

export interface MetarCloudBase {
  /** Lowest BKN/OVC layer or vertical visibility (VV) in ft above the airfield; null when none is reported. */
  ceilingFt: number | null;
  /** Lowest reported cloud layer of any amount (FEW/SCT/BKN/OVC) in ft, or null. */
  lowestLayerFt: number | null;
  /** The METAR group that sets the ceiling, e.g. "BKN008". */
  ceilingGroup: string | null;
  /** True when the report says there is no ceiling (CAVOK, NSC, NCD, SKC, CLR, or only FEW/SCT). */
  noCeiling: boolean;
}

/**
 * Reads the reported cloud base from a raw METAR. A ceiling is the lowest broken (BKN) or
 * overcast (OVC) layer, or the vertical visibility (VV) in fog. Heights in METARs are in
 * hundreds of feet above the airfield. Returns null when the METAR is missing or unreadable.
 */
export function parseMetarCloudBase(rawOb?: string | null): MetarCloudBase | null {
  if (!rawOb || typeof rawOb !== 'string') return null;
  // Ignore trend / remarks so a forecast group like "BECMG BKN005" is not read as observed
  const body = ` ${rawOb.toUpperCase().split(/\s(?:TEMPO|BECMG|NOSIG|RMK)\b/)[0]} `;
  const layers = [...body.matchAll(/\s(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(?:CB|TCU|\/\/\/)?(?=\s)/g)];
  const parsed = layers
    .filter((m) => /\d{3}/.test(m[2]))
    .map((m) => ({ amount: m[1], heightFt: parseInt(m[2], 10) * 100, group: `${m[1]}${m[2]}` }));
  const ceilingLayer = parsed
    .filter((l) => l.amount === 'BKN' || l.amount === 'OVC' || l.amount === 'VV')
    .sort((a, b) => a.heightFt - b.heightFt)[0];
  const lowest = [...parsed].sort((a, b) => a.heightFt - b.heightFt)[0];
  const saysNoCloud = /\s(CAVOK|NSC|NCD|SKC|CLR)\s/.test(body);
  if (!ceilingLayer && !saysNoCloud && parsed.length === 0) return null;
  return {
    ceilingFt: ceilingLayer ? ceilingLayer.heightFt : null,
    lowestLayerFt: lowest ? lowest.heightFt : null,
    ceilingGroup: ceilingLayer ? ceilingLayer.group : null,
    noCeiling: !ceilingLayer,
  };
}

/** Value used for "no ceiling reported" when a number is needed for limit checks. */
export const NO_CEILING_FT = 5000;

export interface MetarWindVis {
  windDirDeg: number | null; // null for variable (VRB)
  windSpeedKts: number | null;
  windGustKts: number | null;
  visibilityKm: number | null;
}

/**
 * Reads the reported surface wind (KT or MPS) and prevailing visibility from a raw METAR.
 * CAVOK and 9999 mean 10 km or more and are returned as 10.
 */
export function parseMetarWindVis(rawOb?: string | null): MetarWindVis | null {
  if (!rawOb || typeof rawOb !== 'string') return null;
  const body = ` ${rawOb.toUpperCase().split(/\s(?:TEMPO|BECMG|NOSIG|RMK)\b/)[0]} `;
  let windDirDeg: number | null = null;
  let windSpeedKts: number | null = null;
  let windGustKts: number | null = null;
  const w = body.match(/\s(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)\s/);
  if (w) {
    const factor = w[4] === 'MPS' ? 1.94384 : 1;
    windDirDeg = w[1] === 'VRB' ? null : parseInt(w[1], 10);
    windSpeedKts = Math.round(parseInt(w[2], 10) * factor);
    windGustKts = w[3] ? Math.round(parseInt(w[3], 10) * factor) : null;
  }
  let visibilityKm: number | null = null;
  if (/\sCAVOK\s/.test(body)) {
    visibilityKm = 10;
  } else {
    // Prevailing visibility in metres follows the wind group (and optional variable-direction group)
    const v = body.match(/(?:KT|MPS)\s(?:\d{3}V\d{3}\s)?(\d{4})(?:NDV)?\s/);
    if (v) visibilityKm = v[1] === '9999' ? 10 : Number((parseInt(v[1], 10) / 1000).toFixed(1));
  }
  if (windSpeedKts === null && visibilityKm === null) return null;
  return { windDirDeg, windSpeedKts, windGustKts, visibilityKm };
}
