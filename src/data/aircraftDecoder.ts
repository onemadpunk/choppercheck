import {
  AircraftTarget,
  FieldOperator,
  HelicopterOperator,
  InstallationOrAirport,
  TrafficCategory,
  TrailPoint,
} from '../types/radar';
import { INSTALLATIONS_AND_AIRPORTS } from './installationsAndAirports';

export const AIRCRAFT_TYPE_NAMES: Record<string, { fullName: string; isRotary: boolean }> = {
  // Rotary-Wing / Offshore & SAR Helicopters
  S92: { fullName: 'Sikorsky S-92A Helibus', isRotary: true },
  H175: { fullName: 'Airbus Helicopters H175', isRotary: true },
  A189: { fullName: 'Leonardo AW189', isRotary: true },
  A139: { fullName: 'Leonardo AW139', isRotary: true },
  A169: { fullName: 'Leonardo AW169', isRotary: true },
  A101: { fullName: 'Leonardo AW101 (SAR Queen / Merlin)', isRotary: true },
  EC25: { fullName: 'Airbus H225 Super Puma', isRotary: true },
  AS32: { fullName: 'Airbus AS332 L2 Super Puma', isRotary: true },
  EC55: { fullName: 'Airbus EC155 B1 Dauphin', isRotary: true },
  AS65: { fullName: 'Airbus AS365 N3 Dauphin', isRotary: true },
  EC35: { fullName: 'Airbus H135 Helimed / Offshore Wind', isRotary: true },
  EC45: { fullName: 'Airbus H145 D3', isRotary: true },
  S76: { fullName: 'Sikorsky S-76C++', isRotary: true },
  B412: { fullName: 'Bell 412EP', isRotary: true },
  R44: { fullName: 'Robinson R44 Raven II', isRotary: true },

  // UK Regional, Domestic & International Fixed-Wing
  AT76: { fullName: 'ATR 72-600 Regional Turboprop', isRotary: false },
  AT45: { fullName: 'ATR 42-500 Regional Turboprop', isRotary: false },
  E145: { fullName: 'Embraer ERJ-145 EP', isRotary: false },
  E170: { fullName: 'Embraer E170LR', isRotary: false },
  E190: { fullName: 'Embraer E190SR', isRotary: false },
  DH8D: { fullName: 'De Havilland Dash 8 Q400', isRotary: false },
  SF34: { fullName: 'Saab 340B Regional', isRotary: false },
  DHC6: { fullName: 'De Havilland DHC-6-400 Twin Otter', isRotary: false },
  JS41: { fullName: 'BAe Jetstream 41', isRotary: false },
  B738: { fullName: 'Boeing 737-800', isRotary: false },
  B38M: { fullName: 'Boeing 737 MAX 8', isRotary: false },
  A319: { fullName: 'Airbus A319-111', isRotary: false },
  A320: { fullName: 'Airbus A320-214', isRotary: false },
  A20N: { fullName: 'Airbus A320neo', isRotary: false },
  A321: { fullName: 'Airbus A321-231', isRotary: false },
  A21N: { fullName: 'Airbus A321neo', isRotary: false },
  B77W: { fullName: 'Boeing 777-300ER', isRotary: false },
  B789: { fullName: 'Boeing 787-9 Dreamliner', isRotary: false },
  A35K: { fullName: 'Airbus A350-1000', isRotary: false },

  // Cargo, SAR Fixed-Wing & Military (Common at Prestwick EGPK, Lossiemouth EGQS, Brize Norton)
  B748: { fullName: 'Boeing 747-8F Freighter', isRotary: false },
  B744: { fullName: 'Boeing 747-400F Cargo', isRotary: false },
  B77L: { fullName: 'Boeing 777-F Cargo', isRotary: false },
  C17: { fullName: 'Boeing C-17A Globemaster III', isRotary: false },
  A400: { fullName: 'Airbus A400M Atlas', isRotary: false },
  C130: { fullName: 'Lockheed C-130J Super Hercules', isRotary: false },
  P8: { fullName: 'Boeing P-8A Poseidon MRA1', isRotary: false },
  BE20: { fullName: 'Beechcraft King Air B200 (HM Coastguard / Air Ambulance)', isRotary: false },
};

