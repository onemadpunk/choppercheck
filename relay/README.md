# ChopperCheck flight relay

A free Cloudflare Worker that fetches live aircraft and airport weather for choppercheck.com. Those providers
don't allow requests straight from a browser, so the site asks this relay instead. It replaces the old relay at
`choppercheck-flight-api.ornatehinny4.chatgpt.site` with code that lives here.

**Aircraft sources.** The site first asks airplanes.live directly from each visitor's browser, because it allows
that and blocks Cloudflare. Only if that fails does it ask this relay, which tries:

1. adsb.fi, then airplanes.live (both block Cloudflare's addresses with HTTP 403 as of 27 Nov 2026; kept in
   case that changes, and skipped for a minute after each refusal)
2. FlyItalyADSB (`FLYITALY_API_KEY`) and adsb.lol (`ADSB_LOL_API_KEY`, optional) together, returned as separate feeds

`/health` shows each source's last result.

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
   - `ADSB_LOL_API_KEY` (optional): an adsb.lol feeder key from <https://www.adsb.lol/mmb> → "receiver",
     opened from the network your feeder is on. Without it adsb.lol allows only 500 requests/day per IP,
     shared with everything else on Cloudflare, so it usually answers 429.
4. **Actions → Deploy flight relay to Cloudflare Workers → Run workflow.** The relay appears at
   `https://choppercheck-relay.<your-subdomain>.workers.dev`. Open `/health` there to check it.
5. To switch the site over: **Settings → Secrets and variables → Actions → Variables → New repository
   variable** `FLIGHT_API_ORIGIN` = that URL, then re-run the Pages deploy. Delete the variable to switch back.

Keys stay in Cloudflare and are never sent to the browser or stored in this repository.
