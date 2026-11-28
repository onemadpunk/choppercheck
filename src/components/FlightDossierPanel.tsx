import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AircraftTarget, InstallationOrAirport } from '../types/radar';
import { buildFlightShareText, getWhatsAppShareUrl, playCockpitAlertChime } from '../utils/alertsAndShare';
import { coordinate, positionLabel, reported } from '../utils/dataQuality';
import { OperatorStatusLinks } from './OperatorStatusLinks';
import { describeTurnback } from '../utils/turnbackDetection';
import { INSTALLATIONS_AND_AIRPORTS } from '../data/installationsAndAirports';
import { calculateBearingDeg, calculateDistanceNm } from '../data/aircraftDecoder';
import { Bell, Camera, Compass, Copy, ExternalLink, Navigation, Pin, PlaneTakeoff, PlaneLanding, Share2, Volume2, Wind, X } from 'lucide-react';

interface Props {
  flight: AircraftTarget;
  activeFacility: InstallationOrAirport;
  isPinned: boolean;
  onTogglePin: (hex: string) => void;
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  onClose?: () => void;
  onCenterOnFlight: (flight: AircraftTarget) => void;
}

interface EnrichedAircraftDossier {
  photoUrl?: string;
  photoLink?: string;
  photographer?: string;
  manufacturer?: string;
  fullTypeModel?: string;
  registeredOwner?: string;
  ownerCountry?: string;
  airlineName?: string;
  origin?: {
    icao: string;
    iata?: string;
    name: string;
    city?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
  destination?: {
    icao: string;
    iata?: string;
    name: string;
    city?: string;
    country?: string;
    lat?: number;
    lon?: number;
  };
}

const dossierCache = new Map<string, EnrichedAircraftDossier>();

async function fetchAircraftDossier(
  hex: string,
  callsign: string,
  registration: string,
  signal: AbortSignal,
  onProgress?: (partial: EnrichedAircraftDossier) => void
): Promise<EnrichedAircraftDossier> {
  const cacheKey = `${hex}:${callsign}:${registration}`;
  const cached = dossierCache.get(cacheKey);
  if (cached) return cached;

  const result: EnrichedAircraftDossier = {};
  // Only remember the answer if every lookup actually completed. A lookup cut short (card closed,
  // aircraft changed, phone signal dropped) used to be cached as "no photo, no route" for the rest
  // of the visit, so that aircraft never showed its details again.
  let incomplete = false;
  const report = () => {
    if (!signal.aborted) onProgress?.({ ...result });
  };
  const cleanHex = hex.trim().toLowerCase();
  const cleanCallsign = callsign.trim().toUpperCase();
  const cleanReg = registration && registration !== 'Unknown' ? registration.trim().toUpperCase() : '';

  const tasks: Promise<void>[] = [];

  // 1. Live aircraft photo from Planespotters.net public API (CORS-enabled, no key required)
  tasks.push(
    (async () => {
      try {
        const res = await fetch(`https://api.planespotters.net/pub/photos/hex/${encodeURIComponent(cleanHex)}`, {
          signal,
        });
        if (!res.ok && res.status !== 404) incomplete = true;
        let data = res.ok ? await res.json() : null;
        if ((!data?.photos || data.photos.length === 0) && cleanReg) {
          const regRes = await fetch(
            `https://api.planespotters.net/pub/photos/reg/${encodeURIComponent(cleanReg)}`,
            { signal }
          );
          if (regRes.ok) data = await regRes.json();
        }
        const photo = data?.photos?.[0];
        if (photo) {
          result.photoUrl = photo.thumbnail_large?.src || photo.thumbnail?.src;
          result.photoLink = photo.link;
          result.photographer = photo.photographer;
          report();
        }
      } catch {
        incomplete = true;
      }
    })()
  );

  // 2. Registered airframe metadata & backup photo from ADSBDB
  tasks.push(
    (async () => {
      try {
        const res = await fetch(`https://api.adsbdb.com/v0/aircraft/${encodeURIComponent(cleanHex)}`, {
          signal,
        });
        if (!res.ok) {
          if (res.status !== 404) incomplete = true;
          return;
        }
        const data = await res.json();
        const ac = data?.response?.aircraft;
        if (ac && typeof ac === 'object') {
          if (ac.manufacturer) result.manufacturer = String(ac.manufacturer);
          if (ac.type) result.fullTypeModel = String(ac.type);
          if (ac.registered_owner) result.registeredOwner = String(ac.registered_owner);
          if (ac.registered_owner_country_name) result.ownerCountry = String(ac.registered_owner_country_name);
          if (!result.photoUrl && (ac.url_photo || ac.url_photo_thumbnail)) {
            result.photoUrl = String(ac.url_photo || ac.url_photo_thumbnail);
          }
          report();
        }
      } catch {
        incomplete = true;
      }
    })()
  );

  // 3. Published Origin -> Destination route from ADSBDB callsign endpoint
  if (cleanCallsign && cleanCallsign !== hex.toUpperCase()) {
    tasks.push(
      (async () => {
        try {
          const res = await fetch(
            `https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cleanCallsign)}`,
            { signal }
          );
          if (!res.ok) {
            if (res.status !== 404) incomplete = true;
            return;
          }
          const data = await res.json();
          const route = data?.response?.flightroute;
          if (route && typeof route === 'object') {
            if (route.airline?.name) result.airlineName = String(route.airline.name);
            if (route.origin?.icao_code) {
              result.origin = {
                icao: String(route.origin.icao_code),
                iata: route.origin.iata_code ? String(route.origin.iata_code) : undefined,
                name: String(route.origin.name || route.origin.icao_code),
                city: route.origin.municipality ? String(route.origin.municipality) : undefined,
                country: route.origin.country_name ? String(route.origin.country_name) : undefined,
                lat: typeof route.origin.latitude === 'number' ? route.origin.latitude : undefined,
                lon: typeof route.origin.longitude === 'number' ? route.origin.longitude : undefined,
              };
            }
            if (route.destination?.icao_code) {
              result.destination = {
                icao: String(route.destination.icao_code),
                iata: route.destination.iata_code ? String(route.destination.iata_code) : undefined,
                name: String(route.destination.name || route.destination.icao_code),
                city: route.destination.municipality ? String(route.destination.municipality) : undefined,
                country: route.destination.country_name ? String(route.destination.country_name) : undefined,
                lat: typeof route.destination.latitude === 'number' ? route.destination.latitude : undefined,
                lon: typeof route.destination.longitude === 'number' ? route.destination.longitude : undefined,
              };
            }
            report();
          }
        } catch {
          incomplete = true;
        }
      })()
    );
  }

  await Promise.allSettled(tasks);
  if (!incomplete && !signal.aborted) dossierCache.set(cacheKey, result);
  return result;
}

export const FlightDossierPanel: React.FC<Props> = ({
  flight,
  activeFacility,
  isPinned,
  onTogglePin,
  alertsEnabled,
  onToggleAlerts,
  onClose,
  onCenterOnFlight,
}) => {
  const [copied, setCopied] = useState(false);
  const [dossier, setDossier] = useState<EnrichedAircraftDossier | null>(null);
  const [loadingDossier, setLoadingDossier] = useState(false);

  // Look up by the aircraft, not by every small change in what the feeds report: the panel re-renders every
  // couple of seconds, and restarting on a flickering callsign or registration cancelled the photo lookup each
  // time, so on a slow phone connection it never finished. A registration or callsign that turns up later
  // (it was missing before) starts one more lookup.
  const lookupReg = flight.registration && flight.registration !== 'Unknown' ? flight.registration : '';
  const lookupCallsign = flight.callsign !== flight.hex ? flight.callsign : '';
  const stickyRef = useRef<{ hex: string; reg: string; callsign: string }>({ hex: '', reg: '', callsign: '' });
  if (stickyRef.current.hex !== flight.hex) stickyRef.current = { hex: flight.hex, reg: lookupReg, callsign: lookupCallsign };
  if (!stickyRef.current.reg && lookupReg) stickyRef.current = { ...stickyRef.current, reg: lookupReg };
  if (!stickyRef.current.callsign && lookupCallsign) stickyRef.current = { ...stickyRef.current, callsign: lookupCallsign };
  const { reg: stickyReg, callsign: stickyCallsign } = stickyRef.current;

  useEffect(() => {
    const controller = new AbortController();
    // Clear the previous aircraft's photo/route straight away, then show each piece as it arrives
    setDossier(null);
    setLoadingDossier(true);
    fetchAircraftDossier(flight.hex, stickyCallsign || flight.hex, stickyReg || 'Unknown', controller.signal, (partial) =>
      setDossier(partial)
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setDossier(res);
          setLoadingDossier(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoadingDossier(false);
      });
    return () => controller.abort();
  }, [flight.hex, stickyCallsign, stickyReg]);

  // Geometric offshore session origin & heading-aligned facility for helicopters / flights without an airline route
  const geometricTrackContext = useMemo(() => {
    let observedStartFacility: { facility: InstallationOrAirport; distNm: number } | null = null;
    if (flight.trail && flight.trail.length > 0) {
      const firstPt = flight.trail[0];
      let bestDist = 6.5;
      for (const fac of INSTALLATIONS_AND_AIRPORTS) {
        const d = calculateDistanceNm(firstPt.lat, firstPt.lon, fac.lat, fac.lon);
        if (d < bestDist) {
          bestDist = d;
          observedStartFacility = { facility: fac, distNm: Number(d.toFixed(1)) };
        }
      }
    }

    let alignedAheadFacility: {
      facility: InstallationOrAirport;
      distNm: number;
      angleDiffDeg: number;
      etaMin: number | null;
    } | null = null;

    if (flight.trackReported && flight.speedReported && flight.groundSpeedKts >= 35) {
      const maxRangeNm = flight.isRotary ? 135 : 180;
      let bestScore = 999999;
      for (const fac of INSTALLATIONS_AND_AIRPORTS) {
        const distNm = calculateDistanceNm(flight.lat, flight.lon, fac.lat, fac.lon);
        if (distNm < 1.0 || distNm > maxRangeNm) continue;
        if (observedStartFacility && fac.id === observedStartFacility.facility.id && distNm < 15) continue;
        const brg = calculateBearingDeg(flight.lat, flight.lon, fac.lat, fac.lon);
        const diff = Math.abs(((flight.trackDeg - brg + 540) % 360) - 180);
        const maxAngle = distNm <= 20 ? 26 : 16;
        if (diff <= maxAngle) {
          const score = diff * 2.2 + distNm * 0.35;
          if (score < bestScore) {
            bestScore = score;
            alignedAheadFacility = {
              facility: fac,
              distNm: Number(distNm.toFixed(1)),
              angleDiffDeg: Math.round(diff),
              etaMin: Math.max(1, Math.round((distNm / flight.groundSpeedKts) * 60)),
            };
          }
        }
      }
    }

    return { observedStartFacility, alignedAheadFacility };
  }, [flight.lat, flight.lon, flight.trackDeg, flight.trackReported, flight.speedReported, flight.groundSpeedKts, flight.isRotary, flight.trail]);

  const destDistanceAndEta = useMemo(() => {
    if (!dossier?.destination?.lat || !dossier?.destination?.lon) return null;
    const distNm = calculateDistanceNm(flight.lat, flight.lon, dossier.destination.lat, dossier.destination.lon);
    const etaMin =
      flight.speedReported && flight.groundSpeedKts >= 40
        ? Math.max(1, Math.round((distNm / flight.groundSpeedKts) * 60))
        : null;
    return { distNm: Math.round(distNm), etaMin };
  }, [dossier?.destination, flight.lat, flight.lon, flight.speedReported, flight.groundSpeedKts]);

  const trail = flight.trail;
  const maxAlt = Math.max(4000, ...trail.map((t) => t.altFt));
  const points = trail
    .map(
      (pt, i) =>
        ((i / Math.max(1, trail.length - 1)) * 280).toFixed(1) +
        ',' +
        (58 - Math.min(52, (pt.altFt / maxAlt) * 50)).toFixed(1)
    )
    .join(' ');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildFlightShareText(flight, activeFacility.code));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const hasExtendedTelemetry =
    flight.iasKts !== undefined ||
    flight.tasKts !== undefined ||
    flight.mach !== undefined ||
    flight.windSpeedKts !== undefined ||
    flight.oatC !== undefined ||
    flight.navQnhHpa !== undefined ||
    flight.navAltitudeMcpFt !== undefined ||
    flight.altGeomFt !== undefined ||
    flight.rollDeg !== undefined ||
    flight.magHeadingDeg !== undefined ||
    flight.rssiDbfs !== undefined ||
    (flight.navModes && flight.navModes.length > 0);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-3 text-slate-200 text-xs">
      {/* Header Row */}
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-cyan-400">{positionLabel(flight)}</p>
            {flight.isMilitary && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 font-mono text-[10px] font-bold">
                MILITARY / GOV
              </span>
            )}
            {flight.adsbSourceType && (
              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[10px] uppercase">
                {flight.adsbSourceType.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          <h3 className="text-base font-bold text-white truncate mt-0.5">
            {flight.callsign} ·{' '}
            {dossier?.manufacturer && dossier?.fullTypeModel
              ? `${dossier.manufacturer} ${dossier.fullTypeModel}`
              : dossier?.fullTypeModel || flight.typeFullName}
          </h3>
          <p className="text-slate-400 mt-0.5">
            Reg <strong className="text-slate-200">{flight.registration}</strong> · Type{' '}
            <strong className="text-slate-200">{flight.typeCode}</strong> · Hex{' '}
            <span className="font-mono">{flight.hex}</span>
          </p>
          <p className="text-slate-300">
            {dossier?.registeredOwner
              ? `${dossier.registeredOwner}${dossier.ownerCountry ? ` (${dossier.ownerCountry})` : ''}`
              : dossier?.airlineName || flight.operator}
          </p>
        </div>

        <div className="flex gap-1.5 shrink-0">
          <button
            onClick={() => onTogglePin(flight.hex)}
            className={
              'min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-slate-800 cursor-pointer ' +
              (isPinned ? 'text-amber-300' : '')
            }
            aria-label={isPinned ? 'Unpin flight' : 'Pin flight'}
          >
            <Pin className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Close flight details"
              className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-800 rounded-lg cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Real Aircraft Photograph Banner (Planespotters.net / ADSBDB) */}
      {dossier?.photoUrl && (
        <div className="relative rounded-lg overflow-hidden border border-slate-800 bg-slate-950">
          <a
            href={dossier.photoLink || dossier.photoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block relative group"
          >
            <img
              src={dossier.photoUrl}
              alt={`${flight.registration} ${flight.typeFullName}`}
              className="w-full h-36 sm:h-40 object-cover object-center"
              loading="lazy"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-transparent px-2.5 py-1.5 flex items-center justify-between text-[10px] text-slate-300">
              <span className="flex items-center gap-1 truncate">
                <Camera className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="truncate">
                  {dossier.photographer ? `Photo © ${dossier.photographer}` : `Reg ${flight.registration}`}
                </span>
              </span>
              <span className="flex items-center gap-0.5 text-cyan-300 font-mono shrink-0 group-hover:underline">
                Planespotters.net <ExternalLink className="w-2.5 h-2.5" />
              </span>
            </div>
          </a>
        </div>
      )}

      {/* Turnback / RTB Alert Banner */}
      {flight.turnback && (
        <div className="p-2.5 rounded border border-red-700 bg-red-950/40">
          <p className="font-bold text-red-200">
            <span className="mr-1.5 px-1.5 py-0.5 rounded bg-red-600 text-white text-[10px] tracking-wide">
              RTB
            </span>
            {describeTurnback(flight.turnback)}
          </p>
          <p className="text-slate-300 mt-1">
            It left {flight.turnback.baseName} and turned round at{' '}
            {new Date(flight.turnback.turnedAt).toLocaleTimeString('en-GB', {
              hour: '2-digit',
              minute: '2-digit',
            })}{' '}
            without reaching a rig. The reason isn&apos;t published: it could be a technical fault,
            weather or a planned check flight.
          </p>
        </div>
      )}

      {/* From -> To Route Card (Published Callsign Route OR Observed Offshore Session Track) */}
      <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-2">
        {dossier?.origin || dossier?.destination ? (
          <>
            <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400">
              <span>PUBLISHED CALLSIGN ROUTE ({flight.callsign})</span>
              {destDistanceAndEta && (
                <span className="text-emerald-300 font-bold">
                  {destDistanceAndEta.distNm} NM to dest
                  {destDistanceAndEta.etaMin ? ` · ~${destDistanceAndEta.etaMin}m` : ''}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 rounded bg-slate-900/90 border border-slate-800/90">
                <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                  <PlaneTakeoff className="w-3 h-3 text-cyan-400 shrink-0" />
                  <span>FROM (ORIGIN)</span>
                </div>
                {dossier.origin ? (
                  <>
                    <div className="text-sm font-bold font-mono text-white mt-0.5">
                      {dossier.origin.iata
                        ? `${dossier.origin.iata} / ${dossier.origin.icao}`
                        : dossier.origin.icao}
                    </div>
                    <div className="text-[11px] text-slate-200 truncate">{dossier.origin.name}</div>
                    {dossier.origin.city && (
                      <div className="text-[10px] text-slate-400 truncate">
                        {dossier.origin.city}
                        {dossier.origin.country ? `, ${dossier.origin.country}` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-slate-400 mt-1">Not listed</div>
                )}
              </div>

              <div className="p-2 rounded bg-slate-900/90 border border-slate-800/90">
                <div className="flex items-center gap-1 text-[10px] font-mono text-slate-400">
                  <PlaneLanding className="w-3 h-3 text-emerald-400 shrink-0" />
                  <span>TO (DESTINATION)</span>
                </div>
                {dossier.destination ? (
                  <>
                    <div className="text-sm font-bold font-mono text-white mt-0.5">
                      {dossier.destination.iata
                        ? `${dossier.destination.iata} / ${dossier.destination.icao}`
                        : dossier.destination.icao}
                    </div>
                    <div className="text-[11px] text-slate-200 truncate">
                      {dossier.destination.name}
                    </div>
                    {dossier.destination.city && (
                      <div className="text-[10px] text-slate-400 truncate">
                        {dossier.destination.city}
                        {dossier.destination.country ? `, ${dossier.destination.country}` : ''}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-xs text-slate-400 mt-1">Not listed</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            {(geometricTrackContext.observedStartFacility ||
              geometricTrackContext.alignedAheadFacility) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pb-1.5 border-b border-slate-800/80">
                {geometricTrackContext.observedStartFacility && (
                  <div className="p-2 rounded bg-slate-900/90 border border-slate-800">
                    <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                      <PlaneTakeoff className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span>SESSION TRACK START</span>
                    </div>
                    <div className="text-xs font-bold text-white mt-0.5 truncate">
                      {geometricTrackContext.observedStartFacility.facility.shortName} (
                      {geometricTrackContext.observedStartFacility.facility.code})
                    </div>
                    <div className="text-[10px] text-slate-400">
                      First seen {geometricTrackContext.observedStartFacility.distNm} NM from facility
                    </div>
                  </div>
                )}
                {geometricTrackContext.alignedAheadFacility && (
                  <div className="p-2 rounded bg-slate-900/90 border border-cyan-500/30">
                    <div className="text-[10px] font-mono text-cyan-300 flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span>FACILITY ON CURRENT HEADING</span>
                    </div>
                    <div className="text-xs font-bold text-white mt-0.5 truncate">
                      {geometricTrackContext.alignedAheadFacility.facility.shortName} (
                      {geometricTrackContext.alignedAheadFacility.facility.code})
                    </div>
                    <div className="text-[10px] text-emerald-300 font-mono">
                      {geometricTrackContext.alignedAheadFacility.distNm} NM ahead
                      {geometricTrackContext.alignedAheadFacility.etaMin
                        ? ` · ~${geometricTrackContext.alignedAheadFacility.etaMin}m at ${flight.groundSpeedKts}kt`
                        : ''}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-slate-300">
              {loadingDossier
                ? 'Checking public callsign route & airframe registry…'
                : 'Route, departure time and arrival time are not supplied by this position feed.'}
            </p>
            {flight.category === 'coastguard_sar' && (
              <p className="text-slate-400">
                Coastguard identity does not confirm an active rescue mission.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Primary Flight Telemetry Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-2 border-t border-slate-800 pt-3">
        <div>
          <p className="text-slate-400">Reported altitude</p>
          <p className="font-mono text-white">
            {reported(flight.altitudeReported, flight.altitudeFt, ' ft')}
          </p>
          <p className="text-slate-400 mt-1">
            {reported(flight.verticalRateReported, flight.verticalRateFpm, ' fpm')}
          </p>
        </div>
        <div>
          <p className="text-slate-400">Groundspeed</p>
          <p className="font-mono text-white">
            {reported(flight.speedReported, flight.groundSpeedKts, ' kt')}
          </p>
          {flight.tasKts !== undefined && (
            <p className="text-slate-400 mt-1 font-mono text-[11px]">TAS {flight.tasKts} kt</p>
          )}
        </div>
        <div>
          <p className="text-slate-400">Track</p>
          <p className="font-mono text-white">
            {reported(flight.trackReported, flight.trackDeg, '°')}
          </p>
          <p className="text-slate-400 mt-1">Sq {flight.squawk}</p>
        </div>
        <div>
          <p className="text-slate-400">From {activeFacility.code}</p>
          <p className="font-mono text-cyan-300">{flight.distanceFromRefNm} NM</p>
          <p className="text-slate-400 mt-1">
            {flight.bearingFromRefDeg}°
            {flight.speedReported &&
            flight.groundSpeedKts >= 25 &&
            activeFacility.id !== 'map-reference'
              ? ` · ~${Math.max(1, Math.round((flight.distanceFromRefNm / flight.groundSpeedKts) * 60))}m GS`
              : ''}
          </p>
        </div>
      </div>

      {/* Extended Live Mode-S / ADS-B EHS Avionics & Upper-Air Weather Sensor Telemetry */}
      {hasExtendedTelemetry && (
        <div className="p-2.5 rounded-lg bg-slate-950/90 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-[10px] font-mono text-cyan-400">
            <span className="flex items-center gap-1 font-semibold">
              <Wind className="w-3 h-3" /> LIVE TRANSPONDER &amp; AVIONICS TELEMETRY (MODE-S / EHS)
            </span>
            {flight.rssiDbfs !== undefined && (
              <span className="text-slate-400">{flight.rssiDbfs} dBFS</span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
            {(flight.iasKts !== undefined || flight.mach !== undefined) && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">Airspeed (IAS / Mach)</div>
                <div className="text-white font-bold">
                  {flight.iasKts !== undefined ? `${flight.iasKts} kt IAS` : '—'}
                  {flight.mach !== undefined ? ` · M${flight.mach}` : ''}
                </div>
              </div>
            )}
            {(flight.navAltitudeMcpFt !== undefined || flight.navQnhHpa !== undefined) && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">Autopilot MCP / QNH</div>
                <div className="text-cyan-300 font-bold">
                  {flight.navAltitudeMcpFt !== undefined
                    ? `MCP ${flight.navAltitudeMcpFt.toLocaleString()} ft`
                    : ''}
                  {flight.navAltitudeMcpFt !== undefined && flight.navQnhHpa !== undefined ? ' · ' : ''}
                  {flight.navQnhHpa !== undefined ? `${flight.navQnhHpa} hPa` : ''}
                </div>
              </div>
            )}
            {flight.windSpeedKts !== undefined && flight.windDirDeg !== undefined && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">Aircraft-Sensed Wind</div>
                <div className="text-amber-300 font-bold">
                  {String(flight.windDirDeg).padStart(3, '0')}° / {flight.windSpeedKts} kt
                </div>
              </div>
            )}
            {flight.oatC !== undefined && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">Upper-Air Temp (OAT)</div>
                <div className="text-sky-300 font-bold">
                  {flight.oatC}°C
                  {flight.tatC !== undefined ? ` (TAT ${flight.tatC}°C)` : ''}
                </div>
              </div>
            )}
            {(flight.magHeadingDeg !== undefined || flight.rollDeg !== undefined) && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">Heading &amp; Bank Angle</div>
                <div className="text-white font-bold">
                  {flight.magHeadingDeg !== undefined ? `${flight.magHeadingDeg}°M` : ''}
                  {flight.trueHeadingDeg !== undefined ? ` (${flight.trueHeadingDeg}°T)` : ''}
                  {flight.rollDeg !== undefined ? ` · Roll ${flight.rollDeg}°` : ''}
                </div>
              </div>
            )}
            {flight.altGeomFt !== undefined && (
              <div className="p-1.5 rounded bg-slate-900 border border-slate-800/80">
                <div className="text-[10px] text-slate-400 font-sans">GPS Geometric Alt</div>
                <div className="text-slate-200 font-bold">
                  {flight.altGeomFt.toLocaleString()} ft
                </div>
              </div>
            )}
          </div>
          {flight.navModes && flight.navModes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1 pt-1">
              <span className="text-[10px] font-mono text-slate-400">FMS / AP Modes:</span>
              {flight.navModes.map((mode) => (
                <span
                  key={mode}
                  className="px-1.5 py-0.5 rounded bg-cyan-500/15 border border-cyan-500/40 text-cyan-300 font-mono text-[10px] uppercase font-bold"
                >
                  {mode}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Source: {flight.provider || 'ADS-B'} ·{' '}
        {flight.observedAt
          ? new Date(flight.observedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC'
          : 'Observation time unavailable'}
        . Position estimates stop 10 seconds after the report; targets expire at 45 seconds.
      </p>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3">
        <button
          onClick={onToggleAlerts}
          className="min-h-[44px] px-3 py-2 flex gap-1.5 items-center bg-slate-800 rounded-lg cursor-pointer"
        >
          <Bell className="w-3.5 h-3.5" />
          {alertsEnabled ? 'Page alerts on' : 'Page alerts off'}
        </button>
        <button
          onClick={() => playCockpitAlertChime(false)}
          aria-label="Test alert sound"
          className="min-w-[44px] min-h-[44px] flex items-center justify-center bg-slate-800 rounded-lg cursor-pointer"
        >
          <Volume2 className="w-4 h-4" />
        </button>
        <a
          href={getWhatsAppShareUrl(flight, activeFacility.code)}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] px-3 py-2 flex gap-1.5 items-center bg-emerald-800 rounded-lg"
        >
          <Share2 className="w-3.5 h-3.5" />
          Share position
        </a>
        <button
          onClick={copy}
          className="min-h-[44px] px-3 py-2 flex gap-1.5 items-center bg-slate-800 rounded-lg cursor-pointer"
        >
          <Copy className="w-3.5 h-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      <p className="text-[11px] text-slate-400">
        Alerts require this page to remain running. Closed-app push and confirmed take-off alerts
        are not available.
      </p>

      {/* Altitude History Sparkline */}
      <div className="border-t border-slate-800 pt-2">
        <div className="flex justify-between items-center mb-1">
          <span>Observed altitude history — this session</span>
          <button
            onClick={() => onCenterOnFlight(flight)}
            className="min-h-[36px] px-2 text-cyan-300 flex items-center gap-1 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5" />
            Centre
          </button>
        </div>
        {trail.length > 1 ? (
          <svg viewBox="0 0 280 60" className="w-full h-12 bg-slate-950 rounded">
            <polyline fill="none" stroke="#06b6d4" strokeWidth="2" points={points} />
          </svg>
        ) : (
          <p className="text-slate-400">Waiting for more reported points.</p>
        )}
        <p className="text-[11px] text-slate-500 mt-1">
          {coordinate(flight.lat, true)} · {coordinate(flight.lon, false)}
        </p>
      </div>

      <p className="text-[11px] text-slate-500">
        Altitude is reported by the aircraft. Pressure altitude may be negative; it is not height
        above a rig or ground.
      </p>
      <OperatorStatusLinks />
    </div>
  );
};

