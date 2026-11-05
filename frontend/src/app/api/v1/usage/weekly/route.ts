import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const TIMEOUT_MS = 60_000;

function failure(status: number, detail: string) {
  return NextResponse.json(
    { detail },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function GET(request: Request) {
  const week = new URL(request.url).searchParams.get("week");
  if (!week) return failure(422, "week must be YYYY-Www");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const authorization = request.headers.get("authorization");
  const headers: Record<string, string> = {};
  if (authorization) headers.Authorization = authorization;

  try {
    const query = new URLSearchParams({ week }).toString();
    const response = await fetch(
      `${BACKEND_URL}/api/v1/usage/weekly?${query}`,
      {
        headers,
        cache: "no-store",
        signal: controller.signal,
      },
    );
    const body = await response.text();
    return new Response(body || null, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return failure(503, "Usage export is unavailable.");
  } finally {
    clearTimeout(timer);
  }
}
