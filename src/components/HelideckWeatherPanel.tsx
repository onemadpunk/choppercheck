import React, { useEffect, useMemo, useState } from 'react';
import {
  AircraftTarget,
  AirframePresetId,
  CorridorWaypointProfile,
  CustomRigOverride,
  FlightOpsMode,
  HelideckWeatherState,
  InstallationOrAirport,
  MultiModelHourEntry,
  NearbyStationMetar,
  WeatherModelId,
  WeatherOverlayMode,
} from '../types/radar';
import {
  AIRFRAME_PRESETS,
  WEATHER_MODELS_META,
  fetchNearbyOffshoreOrUpwindMetars,
  applyReportedCeilingToWaypoint,
} from '../services/multiModelWeatherService';
import { calculateBearingDeg, calculateDistanceNm } from '../data/aircraftDecoder';
import {
  buildContextAwareSevenDaySummaries,
  computeBestRunwayWind,
  computeEstimatedFpsoDeckMotion,
  computeFiveModelConsensus,
  computeSolarTimesUtc,
  computeWindOverDeckSector,
  decodeRawTafHighlights,
  evaluateFpsoSwellRisk,
  deriveEffectiveLimits,
  evaluateHourWithLimits,
  parseMetarCloudBase,
  NO_CEILING_FT,
  formatCrewOutlookSummary,
} from '../utils/solarAndMetUtils';
import {
  AlertTriangle,
  Calendar,
  Check,
  CheckCircle2,
  CloudFog,
  CloudLightning,
  CloudRainWind,
  Compass,
  Copy,
  Layers,
  Maximize2,
  Minimize2,
  Moon,
  Navigation,
  Plane,
  Radio,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Snowflake,
  Sun,
  Waves,
  Wind,
} from 'lucide-react';

interface HelideckWeatherPanelProps {
  facility: InstallationOrAirport;
  shoreBaseFacility: InstallationOrAirport;
  availableShoreBases: InstallationOrAirport[];
  onChangeShoreBaseCode: (code: string) => void;
  weather: HelideckWeatherState | null;
  loading: boolean;
  onRefresh: () => void;
  airframePresetId: AirframePresetId;
  onChangeAirframePresetId: (id: AirframePresetId) => void;
  weatherModelId: WeatherModelId;
  onChangeWeatherModelId: (id: WeatherModelId) => void;
  weatherOverlayMode: WeatherOverlayMode;
  onChangeWeatherOverlayMode: (mode: WeatherOverlayMode) => void;
  onSwitchToMapWithOverlay: (mode: WeatherOverlayMode) => void;
  hourlyForecast: MultiModelHourEntry[];
  selectedHourIdx: number;
  onChangeSelectedHourIdx: (idx: number) => void;
  corridorWaypoints: CorridorWaypointProfile[];
  ensembleLoading: boolean;
  flightOpsMode: FlightOpsMode;
  onChangeFlightOpsMode: (mode: FlightOpsMode) => void;
  customOverride?: CustomRigOverride | null;
  onChangeCustomOverride: (override: CustomRigOverride | null) => void;
  flights?: AircraftTarget[];
  cachedForecastSavedAt?: string | null;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
  viewMode?: 'simple' | 'detailed';
  onChangeViewMode?: (mode: 'simple' | 'detailed') => void;
}

