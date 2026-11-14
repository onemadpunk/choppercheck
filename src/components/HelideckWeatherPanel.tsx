import React, { useMemo } from 'react';
import {
  AirframePresetId,
  CorridorWaypointProfile,
  HelideckWeatherState,
  InstallationOrAirport,
  MultiModelHourEntry,
  WeatherModelId,
  WeatherOverlayMode,
} from '../types/radar';
import {
  AIRFRAME_PRESETS,
  WEATHER_MODELS_META,
  buildSevenDayFlightWindowSummaries,
} from '../services/multiModelWeatherService';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  CloudFog,
  CloudRainWind,
  Compass,
  Layers,
  Navigation,
  RefreshCw,
  ShieldAlert,
  Snowflake,
  Waves,
  Wind,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface HelideckWeatherPanelProps {
  facility: InstallationOrAirport;
  shoreBaseFacility: InstallationOrAirport;
  weather: HelideckWeatherState | null;
  loading: boolean;
  onRefresh: () => void;
  airframePresetId: AirframePresetId;
  onChangeAirframePresetId: (id: AirframePresetId) => void;
  weatherModelId: WeatherModelId;
  onChangeWeatherModelId: (id: WeatherModelId) => void;
  weatherOverlayMode: WeatherOverlayMode;
  onChangeWeatherOverlayMode: (mode: WeatherOverlayMode) => void;
  onSwitchToMapWithOverlay: (mode: WeatherOverlayMode) => void;
  hourlyForecast: MultiModelHourEntry[];
  selectedHourIdx: number;
  onChangeSelectedHourIdx: (idx: number) => void;
  corridorWaypoints: CorridorWaypointProfile[];
  ensembleLoading: boolean;
  isFullScreen?: boolean;
  onToggleFullScreen?: () => void;
}

