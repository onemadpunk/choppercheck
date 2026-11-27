import test from 'node:test';
import assert from 'node:assert/strict';
import { AIRFRAME_PRESETS, fetchMultiModelRigForecast, fetchJsonWithRetry } from '../src/services/multiModelWeatherService.ts';
import { resetWeatherFetch } from '../src/services/weatherFetch.ts';
import type { InstallationOrAirport } from '../src/types/radar.ts';

const MODELS = ['ukmo_seamless', 'icon_seamless', 'gfs_seamless', 'ecmwf_ifs025', 'gem_seamless'];
const rig = {
  id: 'test-rig', code: 'TR', name: 'Test Rig', shortName: 'Test', fieldOperator: 'bp', assetType: 'FPSO',
  sector: 'west_of_shetland', lat: 60.36, lon: -4.07, elevationFt: 112, primaryShoreBase: 'EGPB',
  helicopterOperators: ['Bristow'], regionLabel: 'WoS',
} as unknown as InstallationOrAirport;

function weatherJson(hours: number, drop: Record<string, string[]>) {
  const start = Date.now() - (Date.now() % 3600_000);
  const time = Array.from({ length: hours }, (_, i) => new Date(start + i * 3600_000).toISOString().slice(0, 16));
  const base: Record<string, number> = {
    wind_speed_10m: 15, wind_direction_10m: 240, wind_gusts_10m: 22, temperature_2m: 8, dew_point_2m: 4,
    cloud_cover_low: 30, freezing_level_height: 1500, temperature_925hPa: 3, geopotential_height_925hPa: 760,
    temperature_850hPa: -1, geopotential_height_850hPa: 1450, pressure_msl: 1008, precipitation: 0, visibility: 25000,
  };
  const hourly: Record<string, unknown[]> = { time };
  for (const m of MODELS) {
    for (const [f, v] of Object.entries(base)) {
      hourly[`${f}_${m}`] = time.map(() => ((drop[m] ?? []).includes(f) ? null : v));
    }
  }
  return { hourly };
}
const marine = (waves: number | null) => ({
  hourly: { time: [], wave_height: Array(200).fill(waves), wave_period: Array(200).fill(waves === null ? null : 7) },
});

function mockFetch(handler: (url: string) => unknown) {
  resetWeatherFetch();
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = handler(url);
    if (body instanceof Error) throw body;
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

test('a gap in one model is filled with another model real value and labelled', async () => {
  const restore = mockFetch((url) =>
    url.includes('marine-api')
      ? marine(2.2)
      : weatherJson(6, { ecmwf_ifs025: ['wind_gusts_10m'], gem_seamless: ['cloud_cover_low'] })
  );
  try {
    const hours = await fetchMultiModelRigForecast(rig, AIRFRAME_PRESETS.S92);
    assert.ok(hours.length > 0);
    const ec = hours[0].models.ecmwf_ifs025;
    assert.equal(ec.windGust10mKts, 22);
    assert.deepEqual(ec.filledData, ['gusts from UKMO UKV']);
    assert.equal(ec.missingData, undefined);
    assert.deepEqual(hours[0].models.gem_seamless.filledData, ['low cloud from UKMO UKV']);
    assert.equal(hours[0].waveHeightM, 2.2);
    assert.equal(hours[0].models.ukmo_seamless.qnhHpa, 1008);
  } finally {
    restore();
  }
});

test('a value no model has stays missing, and a rig on a land cell gets the nearest sea point', async () => {
  const restore = mockFetch((url) => {
    if (url.includes('marine-api')) {
      // First call (the rig itself) has no sea data; the nearby-points call returns an array
      if (url.includes(',')) return [marine(null), marine(3.1), marine(2.0)];
      return marine(null);
    }
    return weatherJson(6, Object.fromEntries(MODELS.map((m) => [m, ['cloud_cover_low']])));
  });
  try {
    const hours = await fetchMultiModelRigForecast(rig, AIRFRAME_PRESETS.S92);
    assert.deepEqual(hours[0].models.ukmo_seamless.missingData, ['low cloud']);
    assert.notEqual(hours[0].models.ukmo_seamless.status, 'GO');
    assert.equal(hours[0].waveHeightM, 3.1);
    assert.match(hours[0].seaDataNote ?? '', /nearest sea point, \d+ NM away/);
  } finally {
    restore();
  }
});

test('fetchJsonWithRetry retries a failed request before giving up', async () => {
  let calls = 0;
  const restore = mockFetch(() => {
    calls++;
    return calls < 2 ? new Error('network down') : { ok: true };
  });
  try {
    assert.deepEqual(await fetchJsonWithRetry('https://example.test/x', 3), { ok: true });
    assert.equal(calls, 2);
  } finally {
    restore();
  }
});
