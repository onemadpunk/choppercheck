import type { ViewBounds } from '../utils/trackingRegions';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { reported, positionLabel } from '../utils/dataQuality';
import {
  AircraftTarget,
  AirframePresetId,
  CustomRigOverride,
  FieldOperator,
  FlightOpsMode,
  HelideckWeatherState,
  InstallationOrAirport,
  MultiModelHourEntry,
  SpatialWeatherGridPoint,
  WeatherModelId,
  WeatherOverlayMode,
} from '../types/radar';
import { FIELD_OPERATOR_COLORS } from '../data/installationsAndAirports';
import {
  AIRFRAME_PRESETS,
  RainViewerRadarFrame,
  WEATHER_MODELS_META,
  evaluateCorridorLightningBypass,
  fetchRainViewerRadarFrames,
  interpolateSpotWeatherAtLatLon,
} from '../services/multiModelWeatherService';
import {
  buildContextAwareSevenDaySummaries,
  evaluateHourWithLimits,
} from '../utils/solarAndMetUtils';
import { WeatherStreamlineCanvas } from './WeatherStreamlineCanvas';
import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronUp,
  CloudRainWind,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Layers,
  LocateFixed,
  MapPin,
  Minus,
  Plus,
  Star,
  X,
  Zap,
} from 'lucide-react';

const escapeHtml = (s: string) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)
  );

interface RadarMapProps {
  flights: AircraftTarget[];
  installations: InstallationOrAirport[];
  selectedFlight: AircraftTarget | null;
  onSelectFlight: (flight: AircraftTarget) => void;
  activeFacility: InstallationOrAirport;
  onSelectFacility: (facility: InstallationOrAirport) => void;
  pinnedFlightHex: string | null;
  showRangeRings: boolean;
  onToggleRangeRings: () => void;
  showFacilityLabels: boolean;
  onToggleFacilityLabels: () => void;
  onUseMyGps: () => void;
  mapViewTarget: { lat: number; lon: number; zoom: number; seq: number };
  onMapCenterChanged: (lat: number, lon: number, bounds?: ViewBounds) => void;
  isFavoriteFacility: boolean;
  onToggleFavoriteFacility: (id: string) => void;
  singleRigFocus: boolean;
  onToggleSingleRigFocus: () => void;
  weather: HelideckWeatherState | null;
  onOpenDirectory: () => void;
  onOpenWeather: () => void;
  weatherOverlayMode: WeatherOverlayMode;
  onChangeWeatherOverlayMode: (mode: WeatherOverlayMode) => void;
  weatherModelId: WeatherModelId;
  onChangeWeatherModelId: (model: WeatherModelId) => void;
  airframePresetId: AirframePresetId;
  onChangeAirframePresetId: (preset: AirframePresetId) => void;
  spatialGrid: SpatialWeatherGridPoint[];
  hourlyForecast: MultiModelHourEntry[];
  selectedHourIdx: number;
  onChangeSelectedHourIdx: (idx: number) => void;
  flightOpsMode: FlightOpsMode;
  customOverride?: CustomRigOverride | null;
  viewMode?: 'simple' | 'detailed';
  onChangeViewMode?: (mode: 'simple' | 'detailed') => void;
}

type MapStyleMode = 'dark_radar' | 'daylight_osm' | 'satellite' | 'nautical_ocean';

const NM_TO_METERS = 1852;

function createAircraftIconHtml(
  flight: AircraftTarget,
  isSelected: boolean,
  isPinned: boolean,
  currentZoom: number,
  showAllLabels: boolean
): string {
  const isSar = flight.category === 'coastguard_sar';
  const isHeli = flight.isRotary ?? (flight.category === 'offshore_heli' || isSar);

  const color = isSelected
    ? '#ffffff'
    : isPinned
    ? '#f59e0b'
    : isSar
    ? '#f97316'
    : isHeli
    ? '#06b6d4'
    : '#eab308';

  const glow = isSelected
    ? 'drop-shadow(0 0 8px rgba(255,255,255,0.95))'
    : isPinned
    ? 'drop-shadow(0 0 7px rgba(245,158,11,0.9))'
    : isSar
    ? 'drop-shadow(0 0 6px rgba(249,115,22,0.85))'
    : 'drop-shadow(0 2px 4px rgba(0,0,0,0.85))';

  const iconSize = isSelected || isPinned ? 30 : currentZoom >= 8 ? 26 : 22;

  const svg = isHeli
    ? `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 32 32" style="transform: rotate(${flight.trackDeg}deg); filter: ${glow};">
        <circle cx="16" cy="14" r="10" fill="none" stroke="${color}" stroke-width="1.3" stroke-dasharray="3 2" opacity="0.7"/>
        <path d="M16 5 C18.2 8 18.5 13 18 18 L17 25 L20 27 L12 27 L15 25 L14 18 C13.5 13 13.8 8 16 5 Z" fill="${color}" stroke="#07090e" stroke-width="1.1"/>
        <line x1="6" y1="14" x2="26" y2="14" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="4" x2="16" y2="24" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      </svg>`
    : `<svg width="${iconSize - 2}" height="${iconSize - 2}" viewBox="0 0 32 32" style="transform: rotate(${flight.trackDeg}deg); filter: ${glow};">
        <path d="M16 3 L18 11 L28 16 L28 18.5 L18 15.5 L17.5 24 L22 27 L22 28.5 L16 27 L10 28.5 L10 27 L14.5 24 L14 15.5 L4 18.5 L4 16 L14 11 Z" fill="${color}" stroke="#07090e" stroke-width="1"/>
      </svg>`;

  const shouldShowLabel =
    isSelected ||
    isPinned ||
    isSar ||
    (isHeli && currentZoom >= 7) ||
    (showAllLabels && currentZoom >= 8);

  const labelBg = isSelected
    ? 'background:#06b6d4;color:#07090e;font-weight:700;'
    : isPinned
    ? 'background:#f59e0b;color:#07090e;font-weight:700;'
    : isSar
    ? 'background:rgba(154,52,18,0.92);color:#ffedd5;border:1px solid #f97316;'
    : 'background:rgba(15,23,42,0.88);color:#e2e8f0;border:1px solid rgba(51,65,85,0.85);';

  const labelHtml = shouldShowLabel
    ? `<div style="margin-top:1px;padding:1px 4px;border-radius:3px;font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.2;white-space:nowrap;${labelBg}">
        ${escapeHtml(flight.callsign)} · ${escapeHtml(flight.typeCode)}
      </div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);cursor:pointer;">
      ${flight.trackReported === false ? `<svg width="22" height="22"><circle cx="11" cy="11" r="6" fill="${color}" /></svg>` : svg}
      ${labelHtml}
    </div>
  `;
}

