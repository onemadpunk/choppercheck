import {
  AircraftTarget,
  HelideckWeatherState,
  HelicopterOperator,
  InstallationOrAirport,
  TrafficCategory,
  TrailPoint,
} from '../types/radar';
import {
  buildTrail,
  calculateBearingDeg,
  calculateDistanceNm,
  decodeAircraftType,
  generateActiveOffshoreAndUkTraffic,
} from '../data/aircraftDecoder';
import { INSTALLATIONS_AND_AIRPORTS } from '../data/installationsAndAirports';

interface RawAdsbAircraft {
  hex?: string;
  flight?: string;
  r?: string; // registration
  t?: string; // ICAO type code
  desc?: string;
  ownOp?: string; // registered owner/operator from ADS-B database
  lat?: number;
  lon?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  baro_rate?: number;
  geom_rate?: number;
  track?: number;
  true_heading?: number;
  squawk?: string;
  category?: string;
}

// Persistent trail history for real live aircraft across radar sweeps
const liveTrailHistory = new Map<string, TrailPoint[]>();
// Client-side cache of resolved real routes
const clientRouteCache = new Map<
  string,
  { originCode: string; originName: string; destCode: string; destName: string }
>();

function classifyLiveAircraft(
  raw: RawAdsbAircraft,
  referenceFacility: InstallationOrAirport
): AircraftTarget | null {
  if (typeof raw.lat !== 'number' || typeof raw.lon !== 'number') return null;

  const hex = (raw.hex || '').trim().toUpperCase();
  const callsign = (raw.flight || raw.r || hex || 'LIVE').trim().toUpperCase();
  const registration = (raw.r || hex || 'N/A').trim().toUpperCase();
  const decoded = decodeAircraftType(raw.t, raw.desc);

  const isCoastguard =
    callsign.startsWith('SRG') ||
    callsign.startsWith('RESCUE') ||
    callsign.startsWith('CGD') ||
    registration.startsWith('G-MCG') ||
    (raw.ownOp || '').toUpperCase().includes('COASTGUARD') ||
    (raw.ownOp || '').toUpperCase().includes('BRISTOW SAR') ||
    raw.squawk === '0020';

  const isBristow =
    callsign.startsWith('BHL') ||
    callsign.startsWith('NOR') ||
    callsign.startsWith('60B') ||
    callsign.startsWith('BPGL') ||
    (raw.ownOp || '').toUpperCase().includes('BRISTOW');
  const isChc =
    callsign.startsWith('HKS') ||
    callsign.startsWith('CHC') ||
    (raw.ownOp || '').toUpperCase().includes('CHC') ||
    (raw.ownOp || '').toUpperCase().includes('HELIKOPTER SERVICE');
  const isNhv =
    callsign.startsWith('GOLD') ||
    callsign.startsWith('NHZ') ||
    callsign.startsWith('NHV') ||
    callsign.startsWith('TTCULZ') ||
    registration.startsWith('G-NHV') ||
    (raw.ownOp || '').toUpperCase().includes('NHV');
  const isOhs =
    callsign.startsWith('OHS') ||
    callsign.startsWith('BBU') ||
    (raw.ownOp || '').toUpperCase().includes('OFFSHORE HELICOPTER');

  const isRotary =
    decoded.isRotary ||
    isCoastguard ||
    isBristow ||
    isChc ||
    isNhv ||
    isOhs ||
    raw.category === 'A7';

  let category: TrafficCategory = 'commercial_fixed_wing';
  let operator = raw.ownOp || 'Commercial Aviation';
  let helicopterOperator: HelicopterOperator = 'Commercial Airline';

  if (isCoastguard) {
    category = 'coastguard_sar';
    operator = raw.ownOp || 'HM Coastguard Search & Rescue';
    helicopterOperator = 'HM Coastguard';
  } else if (isRotary) {
    category = 'offshore_heli';
    if (isBristow) {
      operator = raw.ownOp || 'Bristow Helicopters';
      helicopterOperator = 'Bristow';
    } else if (isChc) {
      operator = raw.ownOp || 'CHC Helicopter Service';
      helicopterOperator = 'CHC';
    } else if (isNhv) {
      operator =
        callsign.startsWith('GOLD')
          ? 'NHV Helicopters (Apache North Sea Contract · GOLD)'
          : raw.ownOp || 'NHV Helicopters';
      helicopterOperator = 'NHV';
    } else if (isOhs) {
      operator = raw.ownOp || 'Offshore Helicopter Services (OHS)';
      helicopterOperator = 'OHS';
    } else {
      operator = raw.ownOp || 'Rotary-Wing Helicopter';
      helicopterOperator = 'Bristow';
    }
  } else if (
    callsign.startsWith('RRR') ||
    callsign.startsWith('RCH') ||
    callsign.startsWith('CLX') ||
    callsign.startsWith('KRF') ||
    decoded.code === 'C17' ||
    decoded.code === 'A400' ||
    decoded.code === 'P8' ||
    decoded.code === 'B748'
  ) {
    category = 'military_cargo';
    operator =
      raw.ownOp ||
      (callsign.startsWith('CLX')
        ? 'Cargolux Heavy Freight'
        : callsign.startsWith('RRR') || callsign.startsWith('KRF')
        ? 'Royal Air Force'
        : 'Military / Cargo Aviation');
    helicopterOperator = 'Cargo / Military';
  } else if (!raw.ownOp) {
    if (callsign.startsWith('LOG')) operator = 'Loganair';
    else if (callsign.startsWith('BAW') || callsign.startsWith('SHT')) operator = 'British Airways';
    else if (callsign.startsWith('EZY')) operator = 'easyJet';
    else if (callsign.startsWith('RYR') || callsign.startsWith('RUK')) operator = 'Ryanair';
    else if (callsign.startsWith('KLM')) operator = 'KLM Royal Dutch Airlines';
    else if (callsign.startsWith('SAS')) operator = 'Scandinavian Airlines (SAS)';
    else if (callsign.startsWith('WIF')) operator = 'Widerøe';
    else if (callsign.startsWith('EZE')) operator = 'Eastern Airways';
    else if (callsign.startsWith('EXS')) operator = 'Jet2.com';
    else if (callsign.startsWith('EIN')) operator = 'Aer Lingus';
    else if (callsign.startsWith('VIR')) operator = 'Virgin Atlantic';
    else if (callsign.startsWith('DLH')) operator = 'Lufthansa';
    else if (callsign.startsWith('AFR')) operator = 'Air France';
    else if (callsign.startsWith('NAX') || callsign.startsWith('NOZ')) operator = 'Norwegian';
  }

  const altFt =
    raw.alt_baro === 'ground'
      ? 25
      : typeof raw.alt_baro === 'number'
      ? raw.alt_baro
      : typeof raw.alt_geom === 'number'
      ? raw.alt_geom
      : 0;

  const gsKts = Math.round(raw.gs ?? 0);
  const trackDeg = Math.round(raw.track ?? raw.true_heading ?? 0);
  const vRate = Math.round(raw.baro_rate ?? raw.geom_rate ?? 0);

  const distFromRefNm = calculateDistanceNm(
    referenceFacility.lat,
    referenceFacility.lon,
    raw.lat,
    raw.lon
  );
  const bearingFromRefDeg = calculateBearingDeg(
    referenceFacility.lat,
    referenceFacility.lon,
    raw.lat,
    raw.lon
  );

  // Check if we have a real resolved route from ADSB.lol routeset API
  const resolvedRoute = clientRouteCache.get(callsign);

  // For offshore helicopters (which don't file IATA airline routes), match nearest offshore rig & shore heliport along track
  let originCode = resolvedRoute?.originCode || 'LIVE';
  let originName = resolvedRoute?.originName || 'Live Airborne Origin';
  let destinationCode = resolvedRoute?.destCode || 'TRACK';
  let destinationName = resolvedRoute?.destName || `Hdg ${String(trackDeg).padStart(3, '0')}°`;
  let destinationRigId: string | undefined = undefined;
  let fieldOperatorServed = undefined;

  if (!resolvedRoute || isRotary) {
    let nearestBehind = INSTALLATIONS_AND_AIRPORTS[0];
    let nearestAhead = referenceFacility;
    let bestAheadScore = Infinity;
    let bestBehindDist = Infinity;

    for (const fac of INSTALLATIONS_AND_AIRPORTS) {
      if (isRotary && fac.assetType === 'UK Airport' && fac.code !== 'EGPD' && fac.code !== 'EGPB') {
        continue;
      }
      const d = calculateDistanceNm(raw.lat, raw.lon, fac.lat, fac.lon);
      const brgToFac = calculateBearingDeg(raw.lat, raw.lon, fac.lat, fac.lon);
      const angleDiff = Math.abs(((brgToFac - trackDeg + 540) % 360) - 180);

      if (angleDiff < 50 && d > 1 && d < 180) {
        const score = d + angleDiff * 1.4;
        if (score < bestAheadScore) {
          bestAheadScore = score;
          nearestAhead = fac;
        }
      } else if (angleDiff > 130 && d < bestBehindDist) {
        bestBehindDist = d;
        nearestBehind = fac;
      }
    }

    if (!resolvedRoute) {
      if (isRotary || bestAheadScore < 130) {
        originCode = nearestBehind.code;
        originName = nearestBehind.shortName;
        destinationCode = nearestAhead.code;
        destinationName = nearestAhead.shortName;
        destinationRigId = nearestAhead.id;
        fieldOperatorServed = nearestAhead.fieldOperator;
      }
    } else if (isRotary && bestAheadScore < 90) {
      destinationCode = nearestAhead.code;
      destinationName = nearestAhead.shortName;
      destinationRigId = nearestAhead.id;
      fieldOperatorServed = nearestAhead.fieldOperator;
    }
  }

  // Update real live trail history for this aircraft hex
  const prevTrail = liveTrailHistory.get(hex) || [];
  const lastPt = prevTrail[prevTrail.length - 1];
  if (!lastPt || lastPt.lat !== raw.lat || lastPt.lon !== raw.lon) {
    prevTrail.push({
      lat: Number(raw.lat.toFixed(4)),
      lon: Number(raw.lon.toFixed(4)),
      altFt: Math.max(0, Math.round(altFt)),
      timestamp: Date.now(),
    });
    if (prevTrail.length > 25) prevTrail.shift();
    liveTrailHistory.set(hex, prevTrail);
  }

  const trail =
    prevTrail.length >= 2
      ? prevTrail
      : buildTrail(
          raw.lat - Math.cos((trackDeg * Math.PI) / 180) * 0.18,
          raw.lon - Math.sin((trackDeg * Math.PI) / 180) * 0.18,
          raw.lat,
          raw.lon,
          Math.max(500, altFt)
        );

  const etaToRefMinutes =
    distFromRefNm < 80 && gsKts > 40
      ? Math.max(1, Math.round((distFromRefNm / gsKts) * 60))
      : null;

  const nowStr = new Date().toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const etaStr =
    etaToRefMinutes !== null
      ? new Date(Date.now() + etaToRefMinutes * 60000).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'LIVE';

  return {
    hex: hex || callsign,
    callsign,
    flightNumber: callsign,
    registration,
    typeCode: decoded.code,
    typeFullName: raw.desc || decoded.fullName,
    category,
    operator,
    helicopterOperator,
    fieldOperatorServed,
    lat: Number(raw.lat.toFixed(4)),
    lon: Number(raw.lon.toFixed(4)),
    altitudeFt: Math.max(0, Math.round(altFt)),
    groundSpeedKts: gsKts,
    groundSpeedMph: Math.round(gsKts * 1.15078),
    verticalRateFpm: vRate,
    trackDeg,
    squawk: raw.squawk || '----',
    originCode,
    originName,
    destinationCode,
    destinationName,
    destinationRigId,
    scheduledDepTime: nowStr,
    estimatedArrTime: etaStr,
    status:
      category === 'coastguard_sar'
        ? 'sar_medevac_active'
        : isRotary && distFromRefNm < 12
        ? 'final_approach'
        : isRotary
        ? 'outbound_to_rig'
        : 'enroute_airline',
    distanceFromRefNm: distFromRefNm,
    distanceFromRefMiles: Math.round(distFromRefNm * 1.15078 * 10) / 10,
    bearingFromRefDeg,
    etaToRefMinutes,
    source: 'live_adsb',
    trail,
  };
}

