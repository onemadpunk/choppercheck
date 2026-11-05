export interface ViewBounds { south: number; north: number; west: number; east: number; }
export const TRACKING_REGIONS = [
  { id: 'north-sea', lat: 58.7, lon: -0.5, radiusNm: 250 },
  { id: 'uk-ireland', lat: 54.2, lon: -5.8, radiusNm: 250 },
  { id: 'south-uk', lat: 51.2, lon: -1.5, radiusNm: 250 },
];
export function regionDistanceNm(lat: number, lon: number, region: typeof TRACKING_REGIONS[number]) {
  const radians = (n: number) => n * Math.PI / 180;
  const a = Math.sin(radians(lat - region.lat) / 2) ** 2 + Math.cos(radians(lat)) * Math.cos(radians(region.lat)) * Math.sin(radians(lon - region.lon) / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
export function regionsForView(lat: number, lon: number, bounds?: ViewBounds): string[] {
  const selected = new Set<string>();
  const select = (latitude: number, longitude: number) => {
    const nearest = TRACKING_REGIONS.map(region => ({ region, distance: regionDistanceNm(latitude, longitude, region) }))
      .filter(x => x.distance <= x.region.radiusNm).sort((a, b) => a.distance - b.distance)[0];
    if (nearest) selected.add(nearest.region.id);
  };
  select(lat, lon);
  if (bounds) {
    const south = Math.max(49, bounds.south), north = Math.min(63, bounds.north);
    const west = Math.max(-12, bounds.west), east = Math.min(10, bounds.east);
    if (south <= north && west <= east) {
      for (let y = south; y <= north; y += 0.5) for (let x = west; x <= east; x += 0.5) select(y, x);
      for (const region of TRACKING_REGIONS) if (region.lat >= south && region.lat <= north && region.lon >= west && region.lon <= east) select(region.lat, region.lon);
      select(north, east); select(north, west); select(south, east);
    }
  }
  return TRACKING_REGIONS.filter(region => selected.has(region.id)).map(region => region.id);
}
