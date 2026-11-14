import { expect, test } from "@playwright/test";

// The public proxy in front of FastAPI. Validation is deliberately here, not
// in FastAPI: an invalid start must never reach the backend.
test.describe("public sky-week route", () => {
  test("a Monday returns the backend JSON with a 24-hour cache", { tag: "@deploy" }, async ({
    request,
  }) => {
    const response = await request.get("/api/v1/sky/week?start=2026-11-16");
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("max-age=86400");
    const body = await response.json();
    expect(body.start).toBe("2026-11-16");
    expect(body.end).toBe("2026-11-22");
    expect(body.activity.closest_past.name).toBe("Black Wednesday");
    expect(body.activity.closest_past.similarity_percent).toBe(79.5);
  });

  test("a Tuesday or a malformed date returns 422 without a cache header", async ({
    request,
  }) => {
    for (const start of [
      "2026-11-17",
      "not-a-date",
      "2026-02-30",
      "1999-12-27",
      "2041-01-07",
    ]) {
      const response = await request.get(
        `/api/v1/sky/week?start=${start}`,
      );
      expect(response.status(), start).toBe(422);
      expect(response.headers()["cache-control"], start).toBeUndefined();
    }
  });

  test("unknown parameters are ignored", async ({ request }) => {
    const clean = await request.get("/api/v1/sky/week?start=2026-11-16");
    const noisy = await request.get(
      "/api/v1/sky/week?start=2026-11-16&foo=bar&resolution=daily",
    );
    expect(noisy.status()).toBe(200);
    expect(await noisy.json()).toEqual(await clean.json());
    expect(noisy.headers()["cache-control"]).toContain("max-age=86400");
  });
});
