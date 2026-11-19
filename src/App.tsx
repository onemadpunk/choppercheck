import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AircraftTarget,
  AirframePresetId,
  CorridorWaypointProfile,
  CustomRigOverride,
  FieldOperator,
  FlightAlertEvent,
  FlightOpsMode,
  HelideckWeatherState,
  HelicopterOperator,
  InstallationOrAirport,
  MultiModelHourEntry,
  SectorId,
  SpatialWeatherGridPoint,
  TrafficCategory,
  WeatherModelId,
  WeatherOverlayMode,
} from './types/radar';
import { INSTALLATIONS_AND_AIRPORTS, resolveHeliAdminStopCode } from './data/installationsAndAirports';
import {
  advanceAircraftPositionsSmoothly,
  fetchHelideckWeather,
  fetchHybridRadarTraffic,
} from './services/radarService';
import {
  AIRFRAME_PRESETS,
  fetchFlightCorridorProfile,
  fetchMultiModelRigForecast,
  fetchSpatialWeatherGrid,
  fetchCorridorTrackSamples,
} from './services/multiModelWeatherService';
import { RadarMap } from './components/RadarMap';
import { FlightDossierPanel } from './components/FlightDossierPanel';
import { CrewAndFlightBoard } from './components/CrewAndFlightBoard';
import { RigsAndAirportsDirectory } from './components/RigsAndAirportsDirectory';
import { HelideckWeatherPanel } from './components/HelideckWeatherPanel';
import { InstallAndGitHubModal } from './components/InstallAndGitHubModal';
import { OverheadSkyCompassModal } from './components/OverheadSkyCompassModal';
import { isRotaryAircraft, matchesAircraftCategory } from './utils/dataQuality';
import { regionsForView, ViewBounds } from './utils/trackingRegions';
import { startVisiblePolling } from './utils/visiblePolling';
import { useOnlineStatus } from './hooks/usePWAInstall';
import {
  getWhatsAppShareUrl,
  playCockpitAlertChime,
  requestNotificationPermission,
  triggerBrowserNotification,
} from './utils/alertsAndShare';
import {
  Bell,
  BellRing,
  Building2,
  CloudRainWind,
  Compass,
  LocateFixed,
  Pin,
  Plane,
  Radar,
  Share2,
  Star,
  X,
} from 'lucide-react';

type ActiveTab = 'radar' | 'flights' | 'directory' | 'weather';

const SECTOR_PRESETS: Array<{
  id: SectorId;
  label: string;
  lat: number;
  lon: number;
  zoom: number;
  defaultFacilityId: string;
}> = [
  {
    id: 'apache_north_sea',
    label: 'Apache',
    lat: 57.7269,
    lon: 0.8472,
    zoom: 7,
    defaultFacilityId: 'apache-forties-charlie',
  },
  {
    id: 'west_of_shetland',
    label: 'West of Shetland',
    lat: 60.45,
    lon: -2.85,
    zoom: 7,
    defaultFacilityId: 'wos-glen-lyon-fpso',
  },
  {
    id: 'uk_north_sea',
    label: 'UK North Sea',
    lat: 57.65,
    lon: 0.8,
    zoom: 6,
    defaultFacilityId: 'uk-etap',
  },
  {
    id: 'irish_sea',
    label: 'Irish Sea',
    lat: 53.75,
    lon: -3.4,
    zoom: 8,
    defaultFacilityId: 'uk-south-morecambe-cpc1',
  },
  {
    id: 'southern_north_sea',
    label: 'Southern NS',
    lat: 53.65,
    lon: 1.45,
    zoom: 7,
    defaultFacilityId: 'uk-sns-clipper',
  },
  {
    id: 'norway_ncs',
    label: 'Norway',
    lat: 59.8,
    lon: 3.1,
    zoom: 6,
    defaultFacilityId: 'no-johan-sverdrup',
  },
  {
    id: 'uk_airports',
    label: 'UK Overview',
    lat: 54.6,
    lon: -2.2,
    zoom: 6,
    defaultFacilityId: 'apt-egpd',
  },
];

