import test from 'node:test';
import assert from 'node:assert/strict';
import { keepIdentity, resetIdentities } from '../src/services/radarService';
import type { AircraftTarget } from '../src/types/radar';

const base = (over: Partial<AircraftTarget>): AircraftTarget => ({
  hex: '400DC2', callsign: 'GMA03B', flightNumber: 'GMA03B', registration: 'G-SASC', typeCode: 'BE20',
  typeFullName: 'Beechcraft King Air 200', operator: 'Gama Aviation', helicopterOperator: 'Unknown',
  category: 'commercial_fixed_wing', lat: 57, lon: 1, observedAt: 1000,
  ...over,
} as AircraftTarget);

test.beforeEach(() => resetIdentities());

test('a fresher position from a thinner source keeps the details another source sent', () => {
  const thin = base({ callsign: '400DC2', flightNumber: '400DC2', registration: 'Unknown', typeCode: 'ACFT',
    typeFullName: 'Tracked Aircraft', operator: 'Operator not reported', observedAt: 2000 });
  const full = base({});
  const out = keepIdentity(thin, full, 5000);
  assert.equal(out.registration, 'G-SASC');
  assert.equal(out.callsign, 'GMA03B');
  assert.equal(out.typeCode, 'BE20');
  assert.equal(out.operator, 'Gama Aviation');
  assert.equal(out.observedAt, 2000); // position stays the fresher one
});

test('details reported earlier fill a later poll where no source sends them', () => {
  keepIdentity(base({}), undefined, 1000);
  const later = keepIdentity(base({ registration: 'Unknown', operator: 'Operator not reported' }), undefined, 61_000);
  assert.equal(later.registration, 'G-SASC');
  assert.equal(later.operator, 'Gama Aviation');
});

test('old details are not reused after 20 minutes, and real values are never overwritten', () => {
  keepIdentity(base({ operator: 'Old Operator' }), undefined, 0);
  const late = keepIdentity(base({ operator: 'Operator not reported' }), undefined, 21 * 60_000);
  assert.equal(late.operator, 'Operator not reported');
  const kept = keepIdentity(base({ operator: 'New Operator' }), base({ operator: 'Other' }), 21 * 60_000 + 1);
  assert.equal(kept.operator, 'New Operator');
});