export function decodeAircraftType(typeCode?: string, fallbackDesc?: string): {
  code: string;
  fullName: string;
  isRotary: boolean;
} {
  const cleanCode = (typeCode || '').trim().toUpperCase();
  if (cleanCode && AIRCRAFT_TYPE_NAMES[cleanCode]) {
    return {
      code: cleanCode,
      fullName: AIRCRAFT_TYPE_NAMES[cleanCode].fullName,
      isRotary: AIRCRAFT_TYPE_NAMES[cleanCode].isRotary,
    };
  }
  const upperDesc = (fallbackDesc || '').toUpperCase();
  const isHeli =
    cleanCode.startsWith('S92') ||
    cleanCode.startsWith('H175') ||
    cleanCode.startsWith('A1') ||
    cleanCode.startsWith('EC') ||
    cleanCode.startsWith('AS') ||
    upperDesc.includes('HELI') ||
    upperDesc.includes('SIKORSKY') ||
    upperDesc.includes('AW1');

  return {
    code: cleanCode || 'ACFT',
    fullName: fallbackDesc || (cleanCode ? `Aircraft (${cleanCode})` : 'Tracked Aircraft'),
    isRotary: isHeli,
  };
}

export function calculateDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_NM = 3440.065; // Earth radius in Nautical Miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R_NM * c * 10) / 10;
}

export function calculateBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return Math.round(((theta * 180) / Math.PI + 360) % 360);
}

export function interpolatePosition(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  fraction: number
): { lat: number; lon: number } {
  const f = Math.max(0, Math.min(1, fraction));
  return {
    lat: Number((lat1 + (lat2 - lat1) * f).toFixed(4)),
    lon: Number((lon1 + (lon2 - lon1) * f).toFixed(4)),
  };
}

export function buildTrail(
  originLat: number,
  originLon: number,
  currentLat: number,
  currentLon: number,
  cruiseAltFt: number
): TrailPoint[] {
  const steps = 8;
  const now = Date.now();
  const points: TrailPoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const pos = interpolatePosition(originLat, originLon, currentLat, currentLon, frac);
    const altFactor = i === 0 ? 0.15 : i === 1 ? 0.6 : 1;
    points.push({
      lat: pos.lat,
      lon: pos.lon,
      altFt: Math.round(cruiseAltFt * altFactor),
      timestamp: now - (steps - i) * 180000,
    });
  }
  return points;
}

interface SeedFlightSpec {
  hex: string;
  callsign: string;
  flightNumber: string;
  registration: string;
  typeCode: string;
  category: TrafficCategory;
  operator: string;
  helicopterOperator?: HelicopterOperator;
  fieldOperatorServed?: FieldOperator;
  originId: string;
  destId: string;
  baseProgress: number; // 0..1 along route
  altitudeFt: number;
  groundSpeedKts: number;
  verticalRateFpm: number;
  squawk: string;
  depOffsetMins: number;
  durationMins: number;
  returnOffsetMins?: number;
  forceLowAltCoasting?: boolean;
  heliAdminCheckInTime?: string;
  heliAdminFlightName?: string;
  plannedRouteCodes?: string[];
  fixedWingLink?: string;
}

