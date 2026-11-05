import React, { useEffect, useMemo, useState } from 'react';
import { AircraftTarget, InstallationOrAirport } from '../types/radar';
import { advanceAircraftPositionsSmoothly, fetchHybridRadarTraffic } from '../services/radarService';
import { compassDirectionFromBearing } from '../utils/alertsAndShare';
import { coordinate, positionLabel, reported } from '../utils/dataQuality';
import { LocateFixed, X } from 'lucide-react';
import { startVisiblePolling } from '../utils/visiblePolling';
interface Props { isOpen: boolean; onClose: () => void; flights: AircraftTarget[]; activeFacility: InstallationOrAirport; onSelectFlight: (f: AircraftTarget) => void; onUseMyGps: () => void; }
export const OverheadSkyCompassModal: React.FC<Props> = ({ isOpen, onClose, activeFacility, onSelectFlight }) => {
  const [location, setLocation] = useState<{lat: number; lon: number; accuracy: number} | null>(null);
  const [mode, setMode] = useState<'gps' | 'rig'>('gps');
  const [gpsMessage, setGpsMessage] = useState('');
  const [targets, setTargets] = useState<AircraftTarget[]>([]);
  const [feed, setFeed] = useState('Connecting…');
  const locate = () => {
    setMode('gps'); setLocation(null); setGpsMessage('Finding your GPS location…');
    if (!navigator.geolocation) { setGpsMessage('GPS is not supported in this browser.'); return; }
    navigator.geolocation.getCurrentPosition(p => { setLocation({lat:p.coords.latitude,lon:p.coords.longitude,accuracy:p.coords.accuracy}); setGpsMessage(''); }, error => {
      setGpsMessage(error.code === 1 ? 'Location access was denied. Enable location for this site, then tap My GPS.' : 'Your GPS location could not be obtained. Try again outdoors or use a selected rig.');
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  };
  useEffect(() => { if (isOpen) locate(); }, [isOpen]);
  const reference = useMemo<InstallationOrAirport | null>(() => mode === 'rig' && activeFacility.id !== 'map-reference' ? activeFacility : mode === 'gps' && location ? { ...activeFacility, id: 'compass-gps', code: 'GPS', name: 'Your GPS location', shortName: 'Your GPS location', lat: location.lat, lon: location.lon } : null, [mode, location, activeFacility]);
  useEffect(() => {
    if (!isOpen || !reference) { setTargets([]); return; }
    setTargets([]); setFeed('Connecting…');
    const stop = startVisiblePolling(async signal => {
      const result = await fetchHybridRadarTraffic(reference.lat, reference.lon, reference, 0, false, signal);
      if (signal.aborted) return;
      setFeed(result.feedAvailable ? (result.provider || 'ADS-B') : 'Feed unavailable');
      if (result.feedAvailable) setTargets(advanceAircraftPositionsSmoothly(result.flights, 0, reference));
      return result.retryAfterMs;
    });
    const expiry = setInterval(() => setTargets(prev => advanceAircraftPositionsSmoothly(prev, 2, reference)), 2000);
    return () => { stop(); clearInterval(expiry); };
  }, [isOpen, reference]);
  const nearby = useMemo(() => targets.filter(f => f.distanceFromRefNm <= 40).sort((a,b) => a.distanceFromRefNm - b.distanceFromRefNm), [targets]);
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[1000] bg-black/80 p-2 sm:p-4 flex items-center justify-center"><div role="dialog" aria-modal="true" aria-label="Nearby aircraft compass" className="w-full max-w-lg max-h-[94dvh] overflow-y-auto rounded-xl bg-slate-950 border border-slate-700 p-4 space-y-4 text-slate-200">
    <div className="flex items-center justify-between"><div><p className="text-xs text-cyan-400">NEARBY AIRCRAFT</p><h2 className="font-bold text-lg text-white">Sky Compass</h2></div><button onClick={onClose} aria-label="Close sky compass" className="p-3 bg-slate-800 rounded-lg"><X className="w-4 h-4" /></button></div>
    <div className="flex gap-2"><button onClick={locate} className={'flex items-center gap-2 min-h-11 px-3 rounded-lg border text-sm ' + (mode === 'gps' ? 'border-cyan-500 text-cyan-300' : 'border-slate-700')}><LocateFixed className="w-4 h-4" />My GPS</button><button disabled={activeFacility.id === 'map-reference'} onClick={() => { setMode('rig'); setGpsMessage(''); }} className={'min-h-11 px-3 rounded-lg border text-sm disabled:opacity-40 ' + (mode === 'rig' ? 'border-cyan-500 text-cyan-300' : 'border-slate-700')}>Selected rig / base</button></div>
    {gpsMessage && <p role="status" className="text-sm text-amber-200">{gpsMessage}</p>}
    {reference && <><div><p className="text-sm font-semibold">{reference.shortName}</p><p className="text-xs text-slate-400">{mode === 'gps' ? 'Uses your device position; does not change the selected rig.' : 'Uses the selected reference location, not your phone location.'}</p><p className="text-[11px] text-slate-500 mt-1">{coordinate(reference.lat, true)} · {coordinate(reference.lon, false)}{mode === 'gps' && location ? ' · accuracy ±' + Math.round(location.accuracy) + ' m' : ''}</p></div>
    <svg viewBox="0 0 260 260" className="w-full max-w-[300px] mx-auto" aria-label="North-up compass with a true distance scale">
      {[10,25,40].map(n => <g key={n}><circle cx="130" cy="130" r={n*2.5} fill="none" stroke="#334155" strokeDasharray={n===40?'':'4 4'} /><text x="134" y={130-n*2.5+10} fontSize="8" fill="#94a3b8">{n} NM</text></g>)}
      <line x1="130" y1="20" x2="130" y2="240" stroke="#1e293b"/><line x1="20" y1="130" x2="240" y2="130" stroke="#1e293b"/>
      <text x="130" y="15" textAnchor="middle" fontSize="12" fill="#22d3ee">N</text><text x="246" y="134" fontSize="12" fill="#94a3b8">E</text><text x="130" y="253" textAnchor="middle" fontSize="12" fill="#94a3b8">S</text><text x="4" y="134" fontSize="12" fill="#94a3b8">W</text><circle cx="130" cy="130" r="4" fill="#f59e0b"/>
      {nearby.slice(0,20).map(f => {const r=f.distanceFromRefNm*2.5,rad=(f.bearingFromRefDeg-90)*Math.PI/180;const x=130+r*Math.cos(rad),y=130+r*Math.sin(rad);return <g key={f.hex}><circle cx={x} cy={y} r="4" fill={f.category==='offshore_heli'?'#22d3ee':'#34d399'}/><text x={x+6} y={y+3} fontSize="7" fill="#cbd5e1">{f.callsign}</text></g>;})}
    </svg>
    <p className="text-xs text-slate-400">{feed} · Within 40 NM · UK, Ireland & North Sea feed coverage · North is true north, not the direction your phone is facing. Aircraft may be below the horizon or obscured.</p>
    {nearby.length===0 && <p className="text-sm text-slate-400">{feed === 'Feed unavailable' ? 'Aircraft updates are currently unavailable.' : 'No fresh aircraft positions detected within 40 NM.'}</p>}
    <div className="divide-y divide-slate-800">{nearby.slice(0,20).map(f => <button key={f.hex} onClick={() => { onSelectFlight(f); onClose(); }} className="block w-full text-left py-3"><div className="flex justify-between gap-2"><span className="font-bold text-sm text-white">{f.callsign}</span><span className="font-mono text-cyan-300 text-xs">{compassDirectionFromBearing(f.bearingFromRefDeg)} {f.bearingFromRefDeg}° · {f.distanceFromRefNm} NM</span></div><p className="text-xs text-slate-300 mt-1">{f.typeFullName} · {reported(f.altitudeReported,f.altitudeFt,' ft')}</p><p className="text-[11px] text-slate-500 mt-1">{positionLabel(f)}</p></button>)}</div></>}
  </div></div>;
};