function createFacilityIconHtml(
  fac: InstallationOrAirport,
  isActive: boolean,
  showLabel: boolean,
  currentZoom: number
): string {
  const color = FIELD_OPERATOR_COLORS[fac.fieldOperator as FieldOperator] || '#06b6d4';
  const isFpso = fac.assetType === 'FPSO';
  const isAirport =
    fac.assetType === 'UK Airport' ||
    fac.assetType === 'Shore Heliport' ||
    fac.assetType === 'SAR Base' ||
    fac.assetType === 'Norwegian Hub';

  const ringBorder = isActive ? '2px solid #ffffff' : `1.5px solid ${color}`;
  const size = isActive ? 15 : 11;

  const shapeHtml =
    fac.assetType === 'GPS location' || fac.assetType === 'Custom location'
      ? `<div style="width:14px;height:14px;border-radius:50%;background:#38bdf8;border:3px solid white;box-shadow:0 0 0 6px rgba(56,189,248,0.2);"></div>`
      : isFpso
      ? `<div style="width:${size + 6}px;height:${size - 2}px;background:${color};border:${ringBorder};border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,0.9);"></div>`
      : isAirport
      ? `<div style="width:${size + 3}px;height:${size + 3}px;background:#0f172a;border:2px solid ${color};border-radius:3px;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;color:${color};">H</div>`
      : `<div style="width:${size}px;height:${size}px;background:${color};border:${ringBorder};transform:rotate(45deg);box-shadow:0 0 8px rgba(0,0,0,0.9);"></div>`;

  const shouldRenderLabel = isActive || (showLabel && currentZoom >= 7);

  const labelHtml = shouldRenderLabel
    ? `<div style="margin-top:3px;padding:1px 4px;border-radius:2px;background:rgba(7,9,14,0.88);color:${
        isActive ? '#ffffff' : '#cbd5e1'
      };border:1px solid ${
        isActive ? '#06b6d4' : 'rgba(30,41,59,0.9)'
      };font-family:'JetBrains Mono',monospace;font-size:9px;white-space:nowrap;font-weight:${
        isActive ? '700' : '500'
      };">
        ${escapeHtml(fac.shortName)}
      </div>`
    : '';

  return `
    <div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);cursor:pointer;">
      ${shapeHtml}
      ${labelHtml}
    </div>
  `;
}

const isNarrowViewport = (): boolean =>
  typeof window !== 'undefined' && window.innerWidth < 1024;

const readStoredFlag = (key: string, fallback: boolean): boolean => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
};

const writeStoredFlag = (key: string, value: boolean): void => {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable (private mode) – keep in-memory state only */
  }
};

