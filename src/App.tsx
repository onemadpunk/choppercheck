import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AircraftTarget,
  FieldOperator,
  FlightAlertEvent,
  HeliAdminSheetData,
  HelideckWeatherState,
  HelicopterOperator,
  InstallationOrAirport,
  SectorId,
  TrafficCategory,
} from './types/radar';
import {
  INSTALLATIONS_AND_AIRPORTS,
  resolveHeliAdminStopCode,
} from './data/installationsAndAirports';
import { REAL_HELIADMIN_SHEETS } from './data/heliAdminSheets';
import {
  advanceAircraftPositionsSmoothly,
  fetchHelideckWeather,
  fetchHybridRadarTraffic,
} from './services/radarService';
import { RadarMap } from './components/RadarMap';
import { FlightDossierPanel } from './components/FlightDossierPanel';
import { CrewAndFlightBoard } from './components/CrewAndFlightBoard';
import { RigsAndAirportsDirectory } from './components/RigsAndAirportsDirectory';
import { HelideckWeatherPanel } from './components/HelideckWeatherPanel';
import { InstallAndGitHubModal } from './components/InstallAndGitHubModal';
import { OverheadSkyCompassModal } from './components/OverheadSkyCompassModal';
import { HeliAdminSheetModal } from './components/HeliAdminSheetModal';
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
  FileSpreadsheet,
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
    label: 'Apache (Forties & Beryl)',
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
    defaultFacilityId: 'wos-clair-ridge',
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
    id: 'norway_ncs',
    label: 'Norwegian Waters',
    lat: 59.8,
    lon: 3.1,
    zoom: 6,
    defaultFacilityId: 'no-johan-sverdrup',
  },
  {
    id: 'scotland_airports',
    label: 'Prestwick / Alloway & Scotland',
    lat: 55.5094,
    lon: -4.5944,
    zoom: 9,
    defaultFacilityId: 'apt-egpk',
  },
  {
    id: 'uk_airports',
    label: 'All UK Airports & Heliports',
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

  // Active locked installation or airport (persisted in localStorage so phone always opens on user's rig)
  const [activeFacilityId, setActiveFacilityId] = useState<string>(() => {
    try {
      return localStorage.getItem('choppercheck_home_rig_id') || 'apache-forties-charlie';
    } catch {
      return 'apache-forties-charlie';
    }
  });
  const activeFacility = useMemo(
    () => facilities.find((f) => f.id === activeFacilityId) || facilities[0],
    [facilities, activeFacilityId]
  );

  // Favourite / Starred Rigs (persisted in localStorage for 1-tap mobile switching)
  const [favoriteFacilityIds, setFavoriteFacilityIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('choppercheck_favorite_rigs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore storage errors
    }
    return ['apache-forties-charlie', 'wos-glen-lyon-fpso', 'uk-culzean', 'apt-egpd'];
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

  // Map viewport target state (boots directly onto user's saved rig coordinates)
  const [activeSector, setActiveSector] = useState<SectorId>(() => activeFacility.sector);
  const [mapViewTarget, setMapViewTarget] = useState<{
    lat: number;
    lon: number;
    zoom: number;
    seq: number;
  }>(() => ({
    lat: activeFacility.lat,
    lon: activeFacility.lon,
    zoom: 8,
    seq: 1,
  }));
  const [queryCenter, setQueryCenter] = useState<{ lat: number; lon: number }>(() => ({
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
  const [includeScheduleWave] = useState<boolean>(false);
  const [liveCount, setLiveCount] = useState<number>(0);

  // Flights & Selection State
  const [flights, setFlights] = useState<AircraftTarget[]>([]);
  const [selectedFlightHex, setSelectedFlightHex] = useState<string | null>(null);
  const [pinnedFlightHex, setPinnedFlightHex] = useState<string | null>(() => {
    try {
      return localStorage.getItem('deckwatch_pinned_hex') || null;
    } catch {
      return null;
    }
  });
  const [tickSeconds, setTickSeconds] = useState<number>(0);
  const queryCenterRef = useRef<{ lat: number; lon: number }>(queryCenter);
  useEffect(() => {
    queryCenterRef.current = queryCenter;
  }, [queryCenter]);

  // Persistent memory of recently seen live aircraft (45s retention) so targets never blink/vanish on a missed packet
  const recentAircraftMapRef = useRef<Map<string, { flight: AircraftTarget; seenAt: number }>>(
    new Map()
  );

  // Due-Off Flight & 25/10 NM Approach Alert State
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(true);
  const [activeAlertBanner, setActiveAlertBanner] = useState<FlightAlertEvent | null>(null);
  const firedAlertKeysRef = useRef<Set<string>>(new Set());

  // Weather & METAR State
  const [weather, setWeather] = useState<HelideckWeatherState | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  // Modals: Mobile/GitHub Setup, 360° Overhead Sky Compass & Heli-Admin Noticeboard Sheets
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [showSkyCompassModal, setShowSkyCompassModal] = useState<boolean>(false);
  const [showHeliAdminModal, setShowHeliAdminModal] = useState<boolean>(false);
  const [heliAdminSheets, setHeliAdminSheets] = useState<HeliAdminSheetData[]>(
    REAL_HELIADMIN_SHEETS
  );
  const [selectedHeliAdminSheet, setSelectedHeliAdminSheet] = useState<HeliAdminSheetData>(
    REAL_HELIADMIN_SHEETS[0]
  );
  const [plottedHeliAdminSheet, setPlottedHeliAdminSheet] =
    useState<HeliAdminSheetData | null>(null);

  // Smoothly advance airborne aircraft positions every 2 seconds along their real transmitted groundSpeedKts & trackDeg
  useEffect(() => {
    const interval = setInterval(() => {
      setTickSeconds((prev) => prev + 2);
      setFlights((prev) => {
        const next = advanceAircraftPositionsSmoothly(prev, 2, activeFacility);
        for (const f of next) {
          const existing = recentAircraftMapRef.current.get(f.hex);
          if (existing) {
            existing.flight = f;
          }
        }
        return next;
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [activeFacility]);

  // Poll live 1090MHz ADS-B every 10 seconds without ever wiping the map on map pans or transient relay hiccups
  useEffect(() => {
    let cancelled = false;
    let nextPollTimeout: ReturnType<typeof setTimeout>;
    const controller = new AbortController();

    const pollLiveRadar = async () => {
      try {
        const center = queryCenterRef.current;
        const { flights: freshFlights, feedAvailable } = await fetchHybridRadarTraffic(
          center.lat,
          center.lon,
          activeFacility,
          0,
          includeScheduleWave,
          controller.signal
        );

        if (cancelled) return;

        if (feedAvailable) {
          const now = Date.now();
          for (const f of freshFlights) {
            recentAircraftMapRef.current.set(f.hex, { flight: f, seenAt: now });
          }
          // Prune targets not seen in the last 45 seconds or far outside the current radar sector
          for (const [hex, entry] of recentAircraftMapRef.current.entries()) {
            const latDiff = Math.abs(entry.flight.lat - center.lat);
            const lonDiff = Math.abs(entry.flight.lon - center.lon);
            if (now - entry.seenAt > 45000 || latDiff > 4.5 || lonDiff > 8.0) {
              recentAircraftMapRef.current.delete(hex);
            }
          }

          const mergedLive = Array.from(recentAircraftMapRef.current.values()).map(
            (e) => e.flight
          );
          if (mergedLive.length > 0 || freshFlights.length === 0) {
            setFlights(mergedLive);
            setLiveCount(mergedLive.length);
            setSelectedFlightHex((prev) =>
              mergedLive.some((f) => f.hex === prev) ? prev : mergedLive[0]?.hex ?? null
            );
          }
        }
      } catch {
        // Keep existing aircraft on screen if a single network poll times out
      } finally {
        if (!cancelled) {
          nextPollTimeout = setTimeout(pollLiveRadar, 10000);
        }
      }
    };

    void pollLiveRadar();

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(nextPollTimeout);
    };
  }, [activeFacility, includeScheduleWave]);

  // Monitor Pinned Due-Off Flight & Active Rig 25 NM / 10 NM Approach Rings for Alerts
  useEffect(() => {
    if (!alertsEnabled || flights.length === 0) return;

    const nowTime = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    });

    for (const f of flights) {
      const isPinned = pinnedFlightHex === f.hex;
      const isHeliNearRig =
        f.category === 'offshore_heli' || f.category === 'coastguard_sar';

      // 1. Pinned Flight Airborne / Liftoff Alert
      if (isPinned && f.altitudeFt >= 200 && f.groundSpeedKts >= 45) {
        const key = `${f.hex}_AIRBORNE`;
        if (!firedAlertKeysRef.current.has(key)) {
          firedAlertKeysRef.current.add(key);
          const msg = `YOUR PINNED FLIGHT IS AIRBORNE: ${f.callsign} (${f.typeFullName}) departed ${f.originCode} enroute to ${f.destinationCode} — ETA ${f.estimatedArrTime}. Get ready!`;
          setActiveAlertBanner({
            id: key,
            timestamp: nowTime,
            callsign: f.callsign,
            typeFullName: f.typeFullName,
            triggerType: 'AIRBORNE_LIFTOFF',
            message: msg,
          });
          playCockpitAlertChime(false);
          triggerBrowserNotification(`Flight Airborne: ${f.callsign}`, msg);
          break;
        }
      }

      // 2. 10 NM Final Approach Ring Alert (Pinned Flight OR Helicopter approaching active rig)
      if ((isPinned || isHeliNearRig) && f.distanceFromRefNm <= 10) {
        const key = `${f.hex}_${activeFacility.code}_10NM`;
        if (!firedAlertKeysRef.current.has(key)) {
          firedAlertKeysRef.current.add(key);
          const msg = `10 NM FINAL APPROACH ALERT: ${f.callsign} (${f.typeFullName}) is ${f.distanceFromRefNm} NM from ${activeFacility.shortName} (${activeFacility.code}) at ${f.altitudeFt.toLocaleString()} ft!`;
          setActiveAlertBanner({
            id: key,
            timestamp: nowTime,
            callsign: f.callsign,
            typeFullName: f.typeFullName,
            triggerType: 'RING_10NM',
            message: msg,
          });
          playCockpitAlertChime(true);
          triggerBrowserNotification(`10 NM Approach: ${f.callsign}`, msg);
          break;
        }
      }

      // 3. 25 NM Approach Ring Alert
      if ((isPinned || isHeliNearRig) && f.distanceFromRefNm <= 25 && f.distanceFromRefNm > 10) {
        const key = `${f.hex}_${activeFacility.code}_25NM`;
        if (!firedAlertKeysRef.current.has(key)) {
          firedAlertKeysRef.current.add(key);
          const msg = `25 NM APPROACH ZONE: ${f.callsign} (${f.typeFullName}) crossed within 25 NM of ${activeFacility.shortName} (${f.distanceFromRefNm} NM out · ETA ${f.estimatedArrTime}).`;
          setActiveAlertBanner({
            id: key,
            timestamp: nowTime,
            callsign: f.callsign,
            typeFullName: f.typeFullName,
            triggerType: 'RING_25NM',
            message: msg,
          });
          playCockpitAlertChime(false);
          triggerBrowserNotification(`25 NM Approach: ${f.callsign}`, msg);
          break;
        }
      }
    }
  }, [flights, alertsEnabled, pinnedFlightHex, activeFacility]);

  // Fetch live Open-Meteo marine, aviation & METAR weather for activeFacility
  const loadWeather = useCallback(async () => {
    setWeatherLoading(true);
    const wx = await fetchHelideckWeather(activeFacility);
    setWeather(wx);
    setWeatherLoading(false);
  }, [activeFacility]);

  useEffect(() => {
    loadWeather();
  }, [loadWeather]);

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
  }, [facilities, singleRigFocus, selectedFieldOperator, activeFacility.id, activeFacility.primaryShoreBase]);

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
      } else if (categoryFilter !== 'all' && f.category !== categoryFilter) {
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
            id: 'gps-my-location',
            code: 'HOME',
            name: 'My GPS Overhead Location',
            shortName: 'My GPS Location',
            fieldOperator: 'UK Airport / Heliport',
            assetType: 'UK Airport',
            sector: 'scotland_airports',
            lat,
            lon,
            elevationFt: 50,
            primaryShoreBase: 'EGPK',
            helicopterOperators: ['HM Coastguard', 'Commercial Airline'],
            regionLabel: 'Live GPS Overhead Radar Zone',
          };
          setFacilities((prev) => [
            customHome,
            ...prev.filter((item) => item.id !== 'gps-my-location'),
          ]);
          setActiveFacilityId('gps-my-location');
          setQueryCenter({ lat, lon });
          setMapViewTarget((prev) => ({
            lat,
            lon,
            zoom: 9,
            seq: prev.seq + 1,
          }));
        },
        () => {
          const alloway = facilities.find((f) => f.id === 'apt-egpk');
          if (alloway) handleSelectFacility(alloway);
        }
      );
    }
  }, [facilities, handleSelectFacility]);

  const handleAddCustomCoordinate = (name: string, lat: number, lon: number) => {
    const newId = `custom-${Date.now()}`;
    const newFac: InstallationOrAirport = {
      id: newId,
      code: name.slice(0, 4).toUpperCase(),
      name,
      shortName: name,
      fieldOperator: 'UK Airport / Heliport',
      assetType: 'Fixed Platform',
      sector: 'uk_north_sea',
      lat,
      lon,
      elevationFt: 100,
      primaryShoreBase: 'EGPD',
      helicopterOperators: ['Bristow', 'CHC', 'NHV', 'OHS'],
      regionLabel: 'Custom User Coordinates',
    };
    setFacilities((prev) => [newFac, ...prev]);
    handleSelectFacility(newFac);
  };

  const handlePlotAndFocusSheet = useCallback(
    (sheet: HeliAdminSheetData) => {
      setPlottedHeliAdminSheet(sheet);
      setSelectedHeliAdminSheet(sheet);
      setActiveTab('radar');

      // Find first offshore platform stop in plannedRouteCodes (or first stop)
      const resolvedStops = sheet.plannedRouteCodes
        .map((c) => resolveHeliAdminStopCode(c, facilities))
        .filter((f): f is InstallationOrAirport => !!f);

      const offshoreStop =
        resolvedStops.find(
          (f) => f.assetType === 'Fixed Platform' || f.assetType === 'FPSO'
        ) || resolvedStops[0];

      if (offshoreStop) {
        setActiveFacilityId(offshoreStop.id);
        setQueryCenter({ lat: offshoreStop.lat, lon: offshoreStop.lon });
        setMapViewTarget((prev) => ({
          lat: offshoreStop.lat,
          lon: offshoreStop.lon,
          zoom: 7,
          seq: prev.seq + 1,
        }));
      }

      // Check if matching flight is currently in flights; if not, enable schedule wave so user can track the sheet flight immediately
      const match = flights.find(
        (f) =>
          (sheet.callsign && f.callsign.toUpperCase() === sheet.callsign.toUpperCase()) ||
          (sheet.registration &&
            f.registration.toUpperCase() === sheet.registration.toUpperCase()) ||
          (sheet.flightName &&
            f.heliAdminFlightName?.toUpperCase() === sheet.flightName.toUpperCase())
      );

      if (match) {
        setSelectedFlightHex(match.hex);
        setPinnedFlightHex(match.hex);
      }
    },
    [facilities, flights]
  );

  return (
    <div className="min-h-screen h-screen flex flex-col bg-[#07090e] text-slate-100 overflow-hidden">
      {/* =====================================================================
          TOP NAVIGATION BAR (Strict 3-Zone Contract: Brand | 4 Nav Links | 1 CTA)
         ===================================================================== */}
      <header className="flex items-center justify-between gap-8 px-4 sm:px-6 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#radar"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('radar');
          }}
          className="text-base sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          ChopperCheck.com · Made by onemadpunk
        </a>

        {/* Zone 2: 4 clean single-line navigation links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400">
          <button
            onClick={() => {
              setActiveTab('radar');
              setDockTab('flights');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'radar' && dockTab === 'flights' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Live Radar
          </button>
          <button
            onClick={() => {
              setActiveTab('flights');
              setDockTab('flights');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              dockTab === 'flights' && activeTab === 'flights' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Crew & SAR Flights
          </button>
          <button
            onClick={() => {
              setActiveTab('directory');
              setDockTab('directory');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              dockTab === 'directory' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Rigs, UK Airports & Terminals
          </button>
          <button
            onClick={() => {
              setActiveTab('weather');
              setDockTab('weather');
            }}
            className={`hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              dockTab === 'weather' ? 'text-cyan-400 font-semibold' : ''
            }`}
          >
            Helideck & METAR Weather
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center shrink-0">
          <button
            onClick={() => setShowInstallModal(true)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Install to Phone
          </button>
        </div>
      </header>

      {/* =====================================================================
          WORKSPACE SECTOR, SKY COMPASS & ALERT CONTROLS TOOLBAR
         ===================================================================== */}
      <div className="bg-slate-900/90 border-b border-slate-800 px-3 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Sector & Region Presets + Sky Compass */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 max-w-full">
          {SECTOR_PRESETS.map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelectSector(preset)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                activeSector === preset.id
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'bg-slate-950 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              {preset.label}
            </button>
          ))}

          <button
            onClick={() => setShowHeliAdminModal(true)}
            title="Open Offshore Heli-Admin Flight Sheets (APFOR2/1 · BP GL3 · TTCULZFR) & Multi-Stop Route Plotter"
            className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 flex items-center gap-1 cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400" />
            Heli-Admin Sheets
          </button>

          <button
            onClick={() => setShowSkyCompassModal(true)}
            title="Open 360° Overhead Sky Compass to spot aircraft flying over your head"
            className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5" />
            Sky Compass (Overhead)
          </button>

          <button
            onClick={handleUseMyGps}
            className="px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 bg-slate-950 hover:bg-slate-800 text-amber-400 border border-slate-800 flex items-center gap-1 cursor-pointer"
          >
            <LocateFixed className="w-3.5 h-3.5" />
            My GPS
          </button>
        </div>

        {/* Right Quick Filters: Traffic Category, Alert Arming & Wave Toggle */}
        <div className="hidden xl:flex items-center gap-2 text-xs">
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {[
              { id: 'all', label: 'All Traffic' },
              { id: 'offshore_heli', label: 'Helicopters Only' },
              { id: 'coastguard_sar', label: 'HM Coastguard SAR' },
              { id: 'active_facility', label: `Near ${activeFacility.code}` },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() =>
                  setCategoryFilter(item.id as 'all' | TrafficCategory | 'active_facility')
                }
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  categoryFilter === item.id
                    ? 'bg-slate-800 text-cyan-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleToggleAlerts}
            title="Arm audio & notification alerts when your pinned flight lifts off or crosses 25 NM / 10 NM rings"
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer ${
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
            {alertsEnabled ? 'Alerts Armed' : 'Alerts Muted'}
          </button>

          <div className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-950 text-emerald-400 border border-emerald-500/40 whitespace-nowrap shrink-0">
            ● LIVE 1090MHz ADS-B ({liveCount} Aircraft)
          </div>
        </div>
      </div>

      {/* ★ MY FAVOURITE RIGS QUICK-JUMP BAR (Mobile & Desktop 1-Tap Rig Switcher) */}
      <div className="bg-slate-950/95 border-b border-slate-800/90 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-2 overflow-x-auto shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-mono uppercase tracking-wider text-amber-400 font-semibold flex items-center gap-1 whitespace-nowrap shrink-0">
            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
            My Rigs:
          </span>
          {favoriteFacilities.map((fac) => {
            const isActive = fac.id === activeFacility.id;
            return (
              <button
                key={fac.id}
                onClick={() => {
                  handleSelectFacility(fac);
                  setActiveTab('radar');
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-amber-400 text-slate-950 font-bold shadow-sm'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800'
                }`}
              >
                <span>{fac.shortName}</span>
                <span
                  className={`font-mono text-[10px] ${
                    isActive ? 'text-slate-950' : 'text-amber-400'
                  }`}
                >
                  {fac.code}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => {
              setActiveTab('directory');
              setDockTab('directory');
            }}
            className="px-2 py-1 rounded-md text-[11px] font-medium bg-slate-900/70 hover:bg-slate-800 text-cyan-400 border border-slate-800/80 whitespace-nowrap shrink-0 cursor-pointer"
          >
            + Pick / Star Rig
          </button>
        </div>

        <button
          onClick={handleToggleSingleRigFocus}
          className={`px-2.5 py-1 rounded-md text-[11px] font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer hidden sm:flex items-center gap-1 ${
            singleRigFocus
              ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-800'
          }`}
        >
          {singleRigFocus
            ? `Showing Only ${activeFacility.shortName} (${activeFacility.code})`
            : 'Focus Only 1 Rig'}
        </button>
      </div>

      {/* Live Triggered Flight / Approach Alert Banner */}
      {activeAlertBanner && (
        <div className="bg-emerald-950/80 border-b border-emerald-500/50 px-3 sm:px-6 py-2 flex items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <BellRing className="w-4 h-4 text-emerald-400 shrink-0" />
            <span className="font-mono text-emerald-300 font-semibold whitespace-nowrap">
              [{activeAlertBanner.timestamp}]
            </span>
            <span className="text-white font-medium truncate">
              {activeAlertBanner.message}
            </span>
          </div>
          <button
            onClick={() => setActiveAlertBanner(null)}
            className="text-slate-300 hover:text-white p-1 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Pinned Due-Off / Connection Flight Banner (if a flight is pinned) */}
      {pinnedFlight && (
        <div
          onClick={() => handleSelectFlight(pinnedFlight)}
          className="bg-amber-950/35 border-b border-amber-500/30 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 text-xs cursor-pointer hover:bg-amber-950/50 transition-colors shrink-0"
        >
          <div className="flex items-center gap-2 min-w-0 truncate">
            <Pin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-semibold text-amber-300 whitespace-nowrap">
              MY PINNED FLIGHT:
            </span>
            <span className="font-mono font-bold text-white whitespace-nowrap">
              {pinnedFlight.callsign}
            </span>
            <span className="text-slate-300 truncate hidden sm:inline">
              ({pinnedFlight.typeFullName})
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="font-mono text-cyan-300 whitespace-nowrap">
              {pinnedFlight.originCode} → {pinnedFlight.destinationCode}
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-emerald-400 whitespace-nowrap">
              ETA {pinnedFlight.estimatedArrTime}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
            <span className="text-slate-300 hidden sm:inline">
              {pinnedFlight.distanceFromRefNm} NM · {pinnedFlight.altitudeFt.toLocaleString()} ft
            </span>
            <a
              href={getWhatsAppShareUrl(pinnedFlight, activeFacility.code)}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[11px] font-sans font-medium flex items-center gap-1"
            >
              <Share2 className="w-3 h-3" />
              WhatsApp
            </a>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleTogglePin(pinnedFlight.hex);
              }}
              title="Unpin Flight"
              className="text-slate-400 hover:text-white p-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Active Plotted Heli-Admin Noticeboard Sheet Strip */}
      {plottedHeliAdminSheet && (
        <div className="bg-slate-900/95 border-b border-slate-800 px-3 sm:px-6 py-1.5 flex items-center justify-between gap-3 text-xs shrink-0">
          <div
            onClick={() => setShowHeliAdminModal(true)}
            className="flex items-center gap-2 min-w-0 truncate cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="font-mono font-bold text-amber-400 whitespace-nowrap">
              HELI-ADMIN SHEET: {plottedHeliAdminSheet.flightName}
            </span>
            {plottedHeliAdminSheet.callsign && (
              <span className="font-mono text-cyan-300 whitespace-nowrap">
                ({plottedHeliAdminSheet.callsign} · {plottedHeliAdminSheet.registration || plottedHeliAdminSheet.aircraftType})
              </span>
            )}
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="font-mono text-white whitespace-nowrap">
              Route: {plottedHeliAdminSheet.plannedRouteCodes.join(' → ')}
            </span>
            <span aria-hidden="true" className="text-slate-600 hidden md:inline">·</span>
            <span className="font-mono tabular-nums text-amber-300 whitespace-nowrap hidden md:inline">
              Check-In {plottedHeliAdminSheet.heliAdminCheckInTime}
            </span>
            <span className="font-mono tabular-nums text-emerald-400 whitespace-nowrap hidden md:inline">
              STD {plottedHeliAdminSheet.stdTime}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowHeliAdminModal(true)}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700 text-[11px] font-medium cursor-pointer whitespace-nowrap"
            >
              Sheet & Checklist
            </button>
            <button
              onClick={() => setPlottedHeliAdminSheet(null)}
              title="Hide Plotted Heli-Admin Loop"
              className="text-slate-400 hover:text-white p-0.5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div className="bg-rose-950/80 border-b border-rose-500/40 px-4 py-1 text-xs text-rose-200 text-center shrink-0">
          Offline Mode — Displaying cached offshore rig registry and scheduled flight trajectories.
        </div>
      )}

      {/* =====================================================================
          MAIN WORKSPACE STAGE (Desktop Split Console + Mobile Touch Views)
         ===================================================================== */}
      <main className="flex-1 flex overflow-hidden relative pb-14 lg:pb-0">
        {/* LEFT / MAIN VIEWPORT: Interactive Radar Map */}
        <div
          className={`flex-1 h-full relative ${
            activeTab === 'radar' ? 'block' : 'hidden lg:block'
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
            activeHeliAdminSheet={plottedHeliAdminSheet}
            showRangeRings={showRangeRings}
            onToggleRangeRings={() => setShowRangeRings((prev) => !prev)}
            showFacilityLabels={showFacilityLabels}
            onToggleFacilityLabels={() => setShowFacilityLabels((prev) => !prev)}
            onUseMyGps={handleUseMyGps}
            mapViewTarget={mapViewTarget}
            onMapCenterChanged={(lat, lon) => setQueryCenter({ lat, lon })}
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
          />

          {/* Mobile Bottom Sheet for Selected Flight when viewing Map */}
          {selectedFlight && activeTab === 'radar' && (
            <div className="lg:hidden absolute bottom-2 left-2 right-2 z-[500] max-h-[58vh] overflow-y-auto shadow-2xl">
              <FlightDossierPanel
                flight={selectedFlight}
                activeFacility={activeFacility}
                isPinned={pinnedFlightHex === selectedFlight.hex}
                onTogglePin={handleTogglePin}
                alertsEnabled={alertsEnabled}
                onToggleAlerts={handleToggleAlerts}
                onClose={() => setSelectedFlightHex(null)}
                onCenterOnFlight={handleSelectFlight}
              />
            </div>
          )}
        </div>

        {/* RIGHT TELEMETRY & OPERATIONS DOCK (420px on Desktop, Full View on Mobile Tabs) */}
        <aside
          className={`w-full lg:w-[430px] xl:w-[460px] h-full bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 ${
            activeTab === 'radar' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Desktop Selected Aircraft Telemetry Dossier at top of Right Dock */}
          {selectedFlight && (
            <div className="hidden lg:block p-3 border-b border-slate-800 bg-slate-950 shrink-0">
              <FlightDossierPanel
                flight={selectedFlight}
                activeFacility={activeFacility}
                isPinned={pinnedFlightHex === selectedFlight.hex}
                onTogglePin={handleTogglePin}
                alertsEnabled={alertsEnabled}
                onToggleAlerts={handleToggleAlerts}
                onClose={() => setSelectedFlightHex(null)}
                onCenterOnFlight={handleSelectFlight}
              />
            </div>
          )}

          {/* Right Dock Segmented View Switcher (Desktop) */}
          <div className="hidden lg:grid grid-cols-3 gap-1 p-2 bg-slate-900/80 border-b border-slate-800 shrink-0">
            <button
              onClick={() => setDockTab('flights')}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'flights'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Flights ({visibleFlights.length})
            </button>
            <button
              onClick={() => setDockTab('directory')}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'directory'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Rigs & Terminals
            </button>
            <button
              onClick={() => setDockTab('weather')}
              className={`py-1.5 px-2 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                dockTab === 'weather'
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              METAR & WX ({weather?.cap437Status || 'GO'})
            </button>
          </div>

          {/* Active Panel Body */}
          <div className="flex-1 overflow-hidden">
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

            {dockTab === 'weather' && (
              <HelideckWeatherPanel
                facility={activeFacility}
                weather={weather}
                loading={weatherLoading}
                onRefresh={loadWeather}
              />
            )}
          </div>

          {/* Creator Signature Footer */}
          <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800/90 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <span>ChopperCheck.com</span>
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
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'radar' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Radar className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Radar</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('flights');
            setDockTab('flights');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'flights' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Plane className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Flights</span>
        </button>

        <button
          onClick={() => setShowSkyCompassModal(true)}
          className="min-h-[44px] flex flex-col items-center justify-center text-emerald-400 cursor-pointer"
        >
          <Compass className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Sky Spotter</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('directory');
            setDockTab('directory');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'directory' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Rigs/Terms</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('weather');
            setDockTab('weather');
          }}
          className={`min-h-[44px] flex flex-col items-center justify-center cursor-pointer ${
            activeTab === 'weather' ? 'text-cyan-400' : 'text-slate-400'
          }`}
        >
          <CloudRainWind className="w-4 h-4" />
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">METAR/WX</span>
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

      {/* Offshore Heli-Admin Flight Sheets & Multi-Stop Route Plotter Modal */}
      <HeliAdminSheetModal
        isOpen={showHeliAdminModal}
        onClose={() => setShowHeliAdminModal(false)}
        sheets={heliAdminSheets}
        activeSheet={selectedHeliAdminSheet}
        onSelectSheet={setSelectedHeliAdminSheet}
        onAddSheet={(newSheet) =>
          setHeliAdminSheets((prev) => [newSheet, ...prev])
        }
        facilities={facilities}
        flights={flights}
        onPlotAndFocusSheet={handlePlotAndFocusSheet}
        onSelectFacility={handleSelectFacility}
      />

      {/* Mobile & GitHub Pages Installation Modal */}
      <InstallAndGitHubModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
      />
    </div>
  );
}