export const HelideckWeatherPanel: React.FC<HelideckWeatherPanelProps> = ({
  facility,
  shoreBaseFacility,
  weather,
  loading,
  onRefresh,
  airframePresetId,
  onChangeAirframePresetId,
  weatherModelId,
  onChangeWeatherModelId,
  weatherOverlayMode,
  onChangeWeatherOverlayMode,
  onSwitchToMapWithOverlay,
  hourlyForecast,
  selectedHourIdx,
  onChangeSelectedHourIdx,
  corridorWaypoints,
  ensembleLoading,
  isFullScreen = false,
  onToggleFullScreen,
}) => {
  const preset = AIRFRAME_PRESETS[airframePresetId];
  const isFpso = facility.assetType === 'FPSO' || facility.assetType === 'Semi-Sub';

  // Compute 7-Day Crew-Change Flight Window Summaries (Today through +6 Days, e.g. Monday)
  const daySummaries = useMemo(
    () => buildSevenDayFlightWindowSummaries(hourlyForecast, weatherModelId),
    [hourlyForecast, weatherModelId]
  );

  const activeHour = hourlyForecast[selectedHourIdx] || hourlyForecast[0];
  const activeDayKey = activeHour?.dayKey || daySummaries[0]?.dayKey || '';

  // All hours belonging to the currently selected day (e.g. all 24 hours of Monday)
  const activeDayHours = useMemo(
    () => hourlyForecast.filter((h) => h.dayKey === activeDayKey),
    [hourlyForecast, activeDayKey]
  );

  const activeDaySummary = useMemo(
    () => daySummaries.find((d) => d.dayKey === activeDayKey) || daySummaries[0],
    [daySummaries, activeDayKey]
  );

  if (!weather) {
    return (
      <div className="p-6 text-center text-slate-400 text-sm">
        Loading 7-day multi-model (ICON · ECMWF · GFS · GEM), marine & METAR telemetry for{' '}
        {facility.name}...
      </div>
    );
  }

  const activeModelSnapshot = activeHour?.models[weatherModelId];
  const currentStatus =
    activeModelSnapshot?.status ||
    (weather.cap437Status === 'UNAVAILABLE' ? 'GO' : weather.cap437Status);
  const currentReason = activeModelSnapshot?.statusReason || weather.cap437Reason;

  const statusColor =
    currentStatus === 'GO'
      ? 'text-emerald-400 border-emerald-500/40 bg-emerald-950/20'
      : currentStatus === 'CAUTION'
      ? 'text-amber-400 border-amber-500/40 bg-amber-950/20'
      : 'text-rose-400 border-rose-500/50 bg-rose-950/30';

  const delayColor =
    weather.delayRiskLevel === 'HIGH'
      ? 'border-rose-500/50 bg-rose-950/25 text-rose-300'
      : weather.delayRiskLevel === 'MODERATE'
      ? 'border-amber-500/50 bg-amber-950/25 text-amber-300'
      : 'border-cyan-500/30 bg-slate-900/90 text-slate-200';

  // Individual limit check items for the "Is Location Within Limits?" matrix
  const gustVal = activeModelSnapshot?.windGust10mKts ?? weather.windGustKts ?? 0;
  const gustStatus =
    gustVal >= preset.maxHelideckGustKts
      ? 'HOLD'
      : gustVal >= preset.cautionGustKts
      ? 'CAUTION'
      : 'GO';

  const waveVal = activeHour?.waveHeightM ?? weather.significantWaveHeightM ?? 0;
  const waveStatus = isFpso
    ? waveVal >= preset.maxFpsoWaveHeightM
      ? 'HOLD'
      : waveVal >= preset.maxFpsoWaveHeightM - 1.3
      ? 'CAUTION'
      : 'GO'
    : waveVal >= 6.5
    ? 'HOLD'
    : waveVal >= 5.0
    ? 'CAUTION'
    : 'GO';

  const ceilVal = activeModelSnapshot?.cloudCeilingFt ?? 2200;
  const ceilStatus =
    ceilVal < preset.minCloudCeilingFt
      ? 'HOLD'
      : ceilVal < preset.minCloudCeilingFt + 350
      ? 'CAUTION'
      : 'GO';

  const visVal = activeModelSnapshot?.visibilityKm ?? weather.visibilityKm ?? 10;
  const visStatus =
    visVal < preset.minVisibilityKm
      ? 'HOLD'
      : visVal < preset.minVisibilityKm + 2.0
      ? 'CAUTION'
      : 'GO';

  const freezeVal = activeModelSnapshot?.freezingLevelFt ?? 4000;
  const precipVal = activeModelSnapshot?.precipMmHr ?? 0;
  const icingActive =
    freezeVal > 0 &&
    freezeVal < preset.minIcingFreezingLevelFt &&
    (ceilVal < 2500 || precipVal > 0.2);
  const iceStatus =
    icingActive && freezeVal < 1000 ? 'HOLD' : icingActive ? 'CAUTION' : 'GO';

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-y-auto p-4 sm:p-5 space-y-4">
      <div className={isFullScreen ? 'max-w-6xl mx-auto w-full space-y-4' : 'space-y-4'}>
        {/* Header, Full-Screen Expand Toggle & Refresh */}
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] font-mono text-cyan-400">
              7-DAY MULTI-MODEL FLIGHT LIMITS · {facility.code}
            </div>
            <h3 className="text-base sm:text-lg font-bold text-white truncate">
              {facility.name}
            </h3>
            <div className="text-xs text-slate-400">
              {facility.fieldOperator} · {facility.assetType} · Base {shoreBaseFacility.code}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleFullScreen && (
              <button
                onClick={onToggleFullScreen}
                title={
                  isFullScreen
                    ? 'Switch back to Split Radar Map + Weather View'
                    : 'Expand Weather & 7-Day Limits to Full Screen'
                }
                className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-300 text-xs font-semibold cursor-pointer"
              >
                {isFullScreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" />
                    Split Map + WX
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" />
                    Full Screen WX
                  </>
                )}
              </button>
            )}
            <button
              onClick={onRefresh}
              title="Refresh 7-Day ICON / ECMWF / GFS / GEM & Aviation METAR/TAF"
              className="min-w-[40px] min-h-[40px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-center text-slate-300 cursor-pointer shrink-0"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  loading || ensembleLoading ? 'animate-spin text-cyan-400' : ''
                }`}
              />
            </button>
          </div>
        </div>

      {/* 1. 7-DAY CREW-CHANGE FLIGHT DELAY PLANNER (Click Monday, Tuesday, etc.) */}
      {daySummaries.length > 0 && (
        <div className="p-3 bg-slate-900/95 border border-cyan-500/35 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-cyan-400" />
              7-Day Crew-Change Outlook (Tap Any Day, e.g. Mon)
            </span>
            {selectedHourIdx > 0 && (
              <button
                onClick={() => onChangeSelectedHourIdx(0)}
                className="text-[10px] font-mono text-cyan-400 hover:underline cursor-pointer"
              >
                Back to Live NOW
              </button>
            )}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {daySummaries.slice(0, 7).map((day) => {
              const isSelectedDay = day.dayKey === activeDayKey;
              const pillClr =
                day.overallStatus === 'HOLD'
                  ? 'border-rose-500/60 bg-rose-950/40 text-rose-300'
                  : day.overallStatus === 'CAUTION'
                  ? 'border-amber-500/60 bg-amber-950/40 text-amber-300'
                  : 'border-emerald-500/50 bg-emerald-950/30 text-emerald-300';

              return (
                <button
                  key={day.dayKey}
                  onClick={() => onChangeSelectedHourIdx(day.representativeHourIndex)}
                  className={`p-1.5 rounded-lg border flex flex-col items-center justify-between text-center transition-all cursor-pointer ${
                    isSelectedDay
                      ? 'ring-2 ring-cyan-400 bg-slate-800 border-cyan-400'
                      : pillClr
                  }`}
                >
                  <span className="text-[10px] font-bold text-white leading-tight">
                    {day.dayNameShort}
                  </span>
                  <span className="text-[8px] font-mono text-slate-400 leading-tight">
                    {day.dateShort}
                  </span>
                  <span
                    className={`mt-1 px-1 py-0.2 rounded text-[8px] font-mono font-bold ${
                      day.overallStatus === 'HOLD'
                        ? 'bg-rose-500 text-white'
                        : day.overallStatus === 'CAUTION'
                        ? 'bg-amber-400 text-slate-950'
                        : 'bg-emerald-500 text-slate-950'
                    }`}
                  >
                    {day.overallStatus}
                  </span>
                  <span className="text-[8px] font-mono text-slate-300 mt-0.5 tabular-nums">
                    {day.maxGustKts}kt
                  </span>
                  <span className="text-[8px] font-mono text-cyan-300 tabular-nums">
                    {day.maxWaveM}m
                  </span>
                </button>
              );
            })}
          </div>

          {/* Selected Day Summary & Hour-by-Hour Scrubber for that Day */}
          {activeDaySummary && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-cyan-300">
                  {activeDaySummary.dayNameFull} ({activeDaySummary.dateShort}) ·{' '}
                  <span className="font-mono text-white">{activeHour?.hourLabel} UTC</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Daytime: {activeDaySummary.goHoursCount}h GO ·{' '}
                  {activeDaySummary.cautionHoursCount}h CAUT ·{' '}
                  {activeDaySummary.holdHoursCount}h HOLD
                </span>
              </div>

              {/* Clickable Hour Strip for Selected Day (e.g. Monday 00:00 -> 23:00) */}
              <div className="grid grid-cols-8 sm:grid-cols-12 gap-1">
                {activeDayHours.map((hr) => {
                  const snap = hr.models[weatherModelId];
                  const isSelHr = hr.hourIndex === selectedHourIdx;
                  const badgeClr =
                    snap?.status === 'HOLD'
                      ? 'bg-rose-500/85 text-white'
                      : snap?.status === 'CAUTION'
                      ? 'bg-amber-400 text-slate-950'
                      : 'bg-emerald-500/80 text-slate-950';
                  return (
                    <button
                      key={hr.hourIso}
                      onClick={() => onChangeSelectedHourIdx(hr.hourIndex)}
                      className={`py-1 rounded text-[9px] font-mono font-bold flex flex-col items-center cursor-pointer border ${
                        isSelHr
                          ? 'border-white ring-2 ring-cyan-300 scale-105'
                          : 'border-transparent opacity-80 hover:opacity-100'
                      } ${badgeClr}`}
                    >
                      <span>{hr.hourLabel.slice(0, 2)}h</span>
                      <span className="text-[8px]">{snap?.windGust10mKts}k</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Airframe Operating Limit Preset Selector (S-92A | H175 | AW139 | H160) */}
      <div className="p-2.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono">
          <span className="text-cyan-400 font-semibold">
            HELICOPTER OPERATING LIMITS PRESET:
          </span>
          <span className="text-slate-400">
            Gust {preset.maxHelideckGustKts}kt · FPSO Hs {preset.maxFpsoWaveHeightM}m
          </span>
        </div>
        <div className="grid grid-cols-4 gap-1.5">
          {(['S92', 'H175', 'AW139', 'H160'] as AirframePresetId[]).map((id) => {
            const p = AIRFRAME_PRESETS[id];
            const isSel = airframePresetId === id;
            return (
              <button
                key={id}
                onClick={() => onChangeAirframePresetId(id)}
                className={`py-1.5 px-2 rounded text-xs font-mono font-semibold transition-colors cursor-pointer ${
                  isSel
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800'
                }`}
              >
                {p.id}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Dynamic Go / No-Go Verdict & 5-Point Operating Limits Checklist */}
      <div className={`p-3 rounded-lg border ${statusColor} space-y-2.5`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-semibold text-sm">
            {currentStatus === 'GO' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {currentStatus === 'CAUTION' && (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            {currentStatus === 'HOLD' && <ShieldAlert className="w-4 h-4 shrink-0" />}
            <span>
              {facility.shortName} ({activeHour?.dayNameShort || 'NOW'}{' '}
              {activeHour?.hourLabel || ''}):{' '}
              {currentStatus === 'GO'
                ? 'WITHIN LIMITS (GO)'
                : currentStatus === 'CAUTION'
                ? 'MARGINAL (DELAY RISK)'
                : 'OUT OF LIMITS (NO-GO / HOLD)'}
            </span>
          </div>
          <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-black/30">
            {WEATHER_MODELS_META.find((m) => m.id === weatherModelId)?.shortName}
          </span>
        </div>
        <p className="text-xs opacity-95">{currentReason}</p>

        {/* 5-Row Operating Limits Pass/Fail Breakdown */}
        <div className="grid grid-cols-1 gap-1 pt-1.5 border-t border-white/10 font-mono text-[11px]">
          {[
            {
              label: '1. Helideck Wind & Gusts',
              actual: `${activeModelSnapshot?.windSpeed10mKts ?? weather.windSpeedKts}G${gustVal} kt`,
              limit: `Max ${preset.maxHelideckGustKts} kt`,
              st: gustStatus,
            },
            {
              label: isFpso
                ? '2. FPSO Sea State / Pitch-Roll (Hs)'
                : '2. Significant Wave Height (Hs)',
              actual: `${waveVal} m (${activeHour?.swellPeriodSec ?? weather.swellPeriodSec}s)`,
              limit: isFpso ? `Max ${preset.maxFpsoWaveHeightM} m` : 'Max 6.5 m',
              st: waveStatus,
            },
            {
              label: '3. Cloud Ceiling (ARA Minima)',
              actual: `${ceilVal.toLocaleString()} ft`,
              limit: `Min ${preset.minCloudCeilingFt} ft`,
              st: ceilStatus,
            },
            {
              label: '4. Horizontal Visibility',
              actual: `${visVal} km`,
              limit: `Min ${preset.minVisibilityKm} km`,
              st: visStatus,
            },
            {
              label: '5. 0°C Rotor Icing Altitude',
              actual: `${freezeVal.toLocaleString()} ft`,
              limit: `Safe > ${preset.minIcingFreezingLevelFt} ft`,
              st: iceStatus,
            },
          ].map((item, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between px-2 py-1 rounded bg-slate-950/75 text-slate-200"
            >
              <span className="truncate pr-2">{item.label}</span>
              <div className="flex items-center gap-2 shrink-0 tabular-nums">
                <span className="text-white font-bold">{item.actual}</span>
                <span className="text-slate-400 text-[10px]">({item.limit})</span>
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                    item.st === 'GO'
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : item.st === 'CAUTION'
                      ? 'bg-amber-500/25 text-amber-300'
                      : 'bg-rose-500/30 text-rose-300'
                  }`}
                >
                  {item.st === 'GO' ? 'PASS' : item.st}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* 1-Tap Launch Animated Streamlines on Radar Map */}
        <div className="pt-1.5 border-t border-white/10 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-mono uppercase opacity-80 flex items-center gap-1">
            <CloudRainWind className="w-3 h-3" /> Map Streamlines:
          </span>
          {(
            [
              { id: 'go_nogo_matrix', label: 'Go/No-Go Matrix' },
              { id: 'wind_950hpa', label: '950hPa (1,800ft) Wind' },
              { id: 'wave_swell', label: 'Waves (Hs)' },
              { id: 'freezing_icing', label: '0°C Icing' },
            ] as Array<{ id: WeatherOverlayMode; label: string }>
          ).map((btn) => (
            <button
              key={btn.id}
              onClick={() => {
                onChangeWeatherOverlayMode(btn.id);
                onSwitchToMapWithOverlay(btn.id);
              }}
              className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors cursor-pointer ${
                weatherOverlayMode === btn.id
                  ? 'bg-cyan-400 text-slate-950 font-bold'
                  : 'bg-slate-950/80 hover:bg-slate-900 text-cyan-300 border border-slate-700'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. 4-Model Ensemble Cross-Reference Table (Do ICON, ECMWF, GFS & GEM Agree?) */}
      {activeHour && (
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-amber-400" />
              4-Model Agreement ({activeHour.dayNameShort} {activeHour.dateShort} ·{' '}
              {activeHour.hourLabel} UTC)
            </span>
            <span className="text-[10px] font-mono text-emerald-400">
              TAP MODEL TO SWITCH
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-mono text-[11px]">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 text-[10px]">
                  <th className="py-1.5 pr-2">Model</th>
                  <th className="py-1.5 pr-2">10m Wind</th>
                  <th className="py-1.5 pr-2">950hPa (1.8k ft)</th>
                  <th className="py-1.5 pr-2">0°C Ice</th>
                  <th className="py-1.5 text-right">{preset.id}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {WEATHER_MODELS_META.map((mod) => {
                  const snap = activeHour.models[mod.id];
                  const isActiveMod = weatherModelId === mod.id;
                  return (
                    <tr
                      key={mod.id}
                      onClick={() => onChangeWeatherModelId(mod.id)}
                      className={`cursor-pointer transition-colors ${
                        isActiveMod ? 'bg-slate-800/90' : 'hover:bg-slate-950/60'
                      }`}
                    >
                      <td className="py-1.5 pr-2">
                        <div className="font-bold text-white flex items-center gap-1">
                          {isActiveMod && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                          )}
                          {mod.shortName}
                        </div>
                        <div className="text-[9px] text-slate-400">{mod.resolution}</div>
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-slate-200">
                        {snap.windSpeed10mKts}G
                        <span
                          className={
                            snap.windGust10mKts >= preset.cautionGustKts
                              ? 'text-amber-400 font-bold'
                              : 'text-white'
                          }
                        >
                          {snap.windGust10mKts}
                        </span>
                        kt
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums text-cyan-300">
                        {snap.windSpeed950hPaKts}kt @ {snap.windDir950hPaDeg}°
                      </td>
                      <td className="py-1.5 pr-2 tabular-nums">
                        <span
                          className={
                            snap.freezingLevelFt <= 3000
                              ? 'text-purple-300 font-bold'
                              : 'text-slate-300'
                          }
                        >
                          {snap.freezingLevelFt.toLocaleString()}ft
                        </span>
                      </td>
                      <td className="py-1.5 text-right">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                            snap.status === 'GO'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : snap.status === 'CAUTION'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-rose-500/25 text-rose-300 border border-rose-500/50'
                          }`}
                        >
                          {snap.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Shore-to-Rig Flight Corridor Altitude Profile (10m | 950hPa | 850hPa + Headwind/Icing) */}
      {corridorWaypoints.length > 0 && (
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              Route Corridor ({shoreBaseFacility.code} → {facility.code} ·{' '}
              {activeHour?.dayNameShort} {activeHour?.hourLabel})
            </span>
            <span className="text-[10px] font-mono text-slate-400">
              10m · 950hPa · 850hPa
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2 font-mono text-[11px]">
            {corridorWaypoints.map((wp, idx) => (
              <div
                key={idx}
                className="p-2 rounded bg-slate-950 border border-slate-800 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-cyan-400 font-bold truncate">
                    {idx + 1}. {wp.distanceFromShoreNm} NM
                  </span>
                  <span
                    className={`text-[9px] px-1 rounded font-bold ${
                      wp.status === 'GO'
                        ? 'text-emerald-400 bg-emerald-950'
                        : wp.status === 'CAUTION'
                        ? 'text-amber-400 bg-amber-950'
                        : 'text-rose-400 bg-rose-950'
                    }`}
                  >
                    {wp.status}
                  </span>
                </div>
                <div className="text-[10px] text-white font-sans font-semibold truncate">
                  {wp.label}
                </div>
                <div className="text-[10px] text-slate-300 tabular-nums">
                  10m:{' '}
                  <strong className="text-white">
                    {wp.windSpeed10mKts}G{wp.windGust10mKts}kt
                  </strong>
                </div>
                <div className="text-[10px] text-cyan-300 tabular-nums">
                  950hPa: <strong>{wp.windSpeed950hPaKts}kt</strong> ({wp.windDir950hPaDeg}°)
                </div>
                <div className="text-[10px] text-slate-400 tabular-nums">
                  850hPa: {wp.windSpeed850hPaKts}kt
                </div>
                <div className="text-[10px] pt-0.5 border-t border-slate-800/80 flex items-center justify-between">
                  <span
                    className={
                      wp.headwind950Kts > 0 ? 'text-amber-300' : 'text-emerald-300'
                    }
                  >
                    {wp.headwind950Kts >= 0
                      ? `HW +${wp.headwind950Kts}kt`
                      : `TW ${Math.abs(wp.headwind950Kts)}kt`}
                  </span>
                  <span
                    className={
                      wp.freezingLevelFt <= 2200
                        ? 'text-rose-400 font-bold'
                        : wp.freezingLevelFt <= 3200
                        ? 'text-purple-300'
                        : 'text-slate-400'
                    }
                  >
                    0°C {wp.freezingLevelFt}ft
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Ventusky-Level Atmospheric & Marine Telemetry Grid */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>10m Surface Wind</span>
            <Wind className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-mono font-bold tabular-nums text-white mt-1">
            {activeModelSnapshot?.windSpeed10mKts ?? weather.windSpeedKts}{' '}
            <span className="text-xs font-normal text-slate-400">G</span>{' '}
            <span
              className={
                gustVal >= preset.cautionGustKts ? 'text-amber-400' : 'text-white'
              }
            >
              {gustVal}
            </span>{' '}
            <span className="text-xs font-normal text-slate-400">KT</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            Dir{' '}
            {String(
              activeModelSnapshot?.windDir10mDeg ?? weather.windDirectionDeg
            ).padStart(3, '0')}
            ° · 950hPa {activeModelSnapshot?.windSpeed950hPaKts ?? 25}kt
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Significant Wave (Hs)</span>
            <Waves className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="text-xl font-mono font-bold tabular-nums text-white mt-1">
            {waveVal} <span className="text-xs font-normal text-slate-400">m</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            Period {activeHour?.swellPeriodSec ?? weather.swellPeriodSec}s · SST{' '}
            {activeHour?.seaSurfaceTempC ?? weather.temperatureC}°C
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>0°C Freezing & Temp</span>
            <Snowflake className="w-3.5 h-3.5 text-purple-400" />
          </div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            {freezeVal.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ft</span> ·{' '}
            {activeModelSnapshot?.temp2mC ?? weather.temperatureC}°C
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            950hPa Temp {activeModelSnapshot?.temp950hPaC ?? 4.0}°C · Precip{' '}
            {precipVal}mm/h
          </div>
        </div>

        <div className="p-3 bg-slate-900/90 border border-slate-800 rounded-lg">
          <div className="text-xs text-slate-400">Ceiling, Vis & QNH</div>
          <div className="text-lg font-mono font-bold tabular-nums text-white mt-1">
            {ceilVal.toLocaleString()}{' '}
            <span className="text-xs font-normal text-slate-400">ft</span> · {visVal}{' '}
            <span className="text-xs font-normal text-slate-400">km</span>
          </div>
          <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-0.5">
            QNH {activeModelSnapshot?.qnhHpa ?? weather.pressureMslHpa ?? 1013} hPa · Elev{' '}
            {facility.elevationFt}ft
          </div>
        </div>
      </div>

      {/* 7. Live Shore Base METAR / TAF & Fog / Haar Delay Predictor */}
      <div className={`p-3 rounded-lg border ${delayColor} space-y-2`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <CloudFog className="w-4 h-4 text-cyan-400 shrink-0" />
            <span>
              SHORE BASE ({weather.shoreBaseIcao}) LIVE METAR:{' '}
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
      </div>

      {/* Helideck Hardware Specs & Live Data Source Verification */}
      <div className="p-3.5 bg-slate-900/90 border border-slate-800 rounded-lg space-y-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-white flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-cyan-400" />
            Meteorological Models & Helideck Specs
          </span>
          <span className="font-mono text-[10px] text-emerald-400">7-DAY GRIB FEEDS</span>
        </div>

        <p className="text-[11px] text-slate-400 leading-relaxed">
          <strong>Live Meteorological Sources:</strong> DWD <strong>ICON-EU</strong> (6.5 km),{' '}
          <strong>ECMWF IFS</strong> (9 km Open Data), NOAA <strong>GFS</strong> (0.25°), ECCC{' '}
          <strong>GEM</strong> (15 km), and WaveWatch III / Copernicus Marine queried live at{' '}
          {facility.lat.toFixed(2)}°N, {facility.lon.toFixed(2)}°E.
        </p>
      </div>
      </div>
    </div>
  );
};
