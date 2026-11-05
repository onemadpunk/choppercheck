import { AircraftTarget } from '../types/radar';
export const reported = (known: boolean | undefined, n: number, suffix = '') => known === false ? 'Unavailable' : n.toLocaleString('en-GB') + suffix;
export const coordinate = (n: number, latitude: boolean, digits = 4) => Math.abs(n).toFixed(digits) + '°' + (latitude ? n < 0 ? 'S' : 'N' : n < 0 ? 'W' : 'E');
export function positionLabel(flight: AircraftTarget, now = Date.now()): string {
  if (flight.observedAt === undefined) return 'Position age unknown';
  const age = Math.max(0, Math.floor((now - flight.observedAt) / 1000));
  return (age > 10 ? 'Last known position' : flight.source === 'dead_reckoning' ? 'Estimated position' : 'Reported position') + ' · report ' + age + 's ago';
}
export function routeLabel(flight: AircraftTarget): string {
  return flight.originCode === 'Unknown' || flight.destinationCode === 'Unknown' ? 'Route not reported' : flight.originCode + ' → ' + flight.destinationCode;
}
