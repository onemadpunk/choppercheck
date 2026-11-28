import React, { useMemo, useState } from 'react';
import type { AircraftTarget, DayFlightWindowSummary, InstallationOrAirport } from '../types/radar';
import { plainDayAnswer } from '../utils/solarAndMetUtils';
import { calculateDistanceNm } from '../data/aircraftDecoder';
import { operatorPhrase } from './SimpleFlightAnswer';
import { WeatherStaleNote } from './WeatherStaleNote';

/**
 * The new Simple view home screen: one rig, the answer for today and the next two days in plain words, the
 * helicopters near the rig, and a share button. Everything else is one tap away (Map, Rigs, Pro view).
 */

const NEAR_RIG_NM = 50;
const OFFSHORE_TYPES = new Set(['FPSO', 'Fixed Platform', 'Semi-Sub', 'Norwegian Hub']);
const LAND_TYPES = new Set(['Shore Heliport', 'UK Airport']);
const SECTOR_LABELS: Array<[string, string]> = [
  ['apache_north_sea', 'Forties & Beryl'],
  ['uk_north_sea', 'Central & Northern North Sea'],
  ['west_of_shetland', 'West of Shetland'],
  ['southern_north_sea', 'Southern North Sea'],
  ['irish_sea', 'Irish Sea'],
  ['norway_ncs', 'Norway'],
];

const dayKeyOf = (d: Date) => d.toISOString().slice(0, 10);

type Tone = 'go' | 'caution' | 'hold';
const toneOf = (s: DayFlightWindowSummary['overallStatus']): Tone => (s === 'GO' ? 'go' : s === 'CAUTION' ? 'caution' : 'hold');

const TONE = {
  go: { card: 'bg-[#0f2a22] border-[#1f5c47]', head: 'text-[#ecfdf5]', sub: 'text-[#d1fae5]', label: 'text-[#a7f3d0]', word: 'text-[#6ee7b7]', stroke: '#34d399' },
  caution: { card: 'bg-[#2b230c] border-[#6b5414]', head: 'text-[#fffbeb]', sub: 'text-[#fde68a]', label: 'text-[#fde68a]', word: 'text-[#fde68a]', stroke: '#fbbf24' },
  hold: { card: 'bg-[#2e1218] border-[#7a2636]', head: 'text-[#fff1f2]', sub: 'text-[#fecdd3]', label: 'text-[#fecdd3]', word: 'text-[#fecdd3]', stroke: '#fb7185' },
};

function StatusIcon({ tone, size }: { tone: Tone; size: number }) {
  const stroke = TONE[tone].stroke;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      {tone === 'go' && (<><circle cx="12" cy="12" r="10" /><path d="m7.5 12.5 3 3 6-6.5" /></>)}
      {tone === 'caution' && (<><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>)}
      {tone === 'hold' && (<><circle cx="12" cy="12" r="10" /><path d="m8.5 8.5 7 7" /><path d="m15.5 8.5-7 7" /></>)}
    </svg>
  );
}

function rigLabel(f: InstallationOrAirport): string {
  return f.shortName.replace(/\s*\([A-Z0-9]{2,6}\)\s*$/, '') || f.name;
}

