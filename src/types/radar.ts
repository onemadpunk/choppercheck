export type AssetType =
  | 'Map reference'
  | 'GPS location'
  | 'Custom location'
  | 'Fixed Platform'
  | 'FPSO'
  | 'Semi-Sub'
  | 'Shore Heliport'
  | 'SAR Base'
  | 'UK Airport'
  | 'Norwegian Hub'
  | 'Hospital Helipad';

export type SectorId =
  | 'all_uk_offshore'
  | 'apache_north_sea'
  | 'west_of_shetland'
  | 'uk_north_sea'
  | 'norway_ncs'
  | 'scotland_airports'
  | 'uk_airports';

export type FieldOperator =
  | 'Apache'
  | 'bp'
  | 'Shell'
  | 'Equinor'
  | 'Harbour Energy'
  | 'TotalEnergies'
  | 'Ithaca Energy'
  | 'EnQuest'
  | 'CNOOC'
  | 'Aker BP'
  | 'ConocoPhillips'
  | 'Vår Energi'
  | 'HM Coastguard / SAR'
  | 'UK Airport / Heliport'
  | 'NHS / Hospital Helipad'
  | 'Avinor / Norway Hub';

export type HelicopterOperator =
  | 'Unknown'
  | 'Bristow'
  | 'CHC'
  | 'OHS'
  | 'NHV'
  | 'HM Coastguard'
  | 'Irish Coast Guard'
  | 'Norwegian SAR'
  | 'Commercial Airline'
  | 'Cargo / Military';

export type TrafficCategory =
  | 'offshore_heli'
  | 'coastguard_sar'
  | 'commercial_fixed_wing'
  | 'military_cargo';

export type FlightStatus = 'position_reported';

export interface InstallationOrAirport {
  id: string;
  code: string; // e.g. 'FC', 'EGPD', 'EGPK', 'EGPB'
  heliAdminAliases?: string[]; // e.g. ['ABZ'] for EGPD, ['LSI'] for EGPB, ['GL'] for Glen Lyon, ['CULZ'] for Culzean, ['EPUQ'] for Elgin
  name: string;
  shortName: string;
  fieldOperator: FieldOperator;
  assetType: AssetType;
  sector: SectorId;
  lat: number;
  lon: number;
  elevationFt: number;
  helideckDValueM?: number;
  maxHeliType?: string;
  primaryShoreBase: string;
  helicopterOperators: HelicopterOperator[];
  regionLabel: string;
  notes?: string;
}

export interface TrailPoint {
  lat: number;
  lon: number;
  altFt: number;
  timestamp: number;
}

export interface AircraftTarget {
  observedAt?: number;
  provider?: string;
  reportedLat?: number;
  reportedLon?: number;
  altitudeReported?: boolean;
  speedReported?: boolean;
  trackReported?: boolean;
  verticalRateReported?: boolean;
  hex: string;
  callsign: string;
  flightNumber: string;
  registration: string;
  typeCode: string; // e.g., 'S92', 'H175', 'A189', 'B738'
  typeFullName: string; // e.g., 'Sikorsky S-92A Helibus'
  category: TrafficCategory;
  operator: string;
  helicopterOperator?: HelicopterOperator;
  isRotary?: boolean;
  fieldOperatorServed?: FieldOperator;
  lat: number;
  lon: number;
  altitudeFt: number;
  groundSpeedKts: number;
  groundSpeedMph: number;
  verticalRateFpm: number;
  trackDeg: number;
  squawk: string;
  originCode: string;
  originName: string;
  destinationCode: string;
  destinationName: string;
  destinationRigId?: string;
  scheduledDepTime: string;
  estimatedArrTime: string;
  status: FlightStatus;
  distanceFromRefNm: number;
  distanceFromRefMiles: number;
  bearingFromRefDeg: number;
  etaToRefMinutes: number | null;
  source: 'live_adsb' | 'dead_reckoning';
  trail: TrailPoint[];
}

export interface HelideckWeatherState {
  windSpeedKts: number | null;
  windGustKts: number | null;
  windDirectionDeg: number | null;
  significantWaveHeightM: number | null;
  swellPeriodSec: number | null;
  visibilityKm: number | null;
  temperatureC: number | null;
  pressureMslHpa: number | null;
  weatherTime: number | null;
  marineTime: number | null;
  metarTime: number | null;
  cap437Status: 'UNAVAILABLE';
  cap437Reason: string;
  updatedAt: string;
  shoreBaseIcao?: string;
  rawMetar?: string;
  rawTaf?: string;
  flightCategory?: 'VFR' | 'MVFR' | 'IFR' | 'LIFR';
  delayRiskLevel?: 'LOW' | 'MODERATE' | 'HIGH';
  delayRiskSummary?: string;
}

export interface HeliportTerminal {
  id: string;
  operator: HelicopterOperator;
  airportCode: string;
  terminalName: string;
  address: string;
  postcode: string;
  lat: number;
  lon: number;
  checkInWindow: string;
  baggageRules: string;
  fieldsServed: string;
  phone: string;
  liveAirportBoardUrl: string;
}

export interface FlightAlertEvent {
  id: string;
  timestamp: string;
  callsign: string;
  typeFullName: string;
  triggerType: 'AIRBORNE_LIFTOFF' | 'RING_25NM' | 'RING_10NM';
  message: string;
}
