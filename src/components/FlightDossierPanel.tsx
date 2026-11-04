import React, { useState } from 'react';
import { AircraftTarget, InstallationOrAirport } from '../types/radar';
import {
  buildFlightShareText,
  getWhatsAppShareUrl,
  playCockpitAlertChime,
} from '../utils/alertsAndShare';
import {
  ArrowRight,
  Bell,
  BellRing,
  Check,
  Compass,
  Copy,
  Pin,
  Plane,
  Share2,
  ShieldAlert,
  Volume2,
  X,
} from 'lucide-react';

interface FlightDossierPanelProps {
  flight: AircraftTarget;
  activeFacility: InstallationOrAirport;
  isPinned: boolean;
  onTogglePin: (hex: string) => void;
  alertsEnabled: boolean;
  onToggleAlerts: () => void;
  onClose?: () => void;
  onCenterOnFlight: (flight: AircraftTarget) => void;
}

export const FlightDossierPanel: React.FC<FlightDossierPanelProps> = ({
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

  const isSar = flight.category === 'coastguard_sar';
  const isHeli = flight.category === 'offshore_heli' || isSar;

  const statusText =
    flight.status === 'sar_medevac_active'
      ? 'HM Coastguard SAR / Medevac Priority'
      : flight.status === 'low_alt_coasting'
      ? 'Low-Altitude Helideck Descent (Coasting Estimate)'
      : flight.status === 'final_approach'
      ? 'Final Approach Within 12 NM Ring'
      : flight.status === 'outbound_to_rig'
      ? 'Outbound to Offshore Installation'
      : flight.status === 'inbound_to_shore'
      ? 'Inbound to Shore Heliport'
      : 'Enroute UK / European Airspace';

  const statusColor =
    flight.status === 'sar_medevac_active'
      ? 'text-orange-400'
      : flight.status === 'low_alt_coasting' || flight.status === 'final_approach'
      ? 'text-amber-400'
      : 'text-emerald-400';

  const trail = flight.trail.length > 1 ? flight.trail : [];
  const maxAlt = Math.max(4000, ...trail.map((t) => t.altFt), flight.altitudeFt);
  const svgPoints = trail
    .map((pt, idx) => {
      const x = (idx / Math.max(1, trail.length - 1)) * 280;
      const y = 58 - Math.min(52, (pt.altFt / maxAlt) * 50);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const handleCopyShare = async () => {
    const text = buildFlightShareText(flight, activeFacility.code);
    try {
      if (navigator.share) {
        await navigator.share({
          title: `DeckWatch Live: ${flight.callsign}`,
          text,
        });
        return;
      }
    } catch {
      // Fallback to clipboard
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // ignore
    }
  };

  return (
    <div className="bg-slate-900/95 border border-slate-800 rounded-lg p-3.5 text-slate-100">
      {/* Header Row: Callsign, Aircraft Type & Actions */}
      <div className="flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono flex-wrap">
            <span className={statusColor}>● {statusText}</span>
            <span aria-hidden="true">·</span>
            <span
              className={
                flight.source === 'live_adsb'
                  ? 'text-emerald-400 font-semibold'
                  : 'text-amber-400'
              }
            >
              {flight.source === 'live_adsb' ? 'LIVE 1090MHz ADS-B' : 'DEMO SCHEDULE WAVE'}
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold tracking-tight text-white mt-0.5 truncate">
            {flight.callsign}{' '}
            <span className="text-xs sm:text-sm font-normal text-slate-300">
              · {flight.typeFullName}
            </span>
          </h3>
          <div className="text-xs text-slate-400 mt-0.5 truncate">
            {flight.operator} · Reg <span className="font-mono text-slate-200">{flight.registration}</span> · Type{' '}
            <span className="font-mono text-slate-200">{flight.typeCode}</span> · Hex{' '}
            <span className="font-mono text-slate-300">{flight.hex}</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => onTogglePin(flight.hex)}
            title={isPinned ? 'Unpin Due-Off Flight' : 'Select as My Due-Off / Connection Flight'}
            className={`min-h-[36px] px-2.5 py-1 rounded-md text-xs font-medium flex items-center gap-1 border transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              isPinned
                ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
          >
            <Pin className="w-3.5 h-3.5" />
            {isPinned ? 'My Flight' : 'Pin Flight'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Close Dossier"
              className="min-w-[36px] min-h-[36px] rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Explicit FROM -> TO Route Card */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-800 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="min-w-0">
          <div className="text-[10px] text-slate-400 font-mono">FROM (ORIGIN)</div>
          <div className="text-sm sm:text-base font-bold font-mono text-cyan-400 truncate">
            {flight.originCode}
          </div>
          <div className="text-xs text-slate-300 truncate">{flight.originName}</div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            DEP {flight.scheduledDepTime}
          </div>
        </div>

        <div className="flex flex-col items-center justify-center px-2">
          <div className="flex items-center gap-1 text-amber-400">
            {isSar ? <ShieldAlert className="w-4 h-4" /> : <Plane className="w-4 h-4" />}
            <ArrowRight className="w-4 h-4" />
          </div>
          {flight.etaToRefMinutes !== null && (
            <span className="text-[11px] font-mono tabular-nums text-amber-300 mt-0.5">
              ETA {flight.etaToRefMinutes}m
            </span>
          )}
        </div>

        <div className="min-w-0 text-right">
          <div className="text-[10px] text-slate-400 font-mono">TO (DESTINATION)</div>
          <div className="text-sm sm:text-base font-bold font-mono text-amber-400 truncate">
            {flight.destinationCode}
          </div>
          <div className="text-xs text-slate-300 truncate">{flight.destinationName}</div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            ETA {flight.estimatedArrTime}
            {flight.returnShoreTime ? ` · RET ${flight.returnShoreTime}` : ''}
          </div>
        </div>
      </div>

      {/* Multi-Stop Heli-Admin Planned Route Strip (when available, e.g. ABZ -> FA -> FD -> FC -> ABZ) */}
      {(flight.plannedRouteCodes || flight.heliAdminCheckInTime || flight.fixedWingLink) && (
        <div className="mt-2 pt-2 border-t border-slate-800/90 bg-slate-950/70 rounded px-2.5 py-1.5 text-[11px] font-mono space-y-1">
          {flight.plannedRouteCodes && flight.plannedRouteCodes.length > 0 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-slate-400">
                HELI-ADMIN ROUTE{flight.heliAdminFlightName ? ` (${flight.heliAdminFlightName})` : ''}:
              </span>
              <span className="text-amber-300 font-semibold">
                {flight.plannedRouteCodes.join(' → ')}
              </span>
            </div>
          )}
          {(flight.heliAdminCheckInTime || flight.fixedWingLink) && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-slate-300 flex-wrap">
              {flight.heliAdminCheckInTime && (
                <span>
                  Check-In Heli-Admin: <strong className="text-cyan-300">{flight.heliAdminCheckInTime}</strong> (PEDs off -30m)
                </span>
              )}
              {flight.fixedWingLink && (
                <span className="text-emerald-300">{flight.fixedWingLink}</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Live Telemetry Numerals Grid */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-800 grid grid-cols-4 gap-2">
        <div>
          <div className="text-[10px] text-slate-400">Altitude</div>
          <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-white">
            {flight.altitudeFt.toLocaleString()}{' '}
            <span className="text-[10px] text-slate-400">FT</span>
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-400">
            {flight.verticalRateFpm >= 0 ? `+${flight.verticalRateFpm}` : flight.verticalRateFpm} fpm
          </div>
        </div>

        <div>
          <div className="text-[10px] text-slate-400">Groundspeed</div>
          <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-white">
            {flight.groundSpeedKts}{' '}
            <span className="text-[10px] text-slate-400">KTS</span>
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-400">
            {flight.groundSpeedMph} mph
          </div>
        </div>

        <div>
          <div className="text-[10px] text-slate-400">Track / Sqwk</div>
          <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-white">
            {String(flight.trackDeg).padStart(3, '0')}°
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-400">
            SQWK {flight.squawk}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-slate-400 truncate">
            Dist to {activeFacility.code}
          </div>
          <div className="text-xs sm:text-sm font-mono font-semibold tabular-nums text-cyan-400">
            {flight.distanceFromRefNm}{' '}
            <span className="text-[10px] text-slate-400">NM</span>
          </div>
          <div className="text-[10px] font-mono tabular-nums text-slate-400">
            {flight.distanceFromRefMiles} mi · {flight.bearingFromRefDeg}°
          </div>
        </div>
      </div>

      {/* Due-Off Flight Alert & One-Tap WhatsApp / Status Share Action Bar */}
      <div className="mt-2.5 pt-2.5 border-t border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={onToggleAlerts}
            className={`px-2.5 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 border transition-colors cursor-pointer whitespace-nowrap ${
              alertsEnabled
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/60'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            {alertsEnabled ? (
              <BellRing className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
            {alertsEnabled ? '25/10 NM Alerts Armed' : 'Arm Approach Alerts'}
          </button>

          <button
            onClick={() => playCockpitAlertChime(false)}
            title="Test Audio Chime"
            className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <a
            href={getWhatsAppShareUrl(flight, activeFacility.code)}
            target="_blank"
            rel="noopener noreferrer"
            className="px-2.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1 transition-colors whitespace-nowrap"
          >
            <Share2 className="w-3.5 h-3.5" />
            WhatsApp ETA
          </a>
          <button
            onClick={handleCopyShare}
            className="px-2.5 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Approach / Altitude Profile Mini-Chart */}
      <div className="mt-2.5 pt-2 border-t border-slate-800">
        <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
          <span>
            {isHeli ? 'Helideck Approach & Altitude Profile' : 'Flight Altitude Profile'}
          </span>
          <button
            onClick={() => onCenterOnFlight(flight)}
            className="text-cyan-400 hover:underline flex items-center gap-1 cursor-pointer font-mono"
          >
            <Compass className="w-3 h-3" /> Center ({flight.lat.toFixed(2)}°N, {flight.lon.toFixed(2)}°E)
          </button>
        </div>
        <svg
          viewBox="0 0 280 60"
          className="w-full h-12 bg-slate-950 rounded border border-slate-800/80 overflow-visible"
        >
          <line x1="0" y1="15" x2="280" y2="15" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
          <line x1="0" y1="36" x2="280" y2="36" stroke="#1e293b" strokeWidth="1" strokeDasharray="3 3" />
          {svgPoints && (
            <polyline
              fill="none"
              stroke={isSar ? '#f97316' : '#06b6d4'}
              strokeWidth="2.2"
              points={svgPoints}
            />
          )}
          <text x="6" y="12" fill="#64748b" fontSize="8" fontFamily="JetBrains Mono">
            {maxAlt.toLocaleString()} ft
          </text>
          <text x="6" y="54" fill="#64748b" fontSize="8" fontFamily="JetBrains Mono">
            SEA LEVEL / DECK
          </text>
        </svg>
      </div>
    </div>
  );
};
