import React, { useMemo, useState } from 'react';
import { FieldOperator, InstallationOrAirport } from '../types/radar';
import { FIELD_OPERATOR_COLORS } from '../data/installationsAndAirports';
import { HELIPORT_TERMINALS } from '../data/heliportTerminals';
import {
  Clock,
  Crosshair,
  ExternalLink,
  Luggage,
  MapPin,
  Navigation,
  Phone,
  Search,
} from 'lucide-react';

interface RigsAndAirportsDirectoryProps {
  installations: InstallationOrAirport[];
  activeFacility: InstallationOrAirport;
  onSelectFacility: (facility: InstallationOrAirport) => void;
  selectedFieldOperator: 'all' | FieldOperator;
  onSelectFieldOperator: (op: 'all' | FieldOperator) => void;
  onAddCustomCoordinate: (name: string, lat: number, lon: number) => void;
}

export const RigsAndAirportsDirectory: React.FC<RigsAndAirportsDirectoryProps> = ({
  installations,
  activeFacility,
  onSelectFacility,
  selectedFieldOperator,
  onSelectFieldOperator,
  onAddCustomCoordinate,
}) => {
  const [search, setSearch] = useState('');
  const [assetGroup, setAssetGroup] = useState<
    'all' | 'rigs_fpsos' | 'uk_airports' | 'sar_heliports' | 'terminals_guide'
  >('all');
  const [customName, setCustomName] = useState('');
  const [customLat, setCustomLat] = useState('');
  const [customLon, setCustomLon] = useState('');

  const fieldOperators: Array<'all' | FieldOperator> = [
    'all',
    'Apache',
    'bp',
    'Shell',
    'Equinor',
    'Harbour Energy',
    'TotalEnergies',
    'Ithaca Energy',
    'EnQuest',
    'CNOOC',
    'Aker BP',
    'ConocoPhillips',
    'HM Coastguard / SAR',
    'UK Airport / Heliport',
  ];

  const filtered = useMemo(() => {
    return installations.filter((item) => {
      if (selectedFieldOperator !== 'all' && item.fieldOperator !== selectedFieldOperator) {
        return false;
      }

      if (assetGroup === 'rigs_fpsos') {
        if (
          item.assetType !== 'Fixed Platform' &&
          item.assetType !== 'FPSO' &&
          item.assetType !== 'Semi-Sub'
        ) {
          return false;
        }
      } else if (assetGroup === 'uk_airports') {
        if (
          item.assetType !== 'UK Airport' &&
          item.assetType !== 'Shore Heliport' &&
          item.assetType !== 'Norwegian Hub'
        ) {
          return false;
        }
      } else if (assetGroup === 'sar_heliports') {
        if (
          item.assetType !== 'SAR Base' &&
          item.assetType !== 'Shore Heliport' &&
          item.assetType !== 'Hospital Helipad'
        ) {
          return false;
        }
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const hay = `${item.name} ${item.shortName} ${item.code} ${item.fieldOperator} ${item.regionLabel} ${item.assetType}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [installations, selectedFieldOperator, assetGroup, search]);

  const filteredTerminals = useMemo(() => {
    if (!search.trim()) return HELIPORT_TERMINALS;
    const q = search.toLowerCase();
    return HELIPORT_TERMINALS.filter((t) =>
      `${t.terminalName} ${t.operator} ${t.airportCode} ${t.address} ${t.postcode} ${t.fieldsServed}`
        .toLowerCase()
        .includes(q)
    );
  }, [search]);

  const handleCustomSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const latNum = parseFloat(customLat);
    const lonNum = parseFloat(customLon);
    if (
      isNaN(latNum) ||
      isNaN(lonNum) ||
      latNum < -90 ||
      latNum > 90 ||
      lonNum < -180 ||
      lonNum > 180
    ) {
      return;
    }
    onAddCustomCoordinate(customName.trim() || 'Custom Spotter / Vessel', latNum, lonNum);
    setCustomName('');
    setCustomLat('');
    setCustomLon('');
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100">
      {/* Top Filter Controls */}
      <div className="p-3 border-b border-slate-800 space-y-2.5">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Apache, Forties, Beryl, Clair, Prestwick, NHV Terminal..."
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        {/* Asset Group Tabs (Includes Heliport Terminals & Check-In Guide) */}
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          {[
            { id: 'all', label: 'All Rigs & UK' },
            { id: 'rigs_fpsos', label: 'Platforms & FPSOs' },
            { id: 'uk_airports', label: 'UK Airports' },
            { id: 'sar_heliports', label: 'HMCG SAR' },
            { id: 'terminals_guide', label: 'Heliport Terminals & Check-In' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                setAssetGroup(
                  tab.id as
                    | 'all'
                    | 'rigs_fpsos'
                    | 'uk_airports'
                    | 'sar_heliports'
                    | 'terminals_guide'
                )
              }
              className={`px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                assetGroup === tab.id
                  ? 'bg-cyan-500 text-slate-950 font-semibold'
                  : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Field Operator Filter Bar */}
        {assetGroup !== 'terminals_guide' && (
          <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
            {fieldOperators.map((op) => {
              const isSelected = selectedFieldOperator === op;
              const color = op !== 'all' ? FIELD_OPERATOR_COLORS[op] : '#06b6d4';
              return (
                <button
                  key={op}
                  onClick={() => onSelectFieldOperator(op)}
                  className={`px-2.5 py-1 rounded text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer border ${
                    isSelected
                      ? 'bg-slate-800 text-white border-cyan-400'
                      : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {op !== 'all' && (
                    <span
                      className="inline-block w-2 h-2 rounded-full mr-1.5"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  {op === 'all' ? 'All Operators' : op}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Directory List OR Heliport Terminals & Check-In Guide */}
      {assetGroup === 'terminals_guide' ? (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80 p-3 space-y-3">
          {filteredTerminals.map((term) => (
            <div
              key={term.id}
              className="p-3.5 bg-slate-900/80 border border-slate-800 rounded-lg space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-xs font-mono text-cyan-400">
                    {term.operator} TERMINAL · {term.airportCode}
                  </div>
                  <h4 className="text-sm font-bold text-white mt-0.5">
                    {term.terminalName}
                  </h4>
                  <div className="text-xs text-slate-300 mt-0.5">
                    {term.address} · <span className="font-mono text-amber-300">{term.postcode}</span>
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${term.terminalName} ${term.postcode}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-2.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold rounded-md text-xs flex items-center gap-1 shrink-0 whitespace-nowrap"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  Directions
                </a>
              </div>

              <div className="text-xs text-slate-300 space-y-1 pt-2 border-t border-slate-800/80">
                <div className="flex items-start gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>{term.checkInWindow}</span>
                </div>
                <div className="flex items-start gap-1.5">
                  <Luggage className="w-3.5 h-3.5 text-cyan-400 shrink-0 mt-0.5" />
                  <span>{term.baggageRules}</span>
                </div>
                <div className="text-[11px] text-slate-400 pt-1">
                  <strong className="text-slate-300">Rigs Served:</strong> {term.fieldsServed}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 text-xs">
                <a
                  href={`tel:${term.phone}`}
                  className="text-slate-300 hover:text-white flex items-center gap-1 font-mono"
                >
                  <Phone className="w-3 h-3 text-emerald-400" />
                  {term.phone}
                </a>
                <a
                  href={term.liveAirportBoardUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-cyan-400 hover:underline flex items-center gap-1"
                >
                  Live Onward Flights Board <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
          {filtered.map((fac) => {
            const isActive = fac.id === activeFacility.id;
            const opColor = FIELD_OPERATOR_COLORS[fac.fieldOperator] || '#06b6d4';

            return (
              <div
                key={fac.id}
                onClick={() => onSelectFacility(fac)}
                className={`p-3 transition-colors cursor-pointer flex items-center justify-between gap-3 ${
                  isActive ? 'bg-cyan-950/40' : 'hover:bg-slate-900/70'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-semibold" style={{ color: opColor }}>
                      {fac.fieldOperator}
                    </span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="text-slate-300">{fac.assetType}</span>
                    <span aria-hidden="true" className="text-slate-600">·</span>
                    <span className="font-mono text-cyan-400">{fac.code}</span>
                  </div>

                  <div className="text-sm font-semibold text-white mt-0.5 truncate">
                    {fac.name}
                  </div>

                  <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                    {fac.regionLabel}
                  </div>

                  <div className="flex items-center gap-1.5 text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                    <span>
                      {fac.lat.toFixed(3)}°N, {fac.lon.toFixed(3)}°E
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>Elev {fac.elevationFt} ft</span>
                    {fac.maxHeliType && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="text-slate-300">{fac.maxHeliType}</span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectFacility(fac);
                  }}
                  className={`min-h-[38px] px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 font-semibold'
                      : 'bg-slate-900 hover:bg-slate-800 text-cyan-400 border border-slate-800'
                  }`}
                >
                  <Crosshair className="w-3.5 h-3.5" />
                  {isActive ? 'Locked' : 'Lock Rings'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Custom Rig / Vessel / Hometown Coordinate Adder */}
      <form
        onSubmit={handleCustomSubmit}
        className="p-3 border-t border-slate-800 bg-slate-900/60 space-y-2"
      >
        <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-cyan-400" />
          Add Custom Vessel, Rig or Hometown Coordinates
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <input
            type="text"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder="Name (e.g. Vessel)"
            className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs text-white placeholder:text-slate-500"
          />
          <input
            type="number"
            step="any"
            value={customLat}
            onChange={(e) => setCustomLat(e.target.value)}
            placeholder="Lat (e.g. 57.72)"
            className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-white placeholder:text-slate-500"
          />
          <input
            type="number"
            step="any"
            value={customLon}
            onChange={(e) => setCustomLon(e.target.value)}
            placeholder="Lon (e.g. 0.84)"
            className="px-2 py-1.5 bg-slate-950 border border-slate-800 rounded text-xs font-mono text-white placeholder:text-slate-500"
          />
        </div>
        <button
          type="submit"
          className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 rounded text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Navigation className="w-3.5 h-3.5" />
          Lock Radar onto Custom Coordinates
        </button>
      </form>
    </div>
  );
};
