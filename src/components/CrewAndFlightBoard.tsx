import { matchesAircraftCategory } from '../utils/dataQuality';
import React, { useMemo, useState } from 'react';
import {
  AircraftTarget,
  HelicopterOperator,
  InstallationOrAirport,
  TrafficCategory,
} from '../types/radar';
import { reported, positionLabel } from '../utils/dataQuality';
import { OperatorStatusLinks } from './OperatorStatusLinks';
import { ArrowRight, Pin, Search, ShieldAlert } from 'lucide-react';

interface CrewAndFlightBoardProps {
  flights: AircraftTarget[];
  activeFacility: InstallationOrAirport;
  selectedFlight: AircraftTarget | null;
  onSelectFlight: (flight: AircraftTarget) => void;
  pinnedFlightHex: string | null;
  onTogglePin: (hex: string) => void;
  categoryFilter: 'all' | TrafficCategory | 'active_facility';
  onChangeCategoryFilter: (cat: 'all' | TrafficCategory | 'active_facility') => void;
  heliOpFilter: 'all' | HelicopterOperator;
  onChangeHeliOpFilter: (op: 'all' | HelicopterOperator) => void;
}

export const CrewAndFlightBoard: React.FC<CrewAndFlightBoardProps> = ({
  flights,
  activeFacility,
  selectedFlight,
  onSelectFlight,
  pinnedFlightHex,
  onTogglePin,
  categoryFilter,
  onChangeCategoryFilter,
  heliOpFilter,
  onChangeHeliOpFilter,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredFlights = useMemo(() => {
    return [...flights].sort((a,b) => a.distanceFromRefNm - b.distanceFromRefNm).filter((f) => {
      if (categoryFilter === 'active_facility') {
        const matchesActive =
          f.destinationCode === activeFacility.code ||
          f.originCode === activeFacility.code ||
          f.destinationRigId === activeFacility.id ||
          f.distanceFromRefNm <= 35;
        if (!matchesActive) return false;
      } else if (!matchesAircraftCategory(f, categoryFilter)) {
        return false;
      }

      if (heliOpFilter !== 'all' && f.helicopterOperator !== heliOpFilter) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const hay = `${f.callsign} ${f.flightNumber} ${f.registration} ${f.typeCode} ${f.typeFullName} ${f.operator} ${f.originCode} ${f.originName} ${f.destinationCode} ${f.destinationName} ${f.fieldOperatorServed || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [flights, categoryFilter, heliOpFilter, searchQuery, activeFacility]);

  const heliOperators: Array<'all' | HelicopterOperator> = [
    'all',
    'Bristow',
    'CHC',
    'NHV',
    'OHS',
    'HM Coastguard',
    'Irish Coast Guard',
    'Unknown',
  ];

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* Search & Traffic Filter Controls */}
      <div className="p-3 border-b border-slate-800 space-y-2.5"><OperatorStatusLinks />
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search callsign, registration, aircraft type or operator…"
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Category Segmented Filter */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {[
            { id: 'all', label: 'All Sky' },
            { id: 'offshore_heli', label: 'Helicopters' },
            ...(activeFacility.id !== 'map-reference' ? [{ id: 'active_facility', label: `Near ${activeFacility.code}` }] : []),
            { id: 'coastguard_sar', label: 'Coastguard' },
            { id: 'commercial_fixed_wing', label: 'Fixed Wing' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                onChangeCategoryFilter(tab.id as 'all' | TrafficCategory | 'active_facility')
              }
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                categoryFilter === tab.id
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Helicopter / Flight Operator Filter */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {heliOperators.map((op) => (
            <button
              key={op}
              onClick={() => onChangeHeliOpFilter(op)}
              className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                heliOpFilter === op
                  ? 'bg-slate-800 text-cyan-300 border border-cyan-500/60'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {op === 'all' ? 'All Operators' : op}
            </button>
          ))}
        </div>
      </div>

      {/* Flight Board List */}
      <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
        {filteredFlights.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-sm text-slate-400">
              No active flights match your current filter.
            </p>
            <button
              onClick={() => {
                onChangeCategoryFilter('all');
                onChangeHeliOpFilter('all');
                setSearchQuery('');
              }}
              className="mt-3 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-md text-xs font-medium cursor-pointer"
            >
              Reset Flight Filters
            </button>
          </div>
        ) : (
          filteredFlights.map((flight) => {
            const isSelected = selectedFlight?.hex === flight.hex;
            const isPinned = pinnedFlightHex === flight.hex;
            const isSar = flight.category === 'coastguard_sar';

            return (
              <div
                key={flight.hex}
                onClick={() => onSelectFlight(flight)}
                className={`p-3 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-cyan-950/40'
                    : isPinned
                    ? 'bg-amber-950/25'
                    : 'hover:bg-slate-900/70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  {/* Top Line: Callsign, Aircraft Type & Field/Operator */}
                  <div className="flex items-center gap-1.5 text-xs">
                    {isSar && <ShieldAlert className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                    <span className="font-mono font-bold text-white whitespace-nowrap">
                      {flight.callsign}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-cyan-400 font-medium truncate">
                      {flight.typeFullName}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono text-slate-400 text-[11px] whitespace-nowrap">
                      {flight.registration}
                    </span>
                  </div>

                  <div className="text-xs text-slate-400 mt-1">{flight.operator}</div>
                  <div className="text-[11px] text-slate-400 mt-1">Route & times not reported · {positionLabel(flight)}</div>
                </div>

                {/* Right Column: Live Speed/Alt & Pin Button */}
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right font-mono tabular-nums">
                    <div className="text-xs font-semibold text-white">
                      {reported(flight.altitudeReported, flight.altitudeFt, ' ft')}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      {reported(flight.speedReported, flight.groundSpeedKts, ' kt')} · {flight.distanceFromRefNm} NM
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePin(flight.hex);
                    }}
                    title="Pin tracked aircraft"
                    className={`min-w-[38px] min-h-[38px] rounded-md flex items-center justify-center border transition-colors cursor-pointer ${
                      isPinned
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-400 border-slate-800'
                    }`}
                  >
                    <Pin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
