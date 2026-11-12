import { DIGEST_BACKEND } from "@/lib/server/digestProxy";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("t") || "";
  const query = new URLSearchParams({ t: token }).toString();
  try {
    const response = await fetch(
      `${DIGEST_BACKEND}/api/digest/confirm?${query}`,
      {
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (response.status === 404) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return new Response(null, {
        status: response.status,
        headers: { Location: location, "Cache-Control": "no-store" },
      });
    }
    return new Response(null, {
      status: 303,
      headers: { Location: "/digest/invalid", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response(null, {
      status: 303,
      headers: { Location: "/digest/invalid", "Cache-Control": "no-store" },
    });
  }
}
