import { networkHash } from "@/lib/server/netHash";

export const dynamic = "force-dynamic";

const BACKEND_URL = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const MAX_BODY = 8 * 1024;

// The report is same-origin by construction. A missing Origin is normal for a
// same-origin report; sec-fetch-site then has to say so.
function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY) {
    return new Response(null, { status: 413 });
  }
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  try {
    await fetch(`${BACKEND_URL}/api/v1/csp-report`, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(2_000),
      headers: {
        "Content-Type":
          request.headers.get("content-type") || "application/csp-report",
        // A network hash, not the address, and no user agent.
        "X-SH-Net": networkHash(request),
      },
    });
  } catch {
    // A lost report is acceptable; the browser may send it again.
  }
  return new Response(null, { status: 204 });
}
