import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '15mb' }));

// In-memory cache for live ADS-B queries (3.5 seconds TTL)
const flightCache = new Map<string, { timestamp: number; data: unknown }>();
// Cache for resolved real-world callsign routes
const routeCache = new Map<
  string,
  { originCode: string; originName: string; destCode: string; destName: string }
>();
// Cache for aviation METAR/TAF reports (3 minutes TTL)
const metarCache = new Map<string, { timestamp: number; data: unknown }>();

app.get('/api/flights', async (req, res) => {
  try {
    const lat = Number(req.query.lat ?? 57.5);
    const lon = Number(req.query.lon ?? -1.5);
    const radius = Math.min(250, Math.max(25, Number(req.query.radius ?? 250)));
    const cacheKey = `${lat.toFixed(1)}_${lon.toFixed(1)}_${radius}`;

    const cached = flightCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 3500) {
      return res.json(cached.data);
    }

    const endpoints = [
      `https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${radius}`,
      `https://api.airplanes.live/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${radius}`,
    ];

    for (const url of endpoints) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'DeckWatchRadar/1.0',
          },
        });
        clearTimeout(timeout);

        if (response.ok) {
          const json = await response.json();
          if (Array.isArray(json?.ac)) {
            flightCache.set(cacheKey, { timestamp: Date.now(), data: json });
            return res.json(json);
          }
        }
      } catch {
        // try next live ADS-B feeder
      }
    }

    return res.json({ ac: [], source: 'empty' });
  } catch {
    return res.json({ ac: [], source: 'error' });
  }
});

// Resolve real-world Origin -> Destination route for a live callsign via adsb.lol routeset API
app.post('/api/routes', async (req, res) => {
  try {
    const planes: Array<{ callsign: string; lat: number; lng: number }> = Array.isArray(
      req.body?.planes
    )
      ? req.body.planes.slice(0, 40)
      : [];

    if (planes.length === 0) {
      return res.json({ routes: {} });
    }

    const result: Record<
      string,
      { originCode: string; originName: string; destCode: string; destName: string }
    > = {};
    const uncached: Array<{ callsign: string; lat: number; lng: number }> = [];

    for (const p of planes) {
      const cs = (p.callsign || '').trim().toUpperCase();
      if (!cs) continue;
      const hit = routeCache.get(cs);
      if (hit) {
        result[cs] = hit;
      } else {
        uncached.push({
          callsign: cs,
          lat: Number(p.lat) || 57.0,
          lng: Number(p.lng) || -2.0,
        });
      }
    }

    if (uncached.length > 0) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const response = await fetch('https://api.adsb.lol/api/0/routeset', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'User-Agent': 'DeckWatchRadar/1.0',
        },
        body: JSON.stringify({ planes: uncached }),
      });
      clearTimeout(timeout);

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data)) {
          for (const entry of data) {
            const cs = String(entry?.callsign || '').trim().toUpperCase();
            const airports = Array.isArray(entry?._airports) ? entry._airports : [];
            if (cs && airports.length >= 2) {
              const orig = airports[0];
              const dest = airports[airports.length - 1];
              const mapped = {
                originCode: String(orig?.icao || orig?.iata || 'ORIG'),
                originName: String(orig?.name || orig?.location || orig?.icao || 'Origin'),
                destCode: String(dest?.icao || dest?.iata || 'DEST'),
                destName: String(dest?.name || dest?.location || dest?.icao || 'Destination'),
              };
              routeCache.set(cs, mapped);
              result[cs] = mapped;
            }
          }
        }
      }
    }

    return res.json({ routes: result });
  } catch {
    return res.json({ routes: {} });
  }
});

// Fetch live official aviation METAR & TAF reports for UK / Norwegian airports & heliports
app.get('/api/metar', async (req, res) => {
  try {
    const icao = String(req.query.icao || 'EGPD')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9,]/g, '');

    const cached = metarCache.get(icao);
    if (cached && Date.now() - cached.timestamp < 180000) {
      return res.json(cached.data);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(
      `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&taf=true`,
      {
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'User-Agent': 'DeckWatchRadar/1.0',
        },
      }
    );
    clearTimeout(timeout);

    if (response.ok) {
      const json = await response.json();
      metarCache.set(icao, { timestamp: Date.now(), data: json });
      return res.json(json);
    }
    return res.json([]);
  } catch {
    return res.json([]);
  }
});

