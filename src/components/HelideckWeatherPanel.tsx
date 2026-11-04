import React from 'react';
import { HelideckWeatherState, InstallationOrAirport } from '../types/radar';
import {
  AlertTriangle,
  CheckCircle2,
  CloudFog,
  RefreshCw,
  ShieldAlert,
  Waves,
  Wind,
} from 'lucide-react';

interface HelideckWeatherPanelProps {
  facility: InstallationOrAirport;
  weather: HelideckWeatherState | null;
  loading: boolean;
  onRefresh: () => void;
  customPitch: number;
  customRoll: number;
  customHeave: number;
  onUpdateDeckMotion: (pitch: number, roll: number, heave: number) => void;
  onResetDeckMotion: () => void;
}

export const HelideckWeatherPanel: React.FC<HelideckWeatherPanelProps> = ({
  facility,
  weather,
  loading,
  onRefresh,
  customPitch,
  customRoll,
  customHeave,
  onUpdateDeckMotion,
  onResetDeckMotion,
}) => {
  if (!weather) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm">
        Loading meteorological, marine & aviation METAR telemetry for {facility.name}...
      </div>
    );
  }

  const statusColor =
    weather.cap437Status === 'GO'
      ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20'
      : weather.cap437Status === 'CAUTION'
      ? 'text-amber-400 border-amber-500/40 bg-amber-950/20'
      : 'text-rose-400 border-rose-500/50 bg-rose-950/30';

  const delayColor =
    weather.delayRiskLevel === 'HIGH'
      ? 'border-rose-500/50 bg-rose-950/25 text-rose-300'
      : weather.delayRiskLevel === 'MODERATE'
      ? 'border-amber-500/50 bg-amber-950/25 text-amber-300'
      : 'border-cyan-500/30 bg-slate-900/90 text-slate-200';

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto p-3.5 space-y-3.5">
      {/* Header & Refresh */}
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-mono text-cyan-400">
            HELIDECK & SHORE METAR TELEMETRY · {facility.code}
          </div>
          <h3 className="text-base font-bold text-white truncate">{facility.name}</h3>
          <div className="text-xs text-slate-400">
            {facility.fieldOperator} · {facility.assetType} · Updated {weather.updatedAt}
          </div>
        </div>
        <button
          onClick={onRefresh}
          title="Refresh Live Open-Meteo & Aviation METAR/TAF"
          className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 cursor-pointer shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
        </button>
      </div>

      {/* CAP 437 Operational Status Box */}
      <div className={`p-3 rounded-lg border ${statusColor}`}>
        <div className="flex items-center gap-2 font-semibold text-sm">
          {weather.cap437Status === 'GO' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {weather.cap437Status === 'CAUTION' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {weather.cap437Status === 'HOLD' && <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span>
            HELIDECK STATUS: {weather.cap437Status} (CAA CAP 437 / HCA)
          </span>
        </div>
        <p className="text-xs mt-1 opacity-90">{weather.cap437Reason}</p>
      </div>

      {/* Live Shore Base METAR / TAF & Fog / Haar Delay Predictor */}
      <div className={`p-3 rounded-lg border ${delayColor} space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <CloudFog className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              SHORE BASE ({weather.shoreBaseIcao}) FOG & DELAY PREDICTOR:{' '}
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
            </span>
          </div>
          <span className="text-[11px] font-mono text-cyan-300">
            CAT: {weather.flightCategory || 'VFR'}
          </span>
        </div>

        <p className="text-xs text-slate-300 leading-relaxed">
          {weather.delayRiskSummary}
        </p>

        {weather.rawMetar && (
          <div className="pt-2 border-t border-slate-800/80 space-y-1">
            <div className="text-[10px] font-mono text-slate-400">
              LIVE METAR ({weather.shoreBaseIcao}):
            </div>
            <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-cyan-300 break-words">
              {weather.rawMetar}
            </div>
          </div>
        )}

        {weather.rawTaf && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-slate-400">
              TERMINAL FORECAST (TAF):
            </div>
            <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-300 break-words max-h-24 overflow-y-auto">
              {weather.rawTaf}
            </div>
          </div>
        )}
      </div>

      {/* Primary Wind, Sea State & Atmospheric Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Wind & Gusts (10m/Deck)</span>
            <Wind className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-mono font-bold tabular-nums text-white mt-1">
            {weather.windSpeedKts}{' '}
            <span className="text-xs font-normal text-slate-400">G</span>{' '}
            <span className={weather.windGustKts >= 45 ? 'text-amber-400' : 'text-white'}>
              {weather.windGustKts}
            </span>{' '}
            <span className="text-xs font-normal text-slate-400">KT</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            Direction {String(weather.windDirectionDeg).padStart(3, '0')}° · Limit 60 kt
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Significant Wave (Hs)</span>
            <Waves className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-mono font-bold tabular-nums text-white mt-1">
            {weather.significantWaveHeightM}{' '}
            <span className="text-xs font-normal text-slate-400">m</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            Max {weather.maxWaveHeightM}m · Period {weather.swellPeriodSec}s
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Visibility & Cloud Base</div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            {weather.visibilityKm}{' '}
            <span className="text-xs font-normal text-slate-400">km</span> ·{' '}
            {weather.cloudBaseFt.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ft</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            VFR / ARA Offshore Minima
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Temp & QNH Pressure</div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            {weather.temperatureC}°C · {weather.pressureQnhHpa}{' '}
            <span className="text-xs font-normal text-slate-400">hPa</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            Helideck Elev {facility.elevationFt} ft AMSL
          </div>
        </div>
      </div>

      {/* Vessel / FPSO Pitch, Roll & Heave Simulator (CAP 437) */}
      <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-semibold text-white">
              FPSO / Vessel Helideck Motion Limits (Pitch, Roll & Heave)
            </h4>
            <p className="text-[11px] text-slate-400">
              Test deck motion thresholds for floating assets (e.g. Glen Lyon, Kraken, Captain FPSO)
            </p>
          </div>
          <button
            onClick={onResetDeckMotion}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[11px] cursor-pointer"
          >
            Auto Wave Sync
          </button>
        </div>

        <div className="space-y-2.5 text-xs">
          <div>
            <div className="flex justify-between font-mono tabular-nums">
              <span className="text-slate-300">Deck Pitch (±3.0° Day / ±2.0° Night Limit)</span>
              <span className={weather.vesselPitchDeg > 3.0 ? 'text-rose-400 font-bold' : 'text-cyan-400'}>
                ±{weather.vesselPitchDeg.toFixed(1)}°
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={customPitch}
              onChange={(e) =>
                onUpdateDeckMotion(parseFloat(e.target.value), customRoll, customHeave)
              }
              className="w-full accent-cyan-400 mt-1 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between font-mono tabular-nums">
              <span className="text-slate-300">Deck Roll (±3.0° Day / ±2.0° Night Limit)</span>
              <span className={weather.vesselRollDeg > 3.0 ? 'text-rose-400 font-bold' : 'text-cyan-400'}>
                ±{weather.vesselRollDeg.toFixed(1)}°
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={customRoll}
              onChange={(e) =>
                onUpdateDeckMotion(customPitch, parseFloat(e.target.value), customHeave)
              }
              className="w-full accent-cyan-400 mt-1 cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between font-mono tabular-nums">
              <span className="text-slate-300">Significant Heave Rate (1.3 m/s Limit)</span>
              <span className={weather.vesselHeaveRateMps > 1.3 ? 'text-rose-400 font-bold' : 'text-cyan-400'}>
                {weather.vesselHeaveRateMps.toFixed(2)} m/s
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="2.2"
              step="0.05"
              value={customHeave}
              onChange={(e) =>
                onUpdateDeckMotion(customPitch, customRoll, parseFloat(e.target.value))
              }
              className="w-full accent-cyan-400 mt-1 cursor-pointer"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
