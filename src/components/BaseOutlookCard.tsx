import React, { useEffect, useMemo, useState } from 'react';
import { Mountain, Moon, Sun } from 'lucide-react';
import type { HelideckWeatherState, InstallationOrAirport, MultiModelHourEntry, WeatherModelId } from '../types/radar';
import { fetchTerrainAroundBase } from '../services/multiModelWeatherService';
import {
  buildBaseOutlook,
  summariseBaseOutlook,
  type BaseOutlookLevel,
  type ReportedNow,
  type TerrainSummary,
} from '../utils/baseOutlook';
import { parseMetarCloudBase, parseMetarWindVis } from '../utils/solarAndMetUtils';

/** Asset types that are bases or airfields rather than offshore helidecks. */
export const SHORE_BASE_ASSET_TYPES = new Set<InstallationOrAirport['assetType']>([
  'Shore Heliport',
  'SAR Base',
  'UK Airport',
  'Norwegian Hub',
  'Hospital Helipad',
]);

interface BaseOutlookCardProps {
  facility: InstallationOrAirport;
  hourlyForecast: MultiModelHourEntry[];
  weatherModelId: WeatherModelId;
  modelShortName: string;
  weather: HelideckWeatherState | null;
}

const LEVEL_STYLE: Record<BaseOutlookLevel, { chip: string; label: string }> = {
  GOOD: { chip: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300', label: 'Good' },
  MARGINAL: { chip: 'bg-amber-400/15 border-amber-400/40 text-amber-300', label: 'Marginal' },
  POOR: { chip: 'bg-rose-500/15 border-rose-500/40 text-rose-300', label: 'Poor' },
};

const pad3 = (deg: number) => String(Math.round(((deg % 360) + 360) % 360) || 360).padStart(3, '0');

export const BaseOutlookCard: React.FC<BaseOutlookCardProps> = ({
  facility,
  hourlyForecast,
  weatherModelId,
  modelShortName,
  weather,
}) => {
  const [terrain, setTerrain] = useState<TerrainSummary | null>(null);
  const [terrainState, setTerrainState] = useState<'loading' | 'ok' | 'failed'>('loading');
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTerrainState('loading');
    setTerrain(null);
    fetchTerrainAroundBase(facility.lat, facility.lon)
      .then((t) => {
        if (cancelled) return;
        setTerrain(t);
        setTerrainState(t ? 'ok' : 'failed');
      })
      .catch(() => {
        if (!cancelled) setTerrainState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [facility.lat, facility.lon]);

  // The base's own METAR replaces the model for the current hour while it is under 90 minutes old
  const reportedNow = useMemo<ReportedNow | null>(() => {
    if (!weather?.rawMetar || weather.shoreBaseIcao !== facility.code) return null;
    if (typeof weather.metarTime !== 'number' || Date.now() - weather.metarTime > 90 * 60_000) return null;
    const cloud = parseMetarCloudBase(weather.rawMetar);
    const wv = parseMetarWindVis(weather.rawMetar);
    if (!cloud && !wv) return null;
    return {
      ceilingFt: cloud ? cloud.ceilingFt : null,
      visibilityKm: wv?.visibilityKm ?? null,
      windKts: wv?.windSpeedKts ?? null,
      gustKts: wv?.windGustKts ?? null,
      windDirDeg: wv?.windDirDeg ?? null,
    };
  }, [weather?.rawMetar, weather?.shoreBaseIcao, weather?.metarTime, facility.code]);

  const hillsFt = terrain ? terrain.highest.heightFt : null;

  const rows = useMemo(
    () =>
      buildBaseOutlook({
        hourly: hourlyForecast,
        modelId: weatherModelId,
        lat: facility.lat,
        lon: facility.lon,
        baseElevationFt: facility.elevationFt || 0,
        hillsFt,
        nowMs: Date.now(),
        hours: 48,
        stepHours: 3,
        reportedNow,
      }),
    [hourlyForecast, weatherModelId, facility.lat, facility.lon, facility.elevationFt, hillsFt, reportedNow]
  );

  const summary = useMemo(() => summariseBaseOutlook(rows), [rows]);
  const visibleRows = showAll ? rows : rows.slice(0, 8);

  return (
    <div className="p-3 bg-slate-900/90 border border-cyan-500/30 rounded-xl space-y-2.5 min-w-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="text-xs font-bold text-cyan-300 tracking-wide">
          BASE OUTLOOK · NEXT 48 H · {facility.code}
        </div>
        <div className="text-[10px] font-mono text-slate-400">Estimate · {modelShortName} · times UTC</div>
      </div>

      {rows.length > 0 && <div className="text-sm text-slate-100 leading-snug">{summary}</div>}

      <div className="flex items-start gap-2 text-[11px] text-slate-300 leading-snug">
        <Mountain className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
        {terrainState === 'loading' && <span>Checking the hills around the base…</span>}
        {terrainState === 'failed' && (
          <span>Hill heights unavailable right now, so cloud is only compared with the airfield.</span>
        )}
        {terrainState === 'ok' && terrain && (
          <span>
            Highest ground within 25 NM:{' '}
            <span className="font-semibold text-white">{terrain.highest.heightFt.toLocaleString()} ft</span>,{' '}
            {terrain.highest.distanceNm} NM {terrain.highest.direction}
            {terrain.highestWithin10Nm.heightFt < terrain.highest.heightFt && (
              <>
                {' '}
                · within 10 NM: {terrain.highestWithin10Nm.heightFt.toLocaleString()} ft{' '}
                {terrain.highestWithin10Nm.direction}
              </>
            )}
            <span className="block text-slate-500">
              By direction:{' '}
              {terrain.bySector.map((s) => `${s.sector} ${s.heightFt.toLocaleString()}`).join(' · ')} ft
            </span>
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="text-xs text-slate-400">Waiting for the forecast…</div>
      ) : (
        <ul className="divide-y divide-slate-800 border-y border-slate-800">
          {visibleRows.map((r) => {
            const style = LEVEL_STYLE[r.level];
            const cloudText =
              r.ceilingFt === null
                ? 'No low ceiling'
                : `Cloud ${r.ceilingFt.toLocaleString()} ft${r.reported ? ' (METAR)' : ''}`;
            return (
              <li key={r.hourIso} className="py-1.5 space-y-0.5 min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono">
                  <span className="text-slate-200 whitespace-nowrap shrink-0 flex items-center gap-1">
                    {r.isNight ? (
                      <Moon className="w-3 h-3 text-indigo-300" />
                    ) : (
                      <Sun className="w-3 h-3 text-amber-300" />
                    )}
                    {r.dayNameShort} {r.hourLabel}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${style.chip}`}>
                    {style.label}
                  </span>
                  <span className={r.hillsInCloud ? 'text-amber-300' : 'text-slate-300'}>
                    {cloudText}
                    {r.hillsInCloud ? ', hills in cloud' : ''}
                  </span>
                  <span className="text-slate-400">Freezing {r.freezingLevelFt.toLocaleString()} ft</span>
                  <span className="text-slate-400">Vis {r.visibilityKm} km</span>
                  <span className="text-slate-300">
                    {pad3(r.windDirDeg)}/{r.windKts}
                    {r.gustKts > r.windKts + 2 ? `G${r.gustKts}` : ''} kt
                  </span>
                  <span className="text-slate-400">
                    1,500 ft {pad3(r.wind1500ftDirDeg)}/{r.wind1500ftKts}
                  </span>
                  {r.precipMmHr >= 0.1 && <span className="text-sky-300">Rain {r.precipMmHr} mm/h</span>}
                  {r.isNight && r.moonPercent !== null && (
                    <span className="text-indigo-300">
                      Moon {r.moonUp ? `up, ${r.moonPercent}% lit` : 'down'}
                    </span>
                  )}
                </div>
                {(() => {
                  // "hills in cloud" is already shown next to the cloud base
                  const extra = r.reasons.filter((x) => !x.startsWith('hills ('));
                  return extra.length > 0 ? (
                    <div className="text-[11px] text-slate-400">{extra.join(' · ')}</div>
                  ) : null;
                })()}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 8 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-[11px] font-semibold text-cyan-300 hover:text-cyan-200 cursor-pointer"
        >
          {showAll ? 'Show next 24 h only' : 'Show the full 48 h'}
        </button>
      )}

      <div className="text-[10px] text-slate-500 leading-snug">
        ChopperCheck&apos;s own rough guide from forecast models and 90 m terrain data, not SAR or operator
        limits. Cloud over the hills is often lower than at the airfield, and real summits can be a little
        higher than the terrain data. Use the official briefing for the actual flight.
      </div>
    </div>
  );
};
