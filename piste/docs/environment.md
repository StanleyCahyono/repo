# Environment variables

Piste runs with **no** environment variables on a local machine. Everything below is optional. Put values in
`.env.local` (never commit it). Secrets are only read on the server; nothing here is exposed to the browser except
variables prefixed `NEXT_PUBLIC_`.

| Variable | Default | Purpose |
|---|---|---|
| `PISTE_DATA_DIR` | `./data` | Directory holding `piste.db` (live) and `piste-demo.db` (demo). Must be persistent storage — do not point it at ephemeral hosting disks. |
| `PISTE_DB_FILE` | — | Explicit path for the live database file (overrides `PISTE_DATA_DIR` for live data). |
| `PISTE_PASSCODE` | — | Enables sign-in. Set this before exposing Piste beyond `localhost`. |
| `PISTE_SESSION_SECRET` | — | 32+ random characters used to sign the session cookie. Required with `PISTE_PASSCODE`. |
| `PISTE_CONTACT` | — | Contact (email or URL) added to the User-Agent. api.weather.gov asks every client to identify itself. |
| `OPEN_METEO_API_KEY` | — | Only for Open-Meteo's commercial API. Personal, non-commercial use needs no key. |
| `DUFFEL_ACCESS_TOKEN` | — | Enables live flight offers through Duffel. Test tokens (`duffel_test_…`) return test data, labelled as such. Without it, Piste offers flight-search links and manual itinerary/quote entry. |
| `ORS_API_KEY` | — | openrouteservice routing for driving times. Without it, drive times are curated estimates plus map direction links. |
| `PISTE_WEATHER_EVERY_MIN` | `180` | Weather refresh cadence for the worker. |
| `PISTE_REPORTS_EVERY_MIN` | `60` | Official report refresh cadence during resort operating hours. |
| `NEXT_PUBLIC_MAP_STYLE_URL` | OpenFreeMap Positron | MapLibre style URL. Must allow your traffic volume and show its attribution. |
| `NEXT_DIST_DIR` | `.next` | Build directory (lets several dev servers run side by side). |
| `NODE_USE_ENV_PROXY` | — | Set to `1` if you are behind an HTTPS proxy: Node's built-in fetch only honours `HTTPS_PROXY` with this flag (Node ≥ 22.21). |
| `PISTE_FIXED_NOW` | — | Test/debug only: pin the app clock to an ISO instant. |