const ACTIVE_SEED_FLIGHTS: SeedFlightSpec[] = [
  // =========================================================================
  // APACHE NORTH SEA CREW CHANGE WAVES (FORTIES & BERYL — REAL HELI-ADMIN SHEETS)
  // =========================================================================
  {
    hex: '4071A1',
    callsign: 'GOLD631',
    flightNumber: 'APFOR2/1 (GOLD631)',
    registration: 'G-NHVG',
    typeCode: 'H175',
    category: 'offshore_heli',
    operator: 'NHV Helicopters (Apache Forties APFOR2/1)',
    helicopterOperator: 'NHV',
    fieldOperatorServed: 'Apache',
    originId: 'apt-egpd',
    destId: 'apache-forties-charlie',
    baseProgress: 0.78,
    altitudeFt: 1850,
    groundSpeedKts: 138,
    verticalRateFpm: -350,
    squawk: '7021',
    depOffsetMins: -42,
    durationMins: 54,
    returnOffsetMins: 35,
    heliAdminCheckInTime: '10:30',
    heliAdminFlightName: 'APFOR2/1',
    plannedRouteCodes: ['ABZ', 'FA', 'FD', 'FC', 'ABZ'],
  },
  {
    hex: '4071A2',
    callsign: 'GOLD632',
    flightNumber: 'APFOR1/1 (GOLD632)',
    registration: 'G-NHVU',
    typeCode: 'H175',
    category: 'offshore_heli',
    operator: 'NHV Helicopters (Apache Forties Contract)',
    helicopterOperator: 'NHV',
    fieldOperatorServed: 'Apache',
    originId: 'apache-forties-alpha',
    destId: 'apt-egpd',
    baseProgress: 0.44,
    altitudeFt: 3000,
    groundSpeedKts: 145,
    verticalRateFpm: 0,
    squawk: '7022',
    depOffsetMins: -24,
    durationMins: 52,
    heliAdminCheckInTime: '08:15',
    heliAdminFlightName: 'APFOR1/1',
    plannedRouteCodes: ['ABZ', 'FA', 'FB', 'ABZ'],
  },
  {
    hex: '406B81',
    callsign: 'BHL52B',
    flightNumber: 'BHL 52B',
    registration: 'G-MCGY',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Helicopters (Apache Beryl Shuttle)',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'Apache',
    originId: 'apt-egpd',
    destId: 'apache-beryl-alpha',
    baseProgress: 0.88,
    altitudeFt: 850,
    groundSpeedKts: 112,
    verticalRateFpm: -450,
    squawk: '7025',
    depOffsetMins: -76,
    durationMins: 86,
    returnOffsetMins: 40,
    forceLowAltCoasting: true,
    heliAdminCheckInTime: '09:30',
    heliAdminFlightName: 'APBER1/1',
    plannedRouteCodes: ['ABZ', 'BA', 'BB', 'ABZ'],
  },
  {
    hex: '406C92',
    callsign: 'OHS39D',
    flightNumber: 'OHS 39D',
    registration: 'G-OSSL',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Offshore Helicopter Services (Apache Forties Delta)',
    helicopterOperator: 'OHS',
    fieldOperatorServed: 'Apache',
    originId: 'apt-egpd',
    destId: 'apache-forties-delta',
    baseProgress: 0.32,
    altitudeFt: 3500,
    groundSpeedKts: 142,
    verticalRateFpm: 0,
    squawk: '7024',
    depOffsetMins: -18,
    durationMins: 55,
    returnOffsetMins: 60,
    plannedRouteCodes: ['ABZ', 'FD', 'FC', 'ABZ'],
  },

  // =========================================================================
  // WEST OF SHETLAND CREW CHANGE WAVES (GLEN LYON BP GL3, CLAIR RIDGE, ROSEBANK)
  // =========================================================================
  {
    hex: '406A14',
    callsign: '60B-YG',
    flightNumber: 'BP GL3 (60B-YG)',
    registration: 'G-IASB',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Helicopters (bp Glen Lyon FPSO Shuttle)',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'bp',
    originId: 'wos-glen-lyon-fpso',
    destId: 'apt-egpb',
    baseProgress: 0.56,
    altitudeFt: 3000,
    groundSpeedKts: 144,
    verticalRateFpm: 0,
    squawk: '2644',
    depOffsetMins: -28,
    durationMins: 48,
    heliAdminCheckInTime: '08:45',
    heliAdminFlightName: 'BP GL3',
    plannedRouteCodes: ['LSI', 'GL', 'LSI'],
    fixedWingLink: 'Outbound BP FW3 / Inbound BP FW6 (LSI ↔ ABZ)',
  },
  {
    hex: '406A11',
    callsign: 'BHL801',
    flightNumber: 'BP CL1 (BHL 801)',
    registration: 'G-CIAY',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Helicopters (West of Shetland Clair Ridge)',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'bp',
    originId: 'apt-egpb',
    destId: 'wos-clair-ridge',
    baseProgress: 0.72,
    altitudeFt: 1600,
    groundSpeedKts: 134,
    verticalRateFpm: -300,
    squawk: '2641',
    depOffsetMins: -22,
    durationMins: 32,
    returnOffsetMins: 30,
    heliAdminCheckInTime: '09:15',
    heliAdminFlightName: 'BP CL1',
    plannedRouteCodes: ['LSI', 'CRG', 'CL1', 'LSI'],
  },
  {
    hex: '406A19',
    callsign: 'HKS829',
    flightNumber: 'CHC 829',
    registration: 'G-CHCK',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'CHC Scotia (West of Shetland Atlantic Margin)',
    helicopterOperator: 'CHC',
    fieldOperatorServed: 'Equinor',
    originId: 'apt-egpb',
    destId: 'wos-rosebank',
    baseProgress: 0.64,
    altitudeFt: 2400,
    groundSpeedKts: 139,
    verticalRateFpm: 0,
    squawk: '2650',
    depOffsetMins: -31,
    durationMins: 48,
    returnOffsetMins: 42,
    plannedRouteCodes: ['LSI', 'RSB', 'LSI'],
  },

  // =========================================================================
  // UK CENTRAL & NORTHERN NORTH SEA (TotalEnergies TTCULZFR, bp, Shell, Harbour, CNOOC)
  // =========================================================================
  {
    hex: '406D11',
    callsign: 'NHZ118',
    flightNumber: 'TTCULZFR (NHZ 118)',
    registration: 'G-NHVV',
    typeCode: 'H175',
    category: 'offshore_heli',
    operator: 'NHV / TotalEnergies (Culzean & Elgin-Franklin Loop)',
    helicopterOperator: 'NHV',
    fieldOperatorServed: 'TotalEnergies',
    originId: 'apt-egpd',
    destId: 'uk-culzean',
    baseProgress: 0.82,
    altitudeFt: 1400,
    groundSpeedKts: 136,
    verticalRateFpm: -400,
    squawk: '7038',
    depOffsetMins: -46,
    durationMins: 56,
    returnOffsetMins: 32,
    heliAdminCheckInTime: '06:00',
    heliAdminFlightName: 'TTCULZFR',
    plannedRouteCodes: ['ABZ', 'CULZ', 'AILS', 'EPUQ', 'FRNK', 'EPUQ', 'ABZ'],
  },
  {
    hex: '406D01',
    callsign: 'BHL210',
    flightNumber: 'BHL 210',
    registration: 'G-BHLB',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Helicopters',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'bp',
    originId: 'apt-egpd',
    destId: 'uk-etap',
    baseProgress: 0.68,
    altitudeFt: 2500,
    groundSpeedKts: 141,
    verticalRateFpm: 0,
    squawk: '7031',
    depOffsetMins: -38,
    durationMins: 56,
    returnOffsetMins: 45,
    plannedRouteCodes: ['ABZ', 'ETP', 'ABZ'],
  },
  {
    hex: '406D05',
    callsign: 'HKS305',
    flightNumber: 'CHC 305',
    registration: 'G-WNSR',
    typeCode: 'A189',
    category: 'offshore_heli',
    operator: 'CHC Scotia',
    helicopterOperator: 'CHC',
    fieldOperatorServed: 'Shell',
    originId: 'uk-shearwater',
    destId: 'apt-egpd',
    baseProgress: 0.61,
    altitudeFt: 3000,
    groundSpeedKts: 148,
    verticalRateFpm: 0,
    squawk: '7034',
    depOffsetMins: -35,
    durationMins: 58,
    plannedRouteCodes: ['ABZ', 'SHW', 'GAN', 'ABZ'],
  },
  {
    hex: '406D18',
    callsign: 'BHL142',
    flightNumber: 'BHL 142',
    registration: 'G-CIAC',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Helicopters',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'Harbour Energy',
    originId: 'apt-egpd',
    destId: 'uk-britannia',
    baseProgress: 0.51,
    altitudeFt: 3200,
    groundSpeedKts: 140,
    verticalRateFpm: 0,
    squawk: '7040',
    depOffsetMins: -28,
    durationMins: 54,
    returnOffsetMins: 50,
  },
  {
    hex: '406D22',
    callsign: 'HKS109',
    flightNumber: 'CHC 109',
    registration: 'G-SNSA',
    typeCode: 'A139',
    category: 'offshore_heli',
    operator: 'CHC Scotia',
    helicopterOperator: 'CHC',
    fieldOperatorServed: 'CNOOC',
    originId: 'apt-egpd',
    destId: 'uk-buzzard',
    baseProgress: 0.75,
    altitudeFt: 1500,
    groundSpeedKts: 135,
    verticalRateFpm: -250,
    squawk: '7042',
    depOffsetMins: -21,
    durationMins: 28,
    returnOffsetMins: 25,
  },
  {
    hex: '406D29',
    callsign: 'OHS504',
    flightNumber: 'OHS 504',
    registration: 'G-MCSA',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Offshore Helicopter Services',
    helicopterOperator: 'OHS',
    fieldOperatorServed: 'Ithaca Energy',
    originId: 'uk-captain-fpso',
    destId: 'apt-egpd',
    baseProgress: 0.48,
    altitudeFt: 2800,
    groundSpeedKts: 142,
    verticalRateFpm: 0,
    squawk: '7045',
    depOffsetMins: -16,
    durationMins: 34,
  },

  // =========================================================================
  // NORWEGIAN CONTINENTAL SHELF (STAVANGER ENZV & BERGEN ENBR)
  // =========================================================================
  {
    hex: '4781B1',
    callsign: 'HKS241',
    flightNumber: 'HKS 241',
    registration: 'LN-OQN',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'CHC Helikopter Service (Norway)',
    helicopterOperator: 'CHC',
    fieldOperatorServed: 'Equinor',
    originId: 'apt-enzv',
    destId: 'no-johan-sverdrup',
    baseProgress: 0.69,
    altitudeFt: 2500,
    groundSpeedKts: 143,
    verticalRateFpm: 0,
    squawk: '5412',
    depOffsetMins: -29,
    durationMins: 42,
    returnOffsetMins: 35,
  },
  {
    hex: '4781B5',
    callsign: 'BHL612',
    flightNumber: 'BHL 612',
    registration: 'LN-Osa',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Norway AS',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'Equinor',
    originId: 'apt-enbr',
    destId: 'no-troll-a',
    baseProgress: 0.77,
    altitudeFt: 1400,
    groundSpeedKts: 132,
    verticalRateFpm: -350,
    squawk: '5420',
    depOffsetMins: -18,
    durationMins: 24,
    returnOffsetMins: 25,
  },
  {
    hex: '4781B9',
    callsign: 'BHL705',
    flightNumber: 'BHL 705',
    registration: 'LN-ONZ',
    typeCode: 'S92',
    category: 'offshore_heli',
    operator: 'Bristow Norway AS',
    helicopterOperator: 'Bristow',
    fieldOperatorServed: 'ConocoPhillips',
    originId: 'no-ekofisk',
    destId: 'apt-enzv',
    baseProgress: 0.52,
    altitudeFt: 3500,
    groundSpeedKts: 146,
    verticalRateFpm: 0,
    squawk: '5431',
    depOffsetMins: -42,
    durationMins: 80,
  },

  // =========================================================================
  // HM COASTGUARD (HMCG) & OFFSHORE SAR / MEDEVAC FLIGHTS
  // =========================================================================
  {
    hex: '406F99',
    callsign: 'RESCUE199',
    flightNumber: 'SRG 199 (Medevac)',
    registration: 'G-MCGP',
    typeCode: 'A189',
    category: 'coastguard_sar',
    operator: 'HM Coastguard Search & Rescue (Prestwick Base)',
    helicopterOperator: 'HM Coastguard',
    fieldOperatorServed: 'HM Coastguard / SAR',
    originId: 'apt-egpk',
    destId: 'hosp-qeuh',
    baseProgress: 0.42,
    altitudeFt: 1650,
    groundSpeedKts: 152,
    verticalRateFpm: 0,
    squawk: '0020',
    depOffsetMins: -8,
    durationMins: 19,
  },
  {
    hex: '406F90',
    callsign: 'RESCUE900',
    flightNumber: 'SRG 900 (Offshore SAR)',
    registration: 'G-MCGG',
    typeCode: 'S92',
    category: 'coastguard_sar',
    operator: 'HM Coastguard Search & Rescue (Sumburgh Base)',
    helicopterOperator: 'HM Coastguard',
    fieldOperatorServed: 'HM Coastguard / SAR',
    originId: 'wos-clair-ridge',
    destId: 'apt-egpb',
    baseProgress: 0.63,
    altitudeFt: 2200,
    groundSpeedKts: 155,
    verticalRateFpm: 0,
    squawk: '0020',
    depOffsetMins: -19,
    durationMins: 30,
  },
  {
    hex: '406F51',
    callsign: 'RESCUE151',
    flightNumber: 'SRG 151 (Compassionate / Medevac)',
    registration: 'G-MCGO',
    typeCode: 'A189',
    category: 'coastguard_sar',
    operator: 'HM Coastguard Search & Rescue (Inverness Base)',
    helicopterOperator: 'HM Coastguard',
    fieldOperatorServed: 'HM Coastguard / SAR',
    originId: 'apache-forties-charlie',
    destId: 'hosp-ari',
    baseProgress: 0.71,
    altitudeFt: 2100,
    groundSpeedKts: 156,
    verticalRateFpm: -200,
    squawk: '0020',
    depOffsetMins: -34,
    durationMins: 48,
  },

  // =========================================================================
  // UK DOMESTIC ONWARD CREW CONNECTIONS & AYRSHIRE / PRESTWICK / GLASGOW TRAFFIC
  // =========================================================================
  {
    hex: '405E11',
    callsign: 'LOG82W',
    flightNumber: 'LM 82 (Sumburgh -> Aberdeen)',
    registration: 'G-LMRD',
    typeCode: 'AT76',
    category: 'commercial_fixed_wing',
    operator: 'Loganair (Offshore Crew Fixed-Wing Link)',
    helicopterOperator: 'Commercial Airline',
    fieldOperatorServed: 'UK Airport / Heliport',
    originId: 'apt-egpb',
    destId: 'apt-egpd',
    baseProgress: 0.66,
    altitudeFt: 15000,
    groundSpeedKts: 265,
    verticalRateFpm: -600,
    squawk: '4215',
    depOffsetMins: -32,
    durationMins: 50,
  },
  {
    hex: '405E18',
    callsign: 'LOG41G',
    flightNumber: 'LM 41 (Aberdeen -> Teesside & Newcastle)',
    registration: 'G-SAJC',
    typeCode: 'E145',
    category: 'commercial_fixed_wing',
    operator: 'Loganair',
    helicopterOperator: 'Commercial Airline',
    fieldOperatorServed: 'UK Airport / Heliport',
    originId: 'apt-egpd',
    destId: 'apt-egnv',
    baseProgress: 0.54,
    altitudeFt: 23000,
    groundSpeedKts: 395,
    verticalRateFpm: 0,
    squawk: '4231',
    depOffsetMins: -24,
    durationMins: 45,
  },
  {
    hex: '405E22',
    callsign: 'BAW1313',
    flightNumber: 'BA 1313 (Aberdeen -> London Heathrow)',
    registration: 'G-EUYR',
    typeCode: 'A320',
    category: 'commercial_fixed_wing',
    operator: 'British Airways',
    helicopterOperator: 'Commercial Airline',
    fieldOperatorServed: 'UK Airport / Heliport',
    originId: 'apt-egpd',
    destId: 'apt-egll',
    baseProgress: 0.45,
    altitudeFt: 35000,
    groundSpeedKts: 448,
    verticalRateFpm: 0,
    squawk: '5211',
    depOffsetMins: -36,
    durationMins: 82,
  },
  {
    hex: '405E29',
    callsign: 'LOG33B',
    flightNumber: 'LM 33 (Aberdeen -> Belfast City)',
    registration: 'G-SAJH',
    typeCode: 'E145',
    category: 'commercial_fixed_wing',
    operator: 'Loganair',
    helicopterOperator: 'Commercial Airline',
    fieldOperatorServed: 'UK Airport / Heliport',
    originId: 'apt-egpd',
    destId: 'apt-egac',
    baseProgress: 0.72,
    altitudeFt: 18500,
    groundSpeedKts: 370,
    verticalRateFpm: -850,
    squawk: '4244',
    depOffsetMins: -38,
    durationMins: 54,
  },
  {
    hex: '405E34',
    callsign: 'CLX742',
    flightNumber: 'CV 742 (Prestwick Heavy Cargo)',
    registration: 'LX-VCF',
    typeCode: 'B748',
    category: 'military_cargo',
    operator: 'Cargolux Boeing 747-8F (Prestwick Approach)',
    helicopterOperator: 'Cargo / Military',
    fieldOperatorServed: 'UK Airport / Heliport',
    originId: 'apt-egll',
    destId: 'apt-egpk',
    baseProgress: 0.94,
    altitudeFt: 3200,
    groundSpeedKts: 178,
    verticalRateFpm: -950,
    squawk: '6312',
    depOffsetMins: -52,
    durationMins: 56,
  },
];