export default function App() {
  const isOnline = useOnlineStatus();

  // Registry state (allows adding custom coordinates)
  const [facilities, setFacilities] = useState<InstallationOrAirport[]>(
    INSTALLATIONS_AND_AIRPORTS
  );

  // Active locked installation or airport (persisted in localStorage)
  const [activeFacilityId, setActiveFacilityId] = useState<string>(() => {
    try {
      return localStorage.getItem('choppercheck_home_rig_id') || 'wos-glen-lyon-fpso';
    } catch {
      return 'wos-glen-lyon-fpso';
    }
  });
  const [referenceLocation] = useState({ lat: 57.65, lon: 0.8 });
  const activeFacility = useMemo(
    () =>
      facilities.find((f) => f.id === activeFacilityId) ||
      facilities[0] ||
      ({
        id: 'map-reference',
        code: 'MAP',
        name: 'North Sea map reference',
        shortName: 'Map reference',
        lat: referenceLocation.lat,
        lon: referenceLocation.lon,
        assetType: 'Map reference',
        fieldOperator: 'UK Airport / Heliport',
        primaryShoreBase: 'EGPD',
        helicopterOperators: [],
        regionLabel: '',
        elevationFt: 0,
        sector: 'uk_north_sea',
      } as InstallationOrAirport),
    [facilities, activeFacilityId, referenceLocation]
  );

  // Favourite / Starred Rigs (persisted in localStorage for 1-tap mobile switching)
  const [favoriteFacilityIds, setFavoriteFacilityIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('choppercheck_favorite_rigs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.filter((id): id is string => typeof id === 'string');
        }
      }
    } catch {
      // ignore storage errors
    }
    return ['wos-glen-lyon-fpso', 'apache-forties-charlie', 'uk-culzean', 'apt-egpd'];
  });

  // Single-Rig Focus Mode (hides all other 60+ rigs on the map so phone screen only shows your 1 rig + shore base)
  const [singleRigFocus, setSingleRigFocus] = useState<boolean>(() => {
    try {
      return localStorage.getItem('choppercheck_single_rig_focus') === 'true';
    } catch {
      return false;
    }
  });

  // Active navigation tab (used on mobile and right dock on desktop)
  const [activeTab, setActiveTab] = useState<ActiveTab>('radar');
  const [dockTab, setDockTab] = useState<'flights' | 'directory' | 'weather'>('flights');

  // Map viewport target state
  const [activeSector, setActiveSector] = useState<SectorId>(() => activeFacility.sector);
  const [mapViewTarget, setMapViewTarget] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    seq: number;
  }>(() => ({
    lat: activeFacility.lat,
    lon: activeFacility.lon,
    zoom: activeFacilityId ? 7 : 6,
    seq: 1,
  }));
  const [queryCenter, setQueryCenter] = useState<{
    lat: number;
    lon: number;
    bounds?: ViewBounds;
  }>(() => ({
    lat: activeFacility.lat,
    lon: activeFacility.lon,
  }));

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<
    'all' | TrafficCategory | 'active_facility'
  >('all');
  const [heliOpFilter, setHeliOpFilter] = useState<'all' | HelicopterOperator>('all');
  const [selectedFieldOperator, setSelectedFieldOperator] = useState<'all' | FieldOperator>('all');
  const [showRangeRings, setShowRangeRings] = useState<boolean>(true);
  const [showFacilityLabels, setShowFacilityLabels] = useState<boolean>(true);
  const [feedState, setFeedState] = useState<
    'loading' | 'available' | 'partial' | 'unavailable'
  >('loading');
  const [feedProvider, setFeedProvider] = useState('');

  // Flights & Selection State
  const [flights, setFlights] = useState<AircraftTarget[]>([]);
  const liveCount = flights.length;
  const [selectedFlightHex, setSelectedFlightHex] = useState<string | null>(null);
  const [pinnedFlightHex, setPinnedFlightHex] = useState<string | null>(() => {
    try {
      return localStorage.getItem('deckwatch_pinned_hex') || null;
    } catch {
      return null;
    }
  });

  const queryCenterRef = useRef<{ lat: number; lon: number; bounds?: ViewBounds }>(queryCenter);
  useEffect(() => {
    queryCenterRef.current = queryCenter;
  }, [queryCenter]);
  const queryRegionKey = useMemo(
    () => regionsForView(queryCenter.lat, queryCenter.lon, queryCenter.bounds).join(','),
    [queryCenter]
  );

  // Persistent memory of recently seen live aircraft (45s retention) so targets never blink/vanish on a missed packet
  const recentAircraftMapRef = useRef<Map<string, { flight: AircraftTarget; seenAt: number }>>(
    new Map()
  );

  // Due-Off Flight & 25/10 NM Approach Alert State
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(false);
  const [activeAlertBanner, setActiveAlertBanner] = useState<FlightAlertEvent | null>(null);
  const firedAlertKeysRef = useRef<Set<string>>(new Set());
  const previousAlertPositions = useRef<Map<string, AircraftTarget>>(new Map());

  // Weather & METAR State + 7-Day Multi-Model Streamline Engine
  const [weather, setWeather] = useState<HelideckWeatherState | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);
  const [weatherOverlayMode, setWeatherOverlayMode] =
    useState<WeatherOverlayMode>('go_nogo_matrix');
  const [weatherModelId, setWeatherModelId] = useState<WeatherModelId>('ukmo_seamless');
  const [airframePresetId, setAirframePresetId] = useState<AirframePresetId>('S92');
  const [spatialGrid, setSpatialGrid] = useState<SpatialWeatherGridPoint[]>([]);
  const [corridorRouteSamples, setCorridorRouteSamples] = useState<SpatialWeatherGridPoint[]>([]);
  const [hourlyForecast, setHourlyForecast] = useState<MultiModelHourEntry[]>([]);
  const [selectedHourIdx, setSelectedHourIdx] = useState<number>(0);
  const [corridorWaypoints, setCorridorWaypoints] = useState<CorridorWaypointProfile[]>([]);
  const [ensembleLoading, setEnsembleLoading] = useState<boolean>(false);
  const [cachedForecastSavedAt, setCachedForecastSavedAt] = useState<string | null>(null);
  const [flightOpsMode, setFlightOpsMode] = useState<FlightOpsMode>(() => {
    try {
      const saved = localStorage.getItem('choppercheck_flight_ops_mode');
      return saved === 'daylight_only' ? 'daylight_only' : '24h_ops';
    } catch {
      return '24h_ops';
    }
  });
  const [customRigOverrides, setCustomRigOverrides] = useState<
    Record<string, CustomRigOverride>
  >(() => {
    try {
      const raw = localStorage.getItem('choppercheck_rig_overrides');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [shoreBaseOverrides, setShoreBaseOverrides] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem('choppercheck_shore_base_overrides');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // Modals: Install help and GPS aircraft compass
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [showSkyCompassModal, setShowSkyCompassModal] = useState<boolean>(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'simple' | 'detailed'>(() => {
    try {
      return localStorage.getItem('choppercheck_wx_view_mode') === 'detailed'
        ? 'detailed'
        : 'simple';
    } catch {
      return 'simple';
    }
  });

  const handleSetViewMode = useCallback((mode: 'simple' | 'detailed') => {
    setViewMode(mode);
    try {
      localStorage.setItem('choppercheck_wx_view_mode', mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  // Load shared rig and optional HLL limits from URL parameters (?rig=GL&gust=40&wave=5.0&ceil=250&hdg=240&pr=2.0&inc=2.5&shr=1.0)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const rigParam = params.get('rig');
      if (!rigParam) return;
      const matched =
        INSTALLATIONS_AND_AIRPORTS.find(
          (f) => f.id.toLowerCase() === rigParam.toLowerCase() || f.code.toLowerCase() === rigParam.toLowerCase()
        ) || resolveHeliAdminStopCode(rigParam);
      if (!matched) return;

      setActiveFacilityId(matched.id);
      setActiveSector(matched.sector);
      setQueryCenter({ lat: matched.lat, lon: matched.lon });
      setMapViewTarget((prev) => ({
        lat: matched.lat,
        lon: matched.lon,
        zoom: matched.assetType === 'UK Airport' || matched.assetType === 'SAR Base' ? 9 : 8,
        seq: prev.seq + 1,
      }));

      const sharedOverride: CustomRigOverride = {};
      let hasSharedParam = false;
      const numParam = (k: string) => {
        const v = params.get(k);
        if (v !== null && v.trim() !== '' && Number.isFinite(Number(v))) {
          hasSharedParam = true;
          return Number(v);
        }
        return undefined;
      };
      sharedOverride.maxGustKts = numParam('gust');
      sharedOverride.maxWaveM = numParam('wave');
      sharedOverride.minCeilingFt = numParam('ceil');
      sharedOverride.vesselHeadingDeg = numParam('hdg');
      sharedOverride.maxPitchRollDeg = numParam('pr');
      sharedOverride.maxInclinationDeg = numParam('inc');
      sharedOverride.maxShrMs = numParam('shr');
      if (params.get('daylight') === '1') {
        sharedOverride.daylightOnlyDeck = true;
        hasSharedParam = true;
      }
      if (hasSharedParam) {
        setCustomRigOverrides((prev) => {
          const next = { ...prev, [matched.id]: sharedOverride };
          try {
            localStorage.setItem('choppercheck_rig_overrides', JSON.stringify(next));
          } catch {
            // ignore storage errors
          }
          return next;
        });
      }
    } catch {
      // ignore URL parsing errors
    }
  }, []);

  // Expiry runs even when every network request fails. Predictions retain the original observation time.
  useEffect(() => {
    const timer = setInterval(() => {
      setFlights((prev) => advanceAircraftPositionsSmoothly(prev, 2, activeFacility));
      const now = Date.now();
      for (const [hex, entry] of recentAircraftMapRef.current) {
        if (!entry.flight.observedAt || now - entry.flight.observedAt > 45000) {
          recentAircraftMapRef.current.delete(hex);
        }
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeFacility]);

  // Changing the reference location starts afresh; panning or zooming the map keeps the aircraft already shown.
  useEffect(() => {
    recentAircraftMapRef.current.clear();
    previousAlertPositions.current.clear();
    firedAlertKeysRef.current.clear();
    setFlights([]);
    setFeedState('loading');
  }, [activeFacility]);

  useEffect(() => {
    const stop = startVisiblePolling(async (signal) => {
      const center = queryCenterRef.current;
      const result = await fetchHybridRadarTraffic(
        center.lat,
        center.lon,
        activeFacility,
        0,
        false,
        signal,
        center.bounds
      );
      if (signal.aborted) return;
      setFeedState(
        result.feedAvailable ? (result.partial ? 'partial' : 'available') : 'unavailable'
      );
      if (result.provider) setFeedProvider(result.provider);
      const now = Date.now();
      for (const flight of result.flights) {
        recentAircraftMapRef.current.set(flight.hex, { flight, seenAt: flight.observedAt! });
      }
      for (const [hex, entry] of recentAircraftMapRef.current) {
        if (!entry.flight.observedAt || now - entry.flight.observedAt > 45000) {
          recentAircraftMapRef.current.delete(hex);
        }
      }
      const current = advanceAircraftPositionsSmoothly(
        [...recentAircraftMapRef.current.values()].map((e) => e.flight),
        0,
        activeFacility
      );
      setFlights(current);
      setSelectedFlightHex((prev) => (current.some((f) => f.hex === prev) ? prev : null));
      return result.retryAfterMs;
    });
    return stop;
  }, [activeFacility, queryRegionKey]);

  // Only observed positions trigger alerts. Proximity is not evidence of an approach or destination.
  useEffect(() => {
    for (const f of flights) {
      if (!f.observedAt || Date.now() - f.observedAt > 10000) continue;
      const prev = previousAlertPositions.current.get(f.hex);
      if (prev?.observedAt === f.observedAt) continue;
      previousAlertPositions.current.set(f.hex, f);
      if (!alertsEnabled) continue;
      const pinned = pinnedFlightHex === f.hex;
      const heli = isRotaryAircraft(f);
      let key = '';
      let message = '';
      let type: FlightAlertEvent['triggerType'] = 'AIRBORNE_LIFTOFF';
      if (f.turnback && !firedAlertKeysRef.current.has(f.hex + '_RTB')) {
        type = 'TURNBACK';
        key = f.hex + '_RTB';
        message =
          'TURNBACK: ' +
          f.callsign +
          ' (' +
          f.typeCode +
          ') turned back ' +
          f.turnback.maxDistanceNm +
          ' NM out and is heading back to ' +
          f.turnback.baseName +
          '. Reason not published.';
      } else if (
        pinned &&
        f.altitudeReported &&
        f.speedReported &&
        f.altitudeFt >= 200 &&
        f.groundSpeedKts >= 45 &&
        !firedAlertKeysRef.current.has(f.hex + '_DETECTED')
      ) {
        key = f.hex + '_DETECTED';
        message =
          'PINNED AIRCRAFT DETECTED AIRBORNE: ' +
          f.callsign +
          '. Take-off time and destination are not confirmed.';
      } else if (
        activeFacility.id !== 'map-reference' &&
        (pinned || heli) &&
        prev &&
        prev.observedAt &&
        f.observedAt - prev.observedAt <= 15000
      ) {
        const ring =
          prev.distanceFromRefNm > 10 && f.distanceFromRefNm <= 10
            ? 10
            : prev.distanceFromRefNm > 25 && f.distanceFromRefNm <= 25
            ? 25
            : null;
        if (ring) {
          type = ring === 10 ? 'RING_10NM' : 'RING_25NM';
          key = f.hex + '_' + activeFacility.id + '_' + ring;
          message =
            f.callsign +
            ' entered the ' +
            ring +
            ' NM proximity ring around ' +
            activeFacility.shortName +
            '. Destination is not confirmed.';
        } else if (
          (f.squawk === '7700' || f.category === 'coastguard_sar') &&
          f.distanceFromRefNm <= 40 &&
          !firedAlertKeysRef.current.has(f.hex + '_' + activeFacility.id + '_SAR7700')
        ) {
          type = 'SAR_OR_7700';
          key = f.hex + '_' + activeFacility.id + '_SAR7700';
          message =
            (f.squawk === '7700' ? 'EMERGENCY SQUAWK 7700: ' : 'COASTGUARD SAR IN SECTOR: ') +
            f.callsign +
            ' (' +
            f.distanceFromRefNm +
            ' NM from ' +
            activeFacility.code +
            ').';
        }
      }
      if (!key || firedAlertKeysRef.current.has(key)) continue;
      firedAlertKeysRef.current.add(key);
      setActiveAlertBanner({
        id: key,
        timestamp: new Date().toLocaleTimeString('en-GB'),
        callsign: f.callsign,
        typeFullName: f.typeFullName,
        triggerType: type,
        message,
      });
      playCockpitAlertChime(type === 'RING_10NM' || type === 'SAR_OR_7700' || type === 'TURNBACK');
      triggerBrowserNotification('ChopperCheck: ' + f.callsign, message);
    }
    const present = new Set(flights.map((f) => f.hex));
    for (const hex of previousAlertPositions.current.keys()) {
      if (!present.has(hex)) previousAlertPositions.current.delete(hex);
    }
  }, [flights, alertsEnabled, pinnedFlightHex, activeFacility]);

  const availableShoreBases = useMemo(
    () =>
      facilities.filter(
        (f) =>
          f.assetType === 'UK Airport' ||
          f.assetType === 'Shore Heliport' ||
          f.assetType === 'SAR Base' ||
          f.assetType === 'Norwegian Hub'
      ),
    [facilities]
  );

  const shoreBaseFacility = useMemo(() => {
    const baseCode =
      shoreBaseOverrides[activeFacility.id] || activeFacility.primaryShoreBase || 'EGPD';
    return (
      facilities.find((f) => f.code.toUpperCase() === baseCode.toUpperCase()) ||
      facilities.find((f) => f.code === 'EGPD') ||
      facilities[0]
    );
  }, [facilities, activeFacility.id, activeFacility.primaryShoreBase, shoreBaseOverrides]);

  const activeRigOverride = customRigOverrides[activeFacility.id] || null;

  const handleChangeFlightOpsMode = useCallback((mode: FlightOpsMode) => {
    setFlightOpsMode(mode);
    try {
      localStorage.setItem('choppercheck_flight_ops_mode', mode);
    } catch {
      // ignore storage errors
    }
  }, []);

  const handleChangeActiveRigOverride = useCallback(
    (override: CustomRigOverride | null) => {
      setCustomRigOverrides((prev) => {
        const next = { ...prev };
        if (
          !override ||
          (!override.maxGustKts &&
            !override.maxWaveM &&
            !override.daylightOnlyDeck &&
            typeof override.vesselHeadingDeg !== 'number')
        ) {
          delete next[activeFacility.id];
        } else {
          next[activeFacility.id] = override;
        }
        try {
          localStorage.setItem('choppercheck_rig_overrides', JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [activeFacility.id]
  );

  const handleChangeShoreBaseCode = useCallback(
    (code: string) => {
      setShoreBaseOverrides((prev) => {
        const next = { ...prev, [activeFacility.id]: code };
        try {
          localStorage.setItem('choppercheck_shore_base_overrides', JSON.stringify(next));
        } catch {
          // ignore storage errors
        }
        return next;
      });
    },
    [activeFacility.id]
  );

  const activePreset = useMemo(() => AIRFRAME_PRESETS[airframePresetId], [airframePresetId]);
  const selectedHourIso = hourlyForecast[selectedHourIdx]?.hourIso;

  const weatherRequestRef = useRef(0);
  // Rig whose on-screen forecast is fresh (not the saved copy), so refreshes don't flash the saved one
  const freshForecastFacilityRef = useRef<string | null>(null);
  const loadWeather = useCallback(async () => {
    const requestId = ++weatherRequestRef.current;
    if (activeFacility.id === 'map-reference') {
      setWeather(null);
      setWeatherLoading(false);
      setEnsembleLoading(false);
      return;
    }
    setWeatherLoading(true);
    setEnsembleLoading(true);

    const WX_CACHE_KEY = 'choppercheck_wx_cache_v1';
    const readSavedForecast = (facId: string): { savedAtIso: string; hours: MultiModelHourEntry[] } | null => {
      try {
        const raw = localStorage.getItem(WX_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<
          string,
          { savedAtIso: string; savedAtMs: number; hours: MultiModelHourEntry[] }
        >;
        const entry = parsed?.[facId];
        if (!entry || !Array.isArray(entry.hours) || entry.hours.length === 0) return null;
        // A saved 7-day forecast stays useful for a couple of days; it is shown with its age
        if (Date.now() - entry.savedAtMs > 48 * 3600 * 1000) return null;
        // Drop hours that have already passed so the saved forecast starts at the current hour
        const nowMs = Date.now();
        const hours = entry.hours
          .filter((h) => new Date(h.hourIso + 'Z').getTime() + 3600_000 > nowMs)
          .map((h, i) => ({ ...h, hourIndex: i }));
        if (hours.length === 0) return null;
        return { savedAtIso: entry.savedAtIso, hours };
      } catch {
        return null;
      }
    };

    const writeSavedForecast = (facId: string, hours: MultiModelHourEntry[]) => {
      if (hours.length === 0) return;
      try {
        const raw = localStorage.getItem(WX_CACHE_KEY);
        const parsed = raw
          ? (JSON.parse(raw) as Record<
              string,
              { savedAtIso: string; savedAtMs: number; hours: MultiModelHourEntry[] }
            >)
          : {};
        parsed[facId] = {
          savedAtIso: new Date().toISOString(),
          savedAtMs: Date.now(),
          hours,
        };
        const keys = Object.keys(parsed);
        if (keys.length > 6) {
          keys
            .sort((a, b) => (parsed[a]?.savedAtMs || 0) - (parsed[b]?.savedAtMs || 0))
            .slice(0, keys.length - 6)
            .forEach((k) => delete parsed[k]);
        }
        localStorage.setItem(WX_CACHE_KEY, JSON.stringify(parsed));
      } catch {
        // ignore storage quota errors
      }
    };

    // Show the saved forecast straight away (labelled with its age) while the fresh one loads,
    // so a slow or retried request on a weak signal never leaves the screen empty
    const savedNow =
      freshForecastFacilityRef.current === activeFacility.id ? null : readSavedForecast(activeFacility.id);
    if (savedNow) {
      setHourlyForecast(savedNow.hours);
      setCachedForecastSavedAt(savedNow.savedAtIso);
    }

    fetchMultiModelRigForecast(activeFacility, activePreset)
      .then((hours) => {
        if (requestId !== weatherRequestRef.current) return;
        if (hours.length > 0) {
          freshForecastFacilityRef.current = activeFacility.id;
          setHourlyForecast(hours);
          setCachedForecastSavedAt(null);
          writeSavedForecast(activeFacility.id, hours);
        } else {
          const cached = readSavedForecast(activeFacility.id);
          if (cached) {
            setHourlyForecast(cached.hours);
            setCachedForecastSavedAt(cached.savedAtIso);
          } else {
            setHourlyForecast([]);
            setCachedForecastSavedAt(null);
          }
        }
        setEnsembleLoading(false);
      })
      .catch(() => {
        if (requestId !== weatherRequestRef.current) return;
        const cached = readSavedForecast(activeFacility.id);
        if (cached) {
          setHourlyForecast(cached.hours);
          setCachedForecastSavedAt(cached.savedAtIso);
        }
        setEnsembleLoading(false);
      });

    fetchHelideckWeather(activeFacility)
      .then((wx) => {
        if (requestId !== weatherRequestRef.current) return;
        setWeather(wx);
        setWeatherLoading(false);
      })
      .catch(() => {
        if (requestId !== weatherRequestRef.current) return;
        setWeatherLoading(false);
      });
  }, [activeFacility, activePreset]);

  useEffect(() => {
    setWeather(null);
    void loadWeather();
    const timer = setInterval(() => void loadWeather(), 10 * 60 * 1000);
    return () => {
      weatherRequestRef.current++;
      clearInterval(timer);
    };
  }, [loadWeather]);

  // Update Shore-to-Rig Flight Corridor for the selected forecast hour (e.g. Monday 11:00 UTC)
  useEffect(() => {
    if (activeFacility.id === 'map-reference') return;
    let cancelled = false;
    const loadCorridor = async () => {
      const corridor = await fetchFlightCorridorProfile(
        shoreBaseFacility,
        activeFacility,
        activePreset,
        selectedHourIso,
        weatherModelId
      );
      if (!cancelled) {
        setCorridorWaypoints(corridor);
      }
    };
    void loadCorridor();
    return () => {
      cancelled = true;
    };
  }, [shoreBaseFacility, activeFacility, activePreset, selectedHourIso, weatherModelId]);

  // Sample the selected model along the shore base -> rig track and both 18 NM detours, only while
  // the lightning overlay is on, so the route check is not limited to the coarse background grid.
  useEffect(() => {
    if (
      weatherOverlayMode !== 'triggered_lightning' ||
      activeFacility.id === 'map-reference' ||
      activeFacility.id === shoreBaseFacility.id
    ) {
      setCorridorRouteSamples([]);
      return;
    }
    let cancelled = false;
    setCorridorRouteSamples([]);
    void fetchCorridorTrackSamples(shoreBaseFacility, activeFacility, weatherModelId, selectedHourIso).then(
      (samples) => {
        if (!cancelled) setCorridorRouteSamples(samples);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [weatherOverlayMode, shoreBaseFacility, activeFacility, weatherModelId, selectedHourIso]);

  // Update 25-point UK & North Sea Spatial Weather Grid for the selected model & forecast hour
  useEffect(() => {
    let cancelled = false;
    const loadGrid = async () => {
      const grid = await fetchSpatialWeatherGrid(weatherModelId, selectedHourIso);
      if (!cancelled) {
        setSpatialGrid(grid);
      }
    };
    void loadGrid();
    return () => {
      cancelled = true;
    };
  }, [weatherModelId, selectedHourIso]);

  // Filter installations shown on map by Single-Rig Focus or selectedFieldOperator
  const visibleInstallations = useMemo(() => {
    if (singleRigFocus) {
      return facilities.filter(
        (f) =>
          f.id === activeFacility.id ||
          f.code.toUpperCase() === activeFacility.primaryShoreBase.toUpperCase()
      );
    }
    if (selectedFieldOperator === 'all') return facilities;
    return facilities.filter(
      (f) => f.fieldOperator === selectedFieldOperator || f.id === activeFacility.id
    );
  }, [
    facilities,
    singleRigFocus,
    selectedFieldOperator,
    activeFacility.id,
    activeFacility.primaryShoreBase,
  ]);

  const favoriteFacilities = useMemo(
    () =>
      favoriteFacilityIds
        .map((id) => facilities.find((f) => f.id === id))
        .filter((f): f is InstallationOrAirport => !!f),
    [facilities, favoriteFacilityIds]
  );

  const handleToggleFavoriteFacility = useCallback((facId: string) => {
    setFavoriteFacilityIds((prev) => {
      const next = prev.includes(facId)
        ? prev.filter((id) => id !== facId)
        : [facId, ...prev];
      try {
        localStorage.setItem('choppercheck_favorite_rigs', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const handleToggleSingleRigFocus = useCallback(() => {
    setSingleRigFocus((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('choppercheck_single_rig_focus', String(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Filter flights shown on map
  const visibleFlights = useMemo(() => {
    return flights.filter((f) => {
      if (categoryFilter === 'active_facility') {
        const matches =
          f.destinationCode === activeFacility.code ||
          f.originCode === activeFacility.code ||
          f.destinationRigId === activeFacility.id ||
          f.distanceFromRefNm <= 35;
        if (!matches) return false;
      } else if (!matchesAircraftCategory(f, categoryFilter)) {
        return false;
      }

      if (heliOpFilter !== 'all' && f.helicopterOperator !== heliOpFilter) {
        return false;
      }

      if (
        selectedFieldOperator !== 'all' &&
        selectedFieldOperator !== 'UK Airport / Heliport' &&
        selectedFieldOperator !== 'HM Coastguard / SAR'
      ) {
        if (f.fieldOperatorServed && f.fieldOperatorServed !== selectedFieldOperator) {
          return false;
        }
      }

      return true;
    });
  }, [flights, categoryFilter, heliOpFilter, selectedFieldOperator, activeFacility]);

  const selectedFlight = useMemo(
    () => flights.find((f) => f.hex === selectedFlightHex) || null,
    [flights, selectedFlightHex]
  );

  const pinnedFlight = useMemo(
    () => flights.find((f) => f.hex === pinnedFlightHex) || null,
    [flights, pinnedFlightHex]
  );

  const handleTogglePin = useCallback((hex: string) => {
    requestNotificationPermission();
    setPinnedFlightHex((prev) => {
      const next = prev === hex ? null : hex;
      try {
        if (next) localStorage.setItem('deckwatch_pinned_hex', next);
        else localStorage.removeItem('deckwatch_pinned_hex');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const handleToggleAlerts = useCallback(() => {
    requestNotificationPermission();
    setAlertsEnabled((prev) => {
      const next = !prev;
      if (next) playCockpitAlertChime(false);
      return next;
    });
  }, []);

  const handleSelectSector = (preset: (typeof SECTOR_PRESETS)[number]) => {
    setActiveSector(preset.id);
    setActiveFacilityId(preset.defaultFacilityId);
    try {
      localStorage.setItem('choppercheck_home_rig_id', preset.defaultFacilityId);
    } catch {
      // ignore storage errors
    }
    if (preset.id === 'apache_north_sea') {
      setSelectedFieldOperator('Apache');
    } else {
      setSelectedFieldOperator('all');
    }
    setQueryCenter({ lat: preset.lat, lon: preset.lon });
    setMapViewTarget((prev) => ({
      lat: preset.lat,
      lon: preset.lon,
      zoom: preset.zoom,
      seq: prev.seq + 1,
    }));
  };

  const handleSelectFacility = useCallback((fac: InstallationOrAirport) => {
    setActiveFacilityId(fac.id);
    setActiveSector(fac.sector);
    if (fac.maxHeliType?.startsWith('Airbus H175')) {
      setAirframePresetId('H175');
    } else if (fac.maxHeliType?.startsWith('AW189')) {
      setAirframePresetId('AW189');
    } else if (fac.maxHeliType?.startsWith('AW139')) {
      setAirframePresetId('AW139');
    } else {
      setAirframePresetId('S92');
    }
    try {
      localStorage.setItem('choppercheck_home_rig_id', fac.id);
    } catch {
      // ignore storage errors
    }
    setQueryCenter({ lat: fac.lat, lon: fac.lon });
    setMapViewTarget((prev) => ({
      lat: fac.lat,
      lon: fac.lon,
      zoom: fac.assetType === 'UK Airport' || fac.assetType === 'SAR Base' ? 9 : 8,
      seq: prev.seq + 1,
    }));
  }, []);

  const handleSelectFlight = useCallback((flight: AircraftTarget) => {
    setSelectedFlightHex(flight.hex);
    setMobileDetailsOpen(true);
    setMapViewTarget((prev) => ({
      lat: flight.lat,
      lon: flight.lon,
      zoom: 8,
      seq: prev.seq + 1,
    }));
  }, []);

  const handleUseMyGps = useCallback(() => {
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(4));
          const lon = Number(pos.coords.longitude.toFixed(4));
          const customHome: InstallationOrAirport = {
            id: 'custom-gps-home',
            code: 'MY-GPS',
            name: `My GPS Location (${lat.toFixed(2)}°N, ${lon.toFixed(2)}°E)`,
            shortName: 'My GPS Location',
            fieldOperator: 'UK Airport / Heliport',
            assetType: 'GPS location',
            sector: 'scotland_airports',
            lat,
            lon,
            elevationFt: 50,
            primaryShoreBase: 'EGPK',
            helicopterOperators: ['HM Coastguard', 'Bristow', 'Commercial Airline'],
            regionLabel: 'Live Phone / Browser GPS Coordinate',
            notes: 'Centred on your current GPS coordinates.',
          };

          setFacilities((prev) => {
            const withoutOld = prev.filter((p) => p.id !== 'custom-gps-home');
            return [customHome, ...withoutOld];
          });
          setActiveFacilityId('custom-gps-home');
          setQueryCenter({ lat, lon });
          setMapViewTarget((prev) => ({ lat, lon, zoom: 9, seq: prev.seq + 1 }));
        },
        () => {
          // If GPS denied, center on active facility
          setMapViewTarget((prev) => ({
            lat: activeFacility.lat,
            lon: activeFacility.lon,
            zoom: 8,
            seq: prev.seq + 1,
          }));
        },
        { enableHighAccuracy: true, timeout: 6000 }
      );
    }
  }, [activeFacility]);

  const handleAddCustomCoordinate = useCallback(
    (name: string, lat: number, lon: number) => {
      const newFac: InstallationOrAirport = {
        id: `custom-${Date.now()}`,
        code: 'CUSTOM',
        name,
        shortName: name,
        fieldOperator: 'UK Airport / Heliport',
        assetType: 'Custom location',
        sector: 'uk_north_sea',
        lat,
        lon,
        elevationFt: 0,
        primaryShoreBase: 'EGPD',
        helicopterOperators: [],
        regionLabel: `Custom location (${lat.toFixed(3)}°N, ${lon.toFixed(3)}°E)`,
      };
      setFacilities((prev) => [newFac, ...prev]);
      handleSelectFacility(newFac);
    },
    [handleSelectFacility]
  );

  const handleMapCenterChanged = useCallback(
    (lat: number, lon: number, bounds?: ViewBounds) => {
      setQueryCenter((prev) => {
        const prevBounds = prev.bounds;
        const sameBounds =
          prevBounds &&
          bounds &&
          Math.abs(prevBounds.south - bounds.south) < 0.15 &&
          Math.abs(prevBounds.north - bounds.north) < 0.15 &&
          Math.abs(prevBounds.west - bounds.west) < 0.15 &&
          Math.abs(prevBounds.east - bounds.east) < 0.15;
        if (
          Math.abs(prev.lat - lat) < 0.18 &&
          Math.abs(prev.lon - lon) < 0.18 &&
          sameBounds
        ) {
          return prev;
        }
        return { lat, lon, bounds };
      });
    },
    []
  );

  return (
    <div className="app-shell h-[100dvh] w-screen overflow-hidden bg-[#07090e] text-slate-100 flex flex-col select-none">
      {/* =====================================================================
          PINNED DUE-OFF FLIGHT / 10 NM APPROACH ALERT BANNER
         ===================================================================== */}
      {activeAlertBanner && (
        <div className="bg-amber-500 text-slate-950 px-3 py-2 flex items-center justify-between gap-2 z-50 shrink-0 font-medium text-xs shadow-lg">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="w-4 h-4 shrink-0 animate-bounce" />
            <span className="truncate font-bold">{activeAlertBanner.message}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {pinnedFlight && (
              <a
                href={getWhatsAppShareUrl(pinnedFlight, activeFacility.shortName)}
                target="_blank"
                rel="noopener noreferrer"
                className="px-2.5 py-1.5 rounded bg-slate-950 text-amber-400 font-mono text-[10px] flex items-center gap-1"
              >
                <Share2 className="w-3 h-3" /> WhatsApp
              </a>
            )}
            <button
              onClick={() => setActiveAlertBanner(null)}
              aria-label="Dismiss alert"
              className="p-2 rounded hover:bg-amber-600/40 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* =====================================================================
          TOP COMMAND BAR (Compact, Mobile-Safe, Zero Clutter)
         ===================================================================== */}
      <header className="min-h-13 px-2.5 sm:px-3 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] bg-slate-950/95 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0 z-30">
        {/* Left: Brand Identity & Active Locked Rig/Airport */}
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Radar className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] sm:text-sm font-bold tracking-tight text-white truncate">
                <span className="sm:hidden">ChopperCheck</span>
                <span className="hidden sm:inline">ChopperCheck.com</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold shrink-0 ${
                  isOnline
                    ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-500/40'
                    : 'bg-amber-950/80 text-amber-400 border border-amber-500/40'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                {isOnline ? 'LIVE' : 'OFFLINE'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400 truncate font-mono">
              {activeFacility.shortName.includes(`(${activeFacility.code})`)
                ? activeFacility.shortName
                : `${activeFacility.shortName} (${activeFacility.code})`}
              <span className="hidden sm:inline text-cyan-400"> · Made by onemadpunk</span>
            </div>
          </div>
        </div>

        {/* Center Desktop Quick Sector Switcher */}
        <div className="hidden xl:flex items-center gap-1 bg-slate-900/90 p-1 rounded-lg border border-slate-800">
          {SECTOR_PRESETS.map((preset) => {
            const active = activeSector === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectSector(preset)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:text-white hover:bg-slate-800'
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        {/* Right: Quick Rig Selector + Overhead Sky Compass + Alerts */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pinned Due-Off Flight Pill (if active) */}
          {pinnedFlight && (
            <button
              onClick={() => handleSelectFlight(pinnedFlight)}
              className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-mono cursor-pointer"
            >
              <Pin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>{pinnedFlight.callsign}</span>
            </button>
          )}

          {/* Global Simple Crew View vs Pro Heli-Admin View Toggle Button */}
          <button
            onClick={() => handleSetViewMode(viewMode === 'simple' ? 'detailed' : 'simple')}
            title={
              viewMode === 'simple'
                ? 'Currently in Simple Crew View (Plain English). Click to switch to Heli-Admin Pro View.'
                : 'Currently in Heli-Admin Pro View (Full Telemetry). Click to switch to Simple Crew View.'
            }
            className={`min-h-[40px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border cursor-pointer transition-colors ${
              viewMode === 'simple'
                ? 'bg-emerald-500/20 hover:bg-emerald-500/30 border-emerald-500/50 text-emerald-300'
                : 'bg-amber-500/20 hover:bg-amber-500/30 border-amber-500/50 text-amber-300'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-current" />
            <span className="whitespace-nowrap">
              {viewMode === 'simple' ? 'Simple View' : 'Pro View'}
            </span>
          </button>

          {/* 360° Overhead Sky Compass Button (Desktop — mobile uses bottom Compass tab) */}
          <button
            onClick={() => setShowSkyCompassModal(true)}
            title="Open 360° Overhead Sky Compass (Spot Helicopters & Planes From Your Rig or Home)"
            className="hidden lg:flex min-h-[36px] px-2.5 py-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-300 text-xs font-semibold items-center gap-1.5 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="whitespace-nowrap">Sky Compass</span>
          </button>

          {/* GPS Home / Spotter Button */}
          <button
            onClick={handleUseMyGps}
            title="Centre on My GPS"
            aria-label="Centre on My GPS"
            className="min-h-[40px] min-w-[40px] sm:min-h-[36px] sm:min-w-0 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-medium text-amber-300 flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <LocateFixed className="w-4 h-4 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
            <span className="hidden md:inline whitespace-nowrap">My GPS</span>
          </button>

          {/* Quick Rig / Airport Selector */}
          <select
            aria-label="Choose rig or airport"
            value={activeFacility.id === 'map-reference' ? '' : activeFacility.id}
            onChange={(e) => {
              const found = facilities.find((f) => f.id === e.target.value);
              if (found) handleSelectFacility(found);
            }}
            className="hidden sm:block max-w-[195px] bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500"
          >
            <option value="">Map reference (GPS / pan)</option>
            <optgroup label="Apache North Sea (Forties & Beryl)">
              {facilities
                .filter((f) => f.sector === 'apache_north_sea')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
            <optgroup label="West of Shetland (Clair, Glen Lyon, Rosebank)">
              {facilities
                .filter((f) => f.sector === 'west_of_shetland')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
            <optgroup label="Scotland Heliports & Prestwick/Alloway">
              {facilities
                .filter((f) => f.sector === 'scotland_airports')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName}
                  </option>
                ))}
            </optgroup>
            <optgroup label="UK Central & Northern North Sea">
              {facilities
                .filter((f) => f.sector === 'uk_north_sea')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
            <optgroup label="Irish Sea (Blackpool / Morecambe & Liverpool Bay)">
              {facilities
                .filter((f) => f.sector === 'irish_sea')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
            <optgroup label="Southern North Sea (Norwich / Humberside)">
              {facilities
                .filter((f) => f.sector === 'southern_north_sea')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
            <optgroup label="All UK Regional, SAR & Onward Airports">
              {facilities
                .filter((f) => f.sector === 'uk_airports')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Norwegian Continental Shelf">
              {facilities
                .filter((f) => f.sector === 'norway_ncs')
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.shortName} ({f.code})
                  </option>
                ))}
            </optgroup>
          </select>

          <button
            onClick={() => setShowInstallModal(true)}
            title="Install App on Phone"
            className="min-h-[40px] sm:min-h-[36px] px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <span className="whitespace-nowrap sm:hidden">Install</span>
            <span className="hidden sm:inline whitespace-nowrap">Install App</span>
          </button>
        </div>
      </header>

      {/* =====================================================================
          SECOND SUB-BAR: FAVOURITE RIGS + SINGLE-RIG FOCUS + HELICOPTER FILTER
         ===================================================================== */}
      <div className="bg-slate-900/95 border-b border-slate-800 px-2.5 sm:px-3 py-1.5 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar shrink-0 z-20">
        {/* Left: Starred Favourite Rigs 1-Tap Bar + Single-Rig Focus Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handleToggleSingleRigFocus}
            title="Hide all other rigs on the map and focus exclusively on your active rig"
            className={`min-h-[34px] px-2.5 py-1 rounded-md text-xs font-semibold flex items-center gap-1 border transition-colors cursor-pointer whitespace-nowrap ${
              singleRigFocus
                ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                : 'bg-slate-950 text-slate-300 border-slate-800 hover:text-white'
            }`}
          >
            <span>
              {singleRigFocus
                ? `★ Only ${activeFacility.code} Shown`
                : `Focus Only ${activeFacility.code}`}
            </span>
          </button>

          <span className="text-slate-700">|</span>

          <div className="flex items-center gap-1 shrink-0">
            <Star className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
            <span className="text-[11px] font-mono text-slate-400 hidden sm:inline">
              MY RIGS:
            </span>
            {favoriteFacilities.map((fav) => {
              const isCurrent = fav.id === activeFacility.id;
              return (
                <button
                  key={fav.id}
                  onClick={() => handleSelectFacility(fav)}
                  className={`min-h-[34px] px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                    isCurrent
                      ? 'bg-amber-400 text-slate-950 font-bold'
                      : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-amber-500/50 hover:text-amber-300'
                  }`}
                >
                  {fav.shortName}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Helicopter Operator Filter Pills + Alerts + Live Feed Status */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Traffic Category Pills */}
          <div className="flex items-center gap-1 shrink-0">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'active_facility', label: `To/Near ${activeFacility.code}` },
                { id: 'offshore_heli', label: 'Helis' },
                { id: 'coastguard_sar', label: 'SAR' },
                { id: 'commercial_fixed_wing', label: 'Airlines' },
              ] as const
            ).map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategoryFilter(cat.id)}
                className={`min-h-[34px] px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  categoryFilter === cat.id
                    ? 'bg-cyan-500 text-slate-950 font-semibold'
                    : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleToggleAlerts}
            title="Alerts while this page runs: airborne detection and 25 / 10 NM proximity rings"
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
              alertsEnabled
                ? 'bg-slate-950 text-cyan-300 border-cyan-500/40'
                : 'bg-slate-950 text-slate-400 border-slate-800'
            }`}
          >
            {alertsEnabled ? (
              <BellRing className="w-3.5 h-3.5 text-cyan-400" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            <span className="sm:hidden">{alertsEnabled ? 'Alerts On' : 'Alerts Off'}</span>
            <span className="hidden sm:inline">
              {alertsEnabled ? 'Page Alerts On' : 'Page Alerts Off'}
            </span>
          </button>

          <div
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-[11px] sm:text-xs font-mono font-medium bg-slate-950 border flex items-center whitespace-nowrap shrink-0 ${
              feedState === 'unavailable'
                ? 'text-amber-300 border-amber-500/40'
                : 'text-emerald-400 border-emerald-500/40'
            }`}
          >
            <span className="sm:hidden">
              {feedState === 'loading'
                ? 'Feed: Syncing…'
                : feedState === 'unavailable'
                ? 'Feed paused'
                : `${liveCount} live`}
            </span>
            <span className="hidden sm:inline">
              {feedState === 'loading'
                ? 'Connecting to aircraft feed…'
                : feedState === 'unavailable'
                ? 'Feed unavailable · last known positions'
                : (feedState === 'partial' ? 'Partial feed · ' : 'UK/IRE · ') +
                  feedProvider +
                  ' · ' +
                  liveCount +
                  ' tracked aircraft'}
            </span>
          </div>
        </div>
      </div>

      {/* =====================================================================
          MAIN WORKSPACE: FULL-BLEED MAP + DOCKED TELEMETRY SIDEBAR
         ===================================================================== */}
      <main className="flex-1 flex overflow-hidden relative pb-14 lg:pb-0">
        {/* LEFT / CENTER: INTERACTIVE RADAR MAP (min-w-0 keeps it inside the screen so the zoom buttons stay visible on phones) */}
        <div
          className={`flex-1 min-w-0 h-full relative ${
            activeTab === 'radar'
              ? 'block'
              : activeTab === 'weather'
              ? 'hidden'
              : 'hidden lg:block'
          }`}
        >
          <RadarMap
            flights={visibleFlights}
            installations={visibleInstallations}
            selectedFlight={selectedFlight}
            onSelectFlight={handleSelectFlight}
            activeFacility={activeFacility}
            onSelectFacility={handleSelectFacility}
            pinnedFlightHex={pinnedFlightHex}
            showRangeRings={showRangeRings}
            onToggleRangeRings={() => setShowRangeRings((prev) => !prev)}
            showFacilityLabels={showFacilityLabels}
            onToggleFacilityLabels={() => setShowFacilityLabels((prev) => !prev)}
            onUseMyGps={handleUseMyGps}
            mapViewTarget={mapViewTarget}
            onMapCenterChanged={handleMapCenterChanged}
            isFavoriteFacility={favoriteFacilityIds.includes(activeFacility.id)}
            onToggleFavoriteFacility={handleToggleFavoriteFacility}
            singleRigFocus={singleRigFocus}
            onToggleSingleRigFocus={handleToggleSingleRigFocus}
            weather={weather}
            onOpenDirectory={() => {
              setActiveTab('directory');
              setDockTab('directory');
            }}
            onOpenWeather={() => {
              setActiveTab('weather');
              setDockTab('weather');
            }}
            weatherOverlayMode={weatherOverlayMode}
            onChangeWeatherOverlayMode={setWeatherOverlayMode}
            weatherModelId={weatherModelId}
            onChangeWeatherModelId={setWeatherModelId}
            airframePresetId={airframePresetId}
            onChangeAirframePresetId={setAirframePresetId}
            spatialGrid={spatialGrid}
            shoreBaseFacility={shoreBaseFacility}
            corridorRouteSamples={corridorRouteSamples}
            hourlyForecast={hourlyForecast}
            selectedHourIdx={selectedHourIdx}
            onChangeSelectedHourIdx={setSelectedHourIdx}
            flightOpsMode={flightOpsMode}
            customOverride={activeRigOverride}
            viewMode={viewMode}
            onChangeViewMode={handleSetViewMode}
          />

          {/* Floating Selected Aircraft Card on Desktop/Mobile so it never crushes the Weather Dock */}
          {selectedFlight && mobileDetailsOpen && (
            <div className="fixed lg:absolute bottom-[calc(3.75rem+env(safe-area-inset-bottom))] lg:bottom-4 left-2 right-2 lg:left-3 lg:right-auto lg:w-[390px] z-[500] max-h-[58vh] lg:max-h-[65vh] overflow-y-auto shadow-2xl rounded-xl">
              <FlightDossierPanel
                flight={selectedFlight}
                activeFacility={activeFacility}
                isPinned={pinnedFlightHex === selectedFlight.hex}
                onTogglePin={handleTogglePin}
                alertsEnabled={alertsEnabled}
                onToggleAlerts={handleToggleAlerts}
                onClose={() => {
                  setSelectedFlightHex(null);
                  setMobileDetailsOpen(false);
                }}
                onCenterOnFlight={handleSelectFlight}
              />
            </div>
          )}
        </div>

        {/* RIGHT TELEMETRY & OPERATIONS DOCK (Full-Width when expanded to Weather, 500px on Desktop Split View) */}
        <aside
          className={`w-full min-w-0 overflow-hidden ${
            activeTab === 'weather'
              ? 'lg:w-full'
              : 'lg:w-[480px] xl:w-[540px]'
          } h-full bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 ${
            activeTab === 'radar' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Right Dock Segmented View Switcher (Desktop) */}
          <div className="hidden lg:grid grid-cols-3 gap-1 p-2 bg-slate-900/80 border-b border-slate-800 shrink-0">
            <button
              onClick={() => {
                setDockTab('flights');
                setActiveTab('radar');
              }}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'flights' && activeTab !== 'weather'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Flights ({visibleFlights.length})
            </button>
            <button
              onClick={() => {
                setDockTab('directory');
                setActiveTab('radar');
              }}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'directory' && activeTab !== 'weather'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Rigs & Terminals
            </button>
            <button
              onClick={() => {
                setDockTab('weather');
              }}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'weather'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Weather & Marine
            </button>
          </div>

          {/* Active Panel Body */}
          <div className="flex-1 min-w-0 overflow-hidden">
            {dockTab === 'flights' && (
              <CrewAndFlightBoard
                flights={flights}
                activeFacility={activeFacility}
                selectedFlight={selectedFlight}
                onSelectFlight={(f) => {
                  handleSelectFlight(f);
                  setActiveTab('radar');
                }}
                pinnedFlightHex={pinnedFlightHex}
                onTogglePin={handleTogglePin}
                categoryFilter={categoryFilter}
                onChangeCategoryFilter={setCategoryFilter}
                heliOpFilter={heliOpFilter}
                onChangeHeliOpFilter={setHeliOpFilter}
              />
            )}
            {dockTab === 'directory' && (
              <RigsAndAirportsDirectory
                installations={facilities}
                activeFacility={activeFacility}
                onSelectFacility={(fac) => {
                  handleSelectFacility(fac);
                  setActiveTab('radar');
                }}
                selectedFieldOperator={selectedFieldOperator}
                onSelectFieldOperator={setSelectedFieldOperator}
                onAddCustomCoordinate={handleAddCustomCoordinate}
                favoriteFacilityIds={favoriteFacilityIds}
                onToggleFavoriteFacility={handleToggleFavoriteFacility}
                singleRigFocus={singleRigFocus}
                onToggleSingleRigFocus={handleToggleSingleRigFocus}
              />
            )}
            {dockTab === 'weather' &&
              (activeFacility.id === 'map-reference' ? (
                <div className="p-6 text-sm text-slate-400">
                  Choose a rig or base from Rigs to view 7-day weather & operating limits.
                </div>
              ) : (
                <HelideckWeatherPanel
                  facility={activeFacility}
                  shoreBaseFacility={shoreBaseFacility}
                  availableShoreBases={availableShoreBases}
                  onChangeShoreBaseCode={handleChangeShoreBaseCode}
                  weather={weather}
                  loading={weatherLoading}
                  onRefresh={loadWeather}
                  airframePresetId={airframePresetId}
                  onChangeAirframePresetId={setAirframePresetId}
                  weatherModelId={weatherModelId}
                  onChangeWeatherModelId={setWeatherModelId}
                  weatherOverlayMode={weatherOverlayMode}
                  onChangeWeatherOverlayMode={setWeatherOverlayMode}
                  onSwitchToMapWithOverlay={(mode) => {
                    setWeatherOverlayMode(mode);
                    setActiveTab('radar');
                  }}
                  hourlyForecast={hourlyForecast}
                  selectedHourIdx={selectedHourIdx}
                  onChangeSelectedHourIdx={setSelectedHourIdx}
                  corridorWaypoints={corridorWaypoints}
                  ensembleLoading={ensembleLoading}
                  flightOpsMode={flightOpsMode}
                  onChangeFlightOpsMode={handleChangeFlightOpsMode}
                  customOverride={activeRigOverride}
                  onChangeCustomOverride={handleChangeActiveRigOverride}
                  flights={flights}
                  cachedForecastSavedAt={cachedForecastSavedAt}
                  isFullScreen={activeTab === 'weather'}
                  onToggleFullScreen={() =>
                    setActiveTab((prev) => (prev === 'weather' ? 'radar' : 'weather'))
                  }
                  viewMode={viewMode}
                  onChangeViewMode={handleSetViewMode}
                />
              ))}
          </div>

          {/* Creator Signature Footer */}
          <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800/90 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <a
              href={
                feedProvider === 'adsb.fi' ? 'https://adsb.fi/' : 'https://www.adsb.lol/'
              }
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {feedProvider || 'ADS-B sources'}
            </a>
            <span className="text-cyan-400 font-semibold">Made by onemadpunk</span>
          </div>
        </aside>
      </main>

      {/* =====================================================================
          MOBILE FIXED BOTTOM TAB BAR (44x44px Thumb Targets, <= 15% Sticky Cap)
         ===================================================================== */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-[600] h-14 bg-slate-950/95 backdrop-blur-md border-t border-slate-800 grid grid-cols-5 items-center">
        <button
          onClick={() => setActiveTab('radar')}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer relative ${
            activeTab === 'radar' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          {activeTab === 'radar' && (
            <span className="absolute top-0 inset-x-3 h-0.5 bg-cyan-400 rounded-b" />
          )}
          <Radar className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Radar</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('flights');
            setDockTab('flights');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer relative ${
            activeTab === 'flights' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          {activeTab === 'flights' && (
            <span className="absolute top-0 inset-x-3 h-0.5 bg-cyan-400 rounded-b" />
          )}
          <div className="relative">
            <Plane className="w-4 h-4" />
            {visibleFlights.length > 0 && (
              <span className="absolute -top-1.5 -right-3 px-1 min-w-[14px] h-[14px] rounded-full bg-cyan-500 text-slate-950 text-[9px] font-mono font-bold flex items-center justify-center leading-none">
                {visibleFlights.length > 99 ? '99+' : visibleFlights.length}
              </span>
            )}
          </div>
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Flights</span>
        </button>
        <button
          onClick={() => setShowSkyCompassModal(true)}
          className="min-h-[44px] flex flex-col items-center justify-center text-emerald-400 cursor-pointer"
        >
          <Compass className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Compass</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('directory');
            setDockTab('directory');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer relative ${
            activeTab === 'directory' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          {activeTab === 'directory' && (
            <span className="absolute top-0 inset-x-3 h-0.5 bg-cyan-400 rounded-b" />
          )}
          <Building2 className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Rigs</span>
        </button>
        <button
          onClick={() => {
            setActiveTab('weather');
            setDockTab('weather');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer relative ${
            activeTab === 'weather' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          {activeTab === 'weather' && (
            <span className="absolute top-0 inset-x-3 h-0.5 bg-cyan-400 rounded-b" />
          )}
          <CloudRainWind className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Weather</span>
        </button>
      </nav>

      {/* 360° Overhead Sky Compass Spotter Modal */}
      <OverheadSkyCompassModal
        isOpen={showSkyCompassModal}
        onClose={() => setShowSkyCompassModal(false)}
        flights={flights}
        activeFacility={activeFacility}
        onSelectFlight={handleSelectFlight}
        onUseMyGps={handleUseMyGps}
      />

      {/* Mobile & GitHub Pages Installation Modal */}
      <InstallAndGitHubModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />
    </div>
  );
}
