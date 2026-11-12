import { DIGEST_BACKEND } from "@/lib/server/digestProxy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${DIGEST_BACKEND}/api/digest/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.text();
    return new Response(body || null, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response(null, { status: 503 });
  }
}
