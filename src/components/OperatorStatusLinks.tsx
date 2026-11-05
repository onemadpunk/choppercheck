import React from 'react';
export const OPERATOR_STATUS_LINKS = [
  { name: 'Bristow', url: 'https://www.bristowgroup.com/flight-status' },
  { name: 'CHC', url: 'https://aims-scheduler.chc.ca/FlightDisplay.aspx' },
  { name: 'NHV', url: 'https://flights.nhv.be/' },
  { name: 'OHS', url: 'https://ultimate-aviation.net/flight-times/' },
];
export const OperatorStatusLinks = () => <div className="space-y-1.5 text-xs"><p className="text-slate-400">Operator schedules & check-in information</p><div className="flex flex-wrap gap-2">{OPERATOR_STATUS_LINKS.map(link => <a key={link.name} href={link.url} target="_blank" rel="noopener noreferrer" className="text-cyan-300 underline">{link.name} ↗</a>)}</div><p className="text-[11px] text-slate-500">External boards; schedules are not automatically matched to radar aircraft.</p></div>;
