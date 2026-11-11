// Warm the macro archive once per server start, off the request path. The
// first visitor after a deploy then meets a warm backend cache; a failure is
// harmless and leaves the normal lazy fetch to handle it.
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const base = (process.env.CHRONO_API_URL ?? "").replace(/\/+$/, "");
  if (!base) return;
  const year = new Date().getUTCFullYear();
  const urls = [
    `${base}/api/v1/regime/macro-history?resolution=weekly`,
    `${base}/api/v1/regime/macro-history?resolution=weekly&start=${year - 20}-01-01`,
    `${base}/api/v1/regime/macro-history?resolution=monthly&start=2025-01-01`,
  ];
  void Promise.allSettled(
    urls.map(async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      // Read the body so the backend finishes serialising before we let go.
      await response.arrayBuffer();
    }),
  );
}
