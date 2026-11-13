import {
  DIGEST_BACKEND,
  json,
  passThrough,
  proxyHeaders,
  sameOrigin,
} from "@/lib/server/digestProxy";

export const dynamic = "force-dynamic";

const MAX_BODY = 2 * 1024;

export async function POST(request: Request) {
  const body = await request.text();
  if (new TextEncoder().encode(body).length > MAX_BODY) {
    return json(413, { detail: "Payload too large" });
  }
  if (!sameOrigin(request)) return json(403, { detail: "Forbidden" });

  try {
    const response = await fetch(`${DIGEST_BACKEND}/api/digest/subscribe`, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
      headers: {
        "Content-Type": "application/json",
        ...proxyHeaders(request),
      },
    });
    return passThrough(response.status, await response.text());
  } catch {
    return json(503, { detail: "Digest unavailable" });
  }
}
