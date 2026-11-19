import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import {
  SpatialWeatherGridPoint,
  WeatherOverlayMode,
  AirframeLimitPreset,
  InstallationOrAirport,
} from '../types/radar';
import {
  evaluateCorridorLightningBypass,
  evaluateGridPointStatus,
} from '../services/multiModelWeatherService';

interface WeatherStreamlineCanvasProps {
  map: L.Map | null;
  gridPoints: SpatialWeatherGridPoint[];
  overlayMode: WeatherOverlayMode;
  preset: AirframeLimitPreset;
  activeFacility?: InstallationOrAirport;
  shoreBaseFacility?: InstallationOrAirport;
}

interface Particle {
  lat: number;
  lon: number;
  age: number;
  maxAge: number;
}

const PARTICLE_COUNT = 650;

/**
 * Inverse-distance weighted interpolation across the live UK/North Sea weather grid.
 */
function interpolateGrid(
  lat: number,
  lon: number,
  gridPoints: SpatialWeatherGridPoint[],
  overlayMode: WeatherOverlayMode,
  preset: AirframeLimitPreset
): {
  u: number;
  v: number;
  scalar: number;
  r: number;
  g: number;
  b: number;
  a: number;
} {
  if (gridPoints.length === 0) {
    return { u: 0, v: 0, scalar: 0, r: 0, g: 0, b: 0, a: 0 };
  }

  let weightSum = 0;
  let uSum = 0;
  let vSum = 0;
  let scalarSum = 0;
  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let aSum = 0;

  for (let i = 0; i < gridPoints.length; i++) {
    const pt = gridPoints[i];
    const dLat = lat - pt.lat;
    const dLon = (lon - pt.lon) * 0.56; // cos(57 deg) aspect correction
    const rawDistSq = dLat * dLat + dLon * dLon;
    const maxDistSq = overlayMode === 'triggered_lightning' ? 2.8 : 16;
    if (rawDistSq > maxDistSq) continue;
    const eps = overlayMode === 'triggered_lightning' ? 0.008 : 0.04;
    const distSq = rawDistSq + eps;
    const w =
      overlayMode === 'triggered_lightning'
        ? 1 / (distSq * distSq * distSq)
        : 1 / (distSq * distSq);

    // Determine U/V wind or wave vector for this grid node
    let windSpd = pt.windSpeed10mKts;
    let windDir = pt.windDir10mDeg;
    if (overlayMode === 'wind_950hpa' || overlayMode === 'triggered_lightning') {
      windSpd = pt.windSpeed950hPaKts;
      windDir = pt.windDir950hPaDeg;
    } else if (overlayMode === 'wind_850hpa') {
      windSpd = pt.windSpeed850hPaKts;
      windDir = pt.windDir850hPaDeg;
    } else if (overlayMode === 'wave_swell') {
      windSpd = Math.max(8, pt.waveHeightM * 7);
      windDir = pt.waveDirDeg;
    }

    // Meteorological wind direction is FROM (degrees clockwise from North).
    // Convert to flow vector direction (TO):
    const flowRad = ((windDir + 180) * Math.PI) / 180;
    const u = Math.sin(flowRad) * windSpd; // Eastward component
    const v = Math.cos(flowRad) * windSpd; // Northward component

    // Determine colour for this point based on active overlay mode
    let r = 16;
    let g = 185;
    let b = 129;
    let ptAlpha = 0.24;
    let scalar = windSpd;

    if (overlayMode === 'go_nogo_matrix') {
      const status = evaluateGridPointStatus(pt, preset);
      if (status === 'HOLD') {
        r = 239;
        g = 68;
        b = 68; // Crimson NO-GO
        scalar = 50;
      } else if (status === 'CAUTION') {
        r = 245;
        g = 158;
        b = 11; // Amber CAUTION
        scalar = 35;
      } else {
        r = 16;
        g = 185;
        b = 129; // Emerald GO
        scalar = 18;
      }
    } else if (overlayMode === 'triggered_lightning') {
      const ltRisk = pt.lightningRisk || 'LOW';
      if (ltRisk === 'HIGH') {
        r = 244;
        g = 63;
        b = 94; // High Triggered-Lightning / Squall Cell (Rose/Magenta)
        ptAlpha = 0.44;
        scalar = 52;
      } else if (ltRisk === 'MODERATE') {
        r = 245;
        g = 158;
        b = 11; // Moderate Triggered-Lightning Shower Band (Amber)
        ptAlpha = 0.34;
        scalar = 36;
      } else {
        r = 16;
        g = 185;
        b = 129; // Clear Fly-Around Air Corridor (Emerald)
        ptAlpha = 0.13;
        scalar = 16;
      }
    } else if (
      overlayMode === 'wind_surface' ||
      overlayMode === 'wind_950hpa' ||
      overlayMode === 'wind_850hpa'
    ) {
      scalar = windSpd;
      if (windSpd >= 48) {
        r = 239;
        g = 68;
        b = 68; // Gale/Storm Crimson
      } else if (windSpd >= 34) {
        r = 245;
        g = 158;
        b = 11; // Near-Gale Amber
      } else if (windSpd >= 20) {
        r = 56;
        g = 189;
        b = 248; // Moderate Sky Blue
      } else {
        r = 16;
        g = 185;
        b = 129; // Calm Emerald
      }
    } else if (overlayMode === 'wave_swell') {
      scalar = pt.waveHeightM;
      if (pt.waveHeightM >= 5.0) {
        r = 239;
        g = 68;
        b = 68;
      } else if (pt.waveHeightM >= 3.2) {
        r = 245;
        g = 158;
        b = 11;
      } else if (pt.waveHeightM >= 1.5) {
        r = 56;
        g = 189;
        b = 248;
      } else {
        r = 20;
        g = 184;
        b = 166;
      }
    } else if (overlayMode === 'freezing_icing') {
      scalar = pt.freezingLevelFt;
      if (pt.freezingLevelFt <= 2500) {
        r = 168;
        g = 85;
        b = 247; // Severe Rotor Icing Purple/Crimson
      } else if (pt.freezingLevelFt <= 4500) {
        r = 56;
        g = 189;
        b = 248; // Moderate Icing Cyan
      } else {
        r = 16;
        g = 185;
        b = 129; // Safe above transit altitude
      }
    }

    weightSum += w;
    uSum += u * w;
    vSum += v * w;
    scalarSum += scalar * w;
    rSum += r * w;
    gSum += g * w;
    bSum += b * w;
    aSum += ptAlpha * w;
  }

  if (weightSum === 0) {
    return { u: 0, v: 0, scalar: 0, r: 0, g: 0, b: 0, a: 0 };
  }

  return {
    u: uSum / weightSum,
    v: vSum / weightSum,
    scalar: scalarSum / weightSum,
    r: Math.round(rSum / weightSum),
    g: Math.round(gSum / weightSum),
    b: Math.round(bSum / weightSum),
    a: aSum / weightSum,
  };
}

