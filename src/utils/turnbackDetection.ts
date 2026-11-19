import { calculateDistanceNm } from '../data/aircraftDecoder';
import { InstallationOrAirport, TrafficCategory, TurnbackInfo } from '../types/radar';

// Air-turnback / return-to-base (RTB) detection from live positions only.
// A flight is flagged when it is seen leaving an offshore shore base, gets at least
// MIN_OUTBOUND_NM away, and then heads back towards the same base without having been
// near any offshore installation. Flight plans and reasons are not public, so the flag
// says only what the track shows: the aircraft turned back.

export const OFFSHORE_SHORE_BASE_CODES = ['EGPD', 'EGPB', 'EGPA', 'EGNJ', 'EGSH', 'EGNH', 'EGSM', 'ENZV', 'ENBR'];
const OFFSHORE_ASSETS = new Set(['Fixed Platform', 'FPSO', 'Semi-Sub']);

export const MIN_OUTBOUND_NM = 10;      // must get at least this far from the base
const BASE_RADIUS_NM = 5;               // "at the base" (departing or back)
const BASE_MAX_ALT_FT = 2500;           // low enough near the base to be departing / arriving
const MIN_RETURN_NM = 5;                // must come back at least this far ...
const MIN_RETURN_FRACTION = 0.3;        // ... and at least this share of the furthest distance
const RIG_RADIUS_NM = 3;                // a turn this close to a rig is a rig visit, not a turnback
const RIG_LOW_ALT_FT = 600;             // low and slow near a rig counts as a landing / approach
const RIG_SLOW_KTS = 50;
const MAX_GAP_MS = 10 * 60_000;         // a longer gap away from base could hide a rig landing
const LEG_EXPIRY_MS = 4 * 3600_000;
export const RECENT_TURNBACK_MS = 3 * 3600_000;

export interface TurnbackFix {
  hex: string; callsign: string; typeCode: string; category: TrafficCategory;
  lat: number; lon: number; altFt: number; speedKts: number; timestamp: number;
}

export interface RecentTurnback extends TurnbackInfo { hex: string; callsign: string; typeCode: string; lastSeenAt: number }

interface Point { lat: number; lon: number }
interface Leg {
  base: InstallationOrAirport; departedAt: number; maxDistNm: number; maxAt: number; maxPoint: Point;
  visitedRig: boolean; lastAt: number; lastDistNm: number; turnback?: TurnbackInfo;
}

export function isTurnbackEligible(category: TrafficCategory): boolean {
  return category === 'offshore_heli' || category === 'commercial_fixed_wing';
}

export class TurnbackTracker {
  private legs = new Map<string, Leg>();
  private recent = new Map<string, RecentTurnback>();
  private bases: InstallationOrAirport[];
  private rigs: InstallationOrAirport[];

  constructor(facilities: InstallationOrAirport[]) {
    const seen = new Set<string>();
    this.bases = facilities.filter(f => OFFSHORE_SHORE_BASE_CODES.includes(f.code) && !seen.has(f.code) && seen.add(f.code));
    this.rigs = facilities.filter(f => OFFSHORE_ASSETS.has(f.assetType));
  }

  private nearestBase(lat: number, lon: number) {
    let best: { base: InstallationOrAirport; dist: number } | null = null;
    for (const base of this.bases) {
      const dist = calculateDistanceNm(base.lat, base.lon, lat, lon);
      if (!best || dist < best.dist) best = { base, dist };
    }
    return best;
  }

  private nearRig(p: Point, radius = RIG_RADIUS_NM) {
    return this.rigs.some(r => calculateDistanceNm(r.lat, r.lon, p.lat, p.lon) <= radius);
  }

