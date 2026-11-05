import React, { useState } from 'react';
import { AircraftTarget, InstallationOrAirport } from '../types/radar';
import { buildFlightShareText, getWhatsAppShareUrl, playCockpitAlertChime } from '../utils/alertsAndShare';
import { coordinate, positionLabel, reported } from '../utils/dataQuality';
import { OperatorStatusLinks } from './OperatorStatusLinks';
import { Bell, Compass, Copy, Pin, Share2, Volume2, X } from 'lucide-react';
interface Props {
  flight: AircraftTarget; activeFacility: InstallationOrAirport; isPinned: boolean;
  onTogglePin: (hex: string) => void; alertsEnabled: boolean; onToggleAlerts: () => void;
  onClose?: () => void; onCenterOnFlight: (flight: AircraftTarget) => void;
}
export const FlightDossierPanel: React.FC<Props> = ({ flight, activeFacility, isPinned, onTogglePin, alertsEnabled, onToggleAlerts, onClose, onCenterOnFlight }) => {
  const [copied, setCopied] = useState(false);
  const trail = flight.trail;
  const maxAlt = Math.max(4000, ...trail.map(t => t.altFt));
  const points = trail.map((pt, i) => ((i / Math.max(1, trail.length - 1)) * 280).toFixed(1) + ',' + (58 - Math.min(52, pt.altFt / maxAlt * 50)).toFixed(1)).join(' ');
  const copy = async () => { try { await navigator.clipboard.writeText(buildFlightShareText(flight, activeFacility.code)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } };
  return <div className="bg-slate-900 border border-slate-800 rounded-lg p-3.5 space-y-3 text-slate-200 text-xs">
    <div className="flex justify-between items-start gap-2"><div className="min-w-0"><p className="text-cyan-400">{positionLabel(flight)}</p><h3 className="text-base font-bold text-white truncate">{flight.callsign} · {flight.typeFullName}</h3><p className="text-slate-400 mt-1">Reg {flight.registration} · Type {flight.typeCode} · Hex {flight.hex}</p><p className="text-slate-400">{flight.operator}</p></div>
    <div className="flex gap-1 shrink-0"><button onClick={() => onTogglePin(flight.hex)} className={'p-2 rounded bg-slate-800 ' + (isPinned ? 'text-amber-300' : '')} aria-label={isPinned ? 'Unpin flight' : 'Pin flight'}><Pin className="w-4 h-4" /></button>{onClose && <button onClick={onClose} aria-label="Close flight details" className="p-2 bg-slate-800 rounded"><X className="w-4 h-4" /></button>}</div></div>
    <p className="text-[11px] text-slate-400">Source: {flight.provider || 'ADS-B'} · {flight.observedAt ? new Date(flight.observedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Observation time unavailable'}. Position estimates stop 10 seconds after the report; targets expire at 45 seconds.</p>
    <div className="p-2.5 bg-slate-950 rounded border border-slate-800"><p className="text-slate-300">Route, departure time and arrival time are not supplied by this position feed.</p>{flight.category === 'coastguard_sar' && <p className="text-slate-400 mt-1">Coastguard identity does not confirm an active rescue mission.</p>}</div>
    <div className="grid grid-cols-4 gap-2 border-t border-slate-800 pt-3">
      <div><p className="text-slate-400">Reported altitude</p><p className="font-mono text-white">{reported(flight.altitudeReported, flight.altitudeFt, ' ft')}</p><p className="text-slate-400 mt-1">{reported(flight.verticalRateReported, flight.verticalRateFpm, ' fpm')}</p></div>
      <div><p className="text-slate-400">Groundspeed</p><p className="font-mono text-white">{reported(flight.speedReported, flight.groundSpeedKts, ' kt')}</p></div>
      <div><p className="text-slate-400">Track</p><p className="font-mono text-white">{reported(flight.trackReported, flight.trackDeg, '°')}</p><p className="text-slate-400 mt-1">Sq {flight.squawk}</p></div>
      <div><p className="text-slate-400">From {activeFacility.code}</p><p className="font-mono text-cyan-300">{flight.distanceFromRefNm} NM</p><p className="text-slate-400 mt-1">{flight.bearingFromRefDeg}°</p></div>
    </div>
    <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-3"><button onClick={onToggleAlerts} className="flex gap-1 items-center bg-slate-800 p-2 rounded"><Bell className="w-3.5 h-3.5" />{alertsEnabled ? 'Page alerts on' : 'Page alerts off'}</button><button onClick={() => playCockpitAlertChime(false)} aria-label="Test alert sound" className="bg-slate-800 p-2 rounded"><Volume2 className="w-4 h-4" /></button><a href={getWhatsAppShareUrl(flight, activeFacility.code)} target="_blank" rel="noopener noreferrer" className="flex gap-1 items-center bg-emerald-800 p-2 rounded"><Share2 className="w-3.5 h-3.5" />Share position</a><button onClick={copy} className="flex gap-1 items-center bg-slate-800 p-2 rounded"><Copy className="w-3.5 h-3.5" />{copied ? 'Copied' : 'Copy'}</button></div>
    <p className="text-[11px] text-slate-400">Alerts require this page to remain running. Closed-app push and confirmed take-off alerts are not available.</p>
    <div className="border-t border-slate-800 pt-2"><div className="flex justify-between mb-1"><span>Observed altitude history — this session</span><button onClick={() => onCenterOnFlight(flight)} className="text-cyan-300 flex gap-1"><Compass className="w-3 h-3" />Centre</button></div>{trail.length > 1 ? <svg viewBox="0 0 280 60" className="w-full h-12 bg-slate-950 rounded"><polyline fill="none" stroke="#06b6d4" strokeWidth="2" points={points} /></svg> : <p className="text-slate-400">Waiting for more reported points.</p>}<p className="text-[11px] text-slate-500 mt-1">{coordinate(flight.lat, true)} · {coordinate(flight.lon, false)}</p></div>
    <p className="text-[11px] text-slate-500">Altitude is reported by the aircraft. Pressure altitude may be negative; it is not height above a rig or ground.</p>
    <OperatorStatusLinks />
  </div>;
};
