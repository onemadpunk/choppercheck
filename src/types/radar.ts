export type AssetType =
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
  | 'Bristow'
  | 'CHC'
  | 'OHS'
  | 'NHV'
  | 'HM Coastguard'
  | 'Norwegian SAR'
  | 'Commercial Airline'
  | 'Cargo / Military';

export type TrafficCategory =
  | 'offshore_heli'
  | 'coastguard_sar'
  | 'commercial_fixed_wing'
  | 'military_cargo';

export type FlightStatus =
  | 'outbound_to_rig'
  | 'final_approach'
  | 'low_alt_coasting'
  | 'on_helideck'
  | 'inbound_to_shore'
  | 'sar_medevac_active'
  | 'enroute_airline'
  | 'climbing_departed'
  | 'descending_arrival';

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
  hex: string;
  callsign: string;
  flightNumber: string;
  registration: string;
  typeCode: string; // e.g., 'S92', 'H175', 'A189', 'B738'
  typeFullName: string; // e.g., 'Sikorsky S-92A Helibus'
  category: TrafficCategory;
  operator: string;
  helicopterOperator?: HelicopterOperator;
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
  returnShoreTime?: string;
  heliAdminCheckInTime?: string;
  heliAdminFlightName?: string;
  plannedRouteCodes?: string[];
  fixedWingLink?: string;
  status: FlightStatus;
  distanceFromRefNm: number;
  distanceFromRefMiles: number;
  bearingFromRefDeg: number;
  etaToRefMinutes: number | null;
  source: 'live_adsb' | 'dead_reckoning' | 'offshore_schedule';
  trail: TrailPoint[];
}

export interface HeliAdminSheetData {
  id: string;
  title: string;
  fieldOperator: FieldOperator;
  flightName: string; // e.g. 'APFOR2/1', 'BP GL3', 'TTCULZFR'
  scheduledDate: string; // e.g. '29/09/2026', '16/11/2023', '17/10/2025'
  callsign: string; // e.g. 'GOLD631', '60B-YG', 'NHZ118'
  registration: string; // e.g. 'G-NHVG', 'G-IASB', 'G-NHVV'
  flightOperator: string; // e.g. 'NHV', 'BRISTOW HELICOP'
  aircraftType: string; // e.g. 'H-175', 'S92'
  stdTime: string; // e.g. '11:45', '11:00', '07:00', '10:30'
  heliAdminCheckInTime: string; // e.g. '10:30', '08:45', '06:00', '08:30'
  plannedRouteCodes: string[]; // e.g. ['ABZ', 'FA', 'FD', 'FC', 'ABZ']
  outboundFixedWing?: string; // e.g. 'BP FW3'
  inboundFixedWing?: string; // e.g. 'BP FW6'
  seatCapacity: number;
  departingPaxCount: number;
  legBreakdownSummary: string;
  checklistRules: string[];
  sampleImageUrl?: string;
}

export interface HelideckWeatherState {
  windSpeedKts: number;
  windGustKts: number;
  windDirectionDeg: number;
  significantWaveHeightM: number;
  maxWaveHeightM: number;
  swellPeriodSec: number;
  visibilityKm: number;
  temperatureC: number;
  pressureQnhHpa: number;
  cloudBaseFt: number;
  vesselPitchDeg: number;
  vesselRollDeg: number;
  vesselHeaveRateMps: number;
  vesselInclinationDeg: number;
  cap437Status: 'GO' | 'CAUTION' | 'HOLD';
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
