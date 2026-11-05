import React, { useMemo, useState } from 'react';
import { FieldOperator, InstallationOrAirport } from '../types/radar';
import { coordinate } from '../utils/dataQuality';
import { OperatorStatusLinks } from './OperatorStatusLinks';
import { Star } from 'lucide-react';
interface Props {
  installations: InstallationOrAirport[]; activeFacility: InstallationOrAirport;
  onSelectFacility: (f: InstallationOrAirport) => void; selectedFieldOperator: 'all' | FieldOperator;
  onSelectFieldOperator: (op: 'all' | FieldOperator) => void;
  onAddCustomCoordinate: (name: string, lat: number, lon: number) => void;
  favoriteFacilityIds: string[]; onToggleFavoriteFacility: (id: string) => void;
  singleRigFocus: boolean; onToggleSingleRigFocus: () => void;
}
export const RigsAndAirportsDirectory: React.FC<Props> = ({ installations, activeFacility, onSelectFacility, selectedFieldOperator, onSelectFieldOperator, onAddCustomCoordinate, favoriteFacilityIds, onToggleFavoriteFacility }) => {
  const [search,setSearch]=useState(''); const [group,setGroup]=useState('all');
  const [name,setName]=useState(''); const [lat,setLat]=useState(''); const [lon,setLon]=useState(''); const [error,setError]=useState('');
  const operators=useMemo(()=>[...new Set(installations.map(f=>f.fieldOperator))].sort(),[installations]);
  const filtered=useMemo(()=>installations.filter(f=>{
    const offshore=['FPSO','Fixed Platform','Semi-Sub'].includes(f.assetType);
    return (selectedFieldOperator==='all'||f.fieldOperator===selectedFieldOperator) &&
      (group!=='saved'||favoriteFacilityIds.includes(f.id)) && (group!=='rigs'||offshore) && (group!=='bases'||!offshore) &&
      (!search.trim()||(f.shortName+' '+f.name+' '+f.code).toLowerCase().includes(search.trim().toLowerCase()));
  }).sort((a,b)=>Number(favoriteFacilityIds.includes(b.id))-Number(favoriteFacilityIds.includes(a.id))),[installations,selectedFieldOperator,group,favoriteFacilityIds,search]);
  const add=(e:React.FormEvent)=>{e.preventDefault();const latitude=Number(lat),longitude=Number(lon);if(!name.trim()||!lat.trim()||!lon.trim()||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180){setError('Enter a name and valid latitude / longitude.');return;}onAddCustomCoordinate(name.trim(),latitude,longitude);setError('');};
  return <div className="flex flex-col h-full min-h-0 bg-slate-950 text-slate-200">
    <div className="p-3 border-b border-slate-800 space-y-2 shrink-0"><h3 className="text-base font-semibold text-white">Choose a rig or base</h3><input aria-label="Search rigs and bases" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search Glen Lyon, Sumburgh, Aberdeen…" className="w-full p-3 bg-slate-900 border border-slate-700 rounded-lg text-sm" />
      <div className="grid grid-cols-2 gap-2"><select aria-label="Location type" value={group} onChange={e=>setGroup(e.target.value)} className="min-h-11 p-2 bg-slate-900 rounded-lg text-xs"><option value="all">All rigs & bases</option><option value="saved">My saved ({favoriteFacilityIds.length})</option><option value="rigs">Offshore installations</option><option value="bases">Airports & bases</option><option value="operators">Operator boards</option></select>
      <select aria-label="Directory operator" value={selectedFieldOperator} onChange={e=>onSelectFieldOperator(e.target.value as 'all'|FieldOperator)} className="min-h-11 p-2 bg-slate-900 rounded-lg text-xs"><option value="all">All directory operators</option>{operators.map(op=><option key={op}>{op}</option>)}</select></div>
      <p className="text-[11px] text-slate-500">Stars save choices on this device. Directory locations and ownership labels are reference metadata; mobile assets can move.</p></div>
    <div className="flex-1 min-h-0 overflow-y-auto">{group==='operators'?<div className="p-4 space-y-4"><OperatorStatusLinks/><p className="text-xs text-slate-400">Use current operator and employer instructions for check-in, terminal, baggage and travel requirements.</p></div>:<>
      {filtered.length===0&&<p className="p-6 text-sm text-slate-400">{group==='saved'?'No saved locations yet. Tap a star beside a rig or base.':'No locations match. Try a different search or filter.'}</p>}
      {filtered.map(f=>{const saved=favoriteFacilityIds.includes(f.id);return <div key={f.id} className={'flex items-center gap-2 p-3 border-b border-slate-800 '+(f.id===activeFacility.id?'bg-cyan-950/30':'')}><button onClick={()=>onSelectFacility(f)} className="text-left flex-1 min-w-0 min-h-11" aria-label={'Choose '+f.shortName}><p className="font-semibold text-sm text-white">{f.shortName}</p><p className="text-xs text-slate-400 mt-1">{f.code} · {f.assetType}</p></button><button onClick={()=>onToggleFavoriteFacility(f.id)} aria-label={(saved?'Unsave ':'Save ')+f.shortName} className="p-3 rounded-lg bg-slate-900"><Star className={'w-5 h-5 '+(saved?'fill-amber-400 text-amber-400':'text-slate-500')}/></button></div>;})}
      </>}
      <details className="p-4 text-xs border-t border-slate-800"><summary className="cursor-pointer text-cyan-300 py-2">Add a location by coordinates</summary><form onSubmit={add} className="space-y-2 pt-2"><input aria-label="Custom location name" value={name} onChange={e=>setName(e.target.value)} placeholder="Location name" maxLength={60} className="w-full p-3 bg-slate-900 rounded"/><div className="grid grid-cols-2 gap-2"><input aria-label="Latitude" type="number" step="any" value={lat} onChange={e=>setLat(e.target.value)} placeholder="Latitude" className="w-full p-3 bg-slate-900 rounded"/><input aria-label="Longitude" type="number" step="any" value={lon} onChange={e=>setLon(e.target.value)} placeholder="Longitude" className="w-full p-3 bg-slate-900 rounded"/></div>{error&&<p role="alert" className="text-amber-300">{error}</p>}<button className="w-full p-3 bg-cyan-500 text-slate-950 font-semibold rounded">Use location</button><p className="text-slate-500">Custom coordinates last for this page session. {activeFacility.id.startsWith('custom-')?coordinate(activeFacility.lat,true)+' '+coordinate(activeFacility.lon,false):''}</p></form></details>
    </div>
  </div>;
};
