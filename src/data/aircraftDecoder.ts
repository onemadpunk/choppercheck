
export const AIRCRAFT_TYPE_NAMES: Record<string, { fullName: string; isRotary: boolean }> = {
  // Rotary-Wing / Offshore & SAR Helicopters
  S92: { fullName: 'Sikorsky S-92', isRotary: true },
  EC75: { fullName: 'Airbus Helicopters H175', isRotary: true },
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
  A319: { fullName: 'Airbus A319', isRotary: false },
  A320: { fullName: 'Airbus A320', isRotary: false },
  A20N: { fullName: 'Airbus A320neo', isRotary: false },
  A321: { fullName: 'Airbus A321', isRotary: false },
  A21N: { fullName: 'Airbus A321neo', isRotary: false },
  B77W: { fullName: 'Boeing 777-300ER', isRotary: false },
  B789: { fullName: 'Boeing 787-9 Dreamliner', isRotary: false },
  A35K: { fullName: 'Airbus A350-1000', isRotary: false },

  // Cargo, SAR Fixed-Wing & Military (Common at Prestwick EGPK, Lossiemouth EGQS, Brize Norton)
  B748: { fullName: 'Boeing 747-8', isRotary: false },
  B744: { fullName: 'Boeing 747-400', isRotary: false },
  B77L: { fullName: 'Boeing 777-F Cargo', isRotary: false },
  C17: { fullName: 'Boeing C-17A Globemaster III', isRotary: false },
  A400: { fullName: 'Airbus A400M Atlas', isRotary: false },
  C130: { fullName: 'Lockheed C-130J Super Hercules', isRotary: false },
  P8: { fullName: 'Boeing P-8A Poseidon MRA1', isRotary: false },
  BE20: { fullName: 'Beechcraft King Air 200', isRotary: false },
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

