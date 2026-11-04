import React from 'react';
import { HelideckWeatherState, InstallationOrAirport } from '../types/radar';
import {
  AlertTriangle,
  CheckCircle2,
  CloudFog,
  Compass,
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
}

export const HelideckWeatherPanel: React.FC<HelideckWeatherPanelProps> = ({
  facility,
  weather,
  loading,
  onRefresh,
}) => {
  if (!weather) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm">
        Loading live meteorological, marine & aviation METAR telemetry for {facility.name}...
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
            LIVE METAR & MARINE TELEMETRY · {facility.code}
          </div>
          <h3 className="text-base font-bold text-white truncate">{facility.name}</h3>
          <div className="text-xs text-slate-400">
            {facility.fieldOperator} · {facility.assetType} · Live Sync {weather.updatedAt}
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

      {/* Weather & Wind Operational Status Box */}
      <div className={`p-3 rounded-lg border ${statusColor}`}>
        <div className="flex items-center gap-2 font-semibold text-sm">
          {weather.cap437Status === 'GO' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
          {weather.cap437Status === 'CAUTION' && <AlertTriangle className="w-4 h-4 shrink-0" />}
          {weather.cap437Status === 'HOLD' && <ShieldAlert className="w-4 h-4 shrink-0" />}
          <span>
            LIVE WEATHER & SEA STATE:{' '}
            {weather.cap437Status === 'GO' ? 'FAVOURABLE (GO)' : weather.cap437Status}
          </span>
        </div>
        <p className="text-xs mt-1 opacity-90">{weather.cap437Reason}</p>
        <p className="text-[10px] mt-1 opacity-75 font-mono">
          Calculated from live offshore wind/wave model & shore METAR (onboard HMS pitch/roll sensors are private to vessel bridge).
        </p>
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
              OFFICIAL AIRPORT METAR ({weather.shoreBaseIcao}):
            </div>
            <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[11px] text-cyan-300 break-words">
              {weather.rawMetar}
            </div>
          </div>
        )}

        {weather.rawTaf && (
          <div className="space-y-1">
            <div className="text-[10px] font-mono text-slate-400">
              OFFICIAL TERMINAL FORECAST (TAF):
            </div>
            <div className="p-2 bg-slate-950 rounded border border-slate-800 font-mono text-[10px] text-slate-300 break-words max-h-24 overflow-y-auto">
              {weather.rawTaf}
            </div>
          </div>
        )}
      </div>

      {/* Primary Live Wind, Sea State & Atmospheric Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Live Wind & Gusts</span>
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

      {/* Helideck Hardware Specs & Live Data Source Verification */}
      <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            Installation Helideck Specs & Live Telemetry Sources
          </span>
          <span className="font-mono text-[10px] text-emerald-400">100% LIVE FEEDS</span>
        </div>

        <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">COORDINATES</div>
            <div className="text-slate-200 tabular-nums mt-0.5">
              {facility.lat.toFixed(4)}°N, {facility.lon.toFixed(4)}°E
            </div>
          </div>
          <div className="p-2 rounded bg-slate-950 border border-slate-800">
            <div className="text-[10px] text-slate-400">CERTIFIED HELIDECK</div>
            <div className="text-slate-200 truncate mt-0.5">
              {facility.helideckDValueM ? `D-Value ${facility.helideckDValueM}m` : facility.assetType}{' '}
              {facility.maxHeliType ? `· ${facility.maxHeliType}` : ''}
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed pt-1">
          <strong>Live Sources:</strong> Airport METAR/TAF from NOAA/CAA Aviation Weather ({weather.shoreBaseIcao}); Offshore Wind, QNH & Marine Wave Height (Hs) queried live at {facility.lat.toFixed(2)}°N, {facility.lon.toFixed(2)}°E via Open-Meteo Marine & ECMWF.
        </p>
      </div>
    </div>
  );
};
