import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { coordinate, reported, positionLabel } from '../utils/dataQuality';
const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
import {
  AircraftTarget,
  FieldOperator,
  HelideckWeatherState,
  InstallationOrAirport,
} from '../types/radar';
import {
  FIELD_OPERATOR_COLORS,
} from '../data/installationsAndAirports';
import {
  Building2,
  Compass,
  Crosshair,
  Eye,
  Globe,
  Layers,
  LocateFixed,
  Minus,
  Plus,
  Star,
} from 'lucide-react';

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
  onMapCenterChanged: (lat: number, lon: number) => void;
  isFavoriteFacility: boolean;
  onToggleFavoriteFacility: (id: string) => void;
  singleRigFocus: boolean;
  onToggleSingleRigFocus: () => void;
  weather: HelideckWeatherState | null;
  onOpenDirectory: () => void;
  onOpenWeather: () => void;
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
  const isHeli = flight.category === 'offshore_heli' || isSar;

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

  // Show permanent badge on Selected, Pinned, SAR, Offshore Helis when zoom >= 7, or when zoomed in >= 9
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

  const shapeHtml = fac.assetType === 'GPS location' || fac.assetType === 'Custom location'
    ? `<div style="width:14px;height:14px;border-radius:50%;background:#38bdf8;border:3px solid white;box-shadow:0 0 0 6px rgba(56,189,248,0.2);"></div>`
    : isFpso
    ? `<div style="width:${size + 6}px;height:${size - 2}px;background:${color};border:${ringBorder};border-radius:6px;box-shadow:0 0 8px rgba(0,0,0,0.9);"></div>`
    : isAirport
    ? `<div style="width:${size + 3}px;height:${size + 3}px;background:#0f172a;border:2px solid ${color};border-radius:3px;display:flex;align-items:center;justify-content:center;font-family:'JetBrains Mono',monospace;font-size:8px;font-weight:700;color:${color};">H</div>`
    : `<div style="width:${size}px;height:${size}px;background:${color};border:${ringBorder};transform:rotate(45deg);box-shadow:0 0 8px rgba(0,0,0,0.9);"></div>`;

  // Avoid label clutter at very wide zoom unless active or user toggled labels at zoom >= 7
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
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseTileLayerRef = useRef<L.TileLayer | null>(null);
  const aircraftLayerRef = useRef<L.LayerGroup | null>(null);
  const facilityLayerRef = useRef<L.LayerGroup | null>(null);
  const ringsLayerRef = useRef<L.LayerGroup | null>(null);
  const trailLayerRef = useRef<L.LayerGroup | null>(null);

  const [mapStyle, setMapStyle] = useState<MapStyleMode>('dark_radar');
  const [referenceCardExpanded, setReferenceCardExpanded] = useState(false);
  useEffect(() => setReferenceCardExpanded(false), [activeFacility.id]);
  const [currentZoom, setCurrentZoom] = useState<number>(mapViewTarget.zoom);
  const [cursorCoords, setCursorCoords] = useState<{ lat: number; lon: number }>({
    lat: activeFacility.lat,
    lon: activeFacility.lon,
  });

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

    map.on('zoomend', () => {
      setCurrentZoom(map.getZoom());
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      setCurrentZoom(map.getZoom());
      onMapCenterChanged(c.lat, c.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch Map Tile Layer (All 4 options are 100% free & require NO API Key)
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

  // Pan/zoom when mapViewTarget.seq updates
  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.flyTo([mapViewTarget.lat, mapViewTarget.lon], mapViewTarget.zoom, {
      duration: 0.85,
    });
  }, [mapViewTarget.seq]);

  // Draw Concentric Helideck Range Rings (5 NM, 10 NM, 25 NM) around activeFacility
  useEffect(() => {
    const group = ringsLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (activeFacility.id === 'map-reference') return;
    if (!showRangeRings) return;

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

    installations.filter(fac => currentZoom >= 7 || fac.id === activeFacility.id || !['UK Airport', 'Shore Heliport', 'Hospital Helipad', 'SAR Base'].includes(fac.assetType) || ['EGPD','EGPB','EGSH','EGNJ'].includes(fac.code)).forEach((fac) => {
      const isActive = fac.id === activeFacility.id;
      const marker = L.marker([fac.lat, fac.lon], {
        title: fac.shortName,
        icon: L.divIcon({
          className: '',
          html: createFacilityIconHtml(fac, isActive, showFacilityLabels, currentZoom),
          iconSize: [0, 0],
        }),
        zIndexOffset: isActive ? 600 : 100,
      });

      marker.bindTooltip(
        `${escapeHtml(fac.shortName)} (${fac.code}) · ${fac.fieldOperator} · ${fac.assetType}`,
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

  // Render Selected Flight Trail & Multi-Stop Heli-Admin Planned Route Loop
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

    const destFac = installations.find(
      (i) => i.code === selectedFlight.destinationCode || i.id === selectedFlight.destinationRigId
    );
    if (destFac) {
      L.polyline(
        [
          [selectedFlight.lat, selectedFlight.lon],
          [destFac.lat, destFac.lon],
        ],
        {
          color: '#f59e0b',
          weight: 2,
          dashArray: '6 6',
          opacity: 0.9,
        }
      ).addTo(group);
    }
  }, [selectedFlight, installations]);

  // Render Live & Scheduled Helicopters and Aircraft
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
        escapeHtml(flight.callsign + ' · ' + flight.typeFullName + ' · ' + reported(flight.altitudeReported, flight.altitudeFt, ' ft') + ' · ' + positionLabel(flight)),
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

  return (
    <div className="relative w-full h-full bg-[#07090e] overflow-hidden select-none">
      {/* Main Leaflet Canvas */}
      <div ref={containerRef} className="w-full h-full z-0" />

      <div className="map-reference-card absolute top-2.5 left-2.5 z-[400] bg-slate-950/95 border border-slate-700 rounded-xl w-[240px] max-w-[calc(100%-76px)] shadow-lg">
        {activeFacility.id === 'map-reference' ? <button onClick={onOpenDirectory} className="w-full p-3 text-left text-sm text-cyan-300">Choose your rig or base</button> : <>
          <button onClick={() => setReferenceCardExpanded(prev => !prev)} aria-expanded={referenceCardExpanded} aria-label="Toggle selected rig details" className="flex items-center justify-between gap-2 w-full p-3 text-left"><span className="font-semibold text-sm text-white truncate">{activeFacility.shortName}</span><span className="text-slate-400 text-xs">{referenceCardExpanded ? '▴' : '▾'}</span></button>
          {referenceCardExpanded && <div className="px-3 pb-3 space-y-2 text-xs border-t border-slate-800 pt-2"><p className="text-slate-400">{activeFacility.assetType} · Reference location</p><div className="grid grid-cols-2 gap-2"><button onClick={() => onToggleFavoriteFacility(activeFacility.id)} className="p-2 rounded bg-slate-800 text-amber-300">{isFavoriteFacility ? '★ Saved' : '☆ Save rig'}</button><button onClick={onOpenDirectory} className="p-2 rounded bg-slate-800 text-cyan-300">Change rig</button><button onClick={onOpenWeather} className="p-2 rounded bg-slate-800 text-cyan-300">Weather</button><button onClick={onToggleSingleRigFocus} className="p-2 rounded bg-slate-800">{singleRigFocus ? 'Show all rigs' : 'Only this rig'}</button></div></div>}
        </>}
      </div>

      {/* Right Map Floating Tactical Controls */}
      <div className="map-controls absolute top-3 right-3 z-[400] flex flex-col gap-1.5 pointer-events-auto">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          title="Zoom In"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-slate-200 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          title="Zoom Out"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-slate-200 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button
          onClick={() =>
            mapRef.current?.flyTo([activeFacility.lat, activeFacility.lon], 8, { duration: 0.7 })
          }
          title="Center on Active Rig / Airport"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-cyan-400 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <Crosshair className="w-4 h-4" />
        </button>
        <button
          onClick={onUseMyGps}
          title="Centre map on my GPS"
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-amber-400 border border-slate-800 rounded-lg flex items-center justify-center transition-colors cursor-pointer"
        >
          <LocateFixed className="w-4 h-4" />
        </button>
        <button
          onClick={cycleMapStyle}
          title={`Switch Map Layer (Current: ${mapStyleLabel})`}
          className="min-w-[44px] min-h-[44px] bg-slate-950/90 hover:bg-slate-900 text-emerald-400 border border-slate-800 rounded-lg flex flex-col items-center justify-center transition-colors cursor-pointer px-1"
        >
          <Globe className="w-4 h-4" />
          <span className="text-[8px] font-mono mt-0.5 leading-none">MAP</span>
        </button>
        <button
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

      {/* Bottom-Left Legend, Map Mode & Live Coordinate Readout */}
      <div className="hidden sm:flex absolute bottom-3 left-3 z-[400] items-center gap-3 bg-slate-950/90 backdrop-blur-md border border-slate-800 rounded-lg px-3 py-1.5 text-[11px] text-slate-300 pointer-events-auto">
        <button
          onClick={cycleMapStyle}
          className="font-mono text-emerald-400 hover:underline cursor-pointer"
        >
          LAYER: {mapStyleLabel.toUpperCase()}
        </button>
        <span aria-hidden="true">·</span>
        <span className="font-mono tabular-nums text-slate-400">
          {cursorCoords.lat.toFixed(3)}°N, {cursorCoords.lon.toFixed(3)}°E
        </span>
        <span aria-hidden="true">·</span>
        <span className="text-cyan-400 font-medium">Cyan: Offshore Heli</span>
        <span aria-hidden="true">·</span>
        <span className="text-orange-400 font-medium">Orange: HM Coastguard SAR</span>
        <span aria-hidden="true">·</span>
        <span className="text-amber-400 font-medium">Amber: Airline</span>
        <span aria-hidden="true">·</span>
        <span className="font-mono text-slate-300 font-semibold">Made by onemadpunk</span>
      </div>
    </div>
  );
};