export async function resolveFlightRoutesBatch(
  flights: AircraftTarget[]
): Promise<boolean> {
  const candidates = flights
    .filter(
      (f) =>
        f.source === 'live_adsb' &&
        f.callsign &&
        f.callsign.length >= 4 &&
        !clientRouteCache.has(f.callsign)
    )
    .slice(0, 30)
    .map((f) => ({ callsign: f.callsign, lat: f.lat, lng: f.lon }));

  if (candidates.length === 0) return false;

  try {
    const res = await fetch('/api/routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planes: candidates }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.routes && typeof data.routes === 'object') {
        let added = false;
        for (const [cs, route] of Object.entries(data.routes)) {
          clientRouteCache.set(
            cs,
            route as { originCode: string; originName: string; destCode: string; destName: string }
          );
          added = true;
        }
        return added;
      }
    }
  } catch {
    // Ignore on static hosts
  }
  return false;
}

export async function fetchHybridRadarTraffic(
  centerLat: number,
  centerLon: number,
  referenceFacility: InstallationOrAirport,
  tickSeconds: number,
  includeOffshoreWaveSchedule: boolean
): Promise<{ flights: AircraftTarget[]; liveCount: number }> {
  const scheduledTraffic = includeOffshoreWaveSchedule
    ? generateActiveOffshoreAndUkTraffic(referenceFacility, tickSeconds)
    : [];

  let liveTargets: AircraftTarget[] = [];

  try {
    // 1. If running with the optional Node server (e.g. AI Studio preview), use /api/flights proxy
    const res = await fetch(
      `/api/flights?lat=${centerLat.toFixed(2)}&lon=${centerLon.toFixed(2)}&radius=250`
    );
    if (res.ok) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data?.ac) && data.ac.length > 0) {
          liveTargets = (data.ac as RawAdsbAircraft[])
            .slice(0, 220)
            .map((raw) => classifyLiveAircraft(raw, referenceFacility))
            .filter((item): item is AircraftTarget => item !== null);
        }
      }
    }
  } catch {
    // Static GitHub Pages host — proceed to direct phone-to-API queries below
  }

  // 2. Direct Phone / Browser Mode (GitHub Pages / choppercheck.com with ZERO backend server):
  // Because api.adsb.lol and opendata.adsb.fi do not send browser CORS headers (ACAO: null),
  // we query them via CORS-enabled relays with a 4-second cache-buster so aircraft move live every 4 seconds!
  if (liveTargets.length === 0) {
    const cacheBust = Math.floor(Date.now() / 4000);
    const adsbLolTarget = `https://api.adsb.lol/v2/point/${centerLat.toFixed(3)}/${centerLon.toFixed(3)}/250?_=${cacheBust}`;
    const adsbFiTarget = `https://opendata.adsb.fi/api/v2/lat/${centerLat.toFixed(3)}/lon/${centerLon.toFixed(3)}/dist/250`;

    const browserSafeUrls = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(adsbLolTarget)}&_=${cacheBust}`,
      `https://api.allorigins.win/get?url=${encodeURIComponent(adsbLolTarget)}&_=${cacheBust}`,
      `https://ais-pre-xajwn6eve4wfyqp5gx7jme-855352357329.europe-west2.run.app/api/flights?lat=${centerLat.toFixed(2)}&lon=${centerLon.toFixed(2)}&radius=250&_=${cacheBust}`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(adsbFiTarget)}&_=${cacheBust}`,
      adsbLolTarget,
      adsbFiTarget,
    ];

    for (const url of browserSafeUrls) {
      try {
        const directRes = await fetch(url, { headers: { Accept: 'application/json' } });
        if (directRes.ok) {
          const rawJson = await directRes.json();
          // Handle both raw JSON and allorigins /get wrapper ({ contents: "..." })
          const parsed =
            typeof rawJson?.contents === 'string'
              ? JSON.parse(rawJson.contents)
              : rawJson;

          const aircraftArray = parsed?.ac || parsed?.aircraft;
          if (Array.isArray(aircraftArray) && aircraftArray.length > 0) {
            liveTargets = (aircraftArray as RawAdsbAircraft[])
              .slice(0, 220)
              .map((raw) => classifyLiveAircraft(raw, referenceFacility))
              .filter((item): item is AircraftTarget => item !== null);
            if (liveTargets.length > 0) break;
          }
        }
      } catch {
        // Try next browser-safe feed
      }
    }
  }

  // 3. Secondary Direct Phone Fallback: OpenSky Network live states
  if (liveTargets.length === 0) {
    try {
      const lamin = (centerLat - 3.5).toFixed(2);
      const lamax = (centerLat + 3.5).toFixed(2);
      const lomin = (centerLon - 5.5).toFixed(2);
      const lomax = (centerLon + 5.5).toFixed(2);
      const openSkyTarget = `https://opensky-network.org/api/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
      const osRes = await fetch(openSkyTarget);
      if (osRes.ok) {
        const osJson = await osRes.json();
        if (Array.isArray(osJson?.states)) {
          liveTargets = osJson.states
            .slice(0, 150)
            .map((st: unknown[]) =>
              classifyLiveAircraft(
                {
                  hex: String(st[0] || ''),
                  flight: String(st[1] || ''),
                  lon: typeof st[5] === 'number' ? st[5] : undefined,
                  lat: typeof st[6] === 'number' ? st[6] : undefined,
                  alt_baro: typeof st[7] === 'number' ? Math.round(st[7] * 3.28084) : 2500,
                  gs: typeof st[9] === 'number' ? Math.round(st[9] * 1.94384) : 140,
                  track: typeof st[10] === 'number' ? Math.round(st[10]) : 0,
                  baro_rate: typeof st[11] === 'number' ? Math.round(st[11] * 196.85) : 0,
                  squawk: String(st[14] || '7000'),
                },
                referenceFacility
              )
            )
            .filter((item: AircraftTarget | null): item is AircraftTarget => item !== null);
        }
      }
    } catch {
      // Offline fallback
    }
  }

  // Trigger background route resolution for live ADS-B callsigns
  if (liveTargets.length > 0) {
    resolveFlightRoutesBatch(liveTargets);
  }

  const seenCallsigns = new Set(liveTargets.map((t) => t.callsign));
  const merged = [
    ...liveTargets,
    ...scheduledTraffic.filter((s) => !seenCallsigns.has(s.callsign)),
  ];

  return {
    flights: merged,
    liveCount: liveTargets.length,
  };
}

