import React, { useMemo } from 'react';
import { AircraftTarget, InstallationOrAirport } from '../types/radar';
import { compassDirectionFromBearing } from '../utils/alertsAndShare';
import { ArrowRight, Compass, LocateFixed, Plane, ShieldAlert, X } from 'lucide-react';

interface OverheadSkyCompassModalProps {
  isOpen: boolean;
  onClose: () => void;
  flights: AircraftTarget[];
  activeFacility: InstallationOrAirport;
  onSelectFlight: (flight: AircraftTarget) => void;
  onUseMyGps: () => void;
}

export const OverheadSkyCompassModal: React.FC<OverheadSkyCompassModalProps> = ({
  isOpen,
  onClose,
  flights,
  activeFacility,
  onSelectFlight,
  onUseMyGps,
}) => {
  const nearestFlights = useMemo(() => {
    return [...flights]
      .sort((a, b) => a.distanceFromRefNm - b.distanceFromRefNm)
      .slice(0, 14);
  }, [flights]);

  if (!isOpen) return null;

  const closest = nearestFlights[0] || null;
  const maxScopeRangeNm = 40;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 sm:p-4">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl p-4 sm:p-5 text-slate-100 shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-mono text-cyan-400">
              <Compass className="w-4 h-4" />
              <span>360° OVERHEAD SKY COMPASS SPOTTER</span>
            </div>
            <h2 className="text-base sm:text-lg font-bold text-white truncate mt-0.5">
              What’s Flying Overhead Near {activeFacility.shortName} ({activeFacility.code})
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onUseMyGps}
              className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 rounded-lg text-xs font-medium flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <LocateFixed className="w-3.5 h-3.5" />
              Use My GPS
            </button>
            <button
              onClick={onClose}
              className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto mt-3 space-y-4 pr-1">
          {/* Top Grid: 360° Polar Sky Scope + Closest Aircraft Callout */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
            {/* 360° Polar Radar Scope SVG */}
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 flex flex-col items-center justify-center">
              <svg viewBox="0 0 240 240" className="w-52 h-52 sm:w-56 sm:h-56">
                {/* Outer 40 NM, Mid 25 NM, Inner 10 NM Rings */}
                <circle cx="120" cy="120" r="100" fill="#07090e" stroke="#1e293b" strokeWidth="1.5" />
                <circle cx="120" cy="120" r="65" fill="none" stroke="#06b6d4" strokeWidth="1" strokeDasharray="4 4" opacity="0.5" />
                <circle cx="120" cy="120" r="30" fill="none" stroke="#10b981" strokeWidth="1" strokeDasharray="3 3" opacity="0.65" />

                {/* Crosshairs */}
                <line x1="120" y1="15" x2="120" y2="225" stroke="#1e293b" strokeWidth="1" />
                <line x1="15" y1="120" x2="225" y2="120" stroke="#1e293b" strokeWidth="1" />

                {/* Cardinal Labels */}
                <text x="120" y="13" textAnchor="middle" fill="#38bdf8" fontSize="10" fontWeight="700" fontFamily="JetBrains Mono">N</text>
                <text x="231" y="123" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">E</text>
                <text x="120" y="236" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">S</text>
                <text x="9" y="123" textAnchor="middle" fill="#64748b" fontSize="9" fontFamily="JetBrains Mono">W</text>

                {/* Center Observer Dot */}
                <circle cx="120" cy="120" r="4" fill="#f59e0b" />

                {/* Aircraft Blips on Polar Scope */}
                {nearestFlights.map((f, idx) => {
                  const clampedDist = Math.min(maxScopeRangeNm, f.distanceFromRefNm);
                  const r = (clampedDist / maxScopeRangeNm) * 95;
                  const rad = ((f.bearingFromRefDeg - 90) * Math.PI) / 180;
                  const x = 120 + r * Math.cos(rad);
                  const y = 120 + r * Math.sin(rad);
                  const color =
                    idx === 0
                      ? '#10b981'
                      : f.category === 'coastguard_sar'
                      ? '#f97316'
                      : f.category === 'offshore_heli'
                      ? '#06b6d4'
                      : '#eab308';

                  return (
                    <g
                      key={f.hex}
                      onClick={() => {
                        onSelectFlight(f);
                        onClose();
                      }}
                      className="cursor-pointer"
                    >
                      {idx === 0 && (
                        <line
                          x1="120"
                          y1="120"
                          x2={x}
                          y2={y}
                          stroke="#10b981"
                          strokeWidth="1.2"
                          strokeDasharray="2 2"
                        />
                      )}
                      <circle cx={x} cy={y} r={idx === 0 ? 5.5 : 4} fill={color} stroke="#07090e" strokeWidth="1" />
                      <text
                        x={x + 6}
                        y={y + 3}
                        fill={idx === 0 ? '#ffffff' : '#cbd5e1'}
                        fontSize="8"
                        fontFamily="JetBrains Mono"
                        fontWeight={idx === 0 ? '700' : '400'}
                      >
                        {f.callsign}
                      </text>
                    </g>
                  );
                })}
              </svg>
              <div className="text-[11px] font-mono text-slate-400 mt-1">
                Inner Ring: 10 NM · Mid: 25 NM · Outer: 40 NM
              </div>
            </div>

            {/* Closest Overhead Target Card */}
            {closest ? (
              <div className="bg-slate-950 border border-emerald-500/40 rounded-xl p-4 space-y-2.5">
                <div className="text-xs font-mono text-emerald-400 font-semibold">
                  CLOSEST AIRCRAFT OVERHEAD RIGHT NOW
                </div>
                <div className="text-2xl font-bold font-mono text-white">
                  LOOK {compassDirectionFromBearing(closest.bearingFromRefDeg)} ({closest.bearingFromRefDeg}°)
                </div>
                <div className="text-sm font-semibold text-cyan-300">
                  {closest.callsign} · {closest.typeFullName}
                </div>
                <div className="text-xs text-slate-300">
                  {closest.operator} · Reg <span className="font-mono">{closest.registration}</span>
                </div>

                <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs font-mono">
                  <span className="text-cyan-400">
                    {closest.originCode} ({closest.originName})
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-amber-400">
                    {closest.destinationCode} ({closest.destinationName})
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800 font-mono tabular-nums text-xs">
                  <div>
                    <div className="text-[10px] text-slate-400">Distance</div>
                    <div className="font-bold text-white">
                      {closest.distanceFromRefMiles} mi ({closest.distanceFromRefNm} NM)
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Altitude</div>
                    <div className="font-bold text-white">
                      {closest.altitudeFt.toLocaleString()} ft
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-slate-400">Speed</div>
                    <div className="font-bold text-white">
                      {closest.groundSpeedMph} mph
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => {
                    onSelectFlight(closest);
                    onClose();
                  }}
                  className="w-full py-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-lg text-xs cursor-pointer transition-colors"
                >
                  Lock Radar & Trail onto {closest.callsign}
                </button>
              </div>
            ) : (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-6 text-center text-sm text-slate-400">
                No aircraft currently detected near {activeFacility.shortName}.
              </div>
            )}
          </div>

          {/* Ranked List of Closest Aircraft */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
            <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 text-xs font-semibold text-slate-200">
              All Nearby Aircraft Ranked by Distance from {activeFacility.shortName}
            </div>
            <div className="divide-y divide-slate-800/80">
              {nearestFlights.map((f) => {
                const dir = compassDirectionFromBearing(f.bearingFromRefDeg);
                const isSar = f.category === 'coastguard_sar';
                return (
                  <div
                    key={f.hex}
                    onClick={() => {
                      onSelectFlight(f);
                      onClose();
                    }}
                    className="px-3.5 py-2.5 hover:bg-slate-900/80 transition-colors cursor-pointer flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        {isSar ? (
                          <ShieldAlert className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                        ) : (
                          <Plane className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                        )}
                        <span className="font-mono font-bold text-white">{f.callsign}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="text-cyan-300 truncate">{f.typeFullName}</span>
                        <span aria-hidden="true" className="text-slate-600">·</span>
                        <span className="font-mono text-slate-400">{f.registration}</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                        {f.originCode} ({f.originName}) → {f.destinationCode} ({f.destinationName}) · {f.operator}
                      </div>
                    </div>

                    <div className="text-right font-mono tabular-nums shrink-0">
                      <div className="text-xs font-bold text-emerald-400">
                        Look {dir} ({f.bearingFromRefDeg}°) · {f.distanceFromRefMiles} mi
                      </div>
                      <div className="text-[11px] text-slate-400">
                        {f.altitudeFt.toLocaleString()} ft · {f.groundSpeedMph} mph
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
