import { networkHash } from "@/lib/server/netHash";

export const DIGEST_BACKEND = (
  process.env.CHRONO_API_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "same-origin";
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export function proxyHeaders(request: Request) {
  return {
    "X-SH-Net": networkHash(request),
    "User-Agent": request.headers.get("user-agent") || "",
  };
}

export function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export function passThrough(status: number, body: string) {
  return new Response(body || null, {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}
