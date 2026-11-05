import React from 'react';
import { HelideckWeatherState, InstallationOrAirport } from '../types/radar';
import { RefreshCw } from 'lucide-react';
const value = (n: number | null, unit: string) => n === null ? 'Unavailable' : n.toFixed(1) + ' ' + unit;
const time = (n: number | null) => n === null ? 'Unavailable' : new Date(n).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
export const HelideckWeatherPanel: React.FC<{ facility: InstallationOrAirport; weather: HelideckWeatherState | null; loading: boolean; onRefresh: () => void }> = ({ facility, weather, loading, onRefresh }) => {
  const tiles = weather ? [
    ['Wind (10 m model)', value(weather.windSpeedKts, 'kt')], ['Gusts (model)', value(weather.windGustKts, 'kt')],
    ['Wind direction (model)', value(weather.windDirectionDeg, '°')], ['Temperature (model)', value(weather.temperatureC, '°C')],
    ['Visibility (model)', value(weather.visibilityKm, 'km')], ['Mean sea-level pressure (model)', value(weather.pressureMslHpa, 'hPa')],
    ['Significant wave height (model)', value(weather.significantWaveHeightM, 'm')], ['Mean wave period (model)', value(weather.swellPeriodSec, 's')],
  ] : [];
  return <div className="h-full overflow-y-auto p-4 space-y-4 text-slate-200 text-sm bg-slate-950">
    <div className="flex justify-between items-start gap-2"><div><p className="text-xs text-cyan-400">WEATHER & MARINE MODELS</p><h3 className="font-bold text-white">{facility.name}</h3></div>
      <button onClick={onRefresh} disabled={loading} aria-label="Refresh weather" className="p-3 bg-slate-800 rounded-lg disabled:opacity-50"><RefreshCw className={loading ? 'w-4 h-4 animate-spin' : 'w-4 h-4'} /></button></div>
    <p className="text-xs text-amber-200 bg-amber-950/30 border border-amber-800/60 rounded-lg p-3">Model estimates at this location. Helideck sensors, cloud ceiling, operating limits and landing clearance are unavailable. Confirm travel and check-in with your operator.</p>
    {loading && !weather && <p>Loading weather sources…</p>}
    <div className="grid grid-cols-2 gap-2">{tiles.map(([label, val]) => <div key={label} className="p-3 bg-slate-900 border border-slate-800 rounded-lg"><p className="text-xs text-slate-400">{label}</p><p className="font-mono font-semibold mt-1">{val}</p></div>)}</div>
    <div className="text-xs text-slate-400 space-y-1"><p>Weather model valid: {time(weather?.weatherTime ?? null)}</p><p>Wave model valid: {time(weather?.marineTime ?? null)}</p><p>These are forecast model values, not measured deck conditions.</p></div>
    {weather?.shoreBaseIcao && <section className="p-3 rounded-lg border border-slate-800 bg-slate-900 space-y-2"><h4 className="font-semibold">Shore airport report — {weather?.shoreBaseIcao || facility.primaryShoreBase}</h4>
      <p className="text-xs text-slate-400">This airport report describes the shore base, not the selected offshore installation.</p>
      {weather?.rawMetar ? <><p className="text-xs text-slate-400">METAR observation: {time(weather.metarTime)}{weather.metarTime && Date.now() - weather.metarTime > 2 * 3600_000 ? ' — OLD REPORT' : ''}</p><pre className="whitespace-pre-wrap break-words text-xs text-cyan-300">{weather.rawMetar}</pre>
      {weather.flightCategory && <p className="text-xs">Reported category: {weather.flightCategory}</p>}</> : <p className="text-xs">METAR unavailable. No substitute report has been generated.</p>}
      <h4 className="font-semibold text-xs pt-2">Shore airport TAF</h4>{weather?.rawTaf ? <pre className="whitespace-pre-wrap break-words text-xs">{weather.rawTaf}</pre> : <p className="text-xs">TAF unavailable.</p>}
      <a className="text-xs text-cyan-400 underline inline-block" href={'https://aviationweather.gov/data/metar/?id=' + (weather?.shoreBaseIcao || facility.primaryShoreBase)} target="_blank" rel="noopener noreferrer">View Aviation Weather Center</a></section>}
    <p className="text-xs text-slate-400">Forecast data: <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer" className="underline text-cyan-400">Open-Meteo</a>, combining national weather-service models. <a href="https://open-meteo.com/en/docs/marine-weather-api" target="_blank" rel="noopener noreferrer" className="underline text-cyan-400">Marine sources</a>. Airport reports: NOAA Aviation Weather Center.</p>
    <p className="text-xs text-slate-400">Directory coordinates are reference locations. FPSOs and other mobile assets may move; no live vessel position or helideck certification is provided.</p>
  </div>;
};
