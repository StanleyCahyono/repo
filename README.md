# C4ISR Startup Landscape

An investment-grade and founder-grade market map of the modern C4ISR ecosystem, delivered as a single offline HTML file.

- **Open `index.html`** in any browser. Everything (data, styles, scripts) is embedded; no server or network needed.
- `data/` holds the research corpus as JSON (segments, buyers, companies, evidence sweeps, gap cards, red-team verdicts, scores, survivor deep dives, syntheses).
- `src/` holds the page template, stylesheet and view code. `python3 build.py` re-embeds `data/` into `index.html`.