app.get('/api/weather', async (req, res) => {
  try {
    const lat = Number(req.query.lat ?? 57.7269);
    const lon = Number(req.query.lon ?? 0.8472);

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover&wind_speed_unit=kn`;
    const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,swell_wave_height`;

    const [wxRes, marRes] = await Promise.allSettled([
      fetch(weatherUrl),
      fetch(marineUrl),
    ]);

    const wxData =
      wxRes.status === 'fulfilled' && wxRes.value.ok
        ? await wxRes.value.json()
        : null;
    const marData =
      marRes.status === 'fulfilled' && marRes.value.ok
        ? await marRes.value.json()
        : null;

    return res.json({ weather: wxData, marine: marData });
  } catch {
    return res.json({ weather: null, marine: null });
  }
});

// Scan an uploaded or camera photo of an Offshore Heli-Admin Noticeboard Sheet
app.post('/api/heliadmin-scan', async (req, res) => {
  try {
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'Missing imageBase64 payload' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
    });

    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: cleanBase64,
            },
          },
          {
            text: `Extract the offshore helicopter flight details from this Heli-Admin Crewchange / Departures noticeboard sheet.
Do NOT extract individual passenger names or ID numbers (keep crew privacy protected).
Instead, extract:
- title: Short descriptive title (e.g. "Apache Forties — APFOR2/1" or "bp Glen Lyon — BP GL3")
- fieldOperator: One of "Apache", "bp", "TotalEnergies", "Shell", "Harbour Energy", "Equinor", "Ithaca Energy", "EnQuest", "CNOOC", "UK Airport / Heliport"
- flightName: Flight Name printed on sheet (e.g. "APFOR2/1", "BP GL3", "TTCULZFR")
- scheduledDate: Date printed on sheet (e.g. "29/09/2026")
- callsign: Radio Callsign printed on sheet (e.g. "GOLD631", "60B-YG") or empty string if blank
- registration: Aircraft tail registration (e.g. "G-NHVG") or empty string if blank
- flightOperator: Helicopter operator (e.g. "NHV", "BRISTOW HELICOP", "CHC", "OHS")
- aircraftType: Aircraft type code (e.g. "H-175", "S92", "AW189")
- stdTime: Scheduled Time of Departure STD in HH:MM (e.g. "11:45", "11:00", "07:00", "10:30")
- heliAdminCheckInTime: Heli-Admin check-in time in HH:MM (e.g. "10:30", "08:45", "06:00", "08:30")
- plannedRouteCodes: Array of 2-to-4 letter stop codes in order from "Planned Route" (e.g. ["ABZ", "FA", "FD", "FC", "ABZ"] or ["LSI", "GL", "LSI"] or ["ABZ", "CULZ", "AILS", "EPUQ", "FRNK", "EPUQ", "ABZ"])
- outboundFixedWing: Outbound fixed-wing connection if listed (e.g. "BP FW3")
- inboundFixedWing: Inbound fixed-wing connection if listed (e.g. "BP FW6")
- seatCapacity: Integer seat capacity (e.g. 16 or 19)
- departingPaxCount: Total number of passenger rows listed on the sheet
- legBreakdownSummary: Summary of how many passengers travel between each stop code (e.g. "8 pax ABZ->FA, 6 pax ABZ->FD, 7 pax FA->ABZ")
- checklistRules: Array of the bold notices/instructions at the bottom or top of the sheet (e.g. PEDs switched off, Blue tag on bag zip, Locker emptied & key returned, Strip bed, Bring survival suit)`,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING },
            fieldOperator: { type: Type.STRING },
            flightName: { type: Type.STRING },
            scheduledDate: { type: Type.STRING },
            callsign: { type: Type.STRING },
            registration: { type: Type.STRING },
            flightOperator: { type: Type.STRING },
            aircraftType: { type: Type.STRING },
            stdTime: { type: Type.STRING },
            heliAdminCheckInTime: { type: Type.STRING },
            plannedRouteCodes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            outboundFixedWing: { type: Type.STRING },
            inboundFixedWing: { type: Type.STRING },
            seatCapacity: { type: Type.INTEGER },
            departingPaxCount: { type: Type.INTEGER },
            legBreakdownSummary: { type: Type.STRING },
            checklistRules: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
          required: [
            'title',
            'flightName',
            'stdTime',
            'heliAdminCheckInTime',
            'plannedRouteCodes',
            'checklistRules',
          ],
        },
      },
    });

    const parsed = JSON.parse(response.text || '{}');
    return res.json({ sheet: parsed });
  } catch (err) {
    console.error('Heli-Admin OCR error:', err);
    return res.status(500).json({ error: 'Failed to scan Heli-Admin sheet photo' });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`DeckWatch Radar server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