export const RadarMap: React.FC<RadarMapProps> = ({
  flights,
  installations,
  selectedFlight,
  onSelectFlight,
  activeFacility,
  onSelectFacility,
  pinnedFlightHex,
  showRangeRings,
  onToggleRangeRings,
  showFacilityLabels,
  onToggleFacilityLabels,
  onUseMyGps,
  mapViewTarget,
  onMapCenterChanged,
  isFavoriteFacility,
  onToggleFavoriteFacility,
  singleRigFocus,
  onToggleSingleRigFocus,
  weather,
  onOpenDirectory,
  onOpenWeather,
  weatherOverlayMode,
  onChangeWeatherOverlayMode,
  weatherModelId,
  onChangeWeatherModelId,
  airframePresetId,
  onChangeAirframePresetId,
  spatialGrid,
  hourlyForecast,
  selectedHourIdx,
  onChangeSelectedHourIdx,
  flightOpsMode,
  customOverride,
  viewMode = 'simple',
  onChangeViewMode,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const rainTileLayerRef = useRef<L.TileLayer | null>(null);
  const aircraftAttributionRef = useRef<string>('');
  const aircraftLayerRef = useRef<L.LayerGroup | null>(null);
  const facilityLayerRef = useRef<L.LayerGroup | null>(null);
  const ringsLayerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);

  const [mapStyle, setMapStyle] = useState<MapStyleMode>('dark_radar');
  const [mobileDockOpen, setMobileDockOpen] = useState<boolean>(false);
  // Floating map cards can be folded into small chips so they never pile up over the map on phones.
  // "Hide boxes" clean-map mode: hides every floating card, the weather dock and the side buttons in one tap.
  const [boxesHidden, setBoxesHidden] = useState<boolean>(false);
  const [rigCardCollapsed, setRigCardCollapsed] = useState<boolean>(() =>
    readStoredFlag('choppercheck_rig_card_collapsed', false)
  );
  const [lightningKeyCollapsed, setLightningKeyCollapsed] = useState<boolean>(() =>
    readStoredFlag('choppercheck_lightning_key_collapsed', isNarrowViewport())
  );
  useEffect(() => writeStoredFlag('choppercheck_rig_card_collapsed', rigCardCollapsed), [rigCardCollapsed]);
  useEffect(
    () => writeStoredFlag('choppercheck_lightning_key_collapsed', lightningKeyCollapsed),
    [lightningKeyCollapsed]
  );
  const [showRainRadar, setShowRainRadar] = useState<boolean>(false);
  const [rainFrames, setRainFrames] = useState<RainViewerRadarFrame[]>([]);
  const [rainFrameIdx, setRainFrameIdx] = useState<number>(0);
  const [rainLoopPlaying, setRainLoopPlaying] = useState<boolean>(true);
  const [currentZoom, setCurrentZoom] = useState<number>(mapViewTarget.zoom);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number }>({
    lat: activeFacility.lat,
    lon: activeFacility.lon,
  });

  const isFpso = activeFacility.assetType === 'FPSO' || activeFacility.assetType === 'Semi-Sub';
  const activePreset = AIRFRAME_PRESETS[airframePresetId];
  const daySummaries = useMemo(
    () =>
      buildContextAwareSevenDaySummaries(
        hourlyForecast,
        weatherModelId,
        activePreset,
        isFpso,
        flightOpsMode,
        customOverride
      ),
    [hourlyForecast, weatherModelId, activePreset, isFpso, flightOpsMode, customOverride]
  );
  const activeHour = hourlyForecast[selectedHourIdx] || hourlyForecast[0];
  const activeHourSnap = activeHour?.models[weatherModelId];
  const activeHourEval = useMemo(() => {
    if (!activeHour || !activeHourSnap) return null;
    return evaluateHourWithLimits(
      activeHourSnap,
      activeHour.waveHeightM,
      activeHour.swellPeriodSec,
      Boolean(activeHour.isNight),
      isFpso,
      activePreset,
      flightOpsMode,
      customOverride
    );
  }, [activeHour, activeHourSnap, isFpso, activePreset, flightOpsMode, customOverride]);

  // Live Ventusky-style spot-check readout at cursor / tap coordinate
  const spotWeather = useMemo(
    () =>
      interpolateSpotWeatherAtLatLon(
        cursorCoords.lat,
        cursorCoords.lon,
        spatialGrid,
        activePreset
      ),
    [cursorCoords.lat, cursorCoords.lon, spatialGrid, activePreset]
  );

  const shoreBaseFacility = useMemo(
    () =>
      installations.find((x) => x.code === activeFacility.primaryShoreBase) ||
      installations.find((x) => x.code === 'EGPD') ||
      activeFacility,
    [installations, activeFacility]
  );

  const corridorBypass = useMemo(
    () =>
      evaluateCorridorLightningBypass(
        shoreBaseFacility,
        activeFacility,
        spatialGrid,
        activePreset
      ),
    [shoreBaseFacility, activeFacility, spatialGrid, activePreset]
  );

  // Initialize Leaflet Map once with key-free OpenStreetMap / Esri tiles
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [mapViewTarget.lat, mapViewTarget.lon],
      zoom: mapViewTarget.zoom,
      zoomControl: false,
      attributionControl: true,
    });

    const initialLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
      className: 'radar-dark-tiles',
    }).addTo(map);

    baseTileLayerRef.current = initialLayer;
    ringsLayerRef.current = L.layerGroup().addTo(map);
    trailLayerRef.current = L.layerGroup().addTo(map);
    facilityLayerRef.current = L.layerGroup().addTo(map);
    aircraftLayerRef.current = L.layerGroup().addTo(map);

    map.on('mousemove', (e: L.LeafletMouseEvent) => {
      setCursorCoords({
        lat: Number(e.latlng.lat.toFixed(4)),
        lon: Number(e.latlng.lng.toFixed(4)),
      });
    });

    map.on('click', (e: L.LeafletMouseEvent) => {
      setCursorCoords({
        lat: Number(e.latlng.lat.toFixed(4)),
        lon: Number(e.latlng.lng.toFixed(4)),
      });
    });

    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
    });

    const updateView = () => {
      const c = map.getCenter();
      const b = map.getBounds();
      setCurrentZoom(map.getZoom());
      onMapCenterChanged(c.lat, c.lng, {
        south: b.getSouth(),
        north: b.getNorth(),
        west: b.getWest(),
        east: b.getEast(),
      });
    };

    map.on('moveend', updateView);
    map.on('resize', updateView);
    updateView();

    mapRef.current = map;
    setMapInstance(map);

    return () => {
      map.remove();
      mapRef.current = null;
      setMapInstance(null);
    };
  }, []);

  // Keep source and data-licence attribution attached to the displayed aircraft.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const sources = new Set(flights.map((f) => f.provider));
    const notice = sources.has('adsb.lol')
      ? 'Aircraft: <a href="https://www.adsb.lol/" target="_blank" rel="noopener">adsb.lol</a> · <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>'
      : sources.has('adsb.fi')
      ? 'Aircraft: <a href="https://adsb.fi/" target="_blank" rel="noopener">adsb.fi</a>'
      : '';
    if (notice === aircraftAttributionRef.current) return;
    if (aircraftAttributionRef.current)
      map.attributionControl.removeAttribution(aircraftAttributionRef.current);
    if (notice) map.attributionControl.addAttribution(notice);
    aircraftAttributionRef.current = notice;
  }, [flights]);

  // Switch Map Tile Layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (baseTileLayerRef.current) {
      map.removeLayer(baseTileLayerRef.current);
    }

    let newTileLayer: L.TileLayer;
    if (mapStyle === 'dark_radar') {
      newTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
        className: 'radar-dark-tiles',
      });
    } else if (mapStyle === 'daylight_osm') {
      newTileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      });
    } else if (mapStyle === 'satellite') {
      newTileLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, Maxar, Earthstar Geographics',
          maxZoom: 18,
        }
      );
    } else {
      newTileLayer = L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: '&copy; Esri, GEBCO, NOAA',
          maxZoom: 16,
        }
      );
    }

    newTileLayer.addTo(map);
    newTileLayer.bringToBack();
    baseTileLayerRef.current = newTileLayer;
  }, [mapStyle]);

  // Fetch & Animate Live RainViewer Precipitation Radar Overlay (6 frames / ~60m loop)
  useEffect(() => {
    if (!showRainRadar) {
      if (rainTileLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(rainTileLayerRef.current);
        rainTileLayerRef.current = null;
      }
      return;
    }

    let cancelled = false;
    const loadFrames = async () => {
      const frames = await fetchRainViewerRadarFrames();
      if (!cancelled && frames.length > 0) {
        setRainFrames(frames);
        setRainFrameIdx(frames.length - 1);
      }
    };
    void loadFrames();
    const timer = setInterval(() => void loadFrames(), 5 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [showRainRadar]);

  useEffect(() => {
    if (!showRainRadar || !rainLoopPlaying || rainFrames.length <= 1) return;
    const anim = setInterval(() => {
      setRainFrameIdx((prev) => (prev + 1) % rainFrames.length);
    }, 950);
    return () => clearInterval(anim);
  }, [showRainRadar, rainLoopPlaying, rainFrames.length]);

  const activeRainFrame =
    rainFrames[rainFrameIdx] || rainFrames[rainFrames.length - 1] || null;

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!showRainRadar || !activeRainFrame) {
      if (rainTileLayerRef.current) {
        map.removeLayer(rainTileLayerRef.current);
        rainTileLayerRef.current = null;
      }
      return;
    }
    if (!rainTileLayerRef.current) {
      const layer = L.tileLayer(activeRainFrame.tileUrlTemplate, {
        attribution:
          'Rain: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
        maxNativeZoom: 7,
        maxZoom: 18,
        opacity: 0.65,
        zIndex: 250,
      });
      layer.addTo(map);
      rainTileLayerRef.current = layer;
    } else {
      rainTileLayerRef.current.setUrl(activeRainFrame.tileUrlTemplate);
    }
  }, [showRainRadar, activeRainFrame, mapInstance]);

  // Pan/zoom when mapViewTarget.seq updates
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (mapViewTarget.seq <= 1) return;
    map.flyTo([mapViewTarget.lat, mapViewTarget.lon], mapViewTarget.zoom, {
      duration: 0.7,
    });
  }, [mapViewTarget.seq]);

  // Draw Concentric Helideck Range Rings (5 NM, 10 NM, 25 NM) around activeFacility
  useEffect(() => {
    const group = ringsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (!showRangeRings || activeFacility.id === 'map-reference') return;

    const rings = [
      { nm: 5, color: '#10b981', dash: '4 4', label: '5 NM' },
      { nm: 10, color: '#06b6d4', dash: '6 4', label: '10 NM' },
      { nm: 25, color: '#38bdf8', dash: '8 6', label: '25 NM' },
    ];

    rings.forEach((ring) => {
      L.circle([activeFacility.lat, activeFacility.lon], {
        radius: ring.nm * NM_TO_METERS,
        color: ring.color,
        weight: 1.4,
        opacity: 0.75,
        fillOpacity: ring.nm === 5 ? 0.06 : 0.01,
        dashArray: ring.dash,
        interactive: false,
      }).addTo(group);

      const labelLat = activeFacility.lat + (ring.nm * 1.852) / 111.32;
      L.marker([labelLat, activeFacility.lon], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          html: `<div style="transform:translate(-50%,-50%);padding:1px 5px;background:rgba(7,9,14,0.88);border:1px solid ${ring.color};border-radius:2px;font-family:'JetBrains Mono',monospace;font-size:9px;color:${ring.color};white-space:nowrap;">${ring.label}</div>`,
        }),
      }).addTo(group);
    });
  }, [activeFacility, showRangeRings]);

  // Render Platforms, FPSOs, SAR Bases & UK Airports
  useEffect(() => {
    const group = facilityLayerRef.current;
    if (!group) return;
    group.clearLayers();

    installations.forEach((fac) => {
      const isActive = fac.id === activeFacility.id;
      const marker = L.marker([fac.lat, fac.lon], {
        title: fac.shortName + ' · ' + fac.assetType,
        icon: L.divIcon({
          className: '',
          html: createFacilityIconHtml(fac, isActive, showFacilityLabels, currentZoom),
          iconSize: [0, 0],
        }),
        zIndexOffset: isActive ? 600 : 100,
      });

      marker.bindTooltip(
        escapeHtml(
          fac.shortName + ' (' + fac.code + ') · ' + fac.fieldOperator + ' · ' + fac.assetType
        ),
        {
          direction: 'top',
          offset: [0, -8],
          className: 'radar-hover-tooltip',
        }
      );

      marker.on('click', () => {
        onSelectFacility(fac);
      });

      marker.addTo(group);
    });
  }, [installations, activeFacility, showFacilityLabels, currentZoom, onSelectFacility]);

  // Render Selected Flight Trail
  useEffect(() => {
    const group = trailLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (!selectedFlight) return;

    if (selectedFlight.trail && selectedFlight.trail.length > 1) {
      const coords = selectedFlight.trail.map((p) => [p.lat, p.lon] as [number, number]);
      L.polyline(coords, {
        color: '#06b6d4',
        weight: 3,
        opacity: 0.95,
      }).addTo(group);
    }
  }, [selectedFlight]);

  // Render Live Helicopters and Aircraft
  useEffect(() => {
    const group = aircraftLayerRef.current;
    if (!group) return;
    group.clearLayers();

    flights.forEach((flight) => {
      const isSelected = selectedFlight?.hex === flight.hex;
      const isPinned = pinnedFlightHex === flight.hex;

      const marker = L.marker([flight.lat, flight.lon], {
        title: flight.callsign + ' · ' + flight.typeFullName,
        icon: L.divIcon({
          className: '',
          html: createAircraftIconHtml(
            flight,
            isSelected,
            isPinned,
            currentZoom,
            showFacilityLabels
          ),
          iconSize: [0, 0],
        }),
        zIndexOffset: isSelected ? 1000 : isPinned ? 900 : 400,
      });

      marker.bindTooltip(
        escapeHtml(
          flight.callsign +
            ' · ' +
            flight.typeFullName +
            ' · ' +
            reported(flight.altitudeReported, flight.altitudeFt, ' ft') +
            ' · ' +
            positionLabel(flight)
        ),
        {
          direction: 'top',
          offset: [0, -10],
          className: 'radar-hover-tooltip',
        }
      );

      marker.on('click', () => {
        onSelectFlight(flight);
      });

      marker.addTo(group);
    });
  }, [flights, selectedFlight, pinnedFlightHex, currentZoom, showFacilityLabels, onSelectFlight]);

  const cycleMapStyle = () => {
    const order: MapStyleMode[] = ['dark_radar', 'nautical_ocean', 'satellite', 'daylight_osm'];
    const nextIdx = (order.indexOf(mapStyle) + 1) % order.length;
    setMapStyle(order[nextIdx]);
  };

  const mapStyleLabel =
    mapStyle === 'dark_radar'
      ? 'Dark Radar'
      : mapStyle === 'nautical_ocean'
      ? 'Ocean Map'
      : mapStyle === 'satellite'
      ? 'Satellite'
      : 'Daylight Map';

  const hudStatus =
    activeHourEval?.status ||
    activeHourSnap?.status ||
    (weather?.cap437Status && weather.cap437Status !== 'UNAVAILABLE'
      ? weather.cap437Status
      : 'GO');
  const hudWindSpd =
    activeHourSnap?.deckWindSpeedKts ??
    activeHourSnap?.windSpeed10mKts ??
    weather?.windSpeedKts ??
    20;
  const hudWindGust =
    activeHourSnap?.deckWindGustKts ??
    activeHourSnap?.windGust10mKts ??
    weather?.windGustKts ??
    26;
  const hudWave = activeHour?.waveHeightM ?? weather?.significantWaveHeightM ?? 2.1;

  return (
    <div
      className="radar-map-root relative w-full h-full bg-[#07090e] overflow-hidden select-none"
      data-clean-map={boxesHidden ? 'true' : undefined}
    >
      {/* Main Leaflet Canvas */}
      <div ref={containerRef} className="w-full h-full z-0" />

      {/* Custom HTML5 Canvas Vector-Field Streamlines & Go/No-Go Threshold Heatmap */}
      <WeatherStreamlineCanvas
        map={mapInstance}
        gridPoints={spatialGrid}
        overlayMode={weatherOverlayMode}
        preset={activePreset}
        activeFacility={activeFacility}
        shoreBaseFacility={shoreBaseFacility}
      />

      {/* Top-left stack: rig card + overlay key flow in one column so they can never overlap.
          Each card folds down to a tappable chip to keep the map clear on phones. */}
      <div className="map-top-left-stack map-floating absolute top-2.5 left-2.5 right-[68px] lg:right-auto z-[400] flex flex-col items-start gap-1.5 pointer-events-none max-h-[calc(100%-7rem)] overflow-y-auto no-scrollbar">
        {rigCardCollapsed ? (
          <button
            onClick={() => setRigCardCollapsed(false)}
            aria-expanded={false}
            title="Show rig card"
            className="pointer-events-auto min-h-[36px] max-w-full px-2.5 py-1.5 rounded-full bg-slate-950/92 backdrop-blur-md border border-slate-700 shadow-xl flex items-center gap-1.5 text-[11px] font-mono text-slate-200 cursor-pointer hover:border-cyan-500/60"
          >
            <MapPin className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="font-semibold text-white truncate">{activeFacility.code}</span>
            <span
              className={`font-bold whitespace-nowrap ${
                hudStatus === 'GO'
                    ? 'text-emerald-400'
                    : hudStatus === 'CAUTION'
                    ? 'text-amber-400'
                    : 'text-rose-400'
              }`}
            >
              ● {viewMode === 'simple'
                ? hudStatus === 'GO'
                  ? 'GOOD'
                  : hudStatus === 'CAUTION'
                  ? 'DELAY?'
                  : 'HOLD'
                : `${activePreset.id} ${hudStatus}`}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          </button>
        ) : (
          <div className="map-reference-card pointer-events-auto w-full sm:w-80 max-w-full bg-slate-950/92 backdrop-blur-md border border-slate-800 rounded-xl p-2 sm:p-2.5 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] font-mono text-cyan-400 tracking-tight truncate font-semibold">
                {isFavoriteFacility ? '★ MY FAVOURITE RIG' : 'LOCKED RIG / BASE'} · {activeFacility.code}
              </span>
              <span className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono tabular-nums text-slate-400">
                  {activeFacility.elevationFt} FT
                </span>
                <button
                  onClick={() => setRigCardCollapsed(true)}
                  aria-label="Minimise rig card"
                  title="Minimise"
                  className="w-7 h-7 -my-1 -mr-1 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 mt-0.5">
              <div className="text-sm font-bold text-white truncate">
                {activeFacility.shortName}
              </div>
              <button
                onClick={() => onToggleFavoriteFacility(activeFacility.id)}
                title={
                  isFavoriteFacility
                    ? 'Saved as Favourite Rig (Tap to remove)'
                    : 'Save as My Favourite Rig on this phone'
                }
                className={`min-h-[34px] px-2.5 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 border shrink-0 transition-colors cursor-pointer ${
                  isFavoriteFacility
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                <Star
                  className={`w-3.5 h-3.5 ${
                    isFavoriteFacility ? 'fill-amber-400 text-amber-400' : 'text-slate-400'
                  }`}
                />
                {isFavoriteFacility ? 'Saved' : 'Save Rig'}
              </button>
            </div>

            <div className="text-[11px] text-slate-400 truncate mt-0.5">
              {activeFacility.fieldOperator} · {activeFacility.assetType} · Base {activeFacility.primaryShoreBase}
            </div>

            {/* Live / Selected Day Weather & Limits Mini-Bar (tappable to open 7-Day Planner) */}
            <button
              onClick={onOpenWeather}
              className="mt-1.5 sm:mt-2 w-full min-h-[38px] px-2.5 py-1.5 rounded-md bg-slate-900/95 hover:bg-slate-900 border border-cyan-500/35 flex flex-col gap-0.5 text-left cursor-pointer transition-colors"
            >
              <div className="w-full flex items-center justify-between gap-1.5 text-[11px] font-mono">
                <span
                  className={`font-bold ${
                    hudStatus === 'GO'
                      ? 'text-emerald-400'
                      : hudStatus === 'CAUTION'
                      ? 'text-amber-400'
                      : 'text-rose-400'
                  }`}
                >
                  ●{' '}
                  {viewMode === 'simple'
                    ? hudStatus === 'GO'
                      ? 'GOOD TO FLY'
                      : hudStatus === 'CAUTION'
                      ? 'POSSIBLE DELAY'
                      : 'WEATHER HOLD'
                    : `${activePreset.id} ${hudStatus}`}
                </span>
                <span className="text-cyan-400 font-sans font-semibold text-[10px]">
                  Open 7-Day Weather →
                </span>
              </div>
              <div className="w-full flex items-center justify-between text-[10px] font-mono text-slate-300 tabular-nums">
                <span>
                  Wind {hudWindGust}kt gusts · Waves {hudWave}m
                </span>
                <span className="text-slate-400">
                  {activeHour ? `${activeHour.dayNameShort} ${activeHour.hourLabel}Z` : 'Live'}
                </span>
              </div>
            </button>

            {/* Quick Mobile Action Row: Focus Only 1 Rig + Change Rig */}
            <div className="mt-1.5 sm:mt-2 grid grid-cols-2 gap-1.5">
              <button
                onClick={onToggleSingleRigFocus}
                className={`min-h-[36px] px-2 py-1.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1 border transition-colors cursor-pointer ${
                  singleRigFocus
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border-slate-800'
                }`}
              >
                <Eye className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">
                  {singleRigFocus ? `Only ${activeFacility.code} (ON)` : `Only ${activeFacility.code}`}
                </span>
              </button>

              <button
                onClick={onOpenDirectory}
                className="min-h-[36px] px-2 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <Building2 className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">Change Rig</span>
              </button>
            </div>
          </div>
        )}

        {/* Triggered-Lightning & Fly-Around Corridor key when ⚡ Lightning overlay is active */}
        {weatherOverlayMode === 'triggered_lightning' &&
          (lightningKeyCollapsed ? (
            <button
              onClick={() => setLightningKeyCollapsed(false)}
              aria-expanded={false}
              title="Show lightning map key"
              className="pointer-events-auto min-h-[36px] max-w-full px-2.5 py-1.5 rounded-full bg-slate-950/92 backdrop-blur-md border border-amber-500/50 shadow-xl flex items-center gap-1.5 text-[11px] font-mono cursor-pointer hover:border-amber-400"
            >
              <Zap className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              <span className="font-semibold text-amber-300 whitespace-nowrap">HTLI key</span>
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  corridorBypass.directRisk === 'LOW'
                    ? 'bg-emerald-400'
                    : corridorBypass.recommendedRoute === 'HOLD_WIDESPREAD'
                    ? 'bg-rose-500'
                    : 'bg-amber-400'
                }`}
              />
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ) : (
            <div className="pointer-events-auto w-full sm:w-80 max-w-full bg-slate-950/94 backdrop-blur-md border border-amber-500/50 rounded-xl px-2.5 py-2 shadow-xl text-[10px] font-mono space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-amber-300 flex items-center gap-1">
                  <Zap className="w-3.5 h-3.5" /> TRIGGERED LIGHTNING (HTLI)
                </span>
                <button
                  onClick={() => setLightningKeyCollapsed(true)}
                  aria-label="Minimise lightning map key"
                  title="Minimise"
                  className="w-7 h-7 -my-1 -mr-1 rounded-md flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block shrink-0" />
                <span className="text-emerald-300">Clear fly-around air</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block shrink-0" />
                <span className="text-amber-300">Mod band (0°C ≤ 3,500ft + showers)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block shrink-0" />
                <span className="text-rose-300">High cell (avoid / dog-leg)</span>
              </div>
              <div
                className={`pt-1 border-t border-slate-800 font-semibold ${
                  corridorBypass.directRisk === 'LOW'
                    ? 'text-emerald-300'
                    : corridorBypass.recommendedRoute === 'HOLD_WIDESPREAD'
                    ? 'text-rose-300'
                    : 'text-amber-300'
                }`}
              >
                {corridorBypass.summaryText}
              </div>
            </div>
          ))}
      </div>

      {/* Right Map Floating Tactical Controls */}
      <div className="map-controls absolute top-3 right-3 z-[400] flex flex-col gap-1.5 pointer-events-auto">
        <button
          data-clean-map-toggle="true"
          onClick={() => setBoxesHidden((prev) => !prev)}
          aria-pressed={boxesHidden}
          title={boxesHidden ? 'Show map boxes again' : 'Hide all boxes for a clean map'}
          aria-label={boxesHidden ? 'Show map boxes again' : 'Hide all boxes for a clean map'}
          className={`min-w-[44px] min-h-[44px] rounded-lg flex flex-col items-center justify-center gap-0.5 border text-[9px] font-mono font-semibold transition-colors cursor-pointer ${
            boxesHidden
              ? 'bg-cyan-500 text-slate-950 border-cyan-300'
              : 'bg-slate-950/90 hover:bg-slate-900 text-slate-200 border-slate-800'
          }`}
        >
          {boxesHidden ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          <span>{boxesHidden ? 'SHOW' : 'HIDE'}</span>
        </button>
        <button
          data-secondary-control="true"
          onClick={() =>
            mapRef.current?.fitBounds(
              [
                [49.6, -11],
                [61.2, 2],
              ],
              { padding: [20, 20], animate: true }
            )
          }
          title="Show UK, Ireland and North Sea tracking area"
          aria-label="Show UK, Ireland and North Sea tracking area"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-cyan-300 border border-slate-800 rounded-lg flex items-center justify-center text-[10px] font-semibold cursor-pointer"
        >
          UK/IRE
        </button>
        <button
          onClick={() => mapRef.current?.zoomIn()}
          title="Zoom In"
          aria-label="Zoom In"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-slate-200 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          title="Zoom Out"
          aria-label="Zoom Out"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-slate-200 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() =>
            mapRef.current?.flyTo([activeFacility.lat, activeFacility.lon], 8, { duration: 0.7 })
          }
          title="Center on Active Rig / Airport"
          aria-label="Center on Active Rig or Airport"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-cyan-400 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Crosshair className="w-4 h-4" />
        </button>
        <button
          onClick={onUseMyGps}
          title="Centre map on my GPS"
          aria-label="Centre map on my GPS"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-amber-400 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <LocateFixed className="w-4 h-4" />
        </button>
        <button
          data-secondary-control="true"
          onClick={() =>
            onChangeWeatherOverlayMode(
              weatherOverlayMode === 'off' ? 'go_nogo_matrix' : 'off'
            )
          }
          title="Toggle Animated Wind Streamlines & Go/No-Go Weather Heatmap"
          className={`min-w-[44px] min-h-[44px] border rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer px-1 ${
            weatherOverlayMode !== 'off'
              ? 'bg-cyan-500 text-slate-950 border-cyan-300 font-bold'
              : 'bg-slate-950/90 hover:bg-slate-900 text-cyan-400 border-slate-800'
          }`}
        >
          <CloudRainWind className="w-4 h-4" />
          <span className="text-[8px] font-mono mt-0.5 leading-none">WX MAP</span>
        </button>
        <button
          onClick={cycleMapStyle}
          title={`Switch Map Layer (Current: ${mapStyleLabel})`}
          aria-label={`Switch Map Layer (Current: ${mapStyleLabel})`}
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer px-1"
        >
          <Globe className="w-4 h-4" />
          <span className="text-[8px] font-mono mt-0.5 leading-none">MAP</span>
        </button>
        <button
          data-secondary-control="true"
          onClick={onToggleRangeRings}
          title="Toggle distance rings"
          className={`min-w-[44px] min-h-[44px] border rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            showRangeRings
              ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
              : 'bg-slate-950/90 text-slate-400 border-slate-800 hover:bg-slate-900'
          }`}
        >
          <Compass className="w-4 h-4" />
        </button>
        <button
          data-secondary-control="true"
          onClick={onToggleFacilityLabels}
          title="Toggle Rig & Aircraft Labels"
          className={`min-w-[44px] min-h-[44px] border rounded-lg flex items-center justify-center transition-colors cursor-pointer ${
            showFacilityLabels
              ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
              : 'bg-slate-950/90 text-slate-400 border-slate-800 hover:bg-slate-900'
          }`}
        >
          <Layers className="w-4 h-4" />
        </button>
      </div>

      {/* Floating Multi-Model Offshore Weather, 7-Day Time Machine & Go/No-Go Control Dock */}
      <div className="map-floating absolute bottom-2 right-2 left-2 sm:bottom-2.5 sm:right-2.5 sm:left-auto z-[400] bg-slate-950/94 backdrop-blur-md border border-slate-800 rounded-xl p-2 sm:p-2.5 pointer-events-auto shadow-2xl max-w-full sm:max-w-[580px] space-y-1.5">
        {/* Compact Single-Row Summary Bar when collapsed (phones & tablets, < lg) */}
        <div className="flex lg:hidden items-center justify-between gap-1.5">
          <button
            onClick={() => setMobileDockOpen((prev) => !prev)}
            className="min-h-[38px] px-2 py-1 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-1.5 text-[11px] font-mono text-slate-200 min-w-0 flex-1 cursor-pointer"
          >
            <CloudRainWind className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
            <span className="truncate">
              {activeHour ? `${activeHour.dayNameShort} ${activeHour.hourLabel}Z` : 'NOW'} ·{' '}
              {WEATHER_MODELS_META.find((m) => m.id === weatherModelId)?.shortName || weatherModelId} ·{' '}
              {activePreset.id}
            </span>
          </button>

          <button
            onClick={() =>
              onChangeWeatherOverlayMode(
                weatherOverlayMode === 'triggered_lightning' ? 'go_nogo_matrix' : 'triggered_lightning'
              )
            }
            className={`min-h-[38px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border whitespace-nowrap shrink-0 cursor-pointer ${
              weatherOverlayMode === 'triggered_lightning'
                ? 'bg-amber-400 text-slate-950 border-amber-300 font-bold'
                : 'bg-slate-900 text-amber-300 border-amber-500/40'
            }`}
          >
            {weatherOverlayMode === 'triggered_lightning' ? '⚡ LTNG ON' : '⚡ Ltng'}
          </button>

          <button
            onClick={() => setShowRainRadar((prev) => !prev)}
            className={`min-h-[38px] px-2.5 py-1 rounded-lg text-[11px] font-mono font-semibold border whitespace-nowrap shrink-0 cursor-pointer ${
              showRainRadar
                ? 'bg-sky-400 text-slate-950 border-sky-300'
                : 'bg-slate-900 text-sky-300 border-sky-500/40'
            }`}
          >
            {showRainRadar ? 'Rain ON' : 'Rain'}
          </button>

          <button
            onClick={() => setMobileDockOpen((prev) => !prev)}
            aria-expanded={mobileDockOpen}
            className="min-h-[38px] px-2.5 py-1 rounded-lg bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-semibold flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            {mobileDockOpen ? (
              <>
                <span>Done</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>Layers</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>

        {/* Full 3-Row Controls: Always visible on >= lg, expandable on phones & tablets */}
        <div className={`${mobileDockOpen ? 'block' : 'hidden'} lg:block space-y-1.5`}>
          {/* Row 1: 7-Day Forecast Day Picker (Tap Mon, Tue, etc. to preview future flight limits on map) */}
          {daySummaries.length > 0 && (
            <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-slate-800/80 overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-1 shrink-0">
                <Calendar className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] font-mono text-cyan-400 font-semibold uppercase">
                  DAY:
                </span>
                {daySummaries.slice(0, 7).map((d) => {
                  const isDayActive = activeHour?.dayKey === d.dayKey;
                  const dotColor =
                    d.overallStatus === 'HOLD'
                      ? 'text-rose-400'
                      : d.overallStatus === 'CAUTION'
                      ? 'text-amber-400'
                      : 'text-emerald-400';
                  return (
                    <button
                      key={d.dayKey}
                      onClick={() => onChangeSelectedHourIdx(d.representativeHourIndex)}
                      className={`px-2 py-1.5 sm:py-0.5 rounded text-[10px] font-mono whitespace-nowrap flex items-center gap-1 transition-colors cursor-pointer ${
                        isDayActive
                          ? 'bg-cyan-500 text-slate-950 font-bold'
                          : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800'
                      }`}
                    >
                      <span className={isDayActive ? 'text-slate-950' : dotColor}>●</span>
                      <span>{d.dayNameShort}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={onOpenWeather}
                  className="px-2 py-1.5 sm:py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-mono whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {activeHour
                    ? `${activeHour.dayNameShort} ${activeHour.hourLabel} UTC`
                    : '7-Day Details'}
                </button>
                {onChangeViewMode && (
                  <button
                    onClick={() => onChangeViewMode(viewMode === 'simple' ? 'detailed' : 'simple')}
                    className={`px-2 py-1.5 sm:py-0.5 rounded text-[10px] font-mono font-bold whitespace-nowrap shrink-0 border cursor-pointer ${
                      viewMode === 'simple'
                        ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                        : 'bg-amber-400 text-slate-950 border-amber-300'
                    }`}
                  >
                    {viewMode === 'simple' ? '⚙️ Pro Mode' : '✓ Pro Mode ON'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Row 2: Weather Overlay Streamline Mode Selector */}
          <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/80 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-[10px] font-mono text-cyan-400 font-semibold uppercase">
                MAP WEATHER:
              </span>
              {(viewMode === 'simple'
                ? ([
                    { id: 'off', label: 'Off' },
                    { id: 'go_nogo_matrix', label: 'Flight Status Map' },
                    { id: 'triggered_lightning', label: '⚡ Lightning' },
                    { id: 'wind_surface', label: 'Wind' },
                    { id: 'wave_swell', label: 'Waves' },
                  ] as Array<{ id: WeatherOverlayMode; label: string }>)
                : ([
                    { id: 'off', label: 'Off' },
                    { id: 'go_nogo_matrix', label: 'Go/No-Go Matrix' },
                    { id: 'triggered_lightning', label: '⚡ Triggered Lightning' },
                    { id: 'wind_surface', label: '10m Wind' },
                    { id: 'wind_950hpa', label: '950hPa (1,800ft)' },
                    { id: 'wind_850hpa', label: '850hPa (5,000ft)' },
                    { id: 'wave_swell', label: 'Waves (Hs)' },
                    { id: 'freezing_icing', label: '0°C Icing' },
                  ] as Array<{ id: WeatherOverlayMode; label: string }>)
              ).map((m) => (
                <button
                  key={m.id}
                  onClick={() => onChangeWeatherOverlayMode(m.id)}
                  className={`px-2 py-1.5 sm:py-0.5 rounded text-[10px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                    weatherOverlayMode === m.id
                      ? m.id === 'triggered_lightning'
                        ? 'bg-amber-400 text-slate-950 font-bold border border-amber-300'
                        : 'bg-cyan-500 text-slate-950 font-bold'
                      : m.id === 'triggered_lightning'
                      ? 'bg-amber-950/60 hover:bg-amber-900/60 text-amber-300 border border-amber-500/50'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
                  }`}
                >
                  {m.label}
                </button>
              ))}
              <button
                onClick={() => setShowRainRadar((prev) => !prev)}
                title="Toggle animated RainViewer precipitation & squall radar"
                className={`px-2 py-1.5 sm:py-0.5 rounded text-[10px] font-mono whitespace-nowrap transition-colors cursor-pointer ${
                  showRainRadar
                    ? 'bg-sky-400 text-slate-950 font-bold'
                    : 'bg-slate-900 hover:bg-slate-800 text-sky-300 border border-sky-500/40'
                }`}
              >
                {showRainRadar && activeRainFrame
                  ? `Rain (${activeRainFrame.frameTimeIso}Z)`
                  : 'Rain Radar'}
              </button>
              {showRainRadar && rainFrames.length > 1 && (
                <button
                  onClick={() => {
                    setRainLoopPlaying((p) => {
                      const next = !p;
                      if (!next) setRainFrameIdx(rainFrames.length - 1);
                      return next;
                    });
                  }}
                  title={rainLoopPlaying ? 'Pause radar loop' : 'Play 60-min radar loop'}
                  className="px-2 py-1.5 sm:py-0.5 rounded text-[10px] font-mono bg-slate-900 hover:bg-slate-800 text-sky-300 border border-sky-500/40 cursor-pointer"
                >
                  {rainLoopPlaying ? '⏸' : '▶'}
                </button>
              )}
            </div>
          </div>

          {/* Row 3: Model Source & Airframe Limit Preset Row (Shown in Pro View) */}
          {viewMode === 'detailed' && (
          <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar text-[10px] font-mono">
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-400">MODEL:</span>
              {WEATHER_MODELS_META.map((mod) => (
                <button
                  key={mod.id}
                  onClick={() => onChangeWeatherModelId(mod.id)}
                  title={`${mod.shortName} (${mod.agency} · ${mod.resolution})`}
                  className={`px-2 py-1.5 sm:py-0.5 rounded whitespace-nowrap cursor-pointer ${
                    weatherModelId === mod.id
                      ? 'bg-amber-400 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {mod.shortName}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <span className="text-slate-400">LIMITS:</span>
              {(['S92', 'AW189', 'H175', 'AW139', 'H160'] as AirframePresetId[]).map((presetId) => (
                <button
                  key={presetId}
                  onClick={() => onChangeAirframePresetId(presetId)}
                  className={`px-2 py-1.5 sm:py-0.5 rounded whitespace-nowrap cursor-pointer ${
                    airframePresetId === presetId
                      ? 'bg-emerald-400 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                  }`}
                >
                  {AIRFRAME_PRESETS[presetId].id}
                </button>
              ))}
            </div>
          </div>
          )}

          {/* Mobile-only Quick Map Rings & Labels toggles inside expanded Layers drawer */}
          <div className="flex sm:hidden items-center gap-1.5 pt-1 border-t border-slate-800/80 text-[10px] font-mono">
            <button
              onClick={onToggleRangeRings}
              className={`flex-1 py-1.5 px-2 rounded border text-center cursor-pointer ${
                showRangeRings
                  ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {showRangeRings ? 'Range Rings: ON' : 'Range Rings: OFF'}
            </button>
            <button
              onClick={onToggleFacilityLabels}
              className={`flex-1 py-1.5 px-2 rounded border text-center cursor-pointer ${
                showFacilityLabels
                  ? 'bg-cyan-950/90 text-cyan-300 border-cyan-500/60'
                  : 'bg-slate-900 text-slate-400 border-slate-800'
              }`}
            >
              {showFacilityLabels ? 'Labels: ON' : 'Labels: OFF'}
            </button>
          </div>
        </div>
      </div>

      {/* Bottom-Left Live Ventusky-Style Spot-Check Cursor / Tap Weather Readout */}
      <div className="map-floating hidden xl:flex absolute bottom-3 left-3 z-[400] items-center gap-2.5 bg-slate-950/92 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] font-mono text-slate-300 pointer-events-auto">
        <span className="text-slate-400 tabular-nums">
          SPOT ({cursorCoords.lat.toFixed(2)}°N, {cursorCoords.lon.toFixed(2)}°E):
        </span>
        {spotWeather ? (
          <>
            <span
              className={`font-bold ${
                spotWeather.status === 'GO'
                  ? 'text-emerald-400'
                  : spotWeather.status === 'CAUTION'
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              ● {spotWeather.status}
            </span>
            <span className="text-white tabular-nums">
              10m {spotWeather.windSpeed10mKts}G{spotWeather.windGust10mKts}kt
            </span>
            <span className="text-cyan-300 tabular-nums">
              950hPa {spotWeather.windSpeed950hPaKts}kt
            </span>
            <span className="text-sky-300 tabular-nums">
              Wave {spotWeather.waveHeightM}m
            </span>
            <span className="text-purple-300 tabular-nums">
              0°C {spotWeather.freezingLevelFt.toLocaleString()}ft
            </span>
            <span
              className={`tabular-nums font-semibold ${
                spotWeather.lightningRisk === 'HIGH'
                  ? 'text-rose-400'
                  : spotWeather.lightningRisk === 'MODERATE'
                  ? 'text-amber-300'
                  : 'text-emerald-400'
              }`}
            >
              ⚡ {spotWeather.lightningRisk}
            </span>
          </>
        ) : (
          <span className="text-slate-400">Move cursor over North Sea</span>
        )}
      </div>
    </div>
  );
};
