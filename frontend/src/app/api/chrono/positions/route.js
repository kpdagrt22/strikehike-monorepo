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

export async function GET(request) {
  const searchParams = new URL(request.url).searchParams;
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
