import { DIGEST_BACKEND } from "@/lib/server/digestProxy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const response = await fetch(`${DIGEST_BACKEND}/api/digest/status`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    const body = await response.text();
    // The UI probe is not a digest action. When the backend feature is off it
    // answers 404; translate that to a clean 200 so the browser console stays
    // quiet while the form and footer line remain hidden.
    if (response.status === 404) {
      return Response.json(
        { enabled: false },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
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
