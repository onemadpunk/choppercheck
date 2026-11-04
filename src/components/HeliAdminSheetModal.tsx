import React, { useRef, useState } from 'react';
import {
  AircraftTarget,
  FieldOperator,
  HeliAdminSheetData,
  InstallationOrAirport,
} from '../types/radar';
import { REAL_HELIADMIN_SHEETS } from '../data/heliAdminSheets';
import { resolveHeliAdminStopCode } from '../data/installationsAndAirports';
import { calculateDistanceNm } from '../data/aircraftDecoder';
import {
  ArrowRight,
  Camera,
  CheckSquare,
  ClipboardList,
  Eye,
  FileSpreadsheet,
  MapPin,
  Pin,
  Plane,
  Plus,
  Route,
  Sparkles,
  Square,
  Upload,
  X,
} from 'lucide-react';

interface HeliAdminSheetModalProps {
  isOpen: boolean;
  onClose: () => void;
  sheets: HeliAdminSheetData[];
  activeSheet: HeliAdminSheetData;
  onSelectSheet: (sheet: HeliAdminSheetData) => void;
  onAddSheet: (sheet: HeliAdminSheetData) => void;
  facilities: InstallationOrAirport[];
  flights: AircraftTarget[];
  onPlotAndFocusSheet: (sheet: HeliAdminSheetData) => void;
  onSelectFacility: (fac: InstallationOrAirport) => void;
}

