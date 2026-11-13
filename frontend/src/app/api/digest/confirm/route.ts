import { DIGEST_BACKEND, proxyHeaders } from "@/lib/server/digestProxy";

export const dynamic = "force-dynamic";

function tokenQuery(request: Request) {
  const token = new URL(request.url).searchParams.get("t") || "";
  return new URLSearchParams({ t: token }).toString();
}

function invalid() {
  return new Response(null, {
    status: 303,
    headers: { Location: "/digest/invalid", "Cache-Control": "no-store" },
  });
}

function redirect(location: string, status = 303) {
  return new Response(null, {
    status,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

async function forward(request: Request, method: "GET" | "POST") {
  try {
    const response = await fetch(
      `${DIGEST_BACKEND}/api/digest/confirm?${tokenQuery(request)}`,
      {
        method,
        ...(method === "POST"
          ? {
              body: await request.text(),
              headers: {
                "Content-Type":
                  request.headers.get("content-type") ||
                  "application/x-www-form-urlencoded",
                ...proxyHeaders(request),
              },
            }
          : {}),
        cache: "no-store",
        redirect: "manual",
        signal: AbortSignal.timeout(8_000),
      },
    );
    // Consume the upstream body even when it is a 404 or a redirect.
    await response.text();
    if (response.status === 404) {
      return new Response(null, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return redirect(location, response.status);
    }
    return invalid();
  } catch {
    return invalid();
  }
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function POST(request: Request) {
  return forward(request, "POST");
}
