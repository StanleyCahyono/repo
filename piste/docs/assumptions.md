# Assumptions and environment adaptations

Material decisions made while building Piste. Each is revisitable.

## Build environment
- The build environment's egress proxy only allowed package registries and a web-search tool. Resort sites, pass
  sites, Open-Meteo, api.weather.gov, Wikipedia and map tile hosts could not be fetched during development.
  Consequences:
  - Catalog facts were researched through web-search summaries and are stored with
    `verification: "search-summary"`. The UI labels them "Researched — confirm at source" until you confirm them
    (Settings → corrections) or a live adapter replaces them.
  - Weather and NWS adapters are implemented against the documented APIs and tested with recorded-format
    fixtures; they run live on your machine. In the build environment they show an explicit fetch-failure state.
  - Official report adapters for Greek Peak and Alta could not be developed against the live pages. They are
    written defensively (schema-validated extraction that fails loudly) and are listed as **unverified parsers** in
    the coverage matrix. The manual report entry flow is the dependable path until they are confirmed.
- Photographs: no licensed resort photos could be obtained, so every resort uses the designed topographic
  placeholder. The schema supports licensed photos with credit/licence fields.
