import assert from 'node:assert/strict';
import test from 'node:test';
import { TRACKING_REGIONS, regionDistanceNm, regionsForView } from '../src/utils/trackingRegions';

test('regional queries cover onward destinations and the UK/Ireland islands', () => {
  for (const [place, lat, lon] of [
    ['Belfast',54.6,-5.93],['Dublin',53.35,-6.26],['Cork',51.9,-8.47],['Dingle',52.14,-10.27],['Derry',55,-7.32],
    ['London',51.51,-0.13],['Manchester',53.48,-2.24],['Newcastle',54.98,-1.61],['Dover',51.13,1.31],['Lowestoft',52.48,1.76],
    ['Cardiff',51.48,-3.18],['Aberdeen',57.15,-2.1],['Sumburgh',59.88,-1.3],['Unst',60.83,-0.89],['St Kilda',57.82,-8.57],
    ['Barra',56.99,-7.46],['Isles of Scilly',49.92,-6.3],['Jersey',49.21,-2.13],['Isle of Man',54.15,-4.48],['Stavanger',58.97,5.73],
  ] as Array<[string,number,number]>) assert.ok(TRACKING_REGIONS.some(region => regionDistanceNm(lat,lon,region) < 250), place + ' must be covered');
});

test('close views only request their local shared region; the wide overview requests all three', () => {
  assert.deepEqual(regionsForView(53.35,-6.26), ['uk-ireland']);
  assert.deepEqual(regionsForView(51.5,-0.12), ['south-uk']);
  assert.deepEqual(regionsForView(59.88,-1.3), ['north-sea']);
  assert.deepEqual(regionsForView(53.35,-6.26,{south:53.25,north:53.45,west:-6.4,east:-6.1}), ['uk-ireland']);
  assert.deepEqual(regionsForView(56,-3,{south:49.5,north:61.5,west:-11,east:8}), ['north-sea','uk-ireland','south-uk']);
  assert.deepEqual(regionsForView(0,100), []);
});
