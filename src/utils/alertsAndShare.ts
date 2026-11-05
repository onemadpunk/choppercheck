import { AircraftTarget } from '../types/radar';

// Synthesize an authentic dual-tone aviation cockpit alert chime using Web Audio API
export function playCockpitAlertChime(urgent = false): void {
  try {
    const AudioCtx =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);

      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.22, startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    if (urgent) {
      // 10 NM Final Approach triple hi-lo chime
      playTone(880, now, 0.16);
      playTone(659.25, now + 0.18, 0.16);
      playTone(880, now + 0.36, 0.25);
    } else {
      // Standard Airbus/Sikorsky dual-tone chime (C5 -> A4)
      playTone(587.33, now, 0.22);
      playTone(493.88, now + 0.24, 0.35);
    }
    setTimeout(() => { void ctx.close().catch(() => {}); }, 1500);
  } catch {
    // Ignore if audio context is blocked before user gesture
  }
}

export function triggerBrowserNotification(title: string, body: string): void {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: './pwa-192x192.png',
      });
    }
  } catch {
    // Ignore in restricted frames
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  try {
    if (!('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    const res = await Notification.requestPermission();
    return res === 'granted';
  } catch {
    return false;
  }
}

export function buildFlightShareText(
  flight: AircraftTarget,
  refCode: string
): string {
  const age = flight.observedAt ? new Date(flight.observedAt).toISOString() : 'Unknown';
  return [
    'ChopperCheck position update',
    'Aircraft: ' + flight.callsign + ' (' + flight.typeFullName + ' · Reg ' + flight.registration + ')',
    'Operator: ' + flight.operator,
    'Route, departure and arrival times: not reported',
    'Position: ' + flight.distanceFromRefNm + ' NM from ' + refCode + ' · Bearing ' + flight.bearingFromRefDeg + '°',
    'Altitude: ' + (flight.altitudeReported === false ? 'unavailable' : flight.altitudeFt + ' ft') + ' · Speed: ' + (flight.speedReported === false ? 'unavailable' : flight.groundSpeedKts + ' kt'),
    'Position report: ' + age + ' · ' + (flight.source === 'dead_reckoning' ? 'Displayed position is estimated' : 'Reported position'),
    'Source: ' + (flight.provider || 'ADS-B'),
    'https://choppercheck.com',
  ].join('\n');
}

export function getWhatsAppShareUrl(flight: AircraftTarget, refCode: string): string {
  const text = buildFlightShareText(flight, refCode);
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function compassDirectionFromBearing(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const idx = Math.round(((deg % 360) / 22.5)) % 16;
  return dirs[idx];
}