  /** Feed one observed position. Returns the turnback for this aircraft, if any. */
  update(fix: TurnbackFix): TurnbackInfo | undefined {
    for (const [hex, leg] of this.legs) if (fix.timestamp - leg.lastAt > LEG_EXPIRY_MS) this.legs.delete(hex);
    for (const [hex, rtb] of this.recent) if (fix.timestamp - rtb.lastSeenAt > RECENT_TURNBACK_MS) this.recent.delete(hex);
    if (!isTurnbackEligible(fix.category)) { this.legs.delete(fix.hex); return undefined; }

    let leg = this.legs.get(fix.hex);
    if (leg && fix.timestamp <= leg.lastAt) return leg.turnback;
    const nearest = this.nearestBase(fix.lat, fix.lon);
    const atBase = nearest && nearest.dist <= BASE_RADIUS_NM && fix.altFt <= BASE_MAX_ALT_FT ? nearest.base : null;

    if (atBase) {
      // Back at the departure base after a turnback: record it as completed, then start afresh.
      // Also catches a turnback whose inbound leg was not seen until it was already close to the base.
      const missedInbound = leg && !leg.turnback && leg.base.code === atBase.code && !leg.visitedRig &&
        leg.maxDistNm >= MIN_OUTBOUND_NM && fix.timestamp - leg.lastAt <= MAX_GAP_MS && !this.nearRig(leg.maxPoint);
      if (leg && (leg.turnback || missedInbound) && leg.base.code === atBase.code) {
        const base: TurnbackInfo = leg.turnback ?? { status: 'returning', baseCode: leg.base.code, baseName: leg.base.shortName,
          maxDistanceNm: Math.round(leg.maxDistNm), turnedAt: leg.maxAt, detectedAt: fix.timestamp };
        const done: TurnbackInfo = { ...base, status: 'landed', backAt: fix.timestamp };
        this.remember(fix, done);
        this.legs.set(fix.hex, this.newLeg(atBase, fix, nearest!.dist));
        return done;
      }
      if (!leg || leg.base.code !== atBase.code || leg.maxDistNm >= MIN_OUTBOUND_NM) {
        leg = this.newLeg(atBase, fix, nearest!.dist);
      } else {
        leg.lastAt = fix.timestamp; leg.lastDistNm = nearest!.dist;
      }
      this.legs.set(fix.hex, leg);
      return undefined;
    }

    // First seen away from any base: the departure was not observed, so nothing can be said.
    if (!leg) return undefined;

    const dist = calculateDistanceNm(leg.base.lat, leg.base.lon, fix.lat, fix.lon);
    if (fix.timestamp - leg.lastAt > MAX_GAP_MS) leg.visitedRig = true;
    if (this.nearRig(fix, RIG_RADIUS_NM) && (fix.altFt <= RIG_LOW_ALT_FT || fix.speedKts <= RIG_SLOW_KTS)) leg.visitedRig = true;

    if (dist > leg.maxDistNm) {
      leg.maxDistNm = dist; leg.maxAt = fix.timestamp; leg.maxPoint = { lat: fix.lat, lon: fix.lon };
      // Heading out again past the earlier furthest point: it was not a turnback after all.
      if (leg.turnback?.status === 'returning') { leg.turnback = undefined; this.recent.delete(fix.hex); }
    }
    const comeBack = leg.maxDistNm - dist;
    const inbound = dist < leg.lastDistNm;
    if (!leg.turnback && !leg.visitedRig && leg.maxDistNm >= MIN_OUTBOUND_NM && inbound &&
      comeBack >= Math.max(MIN_RETURN_NM, leg.maxDistNm * MIN_RETURN_FRACTION) && !this.nearRig(leg.maxPoint)) {
      leg.turnback = {
        status: 'returning', baseCode: leg.base.code, baseName: leg.base.shortName,
        maxDistanceNm: Math.round(leg.maxDistNm), turnedAt: leg.maxAt, detectedAt: fix.timestamp,
      };
    }
    leg.lastAt = fix.timestamp; leg.lastDistNm = dist;
    if (leg.turnback) this.remember(fix, leg.turnback);
    return leg.turnback;
  }

  private newLeg(base: InstallationOrAirport, fix: TurnbackFix, dist: number): Leg {
    return { base, departedAt: fix.timestamp, maxDistNm: dist, maxAt: fix.timestamp, maxPoint: { lat: fix.lat, lon: fix.lon },
      visitedRig: false, lastAt: fix.timestamp, lastDistNm: dist };
  }

  private remember(fix: TurnbackFix, info: TurnbackInfo) {
    this.recent.set(fix.hex, { ...info, hex: fix.hex, callsign: fix.callsign, typeCode: fix.typeCode, lastSeenAt: fix.timestamp });
  }

  /** Turnbacks seen in the last few hours, newest first, including ones that have since landed. */
  recentTurnbacks(now = Date.now()): RecentTurnback[] {
    return [...this.recent.values()].filter(r => now - r.lastSeenAt <= RECENT_TURNBACK_MS)
      .sort((a, b) => b.detectedAt - a.detectedAt);
  }

  clear() { this.legs.clear(); this.recent.clear(); }
}

export function describeTurnback(t: TurnbackInfo): string {
  return t.status === 'landed'
    ? `Turned back ${t.maxDistanceNm} NM out and returned to ${t.baseName}`
    : `Turned back ${t.maxDistanceNm} NM out, heading back to ${t.baseName}`;
}
