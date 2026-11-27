import test from 'node:test';
import assert from 'node:assert/strict';
import { feedCredits, feedCreditText } from '../src/data/feedCredits';

test('each backup source gets the credit its terms require', () => {
  assert.deepEqual(feedCredits('adsb.fi + airplanes.live').map(c => c.name), ['adsb.fi', 'airplanes.live']);
  assert.equal(feedCredits('flyitalyadsb')[0].licence?.name, 'CC BY-SA 4.0');
  assert.equal(feedCredits('adsb.lol')[0].licence?.name, 'ODbL');
  assert.deepEqual(feedCredits('adsb.fi + adsb.fi').length, 1);
  assert.deepEqual(feedCredits(undefined), []);
});

test('share text keeps unknown providers and licence links', () => {
  assert.equal(feedCreditText('Mystery feed'), 'Mystery feed');
  assert.equal(feedCreditText(undefined), 'ADS-B');
  assert.match(feedCreditText('flyitalyadsb'), /FlyItalyADSB — CC BY-SA 4\.0 \(https:\/\/creativecommons/);
  assert.match(feedCreditText('adsb.lol'), /adsb\.lol — ODbL/);
});
