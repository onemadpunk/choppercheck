// Production relay (relay/ Worker). Set the GitHub repository variable FLIGHT_API_ORIGIN to switch without a
// code change. In local development, /live-api is proxied by Vite (see vite.config.ts).
export const FLIGHT_API_ORIGIN = import.meta.env?.DEV ? '/live-api'
  : (import.meta.env?.VITE_FLIGHT_API_ORIGIN || 'https://choppercheck-relay.one-mad-punk.workers.dev').replace(/\/+$/, '');

/** The relay's shared Open-Meteo cache, or null where there is none (local development and unit tests). */
export const OPEN_METEO_RELAY_ORIGIN: string | null = import.meta.env && !import.meta.env.DEV ? FLIGHT_API_ORIGIN : null;
