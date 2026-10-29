# StrikeHike frontend

The Next.js app behind [strikehike.com](https://strikehike.com): the four engine views, the disclaimer page, and the route handlers under `/api` that reach the FastAPI backend. For the whole system (backend, data sources, deployment), see the [root README](../README.md).

Next.js 16 (App Router, Turbopack, `output: "standalone"`), React 19, Tailwind CSS 4, three.js through React Three Fiber and drei, Lightweight Charts, Framer Motion, GSAP, Zustand and next-themes. Node.js 22, as in CI and the Docker image.

This Next.js version differs from older ones in places (route `params` are promises, for example). [`AGENTS.md`](AGENTS.md) asks you to read the relevant guide in `node_modules/next/dist/docs/` before writing code.

## Pages

Every page except the 404 page lives in the `(engine)` route group. Its `layout.tsx` paints the engine sky and mounts `SiteHeader`: the brand, fixed top-left and linking home, and a cue that reveals the four views on hover, keyboard focus or tap (centred on screens 640 px and wider, at the right on phones). The Orrery fills the viewport; every other page scrolls its own `<main>`. The `layout.tsx` in each of `regime/`, `convergence/`, `patterns/` and `disclaimer/` holds that page's metadata; the Orrery uses the site defaults in `src/app/layout.tsx`.

| Path | Page | What it shows |
|---|---|---|
| `/` | `src/app/(engine)/page.jsx` | The Orrery: the sidereal sky (Swiss Ephemeris, Lahiri) in 3D for a date and UTC time from 13 July 1906 to 31 December 2027, with the energy gauge, the closest historical parallels, the event archive, the future ladder and the Info panel |
| `/regime` | `src/app/(engine)/regime/page.jsx` | One market chart with every NBER recession window since 1854, the weekly Core Index from December 1928 with its trend warning, and the S&P 500, gold, Treasuries and the Nifty 50 on one percentage scale |
| `/convergence` | `src/app/(engine)/convergence/page.jsx` | Any two market declines from the case catalogue side by side: the fall from each peak, the macro reading on the same days and the Sun, Moon and Saturn at each peak |
| `/patterns` | `src/app/(engine)/patterns/page.jsx` | Study of Patterns: the past 12-month setups closest to the latest 12 months of the S&P 500 or the Nifty 50, what followed them beside the usual rate, the 120-year mirror and the measured track record |
| `/disclaimer` | `src/app/(engine)/disclaimer/page.jsx` | The site's disclaimer, composed from the notes the views carry |

Outside the group: `src/app/layout.tsx` (the Onest font, the theme provider and the site's JSON-LD), `not-found.tsx` (the 404 page), `sitemap.ts` (served as `/sitemap.xml`) and `public/robots.txt`.

## How the frontend reaches the backend

The browser calls only same-origin routes. The route handlers in `src/app/api/` run on the Next.js server and call the backend at `CHRONO_API_URL`, each with its own timeout. When the backend cannot be reached, a proxy answers 503 with a one-line error body and the page shows its offline state; `/api/chrono/positions` falls back instead (below).

| Route | Backend endpoint | Called by |
|---|---|---|
| `/api/chrono/positions?date=` or `?datetime=` | `/api/v1/historical-parallels`, `/api/v1/astro-positions` | The Orrery's time controls, the sky on `/regime` and `/convergence` |
| `/api/chrono/positions?start=&end=&step=&bodies=` | none (the bundled ephemeris only) | The Sun, Moon and Saturn through each case on `/convergence` |
| `/api/events` | `/api/v1/events` | The Orrery's event archive |
| `/api/forecast-ladder` | `/api/v1/forecast-ladder` | The Orrery's future ladder |
| `/api/v1/regime/macro-history` | the same path | `/regime` and the Orrery's regime overlay |
| `/api/v1/regime/cases`, `/api/v1/regime/cases/{id}/path` | the same paths | `/convergence` |
| `/api/v1/patterns?asset=` | the same path | `/patterns` |
| `/api/v1/regime/crypto-milestones`, `/api/v1/regime/runs`, `/api/v1/regime/forecast` | the same paths | No page calls them |

- `/api/chrono/positions` computes the planetary positions itself from `src/data/astro/ephemeris.json` (1900–2035; other dates get a 422). Range mode (`start`, `end`, `step` of 1, 7 or 30 days, `bodies`) returns longitudes and retrograde flags, clamped to that coverage, and calls nothing. In single-date mode its two backend calls are optional: without them the energy gauge falls back to a local geometry score (`src/lib/astro/energy.js`) and the historical parallels are marked unavailable.
- The macro-history, patterns and case-path routes pass on only the query parameters the backend accepts, so unknown ones never reach it or add cache entries. With `view=atlas&resolution=weekly`, the macro-history route keeps only the timeline fields `/regime` reads.
- `src/lib/server/routeCache.ts` keeps successful responses in the server process, for 15 minutes (macro history) to an hour (most others), with one upstream request per key at a time. It skips bodies over 4 MB and holds at most 48 MB, and a restart empties it.

| Variable | Default | Effect |
|---|---|---|
| `CHRONO_API_URL` | `http://127.0.0.1:8000` | Backend base URL, read on the server only. Docker Compose sets `http://backend:8010` |
| `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` | unset | Adds the Google site-verification meta tag. Read at build time (a Docker build argument) |

## Folders

```text
src/app/          the pages, the (engine) layout, the api/ route handlers, globals.css (tokens, focus ring, reduced motion)
src/components/   the shared header and the Orrery's scene and panels (top level), regime/ (/regime and /convergence), patterns/ (Study of Patterns), ui/ (the onboarding note)
src/lib/          motion tokens (motion.js), the tone, tithi and parallel-epoch helpers, astro/ (ephemeris lookup, the planet readouts' notes, the energy fallback),
                  regime/ (case comparison helpers), server/routeCache.ts, contact.js (the enquiry link)
src/store/        Zustand stores: chronoStore (the focused date and the sky), entityStore (the hovered or pinned body)
src/hooks/        dialog focus, dismissal, reduced motion and the Orrery's regime overlay
src/data/astro/   ephemeris.json, base_rates.json (the planet readouts' historical frequencies), crash_markers.json
public/           icons, robots.txt, the support QR image and the planet textures (CC BY 4.0, see public/textures/ATTRIBUTION.md)
scripts/          generate-ephemeris.py, which rebuilds ephemeris.json with Swiss Ephemeris (pyswisseph), Lahiri sidereal
```

## Run, lint, build

```bash
npm ci
npm run dev      # next dev on http://localhost:3000
npm run lint     # eslint (next/core-web-vitals and next/typescript)
npm run build    # next build, standalone output in .next/standalone
npm run start    # next start; warns under the standalone output (production runs node server.js, below)
```

Run the backend too (see [`backend/README.md`](../backend/README.md)), or point `CHRONO_API_URL` at one; without it the data views show their offline states. `npx tsc --noEmit` type-checks the TypeScript files.

Before every deploy, CI runs `npm ci`, `npm run lint` and `npm run build` on Node 22. There are no frontend unit tests. The `Dockerfile` builds the standalone server on `node:22-alpine`, copies `public/` and `.next/static` beside it and runs `node server.js` on port 3000; `docker-compose.yml` at the repository root puts it behind Caddy.