export const HeliAdminSheetModal: React.FC<HeliAdminSheetModalProps> = ({
  isOpen,
  onClose,
  sheets,
  activeSheet,
  onSelectSheet,
  onAddSheet,
  facilities,
  flights,
  onPlotAndFocusSheet,
  onSelectFacility,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [showSheetImagePreview, setShowSheetImagePreview] = useState(false);

  // Quick manual route/sheet entry state
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customFlightName, setCustomFlightName] = useState('APFOR2/1');
  const [customCallsign, setCustomCallsign] = useState('GOLD631');
  const [customReg, setCustomReg] = useState('G-NHVG');
  const [customType, setCustomType] = useState('H-175');
  const [customCheckIn, setCustomCheckIn] = useState('10:30');
  const [customStd, setCustomStd] = useState('11:45');
  const [customRouteStr, setCustomRouteStr] = useState('ABZ FA FD FC ABZ');
  const [customFixedWing, setCustomFixedWing] = useState('');

  // Checklist tick state persisted in localStorage
  const [checkedRules, setCheckedRules] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('deckwatch_heliadmin_checks');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  if (!isOpen) return null;

  const toggleRuleCheck = (ruleKey: string) => {
    setCheckedRules((prev) => {
      const next = { ...prev, [ruleKey]: !prev[ruleKey] };
      try {
        localStorage.setItem('deckwatch_heliadmin_checks', JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  // Resolve each stop code in activeSheet.plannedRouteCodes to a real InstallationOrAirport
  const resolvedStops = activeSheet.plannedRouteCodes.map((code, idx) => {
    const fac = resolveHeliAdminStopCode(code, facilities);
    const prevFac =
      idx > 0
        ? resolveHeliAdminStopCode(activeSheet.plannedRouteCodes[idx - 1], facilities)
        : undefined;
    const legNm =
      fac && prevFac ? calculateDistanceNm(prevFac.lat, prevFac.lon, fac.lat, fac.lon) : 0;
    return {
      index: idx + 1,
      code,
      facility: fac,
      legNm,
    };
  });

  const totalLoopNm = resolvedStops.reduce((acc, s) => acc + s.legNm, 0);

  // Check if any active radar flight matches this Heli-Admin sheet
  const matchedFlight = flights.find(
    (f) =>
      (activeSheet.callsign &&
        f.callsign.toUpperCase() === activeSheet.callsign.toUpperCase()) ||
      (activeSheet.registration &&
        f.registration.toUpperCase() === activeSheet.registration.toUpperCase()) ||
      (activeSheet.flightName &&
        f.heliAdminFlightName?.toUpperCase() === activeSheet.flightName.toUpperCase())
  );

  // Handle Photo Upload / Camera Scan via /api/heliadmin-scan
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setScanning(true);
    setScanError(null);

    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const base64Url = await base64Promise;

      const res = await fetch('/api/heliadmin-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageBase64: base64Url,
          mimeType: file.type || 'image/jpeg',
        }),
      });

      if (!res.ok) {
        throw new Error('OCR scan service unavailable on static host — use Quick Route Entry below');
      }

      const data = await res.json();
      const s = data?.sheet;
      if (!s || !Array.isArray(s.plannedRouteCodes)) {
        throw new Error('Could not read Planned Route from photo — try Quick Route Entry');
      }

      const newSheet: HeliAdminSheetData = {
        id: `scanned-${Date.now()}`,
        title: s.title || `${s.flightName || 'Offshore'} Crewchange Sheet`,
        fieldOperator: (s.fieldOperator as FieldOperator) || 'Apache',
        flightName: s.flightName || 'CREW-1',
        scheduledDate: s.scheduledDate || new Date().toLocaleDateString('en-GB'),
        callsign: (s.callsign || '').toUpperCase(),
        registration: (s.registration || '').toUpperCase(),
        flightOperator: s.flightOperator || 'Offshore Helicopter',
        aircraftType: s.aircraftType || 'H-175 / S92',
        stdTime: s.stdTime || '11:00',
        heliAdminCheckInTime: s.heliAdminCheckInTime || '09:45',
        plannedRouteCodes:
          s.plannedRouteCodes.length >= 2
            ? s.plannedRouteCodes.map((c: string) => c.trim().toUpperCase())
            : ['ABZ', 'FC', 'ABZ'],
        outboundFixedWing: s.outboundFixedWing || undefined,
        inboundFixedWing: s.inboundFixedWing || undefined,
        seatCapacity: Number(s.seatCapacity) || 16,
        departingPaxCount: Number(s.departingPaxCount) || 12,
        legBreakdownSummary:
          s.legBreakdownSummary || 'Scanned from Heli-Admin noticeboard sheet photo',
        checklistRules:
          Array.isArray(s.checklistRules) && s.checklistRules.length > 0
            ? s.checklistRules
            : [
                `Check in at Heli-Admin @ ${s.heliAdminCheckInTime || '09:45'}`,
                'PEDs in Flight Mode & switched off 30 mins before arrival',
                'Blue security tag on bag zip — no bag access after check-in',
                'Empty locker, return key & strip bed on day of departure',
              ],
        sampleImageUrl: base64Url,
      };

      onAddSheet(newSheet);
      onSelectSheet(newSheet);
    } catch (err) {
      setScanError(
        err instanceof Error
          ? err.message
          : 'Could not scan photo automatically. Enter the Planned Route codes manually below.'
      );
      setShowCustomForm(true);
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleCreateCustomSheet = (e: React.FormEvent) => {
    e.preventDefault();
    const codes = customRouteStr
      .trim()
      .toUpperCase()
      .split(/[\s,→>-]+/)
      .filter(Boolean);
    if (codes.length < 2) return;

    const created: HeliAdminSheetData = {
      id: `custom-sheet-${Date.now()}`,
      title: `${customFlightName.toUpperCase()} (${customCallsign.toUpperCase() || customType})`,
      fieldOperator: codes.includes('FA') || codes.includes('FC')
        ? 'Apache'
        : codes.includes('GL') || codes.includes('CRG')
        ? 'bp'
        : codes.includes('CULZ') || codes.includes('EPUQ')
        ? 'TotalEnergies'
        : 'UK Airport / Heliport',
      flightName: customFlightName.toUpperCase(),
      scheduledDate: new Date().toLocaleDateString('en-GB'),
      callsign: customCallsign.trim().toUpperCase(),
      registration: customReg.trim().toUpperCase(),
      flightOperator: customCallsign.toUpperCase().startsWith('GOLD') ? 'NHV' : 'Bristow / Offshore',
      aircraftType: customType.toUpperCase(),
      stdTime: customStd,
      heliAdminCheckInTime: customCheckIn,
      plannedRouteCodes: codes,
      outboundFixedWing: customFixedWing || undefined,
      seatCapacity: 16,
      departingPaxCount: 16,
      legBreakdownSummary: `Custom Heli-Admin Route: ${codes.join(' → ')}`,
      checklistRules: [
        `Check in at Heli-Admin @ ${customCheckIn} (for ${customStd} STD)`,
        'PEDs checked in Flight Mode & switched off 30 mins prior',
        'Blue security tag zip-tied on bag after check-in',
        'Empty locker, return key / S3ID card & strip bed',
      ],
    };

    onAddSheet(created);
    onSelectSheet(created);
    setShowCustomForm(false);
  };

  return (
    <div className="fixed inset-0 z-[800] bg-black/80 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-slate-950 border border-slate-800 rounded-xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Modal Header */}
        <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-white truncate">
                Offshore Heli-Admin Flight Sheets & Multi-Stop Route Plotter
              </h2>
              <p className="text-xs text-slate-400 truncate">
                Decode noticeboard sheets (APFOR2/1, BP GL3, TTCULZFR), plot multi-rig loops & track check-in
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              {scanning ? (
                <>
                  <Sparkles className="w-3.5 h-3.5 animate-spin" />
                  Scanning Sheet...
                </>
              ) : (
                <>
                  <Camera className="w-3.5 h-3.5" />
                  Snap / Upload Sheet Photo
                </>
              )}
            </button>

            <button
              onClick={() => setShowCustomForm((prev) => !prev)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Type Route
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {scanError && (
            <div className="p-3 rounded-lg bg-amber-950/60 border border-amber-500/40 text-xs text-amber-200 flex items-center justify-between">
              <span>{scanError}</span>
              <button
                onClick={() => setScanError(null)}
                className="text-amber-300 hover:text-white ml-2"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Optional Manual Route Code Entry Form */}
          {showCustomForm && (
            <form
              onSubmit={handleCreateCustomSheet}
              className="p-3.5 rounded-xl bg-slate-900 border border-cyan-500/40 space-y-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-cyan-300 uppercase tracking-wider font-mono">
                  Enter Heli-Admin Sheet Details or Planned Route Shorthand
                </span>
                <button
                  type="button"
                  onClick={() => setShowCustomForm(false)}
                  className="text-xs text-slate-400 hover:text-white"
                >
                  Cancel
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    FLIGHT NAME
                  </label>
                  <input
                    type="text"
                    value={customFlightName}
                    onChange={(e) => setCustomFlightName(e.target.value)}
                    placeholder="e.g. APFOR2/1, BP GL3"
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    RADIO CALLSIGN
                  </label>
                  <input
                    type="text"
                    value={customCallsign}
                    onChange={(e) => setCustomCallsign(e.target.value)}
                    placeholder="e.g. GOLD631, 60B-YG"
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    TAIL REG / TYPE
                  </label>
                  <input
                    type="text"
                    value={customReg}
                    onChange={(e) => setCustomReg(e.target.value)}
                    placeholder="e.g. G-NHVG"
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    CHECK-IN / STD
                  </label>
                  <div className="grid grid-cols-2 gap-1">
                    <input
                      type="text"
                      value={customCheckIn}
                      onChange={(e) => setCustomCheckIn(e.target.value)}
                      placeholder="10:30"
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-amber-300"
                    />
                    <input
                      type="text"
                      value={customStd}
                      onChange={(e) => setCustomStd(e.target.value)}
                      placeholder="11:45"
                      className="w-full px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_auto] gap-2.5 items-end">
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    PLANNED ROUTE CODES (SPACE SEPARATED, EXACTLY AS ON HELI-ADMIN SHEET)
                  </label>
                  <input
                    type="text"
                    value={customRouteStr}
                    onChange={(e) => setCustomRouteStr(e.target.value)}
                    placeholder="e.g. ABZ FA FD FC ABZ  or  LSI GL LSI  or  ABZ CULZ AILS EPUQ FRNK EPUQ ABZ"
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-700 text-xs font-mono text-cyan-300"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-mono text-slate-400 mb-1">
                    FIXED-WING LINK (OPTIONAL)
                  </label>
                  <input
                    type="text"
                    value={customFixedWing}
                    onChange={(e) => setCustomFixedWing(e.target.value)}
                    placeholder="e.g. BP FW3 / BP FW6"
                    className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs font-mono text-white"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs cursor-pointer h-[32px]"
                >
                  Plot Sheet Route
                </button>
              </div>
            </form>
          )}

          {/* Preset Selector Tabs (Example Templates from Past Flights) */}
          <div>
            <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider mb-2">
              Example Noticeboard Templates (Past Flights to Test Multi-Stop Tracking)
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {sheets.map((sheet) => {
                const isSelected = sheet.id === activeSheet.id;
                return (
                  <button
                    key={sheet.id}
                    onClick={() => onSelectSheet(sheet)}
                    className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer flex items-start justify-between gap-2 ${
                      isSelected
                        ? 'bg-cyan-950/40 border-cyan-400 text-white'
                        : 'bg-slate-900/70 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold font-mono text-amber-400">
                          {sheet.flightName}
                        </span>
                        {sheet.callsign && (
                          <span className="text-xs font-mono text-cyan-300">
                            · {sheet.callsign}
                          </span>
                        )}
                        {sheet.registration && (
                          <span className="text-[11px] font-mono text-slate-400">
                            ({sheet.registration})
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-medium text-white truncate mt-0.5">
                        {sheet.title}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 mt-0.5 truncate">
                        Route: {sheet.plannedRouteCodes.join(' → ')}
                      </div>
                    </div>

                    <div className="text-right font-mono shrink-0">
                      <div className="text-[11px] text-amber-300 font-semibold">
                        CHK {sheet.heliAdminCheckInTime}
                      </div>
                      <div className="text-[11px] text-emerald-400">
                        STD {sheet.stdTime}
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        {sheet.aircraftType}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Heli-Admin Sheet Telemetry & Multi-Stop Route Header */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 text-xs font-mono text-amber-400">
                  <span>FLIGHT: {activeSheet.flightName}</span>
                  <span>·</span>
                  <span>OP: {activeSheet.flightOperator}</span>
                  <span>·</span>
                  <span>A/TYPE: {activeSheet.aircraftType}</span>
                </div>
                <h3 className="text-base sm:text-lg font-bold text-white mt-0.5">
                  {activeSheet.title}
                </h3>
                <p className="text-xs text-slate-300 mt-0.5">
                  {activeSheet.legBreakdownSummary}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {activeSheet.sampleImageUrl && (
                  <button
                    onClick={() => setShowSheetImagePreview((prev) => !prev)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    {showSheetImagePreview ? 'Hide Sheet Photo' : 'View Noticeboard Photo'}
                  </button>
                )}

                <button
                  onClick={() => {
                    onPlotAndFocusSheet(activeSheet);
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Route className="w-3.5 h-3.5" />
                  Plot Multi-Stop Loop on Radar & Pin Flight
                </button>
              </div>
            </div>

            {/* Optional Full Noticeboard Sheet Photo Preview */}
            {showSheetImagePreview && activeSheet.sampleImageUrl && (
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 flex flex-col items-center">
                <div className="text-xs text-slate-400 mb-2 font-mono">
                  Original Offshore Heli-Admin Noticeboard Sheet ({activeSheet.flightName})
                </div>
                <img
                  src={activeSheet.sampleImageUrl}
                  alt={activeSheet.title}
                  className="max-h-[420px] w-auto rounded border border-slate-800 object-contain"
                />
              </div>
            )}

            {/* Key Heli-Admin Timings & Callsign Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
              <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-500/40">
                <div className="text-[10px] font-mono text-amber-300 uppercase">
                  Heli-Admin Check-In
                </div>
                <div className="text-base font-mono font-bold tabular-nums text-amber-400 mt-0.5">
                  {activeSheet.heliAdminCheckInTime}
                </div>
                <div className="text-[10px] text-slate-400">Baggage & PED check</div>
              </div>

              <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/40">
                <div className="text-[10px] font-mono text-emerald-300 uppercase">
                  Scheduled Dep (STD)
                </div>
                <div className="text-base font-mono font-bold tabular-nums text-emerald-400 mt-0.5">
                  {activeSheet.stdTime}
                </div>
                <div className="text-[10px] text-slate-400">
                  PEDs off by -30m
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Callsign & Reg
                </div>
                <div className="text-sm font-mono font-bold text-cyan-400 mt-0.5">
                  {activeSheet.callsign || 'TBA'} · {activeSheet.registration || activeSheet.aircraftType}
                </div>
                <div className="text-[10px] text-slate-400">
                  {matchedFlight ? '● Active on Radar' : 'Ready to Track'}
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Pax / Seat Cap
                </div>
                <div className="text-sm font-mono font-bold tabular-nums text-white mt-0.5">
                  {activeSheet.departingPaxCount} Pax · {activeSheet.seatCapacity} Seats
                </div>
                <div className="text-[10px] text-slate-400">
                  {activeSheet.aircraftType} Cabin
                </div>
              </div>

              <div className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 col-span-2 sm:col-span-1">
                <div className="text-[10px] font-mono text-slate-400 uppercase">
                  Fixed-Wing Charter
                </div>
                <div className="text-xs font-mono font-semibold text-white mt-0.5 truncate">
                  {activeSheet.outboundFixedWing || activeSheet.inboundFixedWing
                    ? `${activeSheet.outboundFixedWing || ''} ${activeSheet.inboundFixedWing || ''}`
                    : 'Direct Shore Heliport'}
                </div>
                <div className="text-[10px] text-slate-400">
                  {activeSheet.plannedRouteCodes[0] === 'LSI'
                    ? 'Via Sumburgh (LSI ↔ ABZ)'
                    : 'Via Aberdeen (ABZ)'}
                </div>
              </div>
            </div>

            {/* Multi-Stop Planned Route Visual Sequence */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-mono text-cyan-300 uppercase tracking-wider">
                  Planned Multi-Stop Route: {activeSheet.plannedRouteCodes.join(' → ')}
                </span>
                <span className="text-xs font-mono tabular-nums text-slate-400">
                  Total Loop: {Math.round(totalLoopNm)} NM ({resolvedStops.length} Stops)
                </span>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
                {resolvedStops.map((stop, idx) => (
                  <React.Fragment key={`${stop.code}-${idx}`}>
                    <div
                      onClick={() => {
                        if (stop.facility) {
                          onSelectFacility(stop.facility);
                          onClose();
                        }
                      }}
                      className="min-w-[130px] p-2.5 rounded-lg bg-slate-950 border border-slate-800 hover:border-cyan-500/60 cursor-pointer transition-colors shrink-0"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span>STOP {stop.index}</span>
                        {stop.legNm > 0 && (
                          <span className="text-cyan-400 tabular-nums">+{stop.legNm} NM</span>
                        )}
                      </div>
                      <div className="text-sm font-mono font-bold text-white mt-0.5 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        {stop.code}
                      </div>
                      <div className="text-[11px] text-slate-300 truncate mt-0.5">
                        {stop.facility ? stop.facility.shortName : `Offshore Stop (${stop.code})`}
                      </div>
                    </div>

                    {idx < resolvedStops.length - 1 && (
                      <ArrowRight className="w-4 h-4 text-slate-500 shrink-0" />
                    )}
                  </React.Fragment>
                ))}
              </div>
            </div>

            {/* Mandatory Heli-Admin Pre-Flight Checklist from Sheet */}
            <div className="pt-2 border-t border-slate-800">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <ClipboardList className="w-4 h-4 text-amber-400" />
                  Heli-Admin Departure Checklist (Printed on Noticeboard Sheet)
                </span>
                <span className="text-[11px] text-slate-400 font-mono">
                  Tap items as you complete them
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {activeSheet.checklistRules.map((rule, idx) => {
                  const key = `${activeSheet.id}-rule-${idx}`;
                  const isDone = !!checkedRules[key];
                  return (
                    <button
                      key={key}
                      onClick={() => toggleRuleCheck(key)}
                      className={`p-2.5 rounded-lg border text-left text-xs flex items-start gap-2 transition-colors cursor-pointer ${
                        isDone
                          ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-200 line-through opacity-80'
                          : 'bg-slate-950 border-slate-800 text-slate-200 hover:border-slate-700'
                      }`}
                    >
                      {isDone ? (
                        <CheckSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                      )}
                      <span>{rule}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
