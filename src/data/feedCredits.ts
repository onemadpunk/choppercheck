/** Credit lines required by each aircraft-data provider's own terms. */
export interface FeedCredit { name: string; url: string; licence?: { name: string; url: string } }

const CREDITS: Record<string, FeedCredit> = {
  'adsb.fi': { name: 'adsb.fi', url: 'https://adsb.fi/' },
  'airplanes.live': { name: 'airplanes.live', url: 'https://airplanes.live/' },
  'adsb.lol': { name: 'adsb.lol', url: 'https://www.adsb.lol/',
    licence: { name: 'ODbL', url: 'https://opendatacommons.org/licenses/odbl/1-0/' } },
  // FlyItalyADSB terms: "Flight data: FlyItalyADSB (flyitalyadsb.com), CC BY-SA 4.0".
  flyitalyadsb: { name: 'FlyItalyADSB', url: 'https://flyitalyadsb.com/',
    licence: { name: 'CC BY-SA 4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/' } },
};

const normalise = (provider: string) => {
  const p = provider.trim().toLowerCase().replace(/\s+/g, '');
  return p === 'flyitalyadsb.com' || p === 'flyitaly' ? 'flyitalyadsb' : p;
};

/** Splits a provider string such as "adsb.fi + flyitalyadsb" into known credits, in order, without duplicates. */
export function feedCredits(provider: string | undefined): FeedCredit[] {
  if (!provider) return [];
  const seen = new Set<string>();
  const out: FeedCredit[] = [];
  for (const part of provider.split('+')) {
    const credit = CREDITS[normalise(part)];
    if (credit && !seen.has(credit.name)) { seen.add(credit.name); out.push(credit); }
  }
  return out;
}

/** Plain-text credit, e.g. for shared messages. */
export function feedCreditText(provider: string | undefined): string {
  const credits = feedCredits(provider);
  if (!credits.length) return provider || 'ADS-B';
  return credits.map(c => c.name + (c.licence ? ' — ' + c.licence.name + ' (' + c.licence.url + ')' : '')).join(' + ');
}
