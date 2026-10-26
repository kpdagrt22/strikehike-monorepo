import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const BACKEND_TIMEOUT_MS = 8000;

export async function GET() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${BACKEND_URL}/api/v1/forecast-ladder?days=180&threshold=75&limit=5`,
      {
        signal: controller.signal,
        cache: "no-store",
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Forecast ladder service is unavailable." },
        { status: 503 },
      );
    }

    return NextResponse.json(await response.json());
  } catch {
    return NextResponse.json(
      { error: "Forecast ladder service is unavailable." },
      { status: 503 },
    );
  } finally {
    clearTimeout(timer);
  }
}
