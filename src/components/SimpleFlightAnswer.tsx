import React from 'react';
import type { DayFlightWindowSummary, HelicopterOperator } from '../types/radar';
import { plainDayAnswer } from '../utils/solarAndMetUtils';

/** "2026-11-19" for a date, in the same UTC calendar the forecast days use. */
function dayKeyOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Plain words for who makes the call: "The helicopter operator (Bristow, CHC or NHV)". */
export function operatorPhrase(operators: HelicopterOperator[] | undefined): string {
  const known = Array.from(new Set((operators || []).filter((o) => o && o !== 'Unknown')));
  if (known.length === 0) return 'The helicopter operator';
  const names = known.length === 1 ? known[0] : `${known.slice(0, -1).join(', ')} or ${known[known.length - 1]}`;
  return `The helicopter operator (${names})`;
}

/**
 * The simple-view answer on the map card: will flights likely go today, tomorrow and the day
 * after, in plain words with no numbers. Uses the same daytime crew-change hours and the same
 * limits as the 7-day planner.
 */
export function SimpleFlightAnswer({
  daySummaries,
  hasForecast,
  operators,
  onOpenWeather,
  onOpenDirectory,
}: {
  daySummaries: DayFlightWindowSummary[];
  hasForecast: boolean;
  operators: HelicopterOperator[] | undefined;
  onOpenWeather: () => void;
  onOpenDirectory: () => void;
}) {
  const now = new Date();
  const todayKey = dayKeyOf(now);
  const tomorrowKey = dayKeyOf(new Date(now.getTime() + 24 * 3600 * 1000));
  const days = daySummaries
    .filter((d) => d.dayKey >= todayKey)
    // Late in the evening there are no daytime hours left today, so start from tomorrow
    .filter((d) => !(d.dayKey === todayKey && d.coversDaytime === false))
    .slice(0, 3);
  const who = operatorPhrase(operators);

  return (
    <div className="mt-1.5">
      {!hasForecast || days.length === 0 ? (
        <div className="rounded-md bg-slate-900/95 border border-slate-700 px-2.5 py-2 text-[12px] text-slate-300">
          Getting the forecast… If this stays, check your signal and try again.
        </div>
      ) : (
        <ul className="rounded-md bg-slate-900/95 border border-cyan-500/35 divide-y divide-slate-800">
          {days.map((d) => {
            const answer = plainDayAnswer(d);
            const label = d.dayKey === todayKey ? 'Today' : d.dayKey === tomorrowKey ? 'Tomorrow' : d.dayNameFull;
            const tone =
              d.overallStatus === 'GO'
                ? 'text-emerald-400'
                : d.overallStatus === 'CAUTION'
                ? 'text-amber-400'
                : 'text-rose-400';
            const dot =
              d.overallStatus === 'GO' ? 'bg-emerald-400' : d.overallStatus === 'CAUTION' ? 'bg-amber-400' : 'bg-rose-400';
            return (
              <li key={d.dayKey} className="flex items-start gap-2 px-2.5 py-1.5">
                <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-[12px] text-slate-300 font-semibold">{label}: </span>
                  <span className={`text-[13px] font-bold ${tone}`}>{answer.headline}</span>
                  {answer.cause && <span className="block text-[11px] text-slate-400">({answer.cause})</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-1.5 text-[10.5px] leading-snug text-slate-400">
        This is a weather estimate. {who} makes the call, so check their texts or app.
      </p>
      <div className="mt-1 grid grid-cols-2 gap-1.5">
        <button
          onClick={onOpenWeather}
          className="min-h-[36px] rounded-lg text-[12px] font-semibold bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-800 cursor-pointer"
        >
          More detail →
        </button>
        <button
          onClick={onOpenDirectory}
          className="min-h-[36px] rounded-lg text-[12px] font-semibold bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-800 cursor-pointer"
        >
          Change rig
        </button>
      </div>
    </div>
  );
}
