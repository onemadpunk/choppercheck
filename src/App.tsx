import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AircraftTarget,
  FieldOperator,
  FlightAlertEvent,
  HelideckWeatherState,
  HelicopterOperator,
  InstallationOrAirport,
  SectorId,
  TrafficCategory,
} from './types/radar';
import {
  INSTALLATIONS_AND_AIRPORTS,
} from './data/installationsAndAirports';
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
import { reported } from './utils/dataQuality';
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

  // The current view starts at GPS; favourites are saved separately.
  const [activeFacilityId, setActiveFacilityId] = useState<string>('');
  const [referenceLocation, setReferenceLocation] = useState({ lat: 57.65, lon: 0.8 });
  const activeFacility = useMemo(
    () => facilities.find((f) => f.id === activeFacilityId) || { id: 'map-reference', code: 'MAP', name: 'North Sea map reference', shortName: 'Map reference', lat: referenceLocation.lat, lon: referenceLocation.lon, assetType: 'Map reference', fieldOperator: 'UK Airport / Heliport', primaryShoreBase: '', helicopterOperators: [], regionLabel: '', elevationFt: 0, sector: 'uk_north_sea' } as InstallationOrAirport,
    [facilities, activeFacilityId, referenceLocation]
  );

  // Favourite / Starred Rigs (persisted in localStorage for 1-tap mobile switching)
  const [favoriteFacilityIds, setFavoriteFacilityIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('choppercheck_favorite_rigs');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((id): id is string => typeof id === 'string');
      }
    } catch {
      // ignore storage errors
    }
    return [];
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
    zoom: activeFacilityId ? 8 : 6,
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
  const [feedState, setFeedState] = useState<'loading' | 'available' | 'unavailable'>('loading');
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
  const queryCenterRef = useRef<{ lat: number; lon: number }>(queryCenter);
  useEffect(() => {
    queryCenterRef.current = queryCenter;
  }, [queryCenter]);

  // Persistent memory of recently seen live aircraft (45s retention) so targets never blink/vanish on a missed packet
  const recentAircraftMapRef = useRef<Map<string, { flight: AircraftTarget; seenAt: number }>>(
    new Map()
  );

  // Due-Off Flight & 25/10 NM Approach Alert State
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(false);
  const [activeAlertBanner, setActiveAlertBanner] = useState<FlightAlertEvent | null>(null);
  const firedAlertKeysRef = useRef<Set<string>>(new Set());
  const previousAlertPositions = useRef<Map<string, AircraftTarget>>(new Map());

  // Weather & METAR State
  const [weather, setWeather] = useState<HelideckWeatherState | null>(null);
  const [weatherLoading, setWeatherLoading] = useState<boolean>(false);

  // Modals: Install help and GPS aircraft compass
  const [showInstallModal, setShowInstallModal] = useState<boolean>(false);
  const [showSkyCompassModal, setShowSkyCompassModal] = useState<boolean>(false);
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  // Expiry runs even when every network request fails. Predictions retain the original observation time.
  useEffect(() => {
    const timer = setInterval(() => {
      setFlights(prev => advanceAircraftPositionsSmoothly(prev, 2, activeFacility));
      const now = Date.now();
      for (const [hex, entry] of recentAircraftMapRef.current) {
        if (!entry.flight.observedAt || now - entry.flight.observedAt > 45000) recentAircraftMapRef.current.delete(hex);
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [activeFacility]);

  useEffect(() => {
    recentAircraftMapRef.current.clear();
    previousAlertPositions.current.clear();
    firedAlertKeysRef.current.clear();
    setFlights([]);
    setFeedState('loading');
    const stop = startVisiblePolling(async signal => {
        const center = queryCenterRef.current;
        const result = await fetchHybridRadarTraffic(center.lat, center.lon, activeFacility, 0, false, signal);
        if (signal.aborted) return;
        setFeedState(result.feedAvailable ? 'available' : 'unavailable');
        if (result.provider) setFeedProvider(result.provider);
        const now = Date.now();
        for (const flight of result.flights) {
          recentAircraftMapRef.current.set(flight.hex, { flight, seenAt: flight.observedAt! });
        }
        for (const [hex, entry] of recentAircraftMapRef.current) {
          if (!entry.flight.observedAt || now - entry.flight.observedAt > 45000) recentAircraftMapRef.current.delete(hex);
        }
        const current = advanceAircraftPositionsSmoothly([...recentAircraftMapRef.current.values()].map(e => e.flight), 0, activeFacility);
        setFlights(current);
        setSelectedFlightHex(prev => current.some(f => f.hex === prev) ? prev : null);
        return result.retryAfterMs;
    });
    return stop;
  }, [activeFacility]);

  // Only observed positions trigger alerts. Proximity is not evidence of an approach or destination.
  useEffect(() => {
    for (const f of flights) {
      if (!f.observedAt || Date.now() - f.observedAt > 10000) continue;
      const prev = previousAlertPositions.current.get(f.hex);
      if (prev?.observedAt === f.observedAt) continue;
      previousAlertPositions.current.set(f.hex, f);
      if (!alertsEnabled) continue;
      const pinned = pinnedFlightHex === f.hex;
      const heli = f.category === 'offshore_heli' || f.category === 'coastguard_sar';
      let key = ''; let message = ''; let type: FlightAlertEvent['triggerType'] = 'AIRBORNE_LIFTOFF';
      if (pinned && f.altitudeReported && f.speedReported && f.altitudeFt >= 200 && f.groundSpeedKts >= 45 && !firedAlertKeysRef.current.has(f.hex + '_DETECTED')) {
        key = f.hex + '_DETECTED';
        message = 'PINNED AIRCRAFT DETECTED AIRBORNE: ' + f.callsign + '. Take-off time and destination are not confirmed.';
      } else if (activeFacility.id !== 'map-reference' && (pinned || heli) && prev && prev.observedAt && f.observedAt - prev.observedAt <= 15000) {
        const ring = prev.distanceFromRefNm > 10 && f.distanceFromRefNm <= 10 ? 10 : prev.distanceFromRefNm > 25 && f.distanceFromRefNm <= 25 ? 25 : null;
        if (ring) {
          type = ring === 10 ? 'RING_10NM' : 'RING_25NM';
          key = f.hex + '_' + activeFacility.id + '_' + ring;
          message = f.callsign + ' entered the ' + ring + ' NM proximity ring around ' + activeFacility.shortName + '. Destination is not confirmed.';
        }
      }
      if (!key || firedAlertKeysRef.current.has(key)) continue;
      firedAlertKeysRef.current.add(key);
      setActiveAlertBanner({ id: key, timestamp: new Date().toLocaleTimeString('en-GB'), callsign: f.callsign, typeFullName: f.typeFullName, triggerType: type, message });
      playCockpitAlertChime(type === 'RING_10NM');
      triggerBrowserNotification('ChopperCheck: ' + f.callsign, message);
    }
    const present = new Set(flights.map(f => f.hex));
    for (const hex of previousAlertPositions.current.keys()) if (!present.has(hex)) previousAlertPositions.current.delete(hex);
  }, [flights, alertsEnabled, pinnedFlightHex, activeFacility]);

  const weatherRequestRef = useRef(0);
  const loadWeather = useCallback(async () => {
    const requestId = ++weatherRequestRef.current;
    if (activeFacility.id === 'map-reference') { setWeather(null); setWeatherLoading(false); return; }
    setWeatherLoading(true);
    const wx = await fetchHelideckWeather(activeFacility);
    if (requestId !== weatherRequestRef.current) return;
    setWeather(wx);
    setWeatherLoading(false);
  }, [activeFacility]);
  useEffect(() => {
    setWeather(null);
    void loadWeather();
    const timer = setInterval(() => void loadWeather(), 10 * 60 * 1000);
    return () => { weatherRequestRef.current++; clearInterval(timer); };
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
      } else if (categoryFilter !== 'all' && f.category !== categoryFilter && !(categoryFilter === 'offshore_heli' && f.category === 'coastguard_sar')) {
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
    if (!alertsEnabled) void requestNotificationPermission();
    setAlertsEnabled((prev) => {
      const next = !prev;
      if (next) playCockpitAlertChime(false);
      return next;
    });
  }, [alertsEnabled]);

  const handleSelectSector = (preset: (typeof SECTOR_PRESETS)[number]) => {
    gpsRequestRef.current++;
    setActiveSector(preset.id);
    setActiveFacilityId('');
    setReferenceLocation({ lat: preset.lat, lon: preset.lon });
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
    gpsRequestRef.current++;
    setActiveFacilityId(fac.id);
    setActiveSector(fac.sector);
    setQueryCenter({ lat: fac.lat, lon: fac.lon });
    setMapViewTarget((prev) => ({
      lat: fac.lat,
      lon: fac.lon,
      zoom: fac.assetType === 'UK Airport' || fac.assetType === 'SAR Base' ? 9 : 8,
      seq: prev.seq + 1,
    }));
  }, []);

  const handleSelectFlight = useCallback((flight: AircraftTarget) => {
    gpsRequestRef.current++;
    const rebased = advanceAircraftPositionsSmoothly([flight], 0, activeFacility)[0];
    if (!rebased) return;
    recentAircraftMapRef.current.set(rebased.hex, { flight: rebased, seenAt: rebased.observedAt! });
    setFlights(prev => [rebased, ...prev.filter(f => f.hex !== rebased.hex)]);
    setActiveTab('radar');
    setMobileDetailsOpen(false);
    setSelectedFlightHex(flight.hex);
    setMapViewTarget((prev) => ({
      lat: flight.lat,
      lon: flight.lon,
      zoom: 8,
      seq: prev.seq + 1,
    }));
  }, [activeFacility]);

  const gpsRequestRef = useRef(0);
  const [locationError, setLocationError] = useState('');
  const handleUseMyGps = useCallback(() => {
    const requestId = ++gpsRequestRef.current;
    if ('geolocation' in navigator) {
      setLocationError('');
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (requestId !== gpsRequestRef.current) return;
          const lat = Number(pos.coords.latitude.toFixed(4));
          const lon = Number(pos.coords.longitude.toFixed(4));
          const customHome: InstallationOrAirport = {
            id: 'gps-my-location',
            code: 'GPS',
            name: 'My GPS Location',
            shortName: 'My GPS Location',
            fieldOperator: 'UK Airport / Heliport',
            assetType: 'GPS location',
            sector: 'uk_north_sea',
            lat,
            lon,
            elevationFt: 0,
            primaryShoreBase: '',
            helicopterOperators: ['HM Coastguard', 'Commercial Airline'],
            regionLabel: 'Device GPS reference',
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
          if (requestId !== gpsRequestRef.current) return;
          setLocationError('Location unavailable. Showing the regional overview. Tap GPS to retry, or choose a rig/base.');
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
      );
    } else { setLocationError('GPS is not supported in this browser.'); }
  }, []);

  useEffect(() => { handleUseMyGps(); }, [handleUseMyGps]);

  const handleAddCustomCoordinate = (name: string, lat: number, lon: number) => {
    const newId = `custom-${Date.now()}`;
    const newFac: InstallationOrAirport = {
      id: newId,
      code: name.slice(0, 4).toUpperCase(),
      name,
      shortName: name,
      fieldOperator: 'UK Airport / Heliport',
      assetType: 'Custom location',
      sector: 'uk_north_sea',
      lat,
      lon,
      elevationFt: 0,
      primaryShoreBase: '',
      helicopterOperators: ['Bristow', 'CHC', 'NHV', 'OHS'],
      regionLabel: 'Custom User Coordinates',
    };
    setFacilities((prev) => [newFac, ...prev]);
    handleSelectFacility(newFac);
  };


  return (
    <div className="app-shell h-dvh flex flex-col bg-[#07090e] text-slate-100 overflow-hidden">
      {/* =====================================================================
          TOP NAVIGATION BAR (Strict 3-Zone Contract: Brand | 4 Nav Links | 1 CTA)
         ===================================================================== */}
      <header className="flex items-center justify-between gap-3 px-3 sm:px-6 py-3 bg-slate-950 border-b border-slate-800 shrink-0">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#radar"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('radar');
          }}
          className="text-sm sm:text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0 font-display"
        >
          ChopperCheck.com
        </a>

        {/* Zone 2: 4 clean single-line navigation links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium text-slate-400">
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
            Flights
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
            Rigs & Bases
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
            Weather & Marine
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action Button */}
        <div className="flex items-center gap-2 shrink-0"><div className="lg:hidden"><select aria-label="Aircraft filter" value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value as typeof categoryFilter); setHeliOpFilter('all'); }} className="bg-slate-800 rounded p-2 text-xs text-slate-200"><option value="all">All flights</option><option value="offshore_heli">Helicopters</option><option value="commercial_fixed_wing">Fixed wing</option><option value="coastguard_sar">Coastguard</option>{activeFacility.id !== 'map-reference' && <option value="active_facility">Near {activeFacility.code}</option>}</select></div><button onClick={() => setShowInstallModal(true)} aria-label="Help and install" className="lg:hidden w-9 h-10 border border-slate-700 rounded-lg text-cyan-300 font-bold">?</button>
          <button
            onClick={() => setShowInstallModal(true)}
            className="hidden lg:block px-3.5 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Install to Phone
          </button>
        </div>
      </header>

      {/* =====================================================================
          WORKSPACE SECTOR, SKY COMPASS & ALERT CONTROLS TOOLBAR
         ===================================================================== */}
      <div className="desktop-toolbar hidden lg:flex bg-slate-900/90 border-b border-slate-800 px-3 sm:px-6 py-2 flex-wrap items-center justify-between gap-2 shrink-0">
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
            onClick={() => setShowSkyCompassModal(true)}
            title="Nearby-aircraft compass using your GPS location"
            className="px-2.5 py-1 rounded-md text-xs font-semibold whitespace-nowrap shrink-0 bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 flex items-center gap-1 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5" />
            Sky Compass
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
            title="Alerts while this page runs: airborne detection and 25 / 10 NM proximity rings"
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
            {alertsEnabled ? 'Page Alerts On' : 'Page Alerts Off'}
          </button>

          <div className="px-2.5 py-1.5 rounded-lg text-xs font-mono font-medium bg-slate-950 text-emerald-400 border border-emerald-500/40 whitespace-nowrap shrink-0">
            {feedState === 'loading' ? 'Connecting to aircraft feed…' : feedState === 'unavailable' ? 'Feed unavailable · last known positions' : 'North Sea · ' + feedProvider + ' · ' + liveCount + ' tracked aircraft'}
          </div>
        </div>
      </div>

      <div className="hidden lg:flex items-center gap-2 px-3 py-2 bg-slate-950 border-b border-slate-800 shrink-0 overflow-x-auto">
        <span className="text-xs text-slate-400 whitespace-nowrap">My rigs</span>
        {favoriteFacilities.length === 0 && <button onClick={() => { setActiveTab('directory'); setDockTab('directory'); }} className="text-xs text-cyan-300 px-3 py-2 bg-slate-900 rounded whitespace-nowrap">Choose & save rigs</button>}
        {favoriteFacilities.map(fac => <button key={fac.id} onClick={() => { handleSelectFacility(fac); setActiveTab('radar'); }} className={'text-xs px-3 py-2 rounded whitespace-nowrap ' + (fac.id === activeFacility.id ? 'bg-cyan-500 text-slate-950 font-semibold' : 'bg-slate-900 text-slate-200')}>{fac.shortName}</button>)}
        <button onClick={() => { setActiveTab('directory'); setDockTab('directory'); }} className="ml-auto text-xs text-cyan-300 px-3 py-2 bg-slate-900 rounded whitespace-nowrap">Choose rig</button>
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
              Route not reported
            </span>
            <span aria-hidden="true" className="text-slate-500">·</span>
            <span className="font-mono tabular-nums text-emerald-400 whitespace-nowrap">
              Arrival time unavailable
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums">
            <span className="text-slate-300 hidden sm:inline">
              {pinnedFlight.distanceFromRefNm} NM · {reported(pinnedFlight.altitudeReported, pinnedFlight.altitudeFt, ' ft')}
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


      {/* Offline Connectivity Banner */}
      {!isOnline && (
        <div className="bg-rose-950/80 border-b border-rose-500/40 px-4 py-1 text-xs text-rose-200 text-center shrink-0">
          Offline — flight updates and page alerts are unavailable. Old aircraft expire automatically.
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
          <button onClick={() => { setActiveTab('flights'); setDockTab('flights'); }} className={'lg:hidden absolute bottom-6 left-2 z-[450] max-w-[calc(100%-76px)] text-left rounded-lg border px-2.5 py-2 text-[11px] shadow-lg ' + (feedState === 'unavailable' ? 'bg-amber-950/95 border-amber-700 text-amber-200' : 'bg-slate-950/95 border-slate-700 text-slate-300')}>
            {feedState === 'loading' ? 'Connecting to aircraft feed…' : feedState === 'unavailable' ? 'Feed unavailable · retrying' : 'North Sea · ' + flights.length + ' aircraft · ' + flights.filter(f => f.category === 'offshore_heli' || f.category === 'coastguard_sar').length + ' helicopters · View list'}
          </button>
          {locationError && <div role="alert" className="absolute top-16 left-2 right-2 max-w-sm z-[500] px-3 py-2 rounded-lg border border-amber-700 bg-amber-950/95 text-amber-200 text-xs flex justify-between gap-2">{locationError}<button onClick={() => setLocationError('')} aria-label="Dismiss location message"><X className="w-4 h-4" /></button></div>}
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

          {selectedFlight && activeTab === 'radar' && (
            <div className="lg:hidden absolute bottom-2 left-2 right-2 z-[500] max-h-[55dvh] overflow-y-auto shadow-2xl rounded-xl border border-slate-700 bg-slate-950">
              <div className="flex items-center justify-between gap-2 p-3">
                <button onClick={() => setMobileDetailsOpen(prev => !prev)} className="text-left flex-1 min-w-0"><p className="font-semibold text-sm text-white truncate">{selectedFlight.callsign} · {selectedFlight.typeFullName}</p><p className="text-xs text-slate-400 mt-1">{reported(selectedFlight.altitudeReported, selectedFlight.altitudeFt, ' ft')} · {selectedFlight.distanceFromRefNm} NM · {mobileDetailsOpen ? 'Hide details ▾' : 'View details ▴'}</p></button>
                <button onClick={() => { setSelectedFlightHex(null); setMobileDetailsOpen(false); }} aria-label="Close selected aircraft" className="p-3 rounded-lg bg-slate-800"><X className="w-4 h-4" /></button>
              </div>
              {mobileDetailsOpen && <FlightDossierPanel flight={selectedFlight} activeFacility={activeFacility} isPinned={pinnedFlightHex === selectedFlight.hex} onTogglePin={handleTogglePin} alertsEnabled={alertsEnabled} onToggleAlerts={handleToggleAlerts} onCenterOnFlight={handleSelectFlight} />}
            </div>
          )}
        </div>

        {/* RIGHT TELEMETRY & OPERATIONS DOCK (420px on Desktop, Full View on Mobile Tabs) */}
        <aside
          className={`w-full lg:w-[430px] xl:w-[460px] h-full bg-slate-950 border-l border-slate-800 flex flex-col shrink-0 ${
            activeTab === 'radar' ? 'hidden lg:flex' : 'flex'
          }`}
        >
          {/* Selected aircraft details only on the flight view */}
          {selectedFlight && dockTab === 'flights' && (
            <div className="hidden lg:block p-3 border-b border-slate-800 bg-slate-950 shrink-0 max-h-[55vh] overflow-y-auto">
              <FlightDossierPanel
                flight={selectedFlight}
                activeFacility={activeFacility}
                isPinned={pinnedFlightHex === selectedFlight.hex}
                onTogglePin={handleTogglePin}
                alertsEnabled={alertsEnabled}
                onToggleAlerts={handleToggleAlerts}
                onClose={() => { setSelectedFlightHex(null); setMobileDetailsOpen(false); }}
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
              Weather & Marine
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
              activeFacility.id === 'map-reference' ? <div className="p-6 text-sm text-slate-400">Choose a rig or base from Rigs to view weather.</div> : <HelideckWeatherPanel
                facility={activeFacility}
                weather={weather}
                loading={weatherLoading}
                onRefresh={loadWeather}
              />
            )}
          </div>

          {/* Creator Signature Footer */}
          <div className="px-3 py-1.5 bg-slate-950 border-t border-slate-800/90 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <a href={feedProvider === 'adsb.fi' ? 'https://adsb.fi/' : 'https://www.adsb.lol/'} target="_blank" rel="noopener noreferrer" className="underline">{feedProvider || 'ADS-B sources'}</a>
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
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Compass</span>
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
          <span className="text-[10px] font-medium mt-0.5 whitespace-nowrap">Rigs</span>
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
