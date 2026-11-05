import { networkHash } from "@/lib/server/netHash";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const MAX_BODY = 2 * 1024;
const BACKEND_TIMEOUT_MS = 5_000;

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY) {
    return json(413, { detail: "Payload too large" });
  }
  if (!sameOrigin(request)) return json(403, { detail: "Forbidden" });
  // No GPC/DNT drop here: a message is sent on purpose and carries no
  // identifier, and dropping it would show "Sent" for a lost message.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BACKEND_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}/api/v1/feedback`, {
      method: "POST",
      body,
      signal: controller.signal,
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain",
        "X-SH-Net": networkHash(request),
        "User-Agent": request.headers.get("user-agent") || "",
      },
    });
    const text = await response.text();
    return new Response(text, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return json(503, { detail: "Feedback unavailable" });
  } finally {
    clearTimeout(timer);
  }
}