export async function fetchHelideckWeather(
  facility: InstallationOrAirport,
  customPitchDeg?: number,
  customRollDeg?: number,
  customHeaveMps?: number
): Promise<HelideckWeatherState> {
  let windSpeedKts = 22;
  let windGustKts = 29;
  let windDirectionDeg = 235;
  let tempC = 9.5;
  let qnhHpa = 1008;
  let visKm = 10;
  let waveHeightM = 2.4;
  let swellPeriodSec = 7.8;
  let cloudBaseFt = 1800;

  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${facility.lat}&longitude=${facility.lon}&current=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover&wind_speed_unit=kn`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${facility.lat}&longitude=${facility.lon}&current=wave_height,wave_period,swell_wave_height`;

    const [wxRes, marRes] = await Promise.allSettled([fetch(weatherUrl), fetch(marineUrl)]);

    if (wxRes.status === 'fulfilled' && wxRes.value.ok) {
      const wx = await wxRes.value.json();
      if (wx?.current) {
        windSpeedKts = Math.round(wx.current.wind_speed_10m ?? windSpeedKts);
        windGustKts = Math.round(wx.current.wind_gusts_10m ?? windSpeedKts + 7);
        windDirectionDeg = Math.round(wx.current.wind_direction_10m ?? windDirectionDeg);
        tempC = Number((wx.current.temperature_2m ?? tempC).toFixed(1));
        qnhHpa = Math.round(wx.current.surface_pressure ?? qnhHpa);
        visKm = Math.round(((wx.current.visibility ?? 10000) / 1000) * 10) / 10;
        const cloudCover = wx.current.cloud_cover ?? 50;
        cloudBaseFt = cloudCover > 80 ? 900 : cloudCover > 40 ? 1800 : 3200;
      }
    }

    if (marRes.status === 'fulfilled' && marRes.value.ok) {
      const mar = await marRes.value.json();
      if (mar?.current && typeof mar.current.wave_height === 'number') {
        waveHeightM = Number(mar.current.wave_height.toFixed(1));
        swellPeriodSec = Number((mar.current.wave_period ?? 7.5).toFixed(1));
      }
    }
  } catch {
    // Fallback if offline
  }

  const pitchDeg = 0;
  const rollDeg = 0;
  const heaveRateMps = 0;
  const inclinationDeg = 0;

  let cap437Status: 'GO' | 'CAUTION' | 'HOLD' = 'GO';
  let cap437Reason = `Normal Offshore Weather Conditions — Wind ${windSpeedKts}G${windGustKts} kt, Significant Wave ${waveHeightM}m`;

  if (windSpeedKts >= 55 || windGustKts >= 60 || waveHeightM >= 6.5) {
    cap437Status = 'HOLD';
    if (windSpeedKts >= 55 || windGustKts >= 60) {
      cap437Reason = `WEATHER HOLD: Live Wind/Gusts (${windSpeedKts}G${windGustKts} kt) exceed 60 kt offshore rotor engagement limit`;
    } else {
      cap437Reason = `SEA STATE HOLD: Significant Wave Height (${waveHeightM}m) exceeds severe offshore operating threshold`;
    }
  } else if (
    windSpeedKts >= 40 ||
    windGustKts >= 45 ||
    windGustKts - windSpeedKts >= 15 ||
    waveHeightM >= 4.5
  ) {
    cap437Status = 'CAUTION';
    cap437Reason = `CAUTION: Elevated offshore wind/sea state (${windSpeedKts}G${windGustKts} kt, Significant Wave ${waveHeightM}m)`;
  }

  const shoreBaseIcao =
    facility.code.length === 4 && facility.code.startsWith('E')
      ? facility.code
      : facility.primaryShoreBase || 'EGPD';

  let rawMetar = `${shoreBaseIcao} ${new Date().getUTCDate().toString().padStart(2, '0')}${new Date()
    .getUTCHours()
    .toString()
    .padStart(2, '0')}20Z ${String(windDirectionDeg).padStart(3, '0')}${String(
    windSpeedKts
  ).padStart(2, '0')}G${String(windGustKts).padStart(2, '0')}KT ${
    visKm >= 10 ? '9999' : String(Math.round(visKm * 1000)).padStart(4, '0')
  } ${cloudBaseFt < 1000 ? 'BKN008' : 'SCT022'} ${Math.round(tempC)
    .toString()
    .padStart(2, '0')}/${Math.max(0, Math.round(tempC - 2))
    .toString()
    .padStart(2, '0')} Q${qnhHpa}`;
  let rawTaf = `TAF ${shoreBaseIcao} 24-HR FORECAST: WIND ${String(windDirectionDeg).padStart(
    3,
    '0'
  )}/${windSpeedKts}KT VIS ${visKm}KM CLOUD BASE ${cloudBaseFt}FT`;
  let flightCategory: 'VFR' | 'MVFR' | 'IFR' | 'LIFR' = 'VFR';

  let metarLoaded = false;
  try {
    const metarRes = await fetch(`/api/metar?icao=${shoreBaseIcao}`);
    if (metarRes.ok) {
      const cType = metarRes.headers.get('content-type') || '';
      if (cType.includes('application/json')) {
        const mData = await metarRes.json();
        if (Array.isArray(mData) && mData.length > 0 && mData[0]?.rawOb) {
          rawMetar = String(mData[0].rawOb);
          if (mData[0].rawTaf) rawTaf = String(mData[0].rawTaf);
          if (mData[0].fltCat) flightCategory = mData[0].fltCat;
          metarLoaded = true;
        }
      }
    }
  } catch {
    // Proceed to direct browser-safe METAR relay below
  }

  if (!metarLoaded) {
    try {
      const targetMetarUrl = `https://aviationweather.gov/api/data/metar?ids=${shoreBaseIcao}&format=json&taf=true`;
      const relayMetarRes = await fetch(
        `https://api.allorigins.win/raw?url=${encodeURIComponent(targetMetarUrl)}&disableCache=true`
      );
      if (relayMetarRes.ok) {
        const mData = await relayMetarRes.json();
        if (Array.isArray(mData) && mData.length > 0 && mData[0]?.rawOb) {
          rawMetar = String(mData[0].rawOb);
          if (mData[0].rawTaf) rawTaf = String(mData[0].rawTaf);
          if (mData[0].fltCat) flightCategory = mData[0].fltCat;
        }
      }
    } catch {
      // Fallback to synthesized METAR from live Open-Meteo telemetry
    }
  }

  if (cloudBaseFt < 500 || visKm < 1.5) flightCategory = 'LIFR';
  else if (cloudBaseFt < 1000 || visKm < 5.0) flightCategory = 'IFR';
  else if (cloudBaseFt <= 2500 || visKm <= 8.0) flightCategory = 'MVFR';

  // Compute plain-English Heliport Fog / Haar & Wind Delay Risk
  let delayRiskLevel: 'LOW' | 'MODERATE' | 'HIGH' = 'LOW';
  let delayRiskSummary = `Normal Heliport Operations at ${shoreBaseIcao} — Good visibility (${visKm} km) and cloud base (${cloudBaseFt.toLocaleString()} ft).`;

  const metarUpper = rawMetar.toUpperCase();
  const hasFogOrMist =
    metarUpper.includes(' FG ') ||
    metarUpper.includes(' BCFG ') ||
    metarUpper.includes(' FZFG ') ||
    visKm < 1.5 ||
    cloudBaseFt < 500;

  if (cap437Status === 'HOLD' || hasFogOrMist || flightCategory === 'LIFR') {
    delayRiskLevel = 'HIGH';
    if (hasFogOrMist || flightCategory === 'LIFR') {
      delayRiskSummary = `HIGH DELAY RISK (${shoreBaseIcao} Haar / Low Cloud): Cloud base ${cloudBaseFt} ft / Vis ${visKm} km below offshore ARA landing minima. Expect shore holds.`;
    } else {
      delayRiskSummary = `HIGH DELAY RISK: Offshore wind/sea state (${windSpeedKts}G${windGustKts} kt, Hs ${waveHeightM}m) exceeds helideck landing limits.`;
    }
  } else if (
    cap437Status === 'CAUTION' ||
    flightCategory === 'IFR' ||
    metarUpper.includes(' BR ') ||
    windGustKts >= 38
  ) {
    delayRiskLevel = 'MODERATE';
    delayRiskSummary = `MODERATE DELAY RISK (${shoreBaseIcao}): ${flightCategory} conditions (Cloud base ${cloudBaseFt.toLocaleString()} ft, Wind ${windSpeedKts}G${windGustKts} kt). Possible payload restriction or Instrument Approach spacing.`;
  }

  return {
    windSpeedKts,
    windGustKts,
    windDirectionDeg,
    significantWaveHeightM: waveHeightM,
    maxWaveHeightM: Number((waveHeightM * 1.65).toFixed(1)),
    swellPeriodSec,
    visibilityKm: visKm,
    temperatureC: tempC,
    pressureQnhHpa: qnhHpa,
    cloudBaseFt,
    vesselPitchDeg: pitchDeg,
    vesselRollDeg: rollDeg,
    vesselHeaveRateMps: heaveRateMps,
    vesselInclinationDeg: inclinationDeg,
    cap437Status,
    cap437Reason,
    updatedAt: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    shoreBaseIcao,
    rawMetar,
    rawTaf,
    flightCategory,
    delayRiskLevel,
    delayRiskSummary,
  };
}