export function SimpleHome({
  facility,
  facilities,
  favoriteIds,
  hasChosenRig,
  daySummaries,
  hasForecast,
  flights,
  feedState,
  onSelectFacility,
  onOpenMap,
  onSelectFlight,
  onOpenPro,
  onUseOldLook,
}: {
  facility: InstallationOrAirport;
  facilities: InstallationOrAirport[];
  favoriteIds: string[];
  hasChosenRig: boolean;
  daySummaries: DayFlightWindowSummary[];
  hasForecast: boolean;
  flights: AircraftTarget[];
  feedState: 'loading' | 'available' | 'partial' | 'unavailable';
  onSelectFacility: (f: InstallationOrAirport) => void;
  onOpenMap: () => void;
  onSelectFlight: (f: AircraftTarget) => void;
  onOpenPro: () => void;
  onUseOldLook: () => void;
}) {
  const [screen, setScreen] = useState<'home' | 'rigs'>(hasChosenRig ? 'home' : 'rigs');
  const [query, setQuery] = useState('');
  const [shareNote, setShareNote] = useState<string | null>(null);

  const now = new Date();
  const todayKey = dayKeyOf(now);
  const tomorrowKey = dayKeyOf(new Date(now.getTime() + 24 * 3600 * 1000));
  const days = daySummaries
    .filter((d) => d.dayKey >= todayKey)
    .filter((d) => !(d.dayKey === todayKey && d.coversDaytime === false))
    .slice(0, 3);
  const dayLabel = (d: DayFlightWindowSummary) =>
    d.dayKey === todayKey ? 'Today' : d.dayKey === tomorrowKey ? 'Tomorrow' : d.dayNameFull;

  const nearby = useMemo(
    () =>
      flights
        .filter(
          (f) =>
            f.category === 'offshore_heli' &&
            (f.destinationCode === facility.code ||
              f.originCode === facility.code ||
              calculateDistanceNm(f.lat, f.lon, facility.lat, facility.lon) <= NEAR_RIG_NM)
        )
        .slice(0, 4),
    [flights, facility]
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: InstallationOrAirport) =>
      !q || f.name.toLowerCase().includes(q) || f.shortName.toLowerCase().includes(q) || f.code.toLowerCase() === q;
    const fav = favoriteIds
      .map((id) => facilities.find((f) => f.id === id))
      .filter((f): f is InstallationOrAirport => !!f && (OFFSHORE_TYPES.has(f.assetType) || LAND_TYPES.has(f.assetType)) && match(f));
    const out: Array<{ label: string; items: InstallationOrAirport[] }> = [];
    if (hasChosenRig && fav.length && !q) out.push({ label: 'Your rigs', items: fav });
    for (const [sector, label] of SECTOR_LABELS) {
      const items = facilities.filter((f) => f.sector === sector && OFFSHORE_TYPES.has(f.assetType) && match(f));
      if (items.length) out.push({ label, items });
    }
    const land = facilities.filter((f) => LAND_TYPES.has(f.assetType) && match(f));
    if (land.length) out.push({ label: 'Heliports and airports', items: land });
    return out;
  }, [facilities, favoriteIds, query, hasChosenRig]);

  const share = async () => {
    const lines = days.map((d) => {
      const a = plainDayAnswer(d);
      return `${dayLabel(d)}: ${a.headline}${a.cause ? ` (${a.cause})` : ''}`;
    });
    const text =
      `Helicopter flights to ${rigLabel(facility)}, weather outlook:\n${lines.join('\n')}\n` +
      `This is a weather estimate. ${operatorPhrase(facility.helicopterOperators)} makes the call.`;
    const url = `https://choppercheck.com/?rig=${encodeURIComponent(facility.id)}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'ChopperCheck', text, url });
        return;
      }
    } catch {
      return; // cancelled
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      setShareNote('Copied. Paste it into a message.');
    } catch {
      window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, '_blank', 'noopener');
    }
  };

  const nav = (
    <nav aria-label="Main" className="fixed bottom-0 inset-x-0 z-[700] pb-[env(safe-area-inset-bottom)] border-t border-[#1c2840] bg-[#0a101c]">
      <div className="max-w-lg mx-auto grid grid-cols-3 h-16">
      {[
        { label: 'Today', active: screen === 'home', onClick: () => setScreen('home'), d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4' },
        { label: 'Map', active: false, onClick: onOpenMap, d: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' },
        { label: 'Rigs', active: screen === 'rigs', onClick: () => setScreen('rigs'), d: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3' },
      ].map((t) => (
        <button
          key={t.label}
          onClick={t.onClick}
          aria-current={t.active ? 'page' : undefined}
          className={`flex flex-col items-center justify-center gap-0.5 text-[12px] font-semibold cursor-pointer ${t.active ? 'text-[#38bdf8]' : 'text-[#9fb0c8]'}`}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={t.d} />
          </svg>
          {t.label}
        </button>
      ))}
      </div>
    </nav>
  );

  const header = (
    <header className="flex items-center justify-between px-4 pt-4 pb-2">
      <div className="flex items-center gap-2.5">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 6h18" /><path d="M12 6v3" /><rect x="6" y="9" width="10" height="6" rx="3" /><path d="M16 12h5" /><path d="M8 18h6" /><path d="M11 15v3" />
        </svg>
        <span className="text-[19px] font-bold tracking-tight">ChopperCheck</span>
      </div>
      <button onClick={onOpenPro} className="min-h-[44px] px-3.5 rounded-full border border-[#2a3a57] text-[#cbd5e1] text-[14px] font-semibold cursor-pointer hover:bg-[#131c2e]">
        Pro view
      </button>
    </header>
  );

  if (screen === 'rigs') {
    return (
      <div className="min-h-[100dvh] bg-[#0b1220] text-[#e6edf7] pb-20">
        <div className="max-w-lg mx-auto">
          {header}
          <div className="px-4 pb-4 flex flex-col gap-3">
            <h1 className="text-[22px] font-bold">{hasChosenRig ? 'Change rig' : 'Which rig are you going to?'}</h1>
            <label className="flex flex-col gap-1 text-[13px] text-[#9fb0c8]">
              Search
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rig, platform or airport name"
                className="min-h-[48px] px-4 rounded-xl bg-[#131c2e] border border-[#22304a] text-[16px] text-[#e6edf7] placeholder:text-[#6b7c96] focus:outline-none focus:border-[#38bdf8]"
              />
            </label>
            {groups.length === 0 && <p className="text-[15px] text-[#9fb0c8]">Nothing matches "{query}".</p>}
            {groups.map((g) => (
              <section key={g.label} className="flex flex-col gap-1.5">
                <h2 className="text-[13px] font-semibold text-[#9fb0c8] uppercase tracking-wide mt-2">{g.label}</h2>
                <ul className="rounded-2xl bg-[#131c2e] border border-[#22304a] divide-y divide-[#22304a] overflow-hidden">
                  {g.items.map((f) => (
                    <li key={g.label + f.id}>
                      <button
                        onClick={() => {
                          onSelectFacility(f);
                          setQuery('');
                          setScreen('home');
                        }}
                        className={`w-full min-h-[52px] px-4 py-2 flex items-center justify-between gap-3 text-left cursor-pointer hover:bg-[#182339] ${f.id === facility.id && hasChosenRig ? 'text-[#38bdf8]' : ''}`}
                      >
                        <span className="text-[16px] font-medium">{rigLabel(f)}</span>
                        <span className="text-[12px] text-[#9fb0c8]">{f.assetType === 'UK Airport' ? 'Airport' : f.assetType}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
        {hasChosenRig && nav}
      </div>
    );
  }

  const hero = days[0];
  const heroTone = hero ? toneOf(hero.overallStatus) : null;
  const heroAnswer = hero ? plainDayAnswer(hero) : null;
  const flightsKnown = feedState === 'available' || feedState === 'partial';

  return (
    <div className="min-h-[100dvh] bg-[#0b1220] text-[#e6edf7] pb-20">
      <div className="max-w-lg mx-auto">
        {header}
        <main className="px-4 pb-4 flex flex-col gap-3.5">
          <button
            onClick={() => setScreen('rigs')}
            className="flex items-center justify-between gap-3 min-h-[64px] px-4 py-2.5 rounded-2xl bg-[#131c2e] border border-[#22304a] text-left cursor-pointer hover:bg-[#182339]"
          >
            <span className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] text-[#9fb0c8] font-medium">Your rig</span>
              <span className="text-[18px] font-bold truncate">{rigLabel(facility)}</span>
              {facility.primaryShoreBase && (
                <span className="text-[13px] text-[#9fb0c8] truncate">
                  {facility.regionLabel ? facility.regionLabel.split('·')[0].trim() : `Base ${facility.primaryShoreBase}`}
                </span>
              )}
            </span>
            <span className="text-[14px] text-[#7dd3fc] font-semibold shrink-0">Change</span>
          </button>

          <WeatherStaleNote />

          {!hasForecast || !hero || !heroTone || !heroAnswer ? (
            <section className="rounded-[20px] bg-[#131c2e] border border-[#22304a] p-5 text-[16px] text-[#cbd5e1]" aria-live="polite">
              Getting the forecast… If this stays, check your signal. It keeps trying by itself.
            </section>
          ) : (
            <>
              <section aria-label={dayLabel(hero)} className={`rounded-[20px] border p-5 flex flex-col gap-2.5 ${TONE[heroTone].card}`}>
                <span className={`text-[13px] font-semibold uppercase tracking-wider ${TONE[heroTone].label}`}>{dayLabel(hero)}</span>
                <div className="flex items-center gap-3">
                  <StatusIcon tone={heroTone} size={40} />
                  <h1 className={`m-0 text-[28px] leading-tight font-bold ${TONE[heroTone].head}`}>{heroAnswer.headline}</h1>
                </div>
                <p className={`m-0 text-[16px] leading-snug ${TONE[heroTone].sub}`}>
                  {heroAnswer.cause
                    ? `Main reason: ${heroAnswer.cause}.`
                    : 'The weather looks within helicopter limits during the day.'}
                </p>
              </section>

              {days.length > 1 && (
                <section aria-label="Next days" className="rounded-2xl bg-[#131c2e] border border-[#22304a] divide-y divide-[#22304a]">
                  {days.slice(1).map((d) => {
                    const t = toneOf(d.overallStatus);
                    const a = plainDayAnswer(d);
                    return (
                      <div key={d.dayKey} className="flex items-start gap-3 px-4 py-3.5">
                        <StatusIcon tone={t} size={26} />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[13px] text-[#9fb0c8] font-semibold">{dayLabel(d)}</span>
                          <span className={`text-[17px] font-bold ${TONE[t].word}`}>{a.headline}</span>
                          {a.cause && <span className="text-[14px] text-[#b6c3d6]">Main reason: {a.cause}</span>}
                        </div>
                      </div>
                    );
                  })}
                </section>
              )}
            </>
          )}

          <section aria-label="Helicopters near your rig" className="rounded-2xl bg-[#131c2e] border border-[#22304a] p-4 flex flex-col gap-2.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[15px] font-semibold">
                {!flightsKnown
                  ? feedState === 'loading'
                    ? 'Looking for helicopters…'
                    : 'Live helicopter positions are unavailable just now'
                  : nearby.length === 0
                  ? 'No helicopters near your rig right now'
                  : `${nearby.length} helicopter${nearby.length > 1 ? 's' : ''} near your rig`}
              </span>
              <button onClick={onOpenMap} className="min-h-[44px] px-3 text-[14px] text-[#7dd3fc] font-semibold cursor-pointer shrink-0">
                Map
              </button>
            </div>
            {flightsKnown &&
              nearby.map((f) => (
                <button
                  key={f.hex}
                  onClick={() => onSelectFlight(f)}
                  className="flex items-center justify-between gap-3 min-h-[48px] px-3 rounded-xl border border-[#22304a] bg-[#0f1828] text-left cursor-pointer hover:bg-[#182339]"
                >
                  <span className="text-[14px] min-w-0 truncate">
                    {f.destinationCode === facility.code
                      ? 'Heading to your rig'
                      : f.originCode === facility.code
                      ? 'Leaving your rig'
                      : `${Math.round(calculateDistanceNm(f.lat, f.lon, facility.lat, facility.lon))} NM away`}
                    <span className="text-[#9fb0c8]"> · {f.helicopterOperator && f.helicopterOperator !== 'Unknown' ? f.helicopterOperator : f.callsign || f.typeCode}</span>
                  </span>
                  <span className="text-[14px] text-[#7dd3fc] font-semibold shrink-0">Details</span>
                </button>
              ))}
          </section>

          <p className="m-0 text-[13px] leading-snug text-[#9fb0c8]">
            This is a weather estimate. {operatorPhrase(facility.helicopterOperators)} makes the call, so check their texts or app.
          </p>

          {hasForecast && days.length > 0 && (
            <button onClick={() => void share()} className="min-h-[48px] rounded-full bg-[#38bdf8] text-[#06202e] text-[16px] font-bold cursor-pointer hover:bg-[#7dd3fc]">
              Send to family
            </button>
          )}
          {shareNote && <p className="m-0 text-center text-[13px] text-[#9fb0c8]" role="status">{shareNote}</p>}

          <button onClick={onUseOldLook} className="min-h-[44px] text-[13px] text-[#9fb0c8] underline underline-offset-2 cursor-pointer">
            Switch back to the old look
          </button>
        </main>
      </div>
      {nav}
    </div>
  );
}
