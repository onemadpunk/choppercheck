# ChopperCheck flight relay

A free Cloudflare Worker that fetches live aircraft and airport weather for choppercheck.com. Those providers
don't allow requests straight from a browser, so the site asks this relay instead. It replaces the old relay at
`choppercheck-flight-api.ornatehinny4.chatgpt.site` with code that lives here.

**Aircraft sources, in order** (the next one is used only if the previous one fails, is rate-limited or stale):

1. adsb.fi (no key)
2. airplanes.live (no key)
3. FlyItalyADSB (key in the `FLYITALY_API_KEY` secret; skipped if not set)
4. adsb.lol (no key)

Each region's answer is cached for 5 seconds, so all visitors share one upstream request. Weather (Open-Meteo
forecast + marine, and the airport METAR/TAF from aviationweather.gov) is cached for 5 minutes.

## One-time setup (about 10 minutes)

1. Sign up free at <https://dash.cloudflare.com/sign-up>. Open **Workers & Pages** once and pick your
   `workers.dev` subdomain.
2. **My Profile → API Tokens → Create Token →** use the **Edit Cloudflare Workers** template.
3. In GitHub: **choppercheck → Settings → Secrets and variables → Actions → New repository secret**, add:
   - `CLOUDFLARE_API_TOKEN`: the token from step 2
   - `CLOUDFLARE_ACCOUNT_ID`: from the right-hand side of the Cloudflare Workers page
   - `FLYITALY_API_KEY`: your FlyItalyADSB key
4. **Actions → Deploy flight relay to Cloudflare Workers → Run workflow.** The relay appears at
   `https://choppercheck-relay.<your-subdomain>.workers.dev`. Open `/health` there to check it.
5. To switch the site over: **Settings → Secrets and variables → Actions → Variables → New repository
   variable** `FLIGHT_API_ORIGIN` = that URL, then re-run the Pages deploy. Delete the variable to switch back.

Keys stay in Cloudflare and are never sent to the browser or stored in this repository.
