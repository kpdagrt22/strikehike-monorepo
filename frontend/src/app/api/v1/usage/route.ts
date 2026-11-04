import { after } from "next/server";
import { networkHash } from "@/lib/server/netHash";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const MAX_BODY = 8 * 1024;
const BACKEND_TIMEOUT_MS = 2_000;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function response(status: number, payload?: unknown) {
  return new Response(payload === undefined ? null : JSON.stringify(payload), {
    status,
    headers:
      payload === undefined
        ? undefined
        : { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY) {
    return response(413, { detail: "Payload too large" });
  }
  if (!sameOrigin(request)) return response(403, { detail: "Forbidden" });
  if (request.headers.get("sec-gpc") === "1" || request.headers.get("dnt") === "1") {
    return response(204);
  }

  const net = networkHash(request);
  const userAgent = request.headers.get("user-agent") || "";
  after(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
    try {
      await fetch(`${BACKEND_URL}/api/v1/usage`, {
        method: "POST",
        body,
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "Content-Type": "text/plain",
          "X-SH-Net": net,
          "User-Agent": userAgent,
        },
      });
    } catch {
      // Losing one batch is preferable to delaying the page.
    } finally {
      clearTimeout(timer);
    }
  });

  return response(204);
}