function drawPillLabel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  borderColor: string,
  textColor: string
) {
  ctx.save();
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  const metrics = ctx.measureText(text);
  const padX = 7;
  const boxW = metrics.width + padX * 2;
  const boxH = 19;
  const left = x - boxW / 2;
  const top = y - boxH / 2;

  ctx.fillStyle = bgColor;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.roundRect(left, top, boxW, boxH, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.restore();
}

export const WeatherStreamlineCanvas: React.FC<WeatherStreamlineCanvasProps> = ({
  map,
  gridPoints,
  overlayMode,
  preset,
  activeFacility,
  shoreBaseFacility,
}) => {
  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!map || overlayMode === 'off' || gridPoints.length === 0) {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const heatCanvas = heatmapCanvasRef.current;
    const partCanvas = particleCanvasRef.current;
    if (!heatCanvas || !partCanvas) return;

    const heatCtx = heatCanvas.getContext('2d');
    const partCtx = partCanvas.getContext('2d');
    if (!heatCtx || !partCtx) return;

    const drawTriggeredLightningAnnotations = () => {
      if (overlayMode !== 'triggered_lightning') return;

      // 1. Draw Convective / Triggered-Lightning Cell Badges at active grid nodes
      for (const pt of gridPoints) {
        const risk = pt.lightningRisk || 'LOW';
        if (risk === 'LOW') continue;

        const screenPt = map.latLngToContainerPoint([pt.lat, pt.lon]);
        if (
          screenPt.x < -60 ||
          screenPt.x > heatCanvas.width + 60 ||
          screenPt.y < -60 ||
          screenPt.y > heatCanvas.height + 60
        ) {
          continue;
        }

        const isHigh = risk === 'HIGH';
        const radius = isHigh ? 34 : 26;

        heatCtx.save();
        heatCtx.beginPath();
        heatCtx.arc(screenPt.x, screenPt.y, radius, 0, Math.PI * 2);
        heatCtx.fillStyle = isHigh
          ? 'rgba(244, 63, 94, 0.24)'
          : 'rgba(245, 158, 11, 0.20)';
        heatCtx.fill();
        heatCtx.setLineDash([4, 3]);
        heatCtx.lineWidth = isHigh ? 1.8 : 1.4;
        heatCtx.strokeStyle = isHigh ? '#fb7185' : '#fbbf24';
        heatCtx.stroke();
        heatCtx.restore();

        const precipTag =
          typeof pt.precipMmHr === 'number' && pt.precipMmHr > 0
            ? ` · ${pt.precipMmHr}mm/h`
            : '';
        const label = isHigh
          ? `⚡ HIGH CELL · 0°C ${pt.freezingLevelFt}ft${precipTag}`
          : `⚡ SHOWER CELL · 0°C ${pt.freezingLevelFt}ft${precipTag}`;

        drawPillLabel(
          heatCtx,
          screenPt.x,
          screenPt.y,
          label,
          isHigh ? 'rgba(136, 19, 55, 0.92)' : 'rgba(120, 53, 15, 0.92)',
          isHigh ? '#fb7185' : '#fbbf24',
          isHigh ? '#ffe4e6' : '#fef3c7'
        );
      }

      // 2. Draw Shore Base -> Rig Flight Corridor & 18 NM Fly-Around Dog-Leg Bypass Route
      if (
        activeFacility &&
        shoreBaseFacility &&
        activeFacility.id !== shoreBaseFacility.id
      ) {
        const assessment = evaluateCorridorLightningBypass(
          shoreBaseFacility,
          activeFacility,
          gridPoints,
          preset
        );

        const pBase = map.latLngToContainerPoint([
          shoreBaseFacility.lat,
          shoreBaseFacility.lon,
        ]);
        const pRig = map.latLngToContainerPoint([
          activeFacility.lat,
          activeFacility.lon,
        ]);
        const pDirectMid = map.latLngToContainerPoint([
          assessment.directMidpoint.lat,
          assessment.directMidpoint.lon,
        ]);
        const pNorthMid = map.latLngToContainerPoint([
          assessment.northMidpoint.lat,
          assessment.northMidpoint.lon,
        ]);
        const pSouthMid = map.latLngToContainerPoint([
          assessment.southMidpoint.lat,
          assessment.southMidpoint.lon,
        ]);

        // Draw Direct Track (Shore Base -> Rig)
        heatCtx.save();
        heatCtx.beginPath();
        heatCtx.moveTo(pBase.x, pBase.y);
        heatCtx.lineTo(pRig.x, pRig.y);

        if (assessment.directRisk === 'LOW') {
          heatCtx.strokeStyle = '#10b981';
          heatCtx.lineWidth = 2.8;
          heatCtx.setLineDash([8, 5]);
          heatCtx.stroke();
          heatCtx.restore();

          // Also draw subtle 18 NM North & South alternate corridor boundaries so pilots see corridor width
          for (const altPt of [pNorthMid, pSouthMid]) {
            heatCtx.save();
            heatCtx.beginPath();
            heatCtx.moveTo(pBase.x, pBase.y);
            heatCtx.lineTo(altPt.x, altPt.y);
            heatCtx.lineTo(pRig.x, pRig.y);
            heatCtx.strokeStyle = 'rgba(34, 211, 238, 0.35)';
            heatCtx.lineWidth = 1.3;
            heatCtx.setLineDash([4, 6]);
            heatCtx.stroke();
            heatCtx.restore();
          }

          drawPillLabel(
            heatCtx,
            pDirectMid.x,
            pDirectMid.y - 12,
            `✓ ${shoreBaseFacility.code} → ${activeFacility.code} DIRECT TRACK CLEAR`,
            'rgba(6, 78, 59, 0.92)',
            '#34d399',
            '#d1fae5'
          );
        } else {
          // Direct track has Moderate or High Triggered-Lightning Cell!
          heatCtx.strokeStyle =
            assessment.directRisk === 'HIGH' ? '#f43f5e' : '#f59e0b';
          heatCtx.lineWidth = 2.4;
          heatCtx.setLineDash([5, 5]);
          heatCtx.stroke();
          heatCtx.restore();

          drawPillLabel(
            heatCtx,
            pDirectMid.x,
            pDirectMid.y,
            `⚡ DIRECT TRACK: ${assessment.directRisk} LIGHTNING RISK`,
            assessment.directRisk === 'HIGH'
              ? 'rgba(136, 19, 55, 0.94)'
              : 'rgba(120, 53, 15, 0.94)',
            assessment.directRisk === 'HIGH' ? '#fb7185' : '#fbbf24',
            '#ffffff'
          );

          // Highlight the recommended 18 NM North or South Fly-Around Dog-Leg Bypass Corridor
          const useNorth =
            assessment.recommendedRoute === 'BYPASS_NORTH' ||
            (assessment.recommendedRoute !== 'BYPASS_SOUTH' &&
              assessment.northBypassRisk !== 'HIGH');
          const bypassPt = useNorth ? pNorthMid : pSouthMid;
          const bypassDirLabel = useNorth ? '18 NM NORTH BYPASS' : '18 NM SOUTH BYPASS';
          const bypassRisk = useNorth
            ? assessment.northBypassRisk
            : assessment.southBypassRisk;

          heatCtx.save();
          heatCtx.beginPath();
          heatCtx.moveTo(pBase.x, pBase.y);
          heatCtx.lineTo(bypassPt.x, bypassPt.y);
          heatCtx.lineTo(pRig.x, pRig.y);
          heatCtx.strokeStyle =
            bypassRisk === 'LOW'
              ? '#10b981'
              : bypassRisk === 'MODERATE'
              ? '#22d3ee'
              : '#fb7185';
          heatCtx.lineWidth = 3.0;
          heatCtx.setLineDash([9, 4]);
          heatCtx.stroke();
          heatCtx.restore();

          drawPillLabel(
            heatCtx,
            bypassPt.x,
            bypassPt.y + (useNorth ? -14 : 14),
            bypassRisk === 'LOW'
              ? `✓ FLY-AROUND: ${bypassDirLabel} (CLEAR)`
              : `↪ ${bypassDirLabel} (${bypassRisk})`,
            bypassRisk === 'LOW'
              ? 'rgba(6, 78, 59, 0.94)'
              : 'rgba(15, 23, 42, 0.94)',
            bypassRisk === 'LOW' ? '#34d399' : '#38bdf8',
            bypassRisk === 'LOW' ? '#d1fae5' : '#bae6fd'
          );
        }
      }
    };

    const resizeAndRenderHeatmap = () => {
      const size = map.getSize();
      heatCanvas.width = size.x;
      heatCanvas.height = size.y;
      partCanvas.width = size.x;
      partCanvas.height = size.y;

      // Render coarse low-res heatmap onto offscreen canvas and scale up smoothly
      const scale = 14;
      const w = Math.max(1, Math.ceil(size.x / scale));
      const h = Math.max(1, Math.ceil(size.y / scale));
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const offCtx = offscreen.getContext('2d');
      if (!offCtx) return;

      const imgData = offCtx.createImageData(w, h);
      const data = imgData.data;

      for (let py = 0; py < h; py++) {
        for (let px = 0; px < w; px++) {
          const containerPt = L.point(px * scale + scale / 2, py * scale + scale / 2);
          const latLng = map.containerPointToLatLng(containerPt);

          const idx = (py * w + px) * 4;
          // Restrict heatmap to UK & North Sea sector bounds
          if (
            latLng.lat < 49.5 ||
            latLng.lat > 63.0 ||
            latLng.lng < -10.5 ||
            latLng.lng > 6.5
          ) {
            data[idx + 3] = 0;
            continue;
          }

          const interp = interpolateGrid(
            latLng.lat,
            latLng.lng,
            gridPoints,
            overlayMode,
            preset
          );
          data[idx] = interp.r;
          data[idx + 1] = interp.g;
          data[idx + 2] = interp.b;
          data[idx + 3] = Math.round(interp.a * 255);
        }
      }

      offCtx.putImageData(imgData, 0, 0);
      heatCtx.clearRect(0, 0, size.x, size.y);
      heatCtx.imageSmoothingEnabled = true;
      heatCtx.imageSmoothingQuality = 'high';
      heatCtx.drawImage(offscreen, 0, 0, w, h, 0, 0, size.x, size.y);

      drawTriggeredLightningAnnotations();
    };

    // Initialize particles inside UK / North Sea bounds
    const spawnParticle = (): Particle => ({
      lat: 51.0 + Math.random() * 11.0,
      lon: -7.5 + Math.random() * 11.5,
      age: Math.floor(Math.random() * 90),
      maxAge: 75 + Math.floor(Math.random() * 55),
    });

    if (particlesRef.current.length === 0) {
      particlesRef.current = Array.from({ length: PARTICLE_COUNT }, spawnParticle);
    }

    resizeAndRenderHeatmap();

    const handleMapMove = () => {
      partCtx.clearRect(0, 0, partCanvas.width, partCanvas.height);
      resizeAndRenderHeatmap();
    };

    map.on('moveend zoomend resize', handleMapMove);

    const animateParticles = () => {
      // Fade previous frame slightly to create smooth glowing streamline trails
      partCtx.globalCompositeOperation = 'destination-in';
      partCtx.fillStyle = 'rgba(0, 0, 0, 0.91)';
      partCtx.fillRect(0, 0, partCanvas.width, partCanvas.height);
      partCtx.globalCompositeOperation = 'source-over';

      const zoom = map.getZoom();
      const speedFactor = 0.00028 * Math.pow(0.82, zoom - 6);

      const particles = particlesRef.current;
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        if (
          p.age >= p.maxAge ||
          p.lat < 50.0 ||
          p.lat > 62.5 ||
          p.lon < -9.5 ||
          p.lon > 5.5
        ) {
          particles[i] = spawnParticle();
          particles[i].age = 0;
          continue;
        }

        const interp = interpolateGrid(
          p.lat,
          p.lon,
          gridPoints,
          overlayMode,
          preset
        );
        if (interp.a === 0) {
          p.age = p.maxAge;
          continue;
        }

        const prevPt = map.latLngToContainerPoint([p.lat, p.lon]);
        const nextLat = p.lat + interp.v * speedFactor;
        const nextLon = p.lon + (interp.u * speedFactor) / 0.56;
        const nextPt = map.latLngToContainerPoint([nextLat, nextLon]);

        p.lat = nextLat;
        p.lon = nextLon;
        p.age++;

        partCtx.beginPath();
        partCtx.moveTo(prevPt.x, prevPt.y);
        partCtx.lineTo(nextPt.x, nextPt.y);
        partCtx.strokeStyle = `rgba(${Math.min(255, interp.r + 70)}, ${Math.min(
          255,
          interp.g + 70
        )}, ${Math.min(255, interp.b + 70)}, 0.92)`;
        partCtx.lineWidth = interp.scalar >= 30 ? 2.4 : 1.8;
        partCtx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(animateParticles);
    };

    animFrameRef.current = requestAnimationFrame(animateParticles);

    return () => {
      map.off('moveend zoomend resize', handleMapMove);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [map, gridPoints, overlayMode, preset, activeFacility, shoreBaseFacility]);

  if (overlayMode === 'off') return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[350] overflow-hidden">
      <canvas
        ref={heatmapCanvasRef}
        className="absolute inset-0 w-full h-full mix-blend-screen"
      />
      <canvas
        ref={particleCanvasRef}
        className="absolute inset-0 w-full h-full"
      />
    </div>
  );
};