function formatClockOffset(offsetMins: number): string {
  const d = new Date(Date.now() + offsetMins * 60000);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function generateActiveOffshoreAndUkTraffic(
  referenceFacility: InstallationOrAirport,
  tickSeconds: number
): AircraftTarget[] {
  const byId = new Map(INSTALLATIONS_AND_AIRPORTS.map((item) => [item.id, item]));

  return ACTIVE_SEED_FLIGHTS.map((spec) => {
    const origin = byId.get(spec.originId) || INSTALLATIONS_AND_AIRPORTS[0];
    const dest = byId.get(spec.destId) || INSTALLATIONS_AND_AIRPORTS[1];

    // Advance progress smoothly over time so helicopters move along their routes
    const cycleDelta = ((tickSeconds * 0.0018) % 0.25);
    const liveProgress = ((spec.baseProgress + cycleDelta) % 0.96) + 0.02;

    const pos = interpolatePosition(origin.lat, origin.lon, dest.lat, dest.lon, liveProgress);
    const trackDeg = calculateBearingDeg(pos.lat, pos.lon, dest.lat, dest.lon);
    const distToDestNm = calculateDistanceNm(pos.lat, pos.lon, dest.lat, dest.lon);
    const distFromRefNm = calculateDistanceNm(
      referenceFacility.lat,
      referenceFacility.lon,
      pos.lat,
      pos.lon
    );
    const bearingFromRefDeg = calculateBearingDeg(
      referenceFacility.lat,
      referenceFacility.lon,
      pos.lat,
      pos.lon
    );

    const decoded = decodeAircraftType(spec.typeCode);
    const etaToDestMins = Math.max(1, Math.round((distToDestNm / Math.max(90, spec.groundSpeedKts)) * 60));

    const isHeadingToReference = dest.id === referenceFacility.id;
    const etaToRefMinutes = isHeadingToReference
      ? etaToDestMins
      : distFromRefNm <= 35
      ? Math.max(1, Math.round((distFromRefNm / Math.max(90, spec.groundSpeedKts)) * 60))
      : null;

    let status =
      spec.category === 'coastguard_sar'
        ? ('sar_medevac_active' as const)
        : spec.forceLowAltCoasting
        ? ('low_alt_coasting' as const)
        : distToDestNm < 12 && decoded.isRotary
        ? ('final_approach' as const)
        : dest.assetType === 'Fixed Platform' || dest.assetType === 'FPSO'
        ? ('outbound_to_rig' as const)
        : decoded.isRotary
        ? ('inbound_to_shore' as const)
        : ('enroute_airline' as const);

    return {
      hex: spec.hex,
      callsign: spec.callsign,
      flightNumber: spec.flightNumber,
      registration: spec.registration.toUpperCase(),
      typeCode: decoded.code,
      typeFullName: decoded.fullName,
      category: spec.category,
      operator: spec.operator,
      helicopterOperator: spec.helicopterOperator,
      fieldOperatorServed: spec.fieldOperatorServed,
      lat: pos.lat,
      lon: pos.lon,
      altitudeFt: spec.altitudeFt,
      groundSpeedKts: spec.groundSpeedKts,
      groundSpeedMph: Math.round(spec.groundSpeedKts * 1.15078),
      verticalRateFpm: spec.verticalRateFpm,
      trackDeg,
      squawk: spec.squawk,
      originCode: origin.code,
      originName: origin.shortName,
      destinationCode: dest.code,
      destinationName: dest.shortName,
      destinationRigId: dest.id,
      scheduledDepTime: formatClockOffset(spec.depOffsetMins),
      estimatedArrTime: formatClockOffset(etaToDestMins),
      returnShoreTime: spec.returnOffsetMins
        ? formatClockOffset(etaToDestMins + spec.returnOffsetMins)
        : undefined,
      heliAdminCheckInTime: spec.heliAdminCheckInTime,
      heliAdminFlightName: spec.heliAdminFlightName,
      plannedRouteCodes: spec.plannedRouteCodes,
      fixedWingLink: spec.fixedWingLink,
      status,
      distanceFromRefNm: distFromRefNm,
      distanceFromRefMiles: Math.round(distFromRefNm * 1.15078 * 10) / 10,
      bearingFromRefDeg,
      etaToRefMinutes,
      source: spec.forceLowAltCoasting ? 'dead_reckoning' : 'offshore_schedule',
      trail: buildTrail(origin.lat, origin.lon, pos.lat, pos.lon, spec.altitudeFt),
    };
  });
}