export const HelideckWeatherPanel: React.FC<HelideckWeatherPanelProps> = ({
  facility,
  shoreBaseFacility,
  availableShoreBases,
  onChangeShoreBaseCode,
  weather,
  loading,
  onRefresh,
  airframePresetId,
  onChangeAirframePresetId,
  weatherModelId,
  onChangeWeatherModelId,
  weatherOverlayMode,
  onChangeWeatherOverlayMode,
  onSwitchToMapWithOverlay,
  hourlyForecast,
  selectedHourIdx,
  onChangeSelectedHourIdx,
  corridorWaypoints: corridorWaypointsModel,
  ensembleLoading,
  flightOpsMode,
  onChangeFlightOpsMode,
  customOverride,
  onChangeCustomOverride,
  flights = [],
  cachedForecastSavedAt = null,
  isFullScreen = false,
  onToggleFullScreen,
  viewMode: externalViewMode,
  onChangeViewMode: externalOnChangeViewMode,
}) => {
  const [copiedOutlook, setCopiedOutlook] = useState(false);
  const [copiedRigLink, setCopiedRigLink] = useState(false);
  const [showRestrictionsEditor, setShowRestrictionsEditor] = useState(false);
  const [nearbyMetars, setNearbyMetars] = useState<NearbyStationMetar[]>([]);
  const [internalViewMode, setInternalViewMode] = useState<'simple' | 'detailed'>(() => {
    try {
      return localStorage.getItem('choppercheck_wx_view_mode') === 'detailed'
        ? 'detailed'
        : 'simple';
    } catch {
      return 'simple';
    }
  });

  const viewMode = externalViewMode ?? internalViewMode;

  const handleSetViewMode = (mode: 'simple' | 'detailed') => {
    setInternalViewMode(mode);
    if (externalOnChangeViewMode) {
      externalOnChangeViewMode(mode);
    }
    try {
      localStorage.setItem('choppercheck_wx_view_mode', mode);
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    let cancelled = false;
    setNearbyMetars([]);
    fetchNearbyOffshoreOrUpwindMetars(facility, shoreBaseFacility.code)
      .then((stations) => {
        if (!cancelled) setNearbyMetars(stations);
      })
      .catch(() => {
        if (!cancelled) setNearbyMetars([]);
      });
    return () => {
      cancelled = true;
    };
  }, [facility, shoreBaseFacility.code]);

  const preset = AIRFRAME_PRESETS[airframePresetId];
  const isFpso = facility.assetType === 'FPSO' || facility.assetType === 'Semi-Sub';
  const isSemiSub = facility.assetType === 'Semi-Sub';

  // Compute 7-Day Crew-Change Flight Window Summaries using dynamic Day/Night limits & overrides
  const daySummaries = useMemo(
    () =>
      buildContextAwareSevenDaySummaries(
        hourlyForecast,
        weatherModelId,
        preset,
        isFpso,
        flightOpsMode,
        customOverride
      ),
    [hourlyForecast, weatherModelId, preset, isFpso, flightOpsMode, customOverride]
  );

  const activeHour = hourlyForecast[selectedHourIdx] || hourlyForecast[0];
  const activeDayKey = activeHour?.dayKey || daySummaries[0]?.dayKey || '';

  const activeDayHours = useMemo(
    () => hourlyForecast.filter((h) => h.dayKey === activeDayKey),
    [hourlyForecast, activeDayKey]
  );

  const activeDaySummary = useMemo(
    () => daySummaries.find((d) => d.dayKey === activeDayKey) || daySummaries[0],
    [daySummaries, activeDayKey]
  );

  // Astronomical daylight window at this rig's lat/lon for the selected day
  const solarWindow = useMemo(() => {
    const refDate = activeHour ? new Date(activeHour.hourIso + 'Z') : new Date();
    return computeSolarTimesUtc(facility.lat, facility.lon, refDate);
  }, [facility.lat, facility.lon, activeHour]);

  const isNightHour = Boolean(activeHour?.isNight);

  // Reported cloud base from the airport METAR. Only used for the hour that is happening now and
  // only while the report is under 90 minutes old; forecast hours and offshore points stay model estimates.
  const isCurrentHour = (() => {
    if (!activeHour?.hourIso) return false;
    const startMs = new Date(activeHour.hourIso + 'Z').getTime();
    const nowMs = Date.now();
    return Number.isFinite(startMs) && nowMs >= startMs && nowMs < startMs + 3600_000;
  })();
  const metarIsFresh =
    typeof weather?.metarTime === 'number' && Date.now() - weather.metarTime <= 90 * 60_000;
  const reportedCloud = useMemo(
    () => (isCurrentHour && metarIsFresh ? parseMetarCloudBase(weather?.rawMetar) : null),
    [isCurrentHour, metarIsFresh, weather?.rawMetar]
  );
  const reportedCeilingFt = reportedCloud
    ? reportedCloud.ceilingFt ?? NO_CEILING_FT
    : null;
  const metarStation = weather?.shoreBaseIcao || '';
  // The facility itself is the airport that issued the METAR (e.g. viewing Aberdeen or Sumburgh)
  const facilityHasReportedCeiling = reportedCeilingFt !== null && metarStation === facility.code;

  const modelSnapshot = activeHour?.models[weatherModelId];
  const activeModelSnapshot = useMemo(
    () =>
      modelSnapshot && facilityHasReportedCeiling && reportedCeilingFt !== null
        ? { ...modelSnapshot, cloudCeilingFt: reportedCeilingFt }
        : modelSnapshot,
    [modelSnapshot, facilityHasReportedCeiling, reportedCeilingFt]
  );

  // Shore base leg of the route: use the reported ceiling when the METAR is from that airport
  const corridorWaypoints = useMemo(() => {
    if (
      reportedCeilingFt === null ||
      corridorWaypointsModel.length === 0 ||
      metarStation !== shoreBaseFacility.code
    ) {
      return corridorWaypointsModel;
    }
    return [
      applyReportedCeilingToWaypoint(corridorWaypointsModel[0], reportedCeilingFt, metarStation, preset),
      ...corridorWaypointsModel.slice(1),
    ];
  }, [corridorWaypointsModel, reportedCeilingFt, metarStation, shoreBaseFacility.code, preset]);

  const evaluatedActive = useMemo(() => {
    if (!activeModelSnapshot || !activeHour) return null;
    return evaluateHourWithLimits(
      activeModelSnapshot,
      activeHour.waveHeightM,
      activeHour.swellPeriodSec,
      isNightHour,
      isFpso,
      preset,
      flightOpsMode,
      customOverride,
      isSemiSub
    );
  }, [
    isSemiSub,
    activeModelSnapshot,
    activeHour,
    isNightHour,
    isFpso,
    preset,
    flightOpsMode,
    customOverride,
  ]);

  const fiveModelConsensus = useMemo(() => {
    if (!activeHour) return null;
    return computeFiveModelConsensus(
      activeHour,
      isFpso,
      preset,
      flightOpsMode,
      customOverride,
      isSemiSub
    );
  }, [activeHour, isFpso, preset, flightOpsMode, customOverride, isSemiSub]);

  const inboundHelis = useMemo(() => {
    if (!flights || flights.length === 0) return [];
    return flights
      .filter((f) => f.isRotary && f.speedReported && f.groundSpeedKts >= 30)
      .map((f) => {
        const distNm = calculateDistanceNm(f.lat, f.lon, facility.lat, facility.lon);
        const brgToRig = calculateBearingDeg(f.lat, f.lon, facility.lat, facility.lon);
        const headingDiff = Math.abs(((f.trackDeg - brgToRig + 540) % 360) - 180);
        const etaMin = Math.max(1, Math.round((distNm / f.groundSpeedKts) * 60));
        return { flight: f, distNm, headingDiff, etaMin };
      })
      .filter((x) => x.distNm <= 40 && x.headingDiff <= 50)
      .sort((a, b) => a.distNm - b.distNm)
      .slice(0, 3);
  }, [flights, facility.lat, facility.lon]);

  const tafHighlights = useMemo(
    () => decodeRawTafHighlights(weather?.rawTaf),
    [weather?.rawTaf]
  );

  if (!weather && hourlyForecast.length === 0) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm">
        Loading 7-day multi-model (UKV · ICON · ECMWF · GFS · GEM), marine & METAR/TAF telemetry for{' '}
        {facility.name}...
      </div>
    );
  }

  const effLimits = evaluatedActive?.limits;
  const delayColor =
    weather?.delayRiskLevel === 'HIGH'
      ? 'border-rose-500/50 bg-rose-950/25 text-rose-300'
      : weather?.delayRiskLevel === 'MODERATE'
      ? 'border-amber-500/50 bg-amber-950/25 text-amber-300'
      : 'border-cyan-500/30 bg-slate-900/90 text-slate-200';

  const maxGustLimit = effLimits?.maxHelideckGustKts ?? preset.maxHelideckGustKts;
  const cautionGustLimit = effLimits?.cautionGustKts ?? preset.cautionGustKts;
  const minCeilLimit = effLimits?.minCloudCeilingFt ?? preset.minCloudCeilingFt;
  const minVisLimit = effLimits?.minVisibilityKm ?? preset.minVisibilityKm;
  const maxWaveLimit = effLimits?.maxFpsoWaveHeightM ?? preset.maxFpsoWaveHeightM;
  const fallbackLimits = deriveEffectiveLimits(
    preset,
    isNightHour,
    isFpso,
    flightOpsMode,
    customOverride,
    isSemiSub
  );
  const maxPitchRollLimit = effLimits?.maxPitchRollDeg ?? fallbackLimits.maxPitchRollDeg;
  const maxInclinationLimit = effLimits?.maxInclinationDeg ?? fallbackLimits.maxInclinationDeg;
  const maxShrLimit = effLimits?.maxShrMs ?? fallbackLimits.maxShrMs;

  const deckWindVal =
    activeModelSnapshot?.deckWindSpeedKts ??
    activeModelSnapshot?.windSpeed10mKts ??
    weather?.windSpeedKts ??
    0;
  const gustVal =
    activeModelSnapshot?.deckWindGustKts ??
    activeModelSnapshot?.windGust10mKts ??
    weather?.windGustKts ??
    0;
  const approachShearKts = activeModelSnapshot?.approachShearKts ?? 0;
  const gustStatus =
    Math.max(gustVal, deckWindVal) > maxGustLimit
      ? 'HOLD'
      : gustVal >= cautionGustLimit || approachShearKts >= 20
      ? 'CAUTION'
      : 'GO';

  const waveVal = activeHour?.waveHeightM ?? weather?.significantWaveHeightM ?? 0;
  const wavePeriodVal = activeHour?.swellPeriodSec ?? weather?.swellPeriodSec ?? 7;
  // FPSO Wind-Over-Deck Sector if heading saved
  const windDirNow = activeModelSnapshot?.windDir10mDeg ?? weather?.windDirectionDeg ?? 230;
  const windOverDeck =
    isFpso && typeof customOverride?.vesselHeadingDeg === 'number'
      ? computeWindOverDeckSector(windDirNow, customOverride.vesselHeadingDeg)
      : null;

  const fpsoMotionEstimate = (() => {
    if (!isFpso) return null;
    return computeEstimatedFpsoDeckMotion({
      waveHeightM: waveVal,
      swellPeriodSec: wavePeriodVal,
      swellWaveHeightM: activeHour?.swellWaveHeightM,
      swellWavePeriodSec: activeHour?.swellWavePeriodSec,
      swellDirDeg: activeHour?.swellDirDeg,
      windDirDeg: windDirNow,
      vesselHeadingDeg: customOverride?.vesselHeadingDeg,
      maxPitchRollLimit,
      maxInclinationLimit,
      maxShrLimit,
    });
  })();

  // The wave-derived deck motion estimate feeds the verdict: if it says the deck may move more than
  // the limits, a GO becomes CAUTION. It never makes a HOLD on its own because it is only an estimate;
  // the vessel's live helideck monitoring system (HMS) decides.
  const baseStatus: 'GO' | 'CAUTION' | 'HOLD' =
    evaluatedActive?.status ||
    activeModelSnapshot?.status ||
    (!weather || weather.cap437Status === 'UNAVAILABLE' ? 'GO' : weather.cap437Status);
  const baseReason =
    evaluatedActive?.reason ||
    activeModelSnapshot?.statusReason ||
    weather?.cap437Reason ||
    '7-Day Multi-Model Offshore Operating Limits Active';
  const deckMotionRaisesCaution =
    isFpso && fpsoMotionEstimate?.deckLightStatus === 'RED' && baseStatus === 'GO';
  const currentStatus: 'GO' | 'CAUTION' | 'HOLD' = deckMotionRaisesCaution ? 'CAUTION' : baseStatus;
  const currentReason = deckMotionRaisesCaution
    ? `DECK MOTION CAUTION (estimate): wave-derived pitch/roll/heave may exceed the ${isSemiSub ? 'semi-sub' : 'FPSO'} limits. Check the live HMS deck status.`
    : baseReason;

  const statusColor =
    currentStatus === 'GO'
      ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20'
      : currentStatus === 'CAUTION'
      ? 'text-amber-400 border-amber-500/40 bg-amber-950/20'
      : 'text-rose-400 border-rose-500/50 bg-rose-950/30';

  const swellRisk = evaluateFpsoSwellRisk(
    waveVal,
    wavePeriodVal,
    activeHour?.swellWaveHeightM,
    activeHour?.swellWavePeriodSec,
    isFpso
  );
  const longSwellRisk = swellRisk.isResonantSwell;
  const waveStatus =
    waveVal > maxWaveLimit
      ? 'HOLD'
      : waveVal >= maxWaveLimit - 1.2 || longSwellRisk
      ? 'CAUTION'
      : 'GO';

  const ceilVal = activeModelSnapshot?.cloudCeilingFt ?? 2200;
  // Nearest airport/platform METAR that reports cloud, shown beside the offshore model estimate
  const nearestReportedCloud = (() => {
    if (!isCurrentHour) return null;
    const candidates: Array<{ icao: string; distanceNm: number; rawOb?: string; obsTimeMs?: number | null }> = [
      ...nearbyMetars.map((st) => ({ icao: st.icao, distanceNm: st.distanceNm, rawOb: st.rawOb, obsTimeMs: st.obsTimeMs })),
    ];
    if (weather?.rawMetar && metarStation) {
      const stn = shoreBaseFacility.code === metarStation ? shoreBaseFacility : null;
      const distanceNm = stn ? Math.round(calculateDistanceNm(facility.lat, facility.lon, stn.lat, stn.lon)) : null;
      if (distanceNm !== null) {
        candidates.push({ icao: metarStation, distanceNm, rawOb: weather.rawMetar, obsTimeMs: weather.metarTime });
      }
    }
    return (
      candidates
        .filter((c) => typeof c.obsTimeMs !== 'number' || Date.now() - c.obsTimeMs <= 90 * 60_000)
        .map((c) => ({ ...c, cloud: parseMetarCloudBase(c.rawOb) }))
        .filter((c): c is typeof c & { cloud: NonNullable<typeof c.cloud> } => c.cloud !== null)
        .sort((a, b) => a.distanceNm - b.distanceNm)[0] || null
    );
  })();
  const ceilStatus =
    ceilVal < minCeilLimit ? 'HOLD' : ceilVal < minCeilLimit + 350 ? 'CAUTION' : 'GO';

  const visVal = activeModelSnapshot?.visibilityKm ?? weather?.visibilityKm ?? 10;
  const visStatus =
    visVal < minVisLimit ? 'HOLD' : visVal < minVisLimit + 2.0 ? 'CAUTION' : 'GO';

  const freezeVal = activeModelSnapshot?.freezingLevelFt ?? 4000;
  const precipVal = activeModelSnapshot?.precipMmHr ?? 0;
  const icingActive =
    freezeVal > 0 &&
    freezeVal < preset.minIcingFreezingLevelFt &&
    (ceilVal < 2500 || precipVal > 0.2);
  const iceStatus =
    icingActive && freezeVal < 1000 ? 'HOLD' : icingActive ? 'CAUTION' : 'GO';

  const lightningRisk = activeModelSnapshot?.lightningRisk ?? 'LOW';
  const lightningType = activeModelSnapshot?.lightningType ?? 'NONE';
  const lightningTypeLabel =
    lightningType === 'NATURAL_TS'
      ? 'Natural TS'
      : lightningType === 'TRIGGERED_WINTER'
      ? 'Winter Triggered'
      : lightningType === 'CONVECTIVE_SHOWER'
      ? 'Squall/Showers'
      : 'None';
  const lightningStatus =
    lightningRisk === 'HIGH' ? 'HOLD' : lightningRisk === 'MODERATE' ? 'CAUTION' : 'GO';

  const dewSpreadVal = activeModelSnapshot?.dewSpreadC ?? 2.5;
  const fogSpreadRisk = activeModelSnapshot?.fogSpreadRisk ?? 'LOW';
  const fogStatus =
    fogSpreadRisk === 'HIGH' ? 'CAUTION' : fogSpreadRisk === 'MODERATE' ? 'CAUTION' : 'GO';

  // Combined Shore-to-Deck route verdict (Shore Base + Mid-Route + Rig/FPSO)
  const routeCombinedStatus: 'GO' | 'CAUTION' | 'HOLD' = (() => {
    const statuses: Array<'GO' | 'CAUTION' | 'HOLD'> = [
      currentStatus === 'HOLD' || currentStatus === 'CAUTION' ? currentStatus : 'GO',
      ...corridorWaypoints.map((w) => w.status),
    ];
    if (statuses.includes('HOLD')) return 'HOLD';
    if (statuses.includes('CAUTION')) return 'CAUTION';
    return 'GO';
  })();

  const limitingLeg = (() => {
    if (corridorWaypoints.length < 3) return null;
    if (corridorWaypoints[0].status === 'HOLD') return `${shoreBaseFacility.code} Shore Base`;
    if (corridorWaypoints[1].status === 'HOLD') return 'Mid-Route Corridor';
    if (currentStatus === 'HOLD') return `${facility.code} Helideck`;
    if (corridorWaypoints[0].status === 'CAUTION') return `${shoreBaseFacility.code} Shore Base`;
    if (corridorWaypoints[1].status === 'CAUTION') return 'Mid-Route Corridor';
    if (currentStatus === 'CAUTION') return `${facility.code} Helideck`;
    return 'All 3 Route Legs Clear';
  })();

  // Shore base runway crosswind check (using shore corridor leg wind or live weather)
  const shoreLeg = corridorWaypoints[0];
  const shoreRunwayWind = (() => {
    const dir = shoreLeg?.windDir10mDeg ?? weather?.windDirectionDeg;
    const spd = shoreLeg?.windSpeed10mKts ?? weather?.windSpeedKts;
    const gst = shoreLeg?.windGust10mKts ?? weather?.windGustKts ?? spd;
    if (typeof dir !== 'number' || typeof spd !== 'number' || typeof gst !== 'number') {
      return null;
    }
    return computeBestRunwayWind(shoreBaseFacility.code, dir, spd, gst);
  })();


  const handleCopyOutlook = async () => {
    const modelName =
      WEATHER_MODELS_META.find((m) => m.id === weatherModelId)?.shortName || weatherModelId;
    const text = formatCrewOutlookSummary({
      facility,
      shoreBase: shoreBaseFacility,
      preset,
      modelName,
      flightOpsMode,
      solarWindow,
      daySummaries,
      corridorWaypoints,
      customOverride,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopiedOutlook(true);
      setTimeout(() => setCopiedOutlook(false), 2500);
    } catch {
      setCopiedOutlook(false);
    }
  };

  const handleCopyShareableRigLink = async () => {
    try {
      const url = new URL(window.location.origin + window.location.pathname);
      url.searchParams.set('rig', facility.code);
      if (customOverride?.maxGustKts) url.searchParams.set('gust', String(customOverride.maxGustKts));
      if (customOverride?.maxWaveM) url.searchParams.set('wave', String(customOverride.maxWaveM));
      if (customOverride?.minCeilingFt) url.searchParams.set('ceil', String(customOverride.minCeilingFt));
      if (typeof customOverride?.vesselHeadingDeg === 'number') {
        url.searchParams.set('hdg', String(customOverride.vesselHeadingDeg));
      }
      if (customOverride?.maxPitchRollDeg) url.searchParams.set('pr', String(customOverride.maxPitchRollDeg));
      if (customOverride?.maxInclinationDeg) url.searchParams.set('inc', String(customOverride.maxInclinationDeg));
      if (customOverride?.maxShrMs) url.searchParams.set('shr', String(customOverride.maxShrMs));
      if (customOverride?.daylightOnlyDeck) url.searchParams.set('daylight', '1');
      await navigator.clipboard.writeText(url.toString());
      setCopiedRigLink(true);
      setTimeout(() => setCopiedRigLink(false), 2500);
    } catch {
      setCopiedRigLink(false);
    }
  };

  const hasCustomOverride = Boolean(
    customOverride &&
      (customOverride.maxGustKts ||
        customOverride.maxWaveM ||
        customOverride.minCeilingFt ||
        customOverride.maxPitchRollDeg ||
        customOverride.maxInclinationDeg ||
        customOverride.maxShrMs ||
        customOverride.daylightOnlyDeck ||
        typeof customOverride.vesselHeadingDeg === 'number')
  );

  // Plain-English explanation for casual offshore passengers & crew
  const plainEnglishSummary = (() => {
    if (evaluatedActive?.limits.daylightOnlyBlocked) {
      return `Night flight hold: ${activeHour?.hourLabel || 'This hour'} UTC is outside daylight hours and the deck is set to Daylight Flights Only.`;
    }
    if (gustStatus === 'HOLD') {
      return `Too windy at the helideck: Wind gusts are ${gustVal} kt, which is over the ${maxGustLimit} kt helicopter limit.`;
    }
    if (waveStatus === 'HOLD') {
      return `Seas are too rough: Wave height is ${waveVal} m, which exceeds the ${maxWaveLimit} m limit for ${
        isFpso ? 'floating FPSO helideck pitch, roll & heave' : 'offshore helicopter operations'
      }.`;
    }
    if (ceilStatus === 'HOLD' || visStatus === 'HOLD') {
      return `Low cloud or sea fog (haar): Cloud base (${ceilVal.toLocaleString()} ft) or visibility (${visVal} km) is below the ${minCeilLimit} ft / ${minVisLimit} km helicopter approach minimum.`;
    }
    if (lightningStatus === 'HOLD') {
      return `High lightning / squall risk: Cold winter showers or thunderstorms can trigger lightning on rotor blades — flights hold until the cells pass.`;
    }
    if (iceStatus === 'HOLD') {
      return `Icing hold: The 0°C freezing level is very low (${freezeVal.toLocaleString()} ft) with cloud/moisture.`;
    }
    if (corridorWaypoints[0]?.status === 'HOLD') {
      return `Weather at ${facility.shortName} is okay, but your shore airport (${shoreBaseFacility.shortName}) is currently below flight limits.`;
    }
    if (corridorWaypoints[1]?.status === 'HOLD') {
      return `Weather at ${facility.shortName} is okay, but weather halfway along the flight route from ${shoreBaseFacility.code} is outside limits.`;
    }
    if (deckMotionRaisesCaution) {
      return `Deck motion may be too much: from the forecast waves (${waveVal} m) and swell (${wavePeriodVal}s), our rough estimate is that this ${isSemiSub ? 'semi-sub' : 'FPSO'} could be pitching, rolling or heaving beyond the landing limits. Only the vessel's own motion sensors know for sure.`;
    }
    if (lightningStatus === 'CAUTION') {
      return `Wind (${gustVal} kt) and waves (${waveVal} m) are well within limits, but cold air + winter showers can trigger static lightning on helicopter blades — crews may wait 20–40 mins for heavy showers to pass.`;
    }
    if (gustStatus === 'CAUTION') {
      return `Breezy at the helideck (${gustVal} kt gusts vs ${maxGustLimit} kt limit) — flights can still operate, with a small chance of wind or turbulence delays.`;
    }
    if (waveStatus === 'CAUTION') {
      return `Moderate-to-rough seas (${waveVal} m waves vs ${maxWaveLimit} m limit)${
        isFpso ? ' — floating FPSO deck motion could cause brief waits for a steady window' : ''
      }.`;
    }
    if (ceilStatus === 'CAUTION' || visStatus === 'CAUTION' || fogStatus === 'CAUTION') {
      return `Low cloud (${ceilVal.toLocaleString()} ft) or mist (${visVal} km) — within radar approach limits (min ${minCeilLimit} ft), so flights can normally go ahead unless fog thickens.`;
    }
    if (iceStatus === 'CAUTION') {
      return `Freezing level is ${freezeVal.toLocaleString()} ft — pilots may fly at a lower cruise altitude to stay below icing.`;
    }
    if (routeCombinedStatus === 'CAUTION') {
      return `Weather at ${facility.shortName} is good, with minor weather caution at ${shoreBaseFacility.shortName} or en-route.`;
    }
    return `All clear for flights: Wind (${gustVal} kt gusts), waves (${waveVal} m), cloud height (${ceilVal.toLocaleString()} ft), and visibility (${visVal} km) are all comfortably inside normal limits.`;
  })();

  return (
    <div className="flex flex-col h-full min-w-0 w-full bg-slate-950 text-slate-100 overflow-y-auto overflow-x-hidden p-3 sm:p-5 space-y-4">
      <div className={isFullScreen ? 'max-w-6xl mx-auto w-full min-w-0 space-y-4' : 'w-full min-w-0 space-y-4'}>
        {/* Header, Copy Outlook, Full-Screen Expand Toggle & Refresh */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-cyan-400">
              7-DAY MULTI-MODEL FLIGHT LIMITS · {facility.code}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white truncate">
              {facility.name}
            </h3>
            <div className="text-xs text-slate-400">
              {facility.fieldOperator} · {facility.assetType} · Base {shoreBaseFacility.code}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleCopyOutlook}
              title="Copy 7-day crew-change weather outlook for WhatsApp / Signal"
              aria-label="Copy 7-day crew-change weather outlook"
              className={`min-w-[44px] min-h-[44px] flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${
                copiedOutlook
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-200'
              }`}
            >
              {copiedOutlook ? (
                <>
                  <Check className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-cyan-400" />
                  <span className="hidden sm:inline">Copy Outlook</span>
                </>
              )}
            </button>
            {onToggleFullScreen && (
              <button
                onClick={onToggleFullScreen}
                title={
                  isFullScreen
                    ? 'Switch back to Split Radar Map + Weather View'
                    : 'Expand Weather & 7-Day Limits to Full Screen'
                }
                className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-semibold cursor-pointer"
              >
                {isFullScreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    Split Map + WX
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    Full Screen WX
                  </>
                )}
              </button>
            )}
            <button
              onClick={onRefresh}
              title="Refresh 7-Day ICON / ECMWF / GFS / GEM & Aviation METAR/TAF"
              aria-label="Refresh weather and forecasts"
              className="min-w-[44px] min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 cursor-pointer shrink-0"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  loading || ensembleLoading ? 'animate-spin text-cyan-400' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {cachedForecastSavedAt && (
          <div className="px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-500/45 text-amber-200 text-xs font-mono flex items-center justify-between gap-2">
            <span>
              Weak / Offline Signal — Showing saved forecast from{' '}
              {cachedForecastSavedAt.slice(11, 16)} UTC
            </span>
            <button
              onClick={onRefresh}
              className="px-2 py-0.5 rounded bg-amber-400 text-slate-950 font-bold text-[10px] cursor-pointer shrink-0"
            >
              Retry
            </button>
          </div>
        )}

        {inboundHelis.length > 0 && (
          <div className="px-3 py-2 rounded-lg bg-cyan-950/35 border border-cyan-500/40 text-xs flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-cyan-300 flex items-center gap-1.5">
              <Plane className="w-3.5 h-3.5" />
              Inbound within 40 NM:
            </span>
            <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
              {inboundHelis.map(({ flight, distNm, etaMin }) => (
                <span
                  key={flight.hex}
                  className="px-2 py-0.5 rounded bg-slate-900 border border-cyan-500/40 text-white"
                >
                  {flight.callsign} ({flight.typeCode}) · {distNm.toFixed(0)} NM · ~{etaMin}m ETA
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Simple Crew View vs Detailed Heli-Admin View Switcher */}
        <div className="p-1.5 bg-slate-900 border border-slate-800 rounded-xl grid grid-cols-2 gap-1.5">
          <button
            onClick={() => handleSetViewMode('simple')}
            className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'simple'
                ? 'bg-cyan-400 text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>Simple Crew View</span>
          </button>
          <button
            onClick={() => handleSetViewMode('detailed')}
            className={`py-2 px-2.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              viewMode === 'detailed'
                ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                : 'text-slate-300 hover:bg-slate-800/80'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5 shrink-0" />
            <span>Heli-Admin / Pro View</span>
          </button>
        </div>

        {/* PLAIN-ENGLISH CREW SUMMARY CARD ("Will My Chopper Fly?") */}
        <div className={`p-3.5 rounded-xl border ${statusColor} space-y-3 min-w-0`}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="text-[10px] font-mono uppercase tracking-wider opacity-85">
                {activeHour?.dayNameFull || 'Today'} {activeHour?.dateShort || ''} ·{' '}
                {activeHour?.hourLabel || 'Live'} UTC ({isNightHour ? 'Night Limits' : 'Daylight'}) ·{' '}
                {preset.id} Helicopter
              </div>
              <div className="text-base sm:text-lg font-extrabold flex items-center gap-2">
                {currentStatus === 'GO' && <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />}
                {currentStatus === 'CAUTION' && <AlertTriangle className="w-5 h-5 shrink-0 text-amber-400" />}
                {currentStatus === 'HOLD' && <ShieldAlert className="w-5 h-5 shrink-0 text-rose-400" />}
                <span>
                  {currentStatus === 'GO'
                    ? 'GOOD TO FLY — LOW DELAY RISK'
                    : currentStatus === 'CAUTION'
                    ? 'POSSIBLE DELAYS — WATCH WEATHER'
                    : 'WEATHER HOLD LIKELY — OUTSIDE LIMITS'}
                </span>
              </div>
            </div>
            {fiveModelConsensus && (
              <span className="px-2 py-1 rounded-md bg-slate-950/80 border border-white/15 text-[11px] font-mono font-bold text-white shrink-0">
                {(currentStatus === 'GO'
                  ? fiveModelConsensus.goCount
                  : currentStatus === 'CAUTION'
                  ? fiveModelConsensus.cautionCount + (deckMotionRaisesCaution ? fiveModelConsensus.goCount : 0)
                  : fiveModelConsensus.holdCount)}
                /{fiveModelConsensus.totalModels} models agree
              </span>
            )}
          </div>

          <p className="text-xs sm:text-sm text-white/95 leading-relaxed font-sans">
            {plainEnglishSummary}
          </p>

          {/* Explain why Night hours show stricter cloud and deck-motion limits than daytime hours */}
          {isNightHour && (
            <div className="p-2.5 rounded-lg bg-indigo-950/80 border border-indigo-400/40 text-xs text-indigo-100 flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="font-bold text-indigo-200 flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                  <span>
                    Why Today&apos;s limits look different right now ({activeHour?.hourLabel || 'Night'} UTC is after sunset):
                  </span>
                </div>
                <p className="text-[11px] text-indigo-200/90 leading-snug">
                  You are viewing a <strong>Night hour</strong>. Wind ({maxGustLimit} kt) and sea state ({maxWaveLimit} m) limits
                  are the same day and night, but night uses a higher cloud minimum (<strong>{minCeilLimit} ft</strong>)
                  {isFpso ? (
                    <>
                      {' '}and tighter deck motion limits (<strong>±{maxPitchRollLimit.toFixed(1)}°</strong> pitch/roll)
                    </>
                  ) : null}
                  . Future days in the 7-day calendar default to{' '}
                  <strong>11:00 UTC (Daylight)</strong>, which uses the daytime limits.
                </p>
              </div>
              {(() => {
                const daylightHr =
                  activeDayHours.find((h) => h.hourLabel.startsWith('11:')) ||
                  activeDayHours.find((h) => !h.isNight) ||
                  hourlyForecast.find((h) => h.hourLabel.startsWith('11:') && !h.isNight);
                if (!daylightHr) return null;
                return (
                  <button
                    onClick={() => onChangeSelectedHourIdx(daylightHr.hourIndex)}
                    className="px-2.5 py-1.5 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-mono font-bold text-[11px] shrink-0 cursor-pointer"
                  >
                    ☀ View {daylightHr.dayNameShort} 11:00 UTC (Day Limits)
                  </button>
                );
              })()}
            </div>
          )}

          {/* 4 Simple Plain-English Weather Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
            <div className="p-2.5 rounded-lg bg-slate-950/85 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium">
                  <Wind className="w-3.5 h-3.5 text-cyan-400" /> Wind
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    gustStatus === 'GO'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : gustStatus === 'CAUTION'
                      ? 'bg-amber-500/25 text-amber-300'
                      : 'bg-rose-500/30 text-rose-300'
                  }`}
                >
                  {gustStatus === 'GO' ? 'OK' : gustStatus === 'CAUTION' ? 'Breezy' : 'Over Limit'}
                </span>
              </div>
              <div className="text-sm font-bold text-white font-mono">{gustVal} kt gusts</div>
              <div className="text-[10px] text-slate-400">
                Max: {maxGustLimit} kt ({isNightHour ? 'Night · 60kt Day' : 'Day'})
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950/85 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium">
                  <Waves className="w-3.5 h-3.5 text-cyan-400" /> Waves
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    waveStatus === 'GO'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : waveStatus === 'CAUTION'
                      ? 'bg-amber-500/25 text-amber-300'
                      : 'bg-rose-500/30 text-rose-300'
                  }`}
                >
                  {waveStatus === 'GO' ? 'OK' : waveStatus === 'CAUTION' ? 'Rough' : 'Over Limit'}
                </span>
              </div>
              <div className="text-sm font-bold text-white font-mono">{waveVal} m waves</div>
              <div className="text-[10px] text-slate-400">
                Max: {maxWaveLimit} m ({isNightHour ? 'Night · 6m Day' : 'Day'})
                {isFpso && fpsoMotionEstimate
                  ? ` · est. deck motion ${fpsoMotionEstimate.deckLightStatus === 'RED' ? 'over limit' : fpsoMotionEstimate.deckLightStatus === 'AMBER' ? 'near limit' : 'OK'}`
                  : ''}
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950/85 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium">
                  <CloudFog className="w-3.5 h-3.5 text-cyan-400" /> Cloud/Fog
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    ceilStatus === 'GO' && visStatus === 'GO'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : ceilStatus === 'HOLD' || visStatus === 'HOLD'
                      ? 'bg-rose-500/30 text-rose-300'
                      : 'bg-amber-500/25 text-amber-300'
                  }`}
                >
                  {ceilStatus === 'GO' && visStatus === 'GO'
                    ? 'Clear'
                    : ceilStatus === 'HOLD' || visStatus === 'HOLD'
                    ? 'Too Low'
                    : 'Low Cloud'}
                </span>
              </div>
              <div className="text-sm font-bold text-white font-mono">
                {facilityHasReportedCeiling && reportedCloud?.noCeiling
                  ? 'No low cloud'
                  : `${ceilVal.toLocaleString()} ft cloud`}
              </div>
              <div className="text-[10px] text-slate-400">
                {facilityHasReportedCeiling
                  ? `Reported by ${metarStation} METAR${reportedCloud?.ceilingGroup ? ` (${reportedCloud.ceilingGroup})` : ''}`
                  : 'Estimate from forecast model'}
              </div>
              {!facilityHasReportedCeiling && nearestReportedCloud && (
                <div className="text-[10px] text-cyan-300/90">
                  Nearest report: {nearestReportedCloud.icao} ({nearestReportedCloud.distanceNm} NM){' '}
                  {nearestReportedCloud.cloud.noCeiling
                    ? 'no low cloud'
                    : `${nearestReportedCloud.cloud.ceilingGroup} = ${(nearestReportedCloud.cloud.ceilingFt ?? 0).toLocaleString()} ft`}
                </div>
              )}
              <div className="text-[10px] text-slate-400">
                Min: {minCeilLimit} ft ({isNightHour ? `Night · ${preset.minCloudCeilingFt}ft Day` : 'Day'}) · Vis {visVal} km
              </div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-950/85 border border-white/10 space-y-1">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="flex items-center gap-1 font-medium">
                  <CloudLightning className="w-3.5 h-3.5 text-amber-400" /> Showers/Ice
                </span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                    lightningStatus === 'GO' && iceStatus === 'GO'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : lightningStatus === 'HOLD' || iceStatus === 'HOLD'
                      ? 'bg-rose-500/30 text-rose-300'
                      : 'bg-amber-500/25 text-amber-300'
                  }`}
                >
                  {lightningStatus === 'GO' && iceStatus === 'GO'
                    ? 'Clear'
                    : lightningStatus === 'HOLD' || iceStatus === 'HOLD'
                    ? 'Hold Risk'
                    : 'Watch'}
                </span>
              </div>
              <div className="text-sm font-bold text-white font-mono truncate">
                {lightningStatus !== 'GO'
                  ? 'Winter Showers'
                  : iceStatus !== 'GO'
                  ? `Ice ${freezeVal.toLocaleString()}ft`
                  : 'No Lightning'}
              </div>
              <div className="text-[10px] text-slate-400">
                0°C Freeze: {freezeVal.toLocaleString()} ft
              </div>
            </div>
          </div>

          {/* Simple 3-Step Shore Airport -> Over Sea -> Rig Route Summary */}
          {corridorWaypoints.length >= 3 && (
            <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-slate-300 font-medium">Flight Route:</span>
                <select
                  aria-label="Select departure shore airport"
                  value={shoreBaseFacility.code}
                  onChange={(e) => onChangeShoreBaseCode(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] font-mono text-cyan-300"
                >
                  {availableShoreBases.map((base) => (
                    <option key={base.id} value={base.code}>
                      From {base.shortName.replace(/\s*\([^)]*\)/, '')} ({base.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px]">
                {corridorWaypoints.map((wp, i) => (
                  <React.Fragment key={wp.code + i}>
                    <span
                      className={`px-2 py-0.5 rounded font-bold ${
                        wp.status === 'GO'
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/35'
                          : wp.status === 'CAUTION'
                          ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                          : 'bg-rose-500/30 text-rose-300 border border-rose-500/45'
                      }`}
                    >
                      {i === 0 ? shoreBaseFacility.code : i === 1 ? 'En-Route' : facility.code}:{' '}
                      {wp.status === 'GO' ? 'OK' : wp.status}
                    </span>
                    {i < 2 && <span className="text-slate-500">→</span>}
                  </React.Fragment>
                ))}
              </div>
            </div>
          )}

          {/* 1-Tap Triggered Lightning & Fly-Around Corridor Map Button (visible in both Simple & Pro View) */}
          <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-300 flex items-center gap-1.5">
              <CloudLightning className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>
                Lightning risk estimate on the route ({shoreBaseFacility.code} → {facility.code}):
              </span>
            </span>
            <button
              onClick={() => {
                onChangeWeatherOverlayMode('triggered_lightning');
                onSwitchToMapWithOverlay('triggered_lightning');
              }}
              className="px-2.5 py-1 rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-mono font-bold text-[11px] flex items-center gap-1 cursor-pointer shadow-sm"
            >
              <span>⚡ Open Lightning Map →</span>
            </button>
          </div>
        </div>

        {/* 0. Astronomical Daylight Window & Auto Day/Night Flight Mode Selector (Shown in Heli-Admin / Pro View) */}
        {viewMode === 'detailed' && (
        <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <div className="flex items-center gap-2 text-amber-300">
              <Sun className="w-3.5 h-3.5 shrink-0" />
              <span>
                DAYLIGHT ({activeDaySummary?.dayNameShort || 'TODAY'}):{' '}
                <strong className="text-white">
                  {solarWindow.sunriseLabel}–{solarWindow.sunsetLabel} UTC
                </strong>{' '}
                <span className="text-slate-400">({solarWindow.daylightDurationLabel})</span>
              </span>
            </div>
            <span className="text-[10px] text-cyan-300">
              CAA Day: {solarWindow.caaDayWindowLabel}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => onChangeFlightOpsMode('24h_ops')}
                className={`min-h-[38px] sm:min-h-0 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded text-[11px] font-mono cursor-pointer flex items-center gap-1 ${
                  flightOpsMode === '24h_ops'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Moon className="w-3 h-3" />
                24h Auto Day/Night Limits
              </button>
              <button
                onClick={() => onChangeFlightOpsMode('daylight_only')}
                className={`min-h-[38px] sm:min-h-0 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded text-[11px] font-mono cursor-pointer flex items-center gap-1 ${
                  flightOpsMode === 'daylight_only'
                    ? 'bg-amber-400 text-slate-950 font-bold'
                    : 'bg-slate-950 text-slate-300 border border-slate-800 hover:bg-slate-800'
                }`}
              >
                <Sun className="w-3 h-3" />
                Daylight Crew-Change Only
              </button>
            </div>

            <button
              onClick={() => setShowRestrictionsEditor((p) => !p)}
              className={`min-h-[38px] sm:min-h-0 px-2.5 py-1.5 sm:px-2 sm:py-1 rounded text-[11px] font-mono cursor-pointer flex items-center gap-1 border ${
                hasCustomOverride
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-bold'
                  : 'bg-slate-950 text-slate-300 border-slate-800 hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-3 h-3" />
              {hasCustomOverride ? 'Local Deck Limits Active' : 'Deck Restrictions / Hdg'}
            </button>
          </div>

          {/* Collapsible Local Deck Restrictions & FPSO Heading Editor */}
          {showRestrictionsEditor && (
            <div className="p-2.5 mt-1.5 rounded bg-slate-950 border border-slate-800 space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-amber-300 font-semibold">
                  LOCAL HELIDECK / HLL LIMITS (SAVED FOR {facility.code})
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyShareableRigLink}
                    className="px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/40 text-[10px] font-mono text-cyan-300 hover:bg-cyan-900/60 cursor-pointer flex items-center gap-1"
                  >
                    {copiedRigLink ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    {copiedRigLink ? 'Rig & Limits Link Copied!' : 'Share Rig & Limits Link'}
                  </button>
                  {hasCustomOverride && (
                    <button
                      onClick={() => onChangeCustomOverride(null)}
                      className="text-[10px] font-mono text-rose-400 hover:underline cursor-pointer"
                    >
                      Reset All
                    </button>
                  )}
                </div>
              </div>

              {/* 1-Tap Quick HCA HLL Operational Scenarios */}
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 font-mono text-[10px]">
                <span className="text-slate-400">Quick HLL Preset:</span>
                <button
                  onClick={() => onChangeCustomOverride(null)}
                  className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-emerald-300 cursor-pointer"
                >
                  Standard UK rules (60kt · 6m · 200ft)
                </button>
                <button
                  onClick={() =>
                    onChangeCustomOverride({
                      ...customOverride,
                      maxGustKts: 40,
                    })
                  }
                  className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-amber-500/40 text-amber-300 cursor-pointer"
                >
                  HLL Turbulence Sector (40kt Wind Cap)
                </button>
                {isFpso && (
                  <button
                    onClick={() =>
                      onChangeCustomOverride({
                        ...customOverride,
                        maxPitchRollDeg: 1.0,
                        maxInclinationDeg: 1.5,
                        maxShrMs: 0.4,
                        maxWaveM: 3.5,
                        daylightOnlyDeck: true,
                      })
                    }
                    className="px-2 py-0.5 rounded bg-slate-900 hover:bg-slate-800 border border-rose-500/40 text-rose-300 cursor-pointer"
                  >
                    HMS Unserviceable (±1.0° P/R · 0.4 m/s SHR · Day)
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <label className="space-y-1">
                  <span className="text-slate-400 block text-[10px]">Max Wind/Gust (kt)</span>
                  <input
                    type="number"
                    min={20}
                    max={65}
                    placeholder={`${preset.maxHelideckGustKts}`}
                    value={customOverride?.maxGustKts ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : undefined;
                      onChangeCustomOverride({ ...customOverride, maxGustKts: val });
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400 block text-[10px]">Max Sea State Hs (m)</span>
                  <input
                    type="number"
                    step="0.1"
                    min={1.5}
                    max={8}
                    placeholder={`${preset.maxFpsoWaveHeightM}`}
                    value={customOverride?.maxWaveM ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : undefined;
                      onChangeCustomOverride({ ...customOverride, maxWaveM: val });
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-slate-400 block text-[10px]">Min Cloud Ceiling (ft)</span>
                  <input
                    type="number"
                    step="50"
                    min={150}
                    max={1500}
                    placeholder={`${minCeilLimit}`}
                    value={customOverride?.minCeilingFt ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : undefined;
                      onChangeCustomOverride({ ...customOverride, minCeilingFt: val });
                    }}
                    className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                  />
                </label>
                {isFpso && (
                  <>
                    <label className="space-y-1">
                      <span className="text-slate-400 block text-[10px]">FPSO Heading (°T)</span>
                      <input
                        type="number"
                        min={0}
                        max={359}
                        placeholder="e.g. 240"
                        value={customOverride?.vesselHeadingDeg ?? ''}
                        onChange={(e) => {
                          const val =
                            e.target.value !== ''
                              ? ((Number(e.target.value) % 360) + 360) % 360
                              : undefined;
                          onChangeCustomOverride({ ...customOverride, vesselHeadingDeg: val });
                        }}
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-400 block text-[10px]">Max Pitch/Roll (±°)</span>
                      <input
                        type="number"
                        step="0.5"
                        min={1}
                        max={6}
                        placeholder={`${maxPitchRollLimit}`}
                        value={customOverride?.maxPitchRollDeg ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          onChangeCustomOverride({ ...customOverride, maxPitchRollDeg: val });
                        }}
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-400 block text-[10px]">Max Inclination INC (°)</span>
                      <input
                        type="number"
                        step="0.5"
                        min={1}
                        max={6}
                        placeholder={`${maxInclinationLimit}`}
                        value={customOverride?.maxInclinationDeg ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          onChangeCustomOverride({ ...customOverride, maxInclinationDeg: val });
                        }}
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-slate-400 block text-[10px]">Max Heave SHR (m/s)</span>
                      <input
                        type="number"
                        step="0.1"
                        min={0.3}
                        max={2.5}
                        placeholder={`${maxShrLimit}`}
                        value={customOverride?.maxShrMs ?? ''}
                        onChange={(e) => {
                          const val = e.target.value ? Number(e.target.value) : undefined;
                          onChangeCustomOverride({ ...customOverride, maxShrMs: val });
                        }}
                        className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-white"
                      />
                    </label>
                  </>
                )}
                <label className="flex items-center gap-2 pt-4 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(customOverride?.daylightOnlyDeck)}
                    onChange={(e) =>
                      onChangeCustomOverride({
                        ...customOverride,
                        daylightOnlyDeck: e.target.checked,
                      })
                    }
                    className="accent-amber-400 w-4 h-4"
                  />
                  <span className="text-[11px] text-slate-200">Daylight-Only Deck</span>
                </label>
              </div>
              <p className="text-[10px] text-slate-500">
                Enter your installation&apos;s exact HCA HLL or HeliMet HMS limits (wind, sea state,
                ceiling, pitch/roll, INC, SHR, or FPSO heading). Saved locally on this device.
              </p>
            </div>
          )}
        </div>
        )}

        {/* 1. 7-DAY CREW-CHANGE FLIGHT DELAY PLANNER */}
        {daySummaries.length > 0 && (
          <div className="p-3 bg-slate-900/95 border border-cyan-500/35 rounded-lg space-y-2.5 min-w-0 max-w-full overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                7-Day Crew-Change Calendar (Tap Your Flight Day &amp; Hour)
              </span>
              {selectedHourIdx > 0 && (
                <button
                  onClick={() => onChangeSelectedHourIdx(0)}
                  className="text-[10px] font-mono text-cyan-400 hover:underline cursor-pointer"
                >
                  Back to Live NOW
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-400 leading-snug">
              Each day shows: <strong className="text-emerald-300">GO</strong> (Good) /{' '}
              <strong className="text-amber-300">CAUTION</strong> (Possible Delay) /{' '}
              <strong className="text-rose-300">HOLD</strong> (Weather Hold) ·{' '}
              <strong className="text-slate-200">Peak Wind (kt)</strong> ·{' '}
              <strong className="text-cyan-300">Peak Waves (m)</strong> ·{' '}
              <strong className="text-slate-300">Models Agreeing (e.g. 5/5)</strong>
            </p>

            <div className="flex w-full min-w-0 overflow-x-auto gap-1.5 pb-1 no-scrollbar sm:grid sm:grid-cols-7 sm:gap-1 sm:pb-0">
              {daySummaries.slice(0, 7).map((day) => {
                const isSelectedDay = day.dayKey === activeDayKey;
                const pillClr =
                  day.overallStatus === 'HOLD'
                    ? 'border-rose-500/60 bg-rose-950/40 text-rose-300'
                    : day.overallStatus === 'CAUTION'
                    ? 'border-amber-500/60 bg-amber-950/40 text-amber-300'
                    : 'border-emerald-500/50 bg-emerald-950/30 text-emerald-300';

                return (
                  <button
                    key={day.dayKey}
                    onClick={() => onChangeSelectedHourIdx(day.representativeHourIndex)}
                    className={`min-w-[74px] shrink-0 sm:min-w-0 p-2 sm:p-1.5 rounded-lg border flex flex-col items-center justify-between text-center transition-all cursor-pointer ${
                      isSelectedDay
                        ? 'ring-2 ring-cyan-400 bg-slate-800 border-cyan-400'
                        : pillClr
                    }`}
                  >
                    <span className="text-xs sm:text-[10px] font-bold text-white leading-tight flex items-center gap-0.5">
                      {day.dayNameShort}
                      {day.hasLightningRisk && (
                        <span title={`${day.lightningHoursCount}h estimated lightning / squall risk`}>
                          ⚡
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] sm:text-[8px] font-mono text-slate-400 leading-tight">
                      {day.dateShort}
                    </span>
                    <span
                      className={`mt-1 px-1.5 sm:px-1 py-0.5 sm:py-0.2 rounded text-[9px] sm:text-[8px] font-mono font-bold ${
                        day.overallStatus === 'HOLD'
                          ? 'bg-rose-500 text-white'
                          : day.overallStatus === 'CAUTION'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-emerald-500 text-slate-950'
                      }`}
                    >
                      {day.overallStatus}
                    </span>
                    <span className="text-[10px] sm:text-[8px] font-mono text-slate-300 mt-1 sm:mt-0.5 tabular-nums">
                      {day.maxGustKts}kt
                    </span>
                    <span className="text-[10px] sm:text-[8px] font-mono text-cyan-300 tabular-nums">
                      {day.maxWaveM}m
                    </span>
                    {day.consensusBadge && (
                      <span className="text-[9px] sm:text-[7px] font-mono text-slate-400 tabular-nums">
                        {day.consensusBadge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected Day Summary & Hour-by-Hour Scrubber with Day/Night & Lightning Indicators */}
            {activeDaySummary && (
              <div className="pt-2 border-t border-slate-800 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-xs">
                  <span className="font-semibold text-cyan-300">
                    {activeDaySummary.dayNameFull} ({activeDaySummary.dateShort}) ·{' '}
                    <span className="font-mono text-white">
                      {activeHour?.hourLabel} UTC ({isNightHour ? 'NIGHT' : 'DAY'})
                    </span>
                  </span>
                  <span className="text-[10px] font-mono text-slate-400">
                    {activeDaySummary.goHoursCount}h GO · {activeDaySummary.cautionHoursCount}h
                    CAUT · {activeDaySummary.holdHoursCount}h HOLD
                    {activeDaySummary.hasLightningRisk
                      ? ` · ⚡${activeDaySummary.lightningHoursCount}h`
                      : ''}
                  </span>
                </div>

                {activeDaySummary.overallStatus !== 'GO' && (
                  <div className="px-2 py-1 rounded bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-amber-200 truncate">
                    Day Limit Driver: {activeDaySummary.primaryRiskReason}
                  </div>
                )}

                <div className="grid grid-cols-6 sm:grid-cols-12 gap-1.5 sm:gap-1">
                  {activeDayHours.map((hr) => {
                    const snap = hr.models[weatherModelId];
                    const hrNight = Boolean(hr.isNight);
                    const hrLightning =
                      snap?.lightningRisk === 'HIGH' || snap?.lightningRisk === 'MODERATE';
                    const hrEval = snap
                      ? evaluateHourWithLimits(
                          snap,
                          hr.waveHeightM,
                          hr.swellPeriodSec,
                          hrNight,
                          isFpso,
                          preset,
                          flightOpsMode,
                          customOverride,
                          isSemiSub
                        )
                      : null;
                    const st = hrEval?.status || snap?.status || 'GO';
                    const isSelHr = hr.hourIndex === selectedHourIdx;
                    const badgeClr =
                      st === 'HOLD'
                        ? 'bg-rose-500/85 text-white'
                        : st === 'CAUTION'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-500/80 text-slate-950';
                    return (
                      <button
                        key={hr.hourIso}
                        onClick={() => onChangeSelectedHourIdx(hr.hourIndex)}
                        title={`${hr.hourLabel} UTC (${hrNight ? 'CAA Night' : 'Daylight'})${
                          hrLightning ? ' · ⚡ Lightning Risk (est.)' : ''
                        } — ${hrEval?.reason || ''}`}
                        className={`py-2 sm:py-1 rounded text-[10px] sm:text-[9px] font-mono font-bold flex flex-col items-center cursor-pointer border ${
                          isSelHr
                            ? 'border-white ring-2 ring-cyan-300 scale-105'
                            : 'border-transparent opacity-85 hover:opacity-100'
                        } ${badgeClr}`}
                      >
                        <span className="flex items-center gap-0.5">
                          {hr.hourLabel.slice(0, 2)}
                          <span className="text-[8px] sm:text-[7px] opacity-85">
                            {hrLightning ? '⚡' : hrNight ? '☾' : '☀'}
                          </span>
                        </span>
                        <span className="text-[9px] sm:text-[8px]">
                          {snap?.deckWindGustKts ?? snap?.windGust10mKts}k
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {viewMode === 'simple' ? (
          <button
            onClick={() => handleSetViewMode('detailed')}
            className="w-full py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-cyan-300 flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <SlidersHorizontal className="w-4 h-4" />
            <span>
              Open Heli-Admin &amp; Technical Details (Pitch/Roll/SHR, 5 Weather Models, Custom Limits &amp; Raw METARs)
            </span>
          </button>
        ) : (
          <>
        {/* 2. Airframe Operating Limit Preset Selector */}
        <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] font-mono">
            <span className="text-cyan-400 font-semibold">
              HELICOPTER OPERATING LIMITS PRESET:
            </span>
            <span className="text-slate-400">
              {isNightHour ? 'NIGHT' : 'DAY'}: Gust {maxGustLimit}kt ·{' '}
              {isFpso ? `FPSO ${maxWaveLimit}m` : `Ceil ${minCeilLimit}ft`}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-1.5">
            {(['S92', 'AW189', 'H175', 'AW139', 'H160'] as AirframePresetId[]).map((id) => {
              const p = AIRFRAME_PRESETS[id];
              const isSel = airframePresetId === id;
              return (
                <button
                  key={id}
                  onClick={() => onChangeAirframePresetId(id)}
                  className={`py-2.5 sm:py-1.5 px-1 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                    isSel
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  {p.id}
                </button>
              );
            })}
          </div>
        </div>

        {/* 3. Dynamic Go / No-Go Verdict & 7-Point Operating Limits Checklist */}
        <div className={`p-3 rounded-lg border ${statusColor} space-y-2.5 min-w-0`}>
          <div className="flex flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-2">
            <div className="flex items-start sm:items-center gap-2 font-semibold text-sm min-w-0">
              {currentStatus === 'GO' && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />}
              {currentStatus === 'CAUTION' && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />}
              {currentStatus === 'HOLD' && <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 sm:mt-0" />}
              <span className="break-words">
                {facility.shortName} ({activeHour?.dayNameShort || 'NOW'}{' '}
                {activeHour?.hourLabel || ''}):{' '}
                {currentStatus === 'GO'
                  ? 'WITHIN LIMITS (GO)'
                  : currentStatus === 'CAUTION'
                  ? 'MARGINAL (DELAY RISK)'
                  : 'OUT OF LIMITS (NO-GO / HOLD)'}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span
                className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                  isNightHour
                    ? 'bg-indigo-950/90 text-indigo-300 border border-indigo-500/40'
                    : 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                }`}
              >
                {isNightHour ? 'NIGHT LIMITS' : 'DAY LIMITS'}
              </span>
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-black/30">
                {WEATHER_MODELS_META.find((m) => m.id === weatherModelId)?.shortName}
              </span>
            </div>
          </div>
          <p className="text-xs opacity-95 break-words">{currentReason}</p>

          {/* 5-Model Spread & Agreement Confidence Bar */}
          {fiveModelConsensus && (
            <div className="px-2.5 py-1.5 rounded bg-slate-950/75 border border-white/10 font-mono text-[10px] flex flex-wrap items-center justify-between gap-1.5">
              <span
                className={
                  fiveModelConsensus.isSplit ? 'text-amber-300 font-bold' : 'text-emerald-300 font-bold'
                }
              >
                {fiveModelConsensus.headline}
                {fiveModelConsensus.dissentingModels.length > 0
                  ? ` · ${fiveModelConsensus.dissentingModels.join(', ')}`
                  : ''}
              </span>
              <span className="text-slate-300 tabular-nums">
                Spread: {fiveModelConsensus.gustMinKts}–{fiveModelConsensus.gustMaxKts}kt · 0°C{' '}
                {fiveModelConsensus.freezeMinFt.toLocaleString()}–
                {fiveModelConsensus.freezeMaxFt.toLocaleString()}ft
              </span>
            </div>
          )}

          {/* FPSO Wind-Over-Deck Relative Sector Banner when vessel heading is entered */}
          {windOverDeck && (
            <div
              className={`px-2.5 py-1.5 rounded text-[11px] font-mono flex flex-wrap items-center justify-between gap-1.5 ${
                windOverDeck.severity === 'AFT_TURBULENCE'
                  ? 'bg-rose-950/70 text-rose-200 border border-rose-500/40'
                  : windOverDeck.severity === 'CROSSWIND'
                  ? 'bg-amber-950/60 text-amber-200 border border-amber-500/40'
                  : 'bg-emerald-950/60 text-emerald-200 border border-emerald-500/40'
              }`}
            >
              <span>
                FPSO Heading {String(customOverride?.vesselHeadingDeg).padStart(3, '0')}° · Wind{' '}
                {String(windDirNow).padStart(3, '0')}°:
              </span>
              <strong>{windOverDeck.sectorLabel}</strong>
            </div>
          )}

          {/* 7-Row Operating Limits Pass/Fail Breakdown */}
          <div className="grid grid-cols-1 gap-1 pt-1.5 border-t border-white/10 font-mono text-[11px]">
            {[
              {
                label:
                  facility.elevationFt > 45
                    ? `1. Helideck Wind (~${facility.elevationFt}ft)${
                        approachShearKts >= 20 ? ` · Shear +${approachShearKts}kt` : ''
                      }`
                    : '1. Helideck Wind & Gusts',
                actual: `${deckWindVal}G${gustVal} kt`,
                limit: isNightHour
                  ? `Max ${maxGustLimit} kt (Night · 60kt Day)`
                  : `Max ${maxGustLimit} kt (Day)`,
                st: gustStatus,
              },
              {
                label: isFpso
                  ? '2. FPSO Sea State & Swell Period'
                  : '2. Significant Wave Height (Hs)',
                actual: `${waveVal} m (${wavePeriodVal}s${
                  longSwellRisk ? ' · Resonant' : activeHour?.swellWaveHeightM ? ` · Swell ${activeHour.swellWaveHeightM}m` : ''
                })`,
                limit: isFpso
                  ? isNightHour
                    ? `Max ${maxWaveLimit} m (Night · 6.0m Day)`
                    : `Max ${maxWaveLimit} m (Day <10s)`
                  : `Max ${maxWaveLimit} m`,
                st: waveStatus,
              },
              {
                label: `3. Cloud Ceiling (${isNightHour ? 'Night' : 'Day'} ARA)`,
                actual: `${ceilVal.toLocaleString()} ft`,
                limit: isNightHour
                  ? `Min ${minCeilLimit} ft (Night · ${preset.minCloudCeilingFt}ft Day)`
                  : `Min ${minCeilLimit} ft (Day)`,
                st: ceilStatus,
              },
              {
                label: `4. Horizontal Visibility (${isNightHour ? 'Night' : 'Day'})`,
                actual: `${visVal} km`,
                limit: isNightHour
                  ? `Min ${minVisLimit} km (Night · 0.8km Day)`
                  : `Min ${minVisLimit} km (Day)`,
                st: visStatus,
              },
              {
                label: '5. 0°C Rotor Icing Altitude',
                actual: `${freezeVal.toLocaleString()} ft`,
                limit: `Safe > ${preset.minIcingFreezingLevelFt} ft`,
                st: iceStatus,
              },
              {
                label: '6. Triggered & Natural Lightning',
                actual: `${lightningRisk}${
                  lightningType !== 'NONE' ? ` · ${lightningTypeLabel}` : ''
                }${
                  typeof activeModelSnapshot?.capeJkg === 'number'
                    ? ` (${activeModelSnapshot.capeJkg} J/kg)`
                    : ''
                }`,
                limit: 'No TS / Low-0°C CAPE',
                st: lightningStatus,
              },
              {
                label: '7. Sea Haar / Fog Dewpoint Spread',
                actual: `T-Td ${dewSpreadVal}°C (${fogSpreadRisk})`,
                limit: 'Safe > 2.2°C',
                st: fogStatus,
              },
            ].map((item, idx) => (
              <div
                key={idx}
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 px-2 py-1.5 sm:py-1 rounded bg-slate-950/75 text-slate-200 min-w-0"
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="break-words min-w-0">{item.label}</span>
                  <span
                    className={`sm:hidden shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      item.st === 'GO'
                        ? 'bg-emerald-500/25 text-emerald-300'
                        : item.st === 'CAUTION'
                        ? 'bg-amber-500/25 text-amber-300'
                        : 'bg-rose-500/30 text-rose-300'
                    }`}
                  >
                    {item.st === 'GO' ? 'PASS' : item.st}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 sm:justify-end tabular-nums">
                  <span className="text-white font-bold break-words">{item.actual}</span>
                  <span className="text-slate-400 text-[10px]">({item.limit})</span>
                  <span
                    className={`hidden sm:inline-block shrink-0 px-1.5 py-0.2 rounded text-[9px] font-bold ${
                      item.st === 'GO'
                        ? 'bg-emerald-500/25 text-emerald-300'
                        : item.st === 'CAUTION'
                        ? 'bg-amber-500/25 text-amber-300'
                        : 'bg-rose-500/30 text-rose-300'
                    }`}
                  >
                    {item.st === 'GO' ? 'PASS' : item.st}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* CAP 437 / HCA HMS Floating Deck Motion Limits & Free Wave-Derived RAO Estimator */}
          {isFpso && (
            <div className="p-2.5 rounded bg-slate-950/85 border border-cyan-500/30 space-y-2 font-mono text-[11px]">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-cyan-300 font-bold text-[10px]">
                  ESTIMATED DECK MOTION vs HCA LIMITS ({preset.id} {isNightHour ? 'NIGHT' : 'DAY'} · CAT 1 FLOATING)
                </span>
                {fpsoMotionEstimate && (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      fpsoMotionEstimate.deckLightStatus === 'RED'
                        ? 'bg-rose-500/30 text-rose-300 border border-rose-500/40'
                        : fpsoMotionEstimate.deckLightStatus === 'AMBER'
                        ? 'bg-amber-500/30 text-amber-300 border border-amber-500/40'
                        : 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                    }`}
                  >
                    {fpsoMotionEstimate.summaryLabel}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-center">
                <div className="p-1.5 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[9px] text-slate-400">PITCH / ROLL</div>
                  {fpsoMotionEstimate && (
                    <div className="text-xs font-bold text-emerald-300">
                      Est. ±{fpsoMotionEstimate.estPitchRollDeg.toFixed(1)}°
                    </div>
                  )}
                  <div className="text-[10px] font-semibold text-white">
                    Limit ±{maxPitchRollLimit.toFixed(1)}°
                  </div>
                </div>
                <div className="p-1.5 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[9px] text-slate-400">INCLINATION (INC)</div>
                  {fpsoMotionEstimate && (
                    <div className="text-xs font-bold text-emerald-300">
                      Est. {fpsoMotionEstimate.estInclinationDeg.toFixed(1)}°
                    </div>
                  )}
                  <div className="text-[10px] font-semibold text-white">
                    Limit {maxInclinationLimit.toFixed(1)}°
                  </div>
                </div>
                <div className="p-1.5 rounded bg-slate-900/90 border border-slate-800">
                  <div className="text-[9px] text-slate-400">HEAVE RATE (SHR)</div>
                  {fpsoMotionEstimate && (
                    <div className="text-xs font-bold text-cyan-300">
                      Est. {fpsoMotionEstimate.estShrMs.toFixed(2)} m/s
                    </div>
                  )}
                  <div className="text-[10px] font-semibold text-white">
                    Limit {maxShrLimit.toFixed(1)} m/s
                  </div>
                </div>
              </div>
              <p className="text-[10px] font-sans text-slate-400 leading-snug">
                <strong className="text-emerald-300">Estimates only (No Login Required):</strong> Pitch/Roll, Inclination (INC), and Heave Rate (SHR) are estimated inside ChopperCheck from live marine wave height ({waveVal}m) &amp; swell period ({wavePeriodVal}s), not measured by the deck&apos;s HMS. They are compared with the HCA Category 1 limits for this helicopter type; the HLL / HeliMet reading is what counts.
              </p>
            </div>
          )}

          {/* 1-Tap Launch Animated Streamlines on Radar Map */}
          <div className="pt-1.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-mono uppercase opacity-80 flex items-center gap-1">
              <CloudRainWind className="w-3 h-3" /> Map Streamlines:
            </span>
            {(
              [
                { id: 'go_nogo_matrix', label: 'Go/No-Go Matrix' },
                { id: 'triggered_lightning', label: '⚡ Lightning (est.)' },
                { id: 'wind_950hpa', label: '950hPa (1,800ft) Wind' },
                { id: 'wave_swell', label: 'Waves (Hs)' },
                { id: 'freezing_icing', label: '0°C Icing' },
              ] as Array<{ id: WeatherOverlayMode; label: string }>
            ).map((btn) => (
              <button
                key={btn.id}
                onClick={() => {
                  onChangeWeatherOverlayMode(btn.id);
                  onSwitchToMapWithOverlay(btn.id);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                  weatherOverlayMode === btn.id
                    ? btn.id === 'triggered_lightning'
                      ? 'bg-amber-400 text-slate-950 font-bold'
                      : 'bg-cyan-400 text-slate-950 font-bold'
                    : btn.id === 'triggered_lightning'
                    ? 'bg-amber-950/70 hover:bg-amber-900/70 text-amber-300 border border-amber-500/50'
                    : 'bg-slate-950/80 hover:bg-slate-900 text-cyan-300 border border-slate-700'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* 4. 5-Model Ensemble Cross-Reference Table */}
        {activeHour && (
          <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                5-Model Agreement ({activeHour.dayNameShort} {activeHour.dateShort} ·{' '}
                {activeHour.hourLabel} UTC)
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                TAP MODEL TO SWITCH
              </span>
            </div>

            <div className="overflow-x-auto max-w-full">
              <table className="w-full text-left border-collapse font-mono text-[10px] sm:text-[11px]">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 text-[10px]">
                    <th className="py-1.5 pr-2">Model</th>
                    <th className="py-1.5 pr-2">10m Wind</th>
                    <th className="py-1.5 pr-2">950hPa</th>
                    <th className="py-1.5 pr-2">0°C Ice</th>
                    <th className="py-1.5 text-right">{preset.id}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {WEATHER_MODELS_META.map((mod) => {
                    const snap = activeHour.models[mod.id];
                    const isActiveMod = weatherModelId === mod.id;
                    const modEval = evaluateHourWithLimits(
                      snap,
                      activeHour.waveHeightM,
                      activeHour.swellPeriodSec,
                      isNightHour,
                      isFpso,
                      preset,
                      flightOpsMode,
                      customOverride,
                      isSemiSub
                    );
                    return (
                      <tr
                        key={mod.id}
                        onClick={() => onChangeWeatherModelId(mod.id)}
                        className={`cursor-pointer transition-colors ${
                          isActiveMod ? 'bg-slate-800/90' : 'hover:bg-slate-950/60'
                        }`}
                      >
                        <td className="py-2.5 sm:py-1.5 pr-2">
                          <div className="font-bold text-white flex items-center gap-1">
                            {isActiveMod && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            )}
                            {mod.shortName}
                          </div>
                          <div className="text-[9px] text-slate-400">{mod.resolution}</div>
                        </td>
                        <td className="py-2.5 sm:py-1.5 pr-2 tabular-nums text-slate-200">
                          {snap.deckWindSpeedKts ?? snap.windSpeed10mKts}G
                          <span
                            className={
                              (snap.deckWindGustKts ?? snap.windGust10mKts) >= cautionGustLimit
                                ? 'text-amber-400 font-bold'
                                : 'text-white'
                            }
                          >
                            {snap.deckWindGustKts ?? snap.windGust10mKts}
                          </span>
                          kt
                        </td>
                        <td className="py-2.5 sm:py-1.5 pr-2 tabular-nums text-cyan-300">
                          {snap.windSpeed950hPaKts}kt @ {snap.windDir950hPaDeg}°
                        </td>
                        <td className="py-2.5 sm:py-1.5 pr-2 tabular-nums">
                          <span
                            className={
                              snap.freezingLevelFt <= 3000
                                ? 'text-purple-300 font-bold'
                                : 'text-slate-300'
                            }
                          >
                            {snap.freezingLevelFt.toLocaleString()}ft
                          </span>
                        </td>
                        <td className="py-2.5 sm:py-1.5 text-right">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              modEval.status === 'GO'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                                : modEval.status === 'CAUTION'
                                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                : 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                            }`}
                          >
                            {modEval.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 5. Shore-to-Deck Combined Route Weather (Shore Base + En-Route + Rig) */}
        {corridorWaypoints.length > 0 && (
          <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-cyan-400" />
                Shore-to-Deck Route ({shoreBaseFacility.code} → {facility.code})
              </span>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Select departure shore heliport for route check"
                  value={shoreBaseFacility.code}
                  onChange={(e) => onChangeShoreBaseCode(e.target.value)}
                  className="bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5 text-[10px] font-mono text-cyan-300 focus:outline-none focus:border-cyan-500"
                >
                  {availableShoreBases.map((base) => (
                    <option key={base.id} value={base.code}>
                      Base: {base.code} ({base.shortName.replace(/\s*\([^)]*\)/, '')})
                    </option>
                  ))}
                </select>
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold ${
                    routeCombinedStatus === 'GO'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : routeCombinedStatus === 'CAUTION'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                  }`}
                >
                  ROUTE: {routeCombinedStatus}
                </span>
              </div>
            </div>

            {limitingLeg && (
              <div className="text-[11px] font-mono text-slate-300 bg-slate-950/70 px-2.5 py-1.5 rounded border border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5">
                <span>Limiting Route Leg ({activeHour?.dayNameShort} {activeHour?.hourLabel}):</span>
                <strong
                  className={
                    routeCombinedStatus === 'HOLD'
                      ? 'text-rose-300'
                      : routeCombinedStatus === 'CAUTION'
                      ? 'text-amber-300'
                      : 'text-emerald-300'
                  }
                >
                  {limitingLeg}
                </strong>
              </div>
            )}

            {shoreRunwayWind && (
              <div className="text-[10px] font-mono text-slate-300 bg-slate-950/60 px-2.5 py-1.5 rounded border border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5">
                <span>
                  {shoreBaseFacility.code} {shoreRunwayWind.runwayLabel} Wind:
                </span>
                <span
                  className={
                    shoreRunwayWind.severity === 'HIGH'
                      ? 'text-rose-300 font-bold'
                      : shoreRunwayWind.severity === 'MODERATE'
                      ? 'text-amber-300 font-bold'
                      : 'text-emerald-300'
                  }
                >
                  HW {shoreRunwayWind.headwindKts}kt · XW {shoreRunwayWind.crosswindKts}kt (Gust XW{' '}
                  {shoreRunwayWind.gustCrosswindKts}kt)
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 font-mono text-[11px]">
              {corridorWaypoints.map((wp, idx) => (
                <div
                  key={idx}
                  className="p-2.5 sm:p-2 rounded bg-slate-950 border border-slate-800 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-cyan-400 font-bold truncate">
                      {idx + 1}. {wp.distanceFromShoreNm} NM
                    </span>
                    <span
                      className={`text-[9px] px-1 rounded font-bold ${
                        wp.status === 'GO'
                          ? 'text-emerald-400 bg-emerald-950'
                          : wp.status === 'CAUTION'
                          ? 'text-amber-400 bg-amber-950'
                          : 'text-rose-400 bg-rose-950'
                      }`}
                    >
                      {wp.status}
                    </span>
                  </div>
                  <div className="text-[10px] text-white font-sans font-semibold truncate">
                    {wp.label}
                  </div>
                  <div className="text-[10px] text-slate-300 tabular-nums">
                    10m:{' '}
                    <strong className="text-white">
                      {wp.windSpeed10mKts}G{wp.windGust10mKts}kt
                    </strong>
                  </div>
                  <div className="text-[10px] text-cyan-300 tabular-nums">
                    Ceil {wp.cloudCeilingFt}ft · Vis {wp.visibilityKm}km
                  </div>
                  <div className="text-[10px] text-slate-400 tabular-nums">
                    950hPa {wp.windSpeed950hPaKts}kt ({wp.windDir950hPaDeg}°)
                  </div>
                  <div className="text-[10px] pt-0.5 border-t border-slate-800/80 flex items-center justify-between">
                    <span
                      className={
                        wp.headwind950Kts > 0 ? 'text-amber-300' : 'text-emerald-300'
                      }
                    >
                      {wp.headwind950Kts >= 0
                        ? `HW +${wp.headwind950Kts}kt`
                        : `TW ${Math.abs(wp.headwind950Kts)}kt`}
                    </span>
                    <span
                      className={
                        wp.freezingLevelFt <= 2200
                          ? 'text-rose-400 font-bold'
                          : wp.freezingLevelFt <= 3200
                          ? 'text-purple-300'
                          : 'text-slate-400'
                      }
                    >
                      0°C {wp.freezingLevelFt}ft
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. Ventusky-Level Atmospheric & Marine Telemetry Grid */}
        <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
          <div className="p-2.5 sm:p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
            <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
              <span>
                {facility.elevationFt > 45
                  ? `Deck Wind (~${facility.elevationFt}ft)`
                  : '10m Surface Wind'}
              </span>
              <Wind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            </div>
            <div className="text-lg sm:text-xl font-mono font-bold tabular-nums text-white mt-1">
              {deckWindVal} <span className="text-xs font-normal text-slate-400">G</span>{' '}
              <span
                className={
                  gustVal >= cautionGustLimit ? 'text-amber-400' : 'text-white'
                }
              >
                {gustVal}
              </span>{' '}
              <span className="text-xs font-normal text-slate-400">KT</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
              10m {activeModelSnapshot?.windSpeed10mKts ?? 0}kt · 80m{' '}
              {activeModelSnapshot?.windSpeed80mKts ?? deckWindVal}kt · 950hPa{' '}
              {activeModelSnapshot?.windSpeed950hPaKts ?? 25}kt
            </div>
          </div>

          <div className="p-2.5 sm:p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
            <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
              <span>Significant Wave & Swell</span>
              <Waves className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            </div>
            <div className="text-lg sm:text-xl font-mono font-bold tabular-nums text-white mt-1">
              {waveVal} <span className="text-xs font-normal text-slate-400">m</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
              {swellRisk.label} ({activeHour?.swellDirDeg ?? 240}°) · SST{' '}
              {activeHour?.seaSurfaceTempC ?? weather?.temperatureC ?? 9}°C
            </div>
          </div>

          <div className="p-2.5 sm:p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
            <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
              <span>0°C Freezing & Temp/Dew</span>
              <Snowflake className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            </div>
            <div className="text-base sm:text-lg font-mono font-bold tabular-nums text-white mt-1">
              {freezeVal.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">ft</span> ·{' '}
              {activeModelSnapshot?.temp2mC ?? weather?.temperatureC ?? 8}°C
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
              Td {activeModelSnapshot?.dewPoint2mC ?? 5.5}°C (Spread {dewSpreadVal}°C) ·{' '}
              {precipVal}mm/h
            </div>
          </div>

          <div className="p-2.5 sm:p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
            <div className="flex items-center justify-between text-[11px] sm:text-xs text-slate-400">
              <span>Ceiling, Vis & Convection</span>
              <CloudLightning className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            </div>
            <div className="text-base sm:text-lg font-mono font-bold tabular-nums text-white mt-1">
              {ceilVal.toLocaleString()}{' '}
              <span className="text-xs font-normal text-slate-400">ft</span> · {visVal}{' '}
              <span className="text-xs font-normal text-slate-400">km</span>
            </div>
            <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
              QNH {activeModelSnapshot?.qnhHpa ?? weather?.pressureMslHpa ?? 1013} hPa · -10°C{' '}
              {(activeModelSnapshot?.minus10IsothermFt ?? 8500).toLocaleString()}ft · ΔT{' '}
              {activeModelSnapshot?.sstMinus500C ?? 25}°C
            </div>
          </div>
        </div>

        {/* 7. Live Shore Base METAR & Official Airport TAF (24–30h Aviation Forecast) */}
        {weather && (weather.rawMetar || weather.rawTaf || weather.delayRiskSummary) && (
          <div className={`p-3 rounded-lg border ${delayColor} space-y-2.5 min-w-0`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold min-w-0">
                <CloudFog className="w-4 h-4 text-cyan-400 shrink-0" />
                <span className="break-words">
                  SHORE BASE ({weather.shoreBaseIcao}) METAR & TAF
                  {weather.delayRiskLevel ? (
                    <>
                      :{' '}
                      <span
                        className={
                          weather.delayRiskLevel === 'HIGH'
                            ? 'text-rose-400'
                            : weather.delayRiskLevel === 'MODERATE'
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }
                      >
                        {weather.delayRiskLevel} RISK
                      </span>
                    </>
                  ) : null}
                </span>
              </div>
              {weather.flightCategory && (
                <span className="text-[11px] font-mono text-cyan-300 shrink-0">
                  CAT: {weather.flightCategory}
                </span>
              )}
            </div>

            {weather.delayRiskSummary && (
              <p className="text-xs text-slate-300 leading-relaxed break-words">
                {weather.delayRiskSummary}
              </p>
            )}

            {weather.rawMetar && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1">
                <div className="text-[10px] font-mono text-slate-400">
                  OFFICIAL AIRPORT METAR ({weather.shoreBaseIcao}):
                </div>
                <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-cyan-300 [overflow-wrap:anywhere]">
                  {weather.rawMetar}
                </div>
              </div>
            )}

            {weather.rawTaf && (
              <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-amber-300 font-semibold">
                    OFFICIAL AIRPORT TAF — 24–30H AVIATION FORECAST ({weather.shoreBaseIcao}):
                  </span>
                </div>
                {tafHighlights.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {tafHighlights.map((hl, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200 font-mono text-[10px]"
                      >
                        {hl}
                      </span>
                    ))}
                  </div>
                )}
                <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-amber-200 [overflow-wrap:anywhere] leading-relaxed">
                  {weather.rawTaf}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 8. Live Offshore Rig & Upwind Atlantic METAR Observations */}
        {nearbyMetars.length > 0 && (
          <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2.5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                <Radio className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>OFFSHORE RIG & UPWIND METAR RING</span>
              </div>
              <span className="text-[10px] font-mono text-slate-400">
                NEAREST {nearbyMetars.length} LIVE STATIONS
              </span>
            </div>

            <div className="space-y-2">
              {nearbyMetars.map((st) => {
                const catStyle =
                  st.flightCategory === 'VFR'
                    ? 'text-emerald-300 bg-emerald-950/70 border-emerald-500/40'
                    : st.flightCategory === 'MVFR'
                    ? 'text-cyan-300 bg-cyan-950/70 border-cyan-500/40'
                    : st.flightCategory === 'IFR'
                    ? 'text-amber-300 bg-amber-950/70 border-amber-500/40'
                    : 'text-rose-300 bg-rose-950/70 border-rose-500/40';
                return (
                  <div
                    key={st.icao}
                    className="p-2.5 bg-slate-950/90 border border-slate-800/90 rounded-lg space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-mono text-xs font-bold text-cyan-300">
                          {st.icao}
                        </span>
                        <span className="text-xs text-slate-200 font-medium truncate">
                          {st.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0 font-mono text-[10px]">
                        <span className="text-slate-400 tabular-nums">
                          {st.distanceNm} NM · {String(st.bearingDeg).padStart(3, '0')}°
                        </span>
                        {st.flightCategory && (
                          <span className={`px-1.5 py-0.5 rounded border ${catStyle}`}>
                            {st.flightCategory}
                          </span>
                        )}
                      </div>
                    </div>

                    {(st.seaStateLabel || typeof st.seaTempC === 'number') && (
                      <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
                        {st.seaStateLabel && (
                          <span className="px-1.5 py-0.5 rounded bg-sky-950/70 border border-sky-500/35 text-sky-300">
                            Sea State: {st.seaStateLabel}
                          </span>
                        )}
                        {typeof st.seaTempC === 'number' && (
                          <span className="px-1.5 py-0.5 rounded bg-teal-950/70 border border-teal-500/35 text-teal-300">
                            Sea Temp: {st.seaTempC}°C
                          </span>
                        )}
                      </div>
                    )}

                    <div className="font-mono text-[11px] text-slate-300 [overflow-wrap:anywhere] leading-relaxed">
                      {st.rawOb}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Helideck Hardware Specs & Live Data Source Verification */}
        <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-white flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-cyan-400" />
              Meteorological Models & Helideck Specs
            </span>
            <span className="font-mono text-[10px] text-emerald-400">7-DAY GRIB FEEDS</span>
          </div>

          <p className="text-[11px] text-slate-400 leading-relaxed">
            <strong>Live Sources:</strong> UK Met Office <strong>UKV</strong> (2 km UK / 10 km
            Global), DWD <strong>ICON-EU</strong> (6.5 km), <strong>ECMWF IFS</strong> (9 km Open
            Data), NOAA <strong>GFS</strong> (0.25°), ECCC <strong>GEM</strong> (15 km), Copernicus
            Marine / WaveWatch III, and NOAA Aviation Weather METAR/TAF queried live at{' '}
            {facility.lat.toFixed(2)}°N, {facility.lon.toFixed(2)}°E. Always confirm with official
            HLO & pilot brief.
          </p>
        </div>
          </>
        )}
      </div>
    </div>
  );
};
