
export const AIRCRAFT_TYPE_NAMES: Record<string, { fullName: string; isRotary: boolean }> = {
  // Rotary-Wing / Offshore & SAR Helicopters
  S92: { fullName: 'Sikorsky S-92', isRotary: true },
  EC75: { fullName: 'Airbus Helicopters H175', isRotary: true },
  H175: { fullName: 'Airbus Helicopters H175', isRotary: true },
  A189: { fullName: 'Leonardo AW189', isRotary: true },
  A139: { fullName: 'Leonardo AW139', isRotary: true },
  A169: { fullName: 'Leonardo AW169', isRotary: true },
  A101: { fullName: 'Leonardo AW101 Merlin', isRotary: true },
  EC25: { fullName: 'Airbus H225 Super Puma', isRotary: true },
  AS32: { fullName: 'Airbus AS332 Super Puma', isRotary: true },
  EC55: { fullName: 'Airbus EC155 Dauphin', isRotary: true },
  AS65: { fullName: 'Airbus AS365 Dauphin', isRotary: true },
  EC35: { fullName: 'Airbus H135', isRotary: true },
  EC45: { fullName: 'Airbus H145', isRotary: true },
  S76: { fullName: 'Sikorsky S-76', isRotary: true },
  B412: { fullName: 'Bell 412', isRotary: true },
  R44: { fullName: 'Robinson R44', isRotary: true },
  EH10: { fullName: 'Leonardo AW101 Merlin', isRotary: true },
  A109: { fullName: 'Leonardo AW109', isRotary: true },
  A119: { fullName: 'Leonardo AW119', isRotary: true },
  H160: { fullName: 'Airbus H160', isRotary: true },
  EC30: { fullName: 'Airbus H130', isRotary: true },
  AS50: { fullName: 'Airbus AS350 Squirrel', isRotary: true },
  EC20: { fullName: 'Airbus EC120', isRotary: true },
  H60: { fullName: 'Sikorsky S-70 Black Hawk', isRotary: true },
  S61: { fullName: 'Sikorsky S-61', isRotary: true },
  H47: { fullName: 'Boeing Chinook', isRotary: true },
  PUMA: { fullName: 'Puma', isRotary: true },
  LYNX: { fullName: 'Lynx / Wildcat', isRotary: true },
  R22: { fullName: 'Robinson R22', isRotary: true },
  R66: { fullName: 'Robinson R66', isRotary: true },
  B06: { fullName: 'Bell 206', isRotary: true },
  B429: { fullName: 'Bell 429', isRotary: true },

  // UK Regional, Domestic & International Fixed-Wing
  AT76: { fullName: 'ATR 72-600', isRotary: false },
  AT45: { fullName: 'ATR 42-500', isRotary: false },
  E145: { fullName: 'Embraer ERJ-145', isRotary: false },
  E170: { fullName: 'Embraer E170', isRotary: false },
  E190: { fullName: 'Embraer E190', isRotary: false },
  DH8D: { fullName: 'De Havilland Dash 8 Q400', isRotary: false },
  SF34: { fullName: 'Saab 340', isRotary: false },
  DHC6: { fullName: 'DHC-6 Twin Otter', isRotary: false },
  JS41: { fullName: 'BAe Jetstream 41', isRotary: false },
  B738: { fullName: 'Boeing 737-800', isRotary: false },
  B38M: { fullName: 'Boeing 737 MAX 8', isRotary: false },
  A319: { fullName: 'Airbus A319', isRotary: false },
  A320: { fullName: 'Airbus A320', isRotary: false },
  A20N: { fullName: 'Airbus A320neo', isRotary: false },
  A321: { fullName: 'Airbus A321', isRotary: false },
  A21N: { fullName: 'Airbus A321neo', isRotary: false },
  B77W: { fullName: 'Boeing 777-300ER', isRotary: false },
  B789: { fullName: 'Boeing 787-9 Dreamliner', isRotary: false },
  A35K: { fullName: 'Airbus A350-1000', isRotary: false },

  // Cargo, SAR fixed-wing & military
  B748: { fullName: 'Boeing 747-8', isRotary: false },
  B744: { fullName: 'Boeing 747-400', isRotary: false },
  B77L: { fullName: 'Boeing 777 Freighter', isRotary: false },
  C17: { fullName: 'Boeing C-17A Globemaster III', isRotary: false },
  A400: { fullName: 'Airbus A400M Atlas', isRotary: false },
  C130: { fullName: 'Lockheed C-130 Hercules', isRotary: false },
  P8: { fullName: 'Boeing P-8 Poseidon', isRotary: false },
  BE20: { fullName: 'Beechcraft King Air 200', isRotary: false },
  AT72: { fullName: 'ATR 72', isRotary: false },
  AT75: { fullName: 'ATR 72-500', isRotary: false },
  DH8A: { fullName: 'Dash 8-100', isRotary: false },
  DH8B: { fullName: 'Dash 8-200', isRotary: false },
  DH8C: { fullName: 'Dash 8-300', isRotary: false },
  E195: { fullName: 'Embraer E195', isRotary: false },
  E75L: { fullName: 'Embraer E175', isRotary: false },
  E290: { fullName: 'Embraer E190-E2', isRotary: false },
  E295: { fullName: 'Embraer E195-E2', isRotary: false },
  BCS1: { fullName: 'Airbus A220-100', isRotary: false },
  BCS3: { fullName: 'Airbus A220-300', isRotary: false },
  CRJ7: { fullName: 'Bombardier CRJ700', isRotary: false },
  CRJ9: { fullName: 'Bombardier CRJ900', isRotary: false },
  B737: { fullName: 'Boeing 737-700', isRotary: false },
  B739: { fullName: 'Boeing 737-900', isRotary: false },
  B39M: { fullName: 'Boeing 737 MAX 9', isRotary: false },
  B752: { fullName: 'Boeing 757-200', isRotary: false },
  B763: { fullName: 'Boeing 767-300', isRotary: false },
  B772: { fullName: 'Boeing 777-200', isRotary: false },
  B788: { fullName: 'Boeing 787-8 Dreamliner', isRotary: false },
  B78X: { fullName: 'Boeing 787-10 Dreamliner', isRotary: false },
  A19N: { fullName: 'Airbus A319neo', isRotary: false },
  A332: { fullName: 'Airbus A330-200', isRotary: false },
  A333: { fullName: 'Airbus A330-300', isRotary: false },
  A339: { fullName: 'Airbus A330-900neo', isRotary: false },
  A359: { fullName: 'Airbus A350-900', isRotary: false },
  A388: { fullName: 'Airbus A380', isRotary: false },
  B350: { fullName: 'Beechcraft King Air 350', isRotary: false },
  BE9L: { fullName: 'Beechcraft King Air 90', isRotary: false },
  C208: { fullName: 'Cessna 208 Caravan', isRotary: false },
  PC12: { fullName: 'Pilatus PC-12', isRotary: false },
  BN2P: { fullName: 'Britten-Norman Islander', isRotary: false },
  DA42: { fullName: 'Diamond DA42', isRotary: false },
  P28A: { fullName: 'Piper PA-28', isRotary: false },
  C172: { fullName: 'Cessna 172', isRotary: false },
  C152: { fullName: 'Cessna 152', isRotary: false },
  SR22: { fullName: 'Cirrus SR22', isRotary: false },
  A30B: { fullName: 'Airbus A300', isRotary: false },
  B762: { fullName: 'Boeing 767-200', isRotary: false },
  E35L: { fullName: 'Embraer Legacy 600', isRotary: false },
  C25A: { fullName: 'Cessna Citation CJ2', isRotary: false },
  C56X: { fullName: 'Cessna Citation Excel', isRotary: false },
  GLF6: { fullName: 'Gulfstream G650', isRotary: false },
  GLEX: { fullName: 'Bombardier Global Express', isRotary: false },
  CL60: { fullName: 'Bombardier Challenger 600', isRotary: false },
  PC24: { fullName: 'Pilatus PC-24', isRotary: false },
  EUFI: { fullName: 'Eurofighter Typhoon', isRotary: false },
  F35: { fullName: 'Lockheed F-35 Lightning', isRotary: false },
  K35R: { fullName: 'Boeing KC-135 Stratotanker', isRotary: false },
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
    /^(A139|A169|A189|EH10)$/.test(cleanCode) ||
    cleanCode.startsWith('EC') ||
    cleanCode.startsWith('AS') ||
    /^[HG][1-9]/.test(upperDesc) ||
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

