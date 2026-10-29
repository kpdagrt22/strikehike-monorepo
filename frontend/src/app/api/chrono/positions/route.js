import { NextResponse } from "next/server";
import ephemeris from "@/data/astro/ephemeris.json";
import { analogInsight } from "@/lib/astro/analog";
import { localGeometryEnergy } from "@/lib/astro/energy";
import { currentSky } from "@/lib/astro/ephemeris";

export const dynamic = "force-dynamic";

const MIN_DATE = "1900-01-01";
const MAX_DATE = "2035-12-31";
const MIN_MS = Date.parse(`${MIN_DATE}T00:00:00Z`);
const MAX_MS = Date.parse(`${MAX_DATE}T00:00:00Z`);
const SOURCE = "Swiss Ephemeris 2.10.03 · Lahiri sidereal";
const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 2400;

async function fetchBackend(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Range mode: ?start=YYYY-MM-DD&end=YYYY-MM-DD&step=1|7|30&bodies=Sun,Moon,Saturn
// returns { start, end, step, source, bodies: { Sun: { lon: [], retro: [] } } }
// from the bundled ephemeris only (no backend calls): longitudes to 0.01°,
// retro as 1 / 0, one sample every `step` days from `start`, the range
// clamped to the coverage and at most RANGE_MAX_SAMPLES samples. Requests with
// `date` or `datetime` keep the single-date contract below, unchanged.
const DAY_MS = 86_400_000;
const RANGE_STEPS = new Set([1, 7, 30]);
const RANGE_MAX_SAMPLES = 1500;
const RANGE_DEFAULT_BODIES = ["Sun", "Moon", "Saturn"];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(value) {
  if (!value || !ISO_DAY.test(value)) return null;
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    return null;
  }
  return ms;
}

function rangeResponse(searchParams) {
  const startValue = searchParams.get("start");
  const endValue = searchParams.get("end") ?? startValue;
  const startMs = parseDay(startValue);
  const endMs = parseDay(endValue);
  if (startMs == null || endMs == null) {
    return NextResponse.json(
      { error: "start and end must be calendar dates in YYYY-MM-DD format." },
      { status: 400 },
    );
  }
  if (endMs < startMs) {
    return NextResponse.json(
      { error: "end must not be before start." },
      { status: 400 },
    );
  }

  const step = Number(searchParams.get("step") ?? "1");
  if (!RANGE_STEPS.has(step)) {
    return NextResponse.json(
      { error: "step must be 1, 7 or 30." },
      { status: 400 },
    );
  }

  const names = (searchParams.get("bodies") ?? RANGE_DEFAULT_BODIES.join(","))
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  const known = Object.keys(currentSky(ephemeris, MIN_MS));
  if (!names.length || names.some((name) => !known.includes(name))) {
    return NextResponse.json(
      { error: `bodies must be a comma list of: ${known.join(", ")}.` },
      { status: 400 },
    );
  }

  if (endMs < MIN_MS || startMs > MAX_MS) {
    return NextResponse.json(
      {
        error: `Ephemeris coverage is ${MIN_DATE} to ${MAX_DATE}.`,
        min: MIN_DATE,
        max: MAX_DATE,
      },
      { status: 422 },
    );
  }

  // Clamp to the coverage, keeping the sample grid anchored on `start`.
  const first = Math.max(
    0,
    Math.ceil((MIN_MS - startMs) / (step * DAY_MS)),
  );
  const firstMs = startMs + first * step * DAY_MS;
  const lastMs = Math.min(endMs, MAX_MS);
  const count = Math.floor((lastMs - firstMs) / (step * DAY_MS)) + 1;
  if (count > RANGE_MAX_SAMPLES) {
    return NextResponse.json(
      {
        error: `At most ${RANGE_MAX_SAMPLES} samples: shorten the range or use a larger step.`,
      },
      { status: 400 },
    );
  }

  const bodies = Object.fromEntries(
    names.map((name) => [name, { lon: [], retro: [] }]),
  );
  for (let index = 0; index < count; index += 1) {
    const sky = currentSky(ephemeris, firstMs + index * step * DAY_MS);
    for (const name of names) {
      bodies[name].lon.push(Math.round(sky[name].lon * 100) / 100);
      bodies[name].retro.push(sky[name].retro ? 1 : 0);
    }
  }

  return NextResponse.json(
    {
      start: new Date(firstMs).toISOString().slice(0, 10),
      end: new Date(firstMs + (count - 1) * step * DAY_MS)
        .toISOString()
        .slice(0, 10),
      step,
      source: SOURCE,
      bodies,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
  if (
    searchParams.has("start") &&
    !searchParams.has("date") &&
    !searchParams.has("datetime")
  ) {
    return rangeResponse(searchParams);
  }
  const requestedDateTime = searchParams.get("datetime");
  const requestedDate = searchParams.get("date");
  const date = requestedDateTime
    ? requestedDateTime.slice(0, 10)
    : requestedDate;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "A date in YYYY-MM-DD format is required." },
      { status: 400 },
    );
  }

  const datetime = requestedDateTime ?? `${date}T00:00`;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(datetime) ||
    Number.isNaN(Date.parse(`${datetime}:00Z`))
  ) {
    return NextResponse.json(
      { error: "datetime must use YYYY-MM-DDTHH:MM." },
      { status: 400 },
    );
  }

  const ms = Date.parse(`${datetime}:00Z`);
  if (
    Number.isNaN(ms) ||
    new Date(ms).toISOString().slice(0, 10) !== date
  ) {
    return NextResponse.json(
      { error: "That is not a valid calendar date." },
      { status: 400 },
    );
  }

  if (ms < MIN_MS || ms > MAX_MS) {
    return NextResponse.json(
      {
        error: `Ephemeris coverage is ${MIN_DATE} to ${MAX_DATE}.`,
        min: MIN_DATE,
        max: MAX_DATE,
      },
      { status: 422 },
    );
  }

  const sky = currentSky(ephemeris, ms);
  const bodies = Object.fromEntries(
    Object.entries(sky).map(([name, body]) => {
      const insight = analogInsight(name, body.rashi, body.retro);
      return [name, { ...body, ...insight }];
    }),
  );

  const [historical, market] = await Promise.all([
    fetchBackend(
      requestedDateTime
        ? `/api/v1/historical-parallels?datetime=${encodeURIComponent(datetime)}&date=${date}&limit=2`
        : `/api/v1/historical-parallels?date=${date}&limit=2`,
    ),
    fetchBackend(`/api/v1/astro-positions?date=${date}`),
  ]);

  const historicalEnergy = historical?.energy
    ? { ...historical.energy, source: "planetary_geometry" }
    : null;
  const marketEnergy = market?.energy
    ? { ...market.energy, source: "market_ml" }
    : null;
  const localEnergy = localGeometryEnergy(bodies);
  const energy = historicalEnergy ?? localEnergy;

  return NextResponse.json(
    {
      date,
      datetime,
      source: SOURCE,
      bodies,
      energy,
      parallels: historical?.matches ?? [],
      marketEnergy,
      sources: {
        ephemeris: "swiss_ephemeris_knots",
        energy: energy?.source ?? "unavailable",
        parallels: historical ? "backend" : "unavailable",
        market_energy: market ? "backend" : "unavailable",
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}
