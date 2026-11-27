import { useSyncExternalStore } from 'react';
import { getWeatherStaleSince, subscribeWeatherStale } from '../services/weatherFetch';

/** "Couldn't reach the weather service. Showing the forecast from 14:20." Shown only while an older copy is in use. */
export function WeatherStaleNote({ className = '' }: { className?: string }) {
  const since = useSyncExternalStore(subscribeWeatherStale, getWeatherStaleSince, () => null);
  if (since === null) return null;
  const d = new Date(since);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const when = sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return (
    <div role="status" className={`rounded-md border border-amber-500/40 bg-amber-950/40 px-2.5 py-1.5 text-[11.5px] leading-snug text-amber-200 ${className}`}>
      Couldn't reach the weather service just now. Showing the forecast from {when}; it updates by itself.
    </div>
  );
}
