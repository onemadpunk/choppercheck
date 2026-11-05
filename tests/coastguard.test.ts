import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyLiveAircraft } from '../src/services/radarService';
import { isRotaryAircraft, matchesAircraftCategory } from '../src/utils/dataQuality';
import { INSTALLATIONS_AND_AIRPORTS } from '../src/data/installationsAndAirports';
const facility = INSTALLATIONS_AND_AIRPORTS[0];
const now = Date.now();
const raw = { hex: 'test', lat: 55, lon: -4, seen_pos: 1, gs: 120, track: 180 };

test('UK Coastguard SRD and British Rescue SRG are identified without claiming a rescue mission', () => {
  for (const callsign of ['SRD948', 'SRD852', 'SRG199A']) {
    const flight = classifyLiveAircraft({ ...raw, flight: callsign, t: 'S92' }, facility, now, 'test', now)!;
    assert.equal(flight.category, 'coastguard_sar'); assert.equal(flight.helicopterOperator, 'HM Coastguard');
    assert.equal(flight.status, 'position_reported'); assert.equal(isRotaryAircraft(flight), true);
  }
});

test('Irish Coast Guard CGI is separate from HM Coastguard; generic RESCUE is not assigned a country', () => {
  const irish = classifyLiveAircraft({ ...raw, flight: 'CGI117', t: 'A189' }, facility, now, 'test', now)!;
  assert.equal(irish.category, 'coastguard_sar'); assert.equal(irish.helicopterOperator, 'Irish Coast Guard');
  const generic = classifyLiveAircraft({ ...raw, flight: 'RESCUE116', t: 'S92' }, facility, now, 'test', now)!;
  assert.equal(generic.helicopterOperator, 'Unknown'); assert.equal(generic.category, 'coastguard_sar');
});

test('Coastguard fixed-wing aircraft keep their physical type and appear in fixed-wing and Coastguard filters', () => {
  const flight = classifyLiveAircraft({ ...raw, flight: 'SRD203B', t: 'B350' }, facility, now, 'test', now)!;
  assert.equal(flight.category, 'coastguard_sar'); assert.equal(isRotaryAircraft(flight), false);
  assert.equal(matchesAircraftCategory(flight, 'offshore_heli'), false);
  assert.equal(matchesAircraftCategory(flight, 'commercial_fixed_wing'), true);
  assert.equal(matchesAircraftCategory(flight, 'coastguard_sar'), true);
});
