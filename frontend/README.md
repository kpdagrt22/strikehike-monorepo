# StrikeHike — Universal Chrono-Spatial Engine

The public frontend shell for StrikeHike's chrono-spatial engine.

## Current state

This repository has been reduced to the engine surface:

- Next.js 16 App Router, React 19, Tailwind CSS 4
- `next-themes` with class-based light/dark support
- A single full-viewport page (`src/app/page.jsx`)
- A transparent `@react-three/fiber` canvas
- `AmbientCosmos.jsx`: an instanced stardust field and a 27-tick Nakshatra
  boundary ring that rotates continuously, independent of any date logic
- `PlanetarySystem.jsx`: the shipped Swiss Ephemeris mapped to eight hoverable
  spheres with orbit rings; hover state lives in a global Zustand store
- `Tooltip.jsx`: the absolute glass hover readout — planet glyph, exact degree,
  the 21-session ML index insight, and the date’s market/geometry energy
- `EnergyGauge.jsx`: the top-center glowing SVG energy ring with a fading
  historical-parallel carousel
- `Timeline.jsx`: a collapsed floating scrubber that expands into a 1906–2026
  slider with 22 historical crash markers
- `/api/chrono/positions`: server-side Swiss Ephemeris + analog insight response,
  plus proxied ML energy and historical parallels
- Theme-aware 3D lighting and materials (emissive obsidian / clearcoat pearl)
- A continuous pearl (light) / obsidian (dark) radial gradient behind the canvas

The previous Yubi-derived marketing surface, its routes, components, upstream
sync workflow, and default public assets have been removed. Git history keeps
the old site recoverable.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Build

```bash
npm run build
npm run start
```

## Backend connection

The frontend talks to the FastAPI ML service through the server-only
`CHRONO_API_URL` environment variable. It defaults to
`http://127.0.0.1:8000`:

```bash
CHRONO_API_URL=https://your-ml-service.example npm run start
```

`/api/chrono/positions` calls `/api/v1/astro-positions` for the market energy
object (1992–2025) and `/api/v1/historical-parallels` for the historical
matches. If the ML service is unavailable, the route falls back to a local
geometry energy score so the gauge still renders; historical parallels are then
reported as unavailable.

## Time travel

The timeline fetches `/api/chrono/positions?date=YYYY-MM-DD`. `PlanetarySystem`
keeps the same mesh instances mounted and lets GSAP tween their `x`/`z`
positions over 2 seconds with `expo.inOut`. `AmbientCosmos` owns the dust and
Nakshatra rotation and is never touched by a date change.

## Data

`src/data/astro/ephemeris.json` is generated for 1900–2035 by
`scripts/generate-ephemeris.py` using Swiss Ephemeris 2.10.03, Lahiri sidereal.
`base_rates.json` holds the 21-session historical rates. Hover insights are
descriptive base-rate comparisons, not forecasts. `crash_markers.json` is
trimmed from the 120-year crash atlas for the timeline.

## Boundary

The frontend carries **no credentials and no model artifacts**. When the
engine is wired, the browser should call a same-origin server route; that route
holds any upstream ML service URL or secret. The browser receives only the
normalized score payload plus its provenance labels.

The project intentionally contains no dashboard, table, or chart components.
