import { expect, test } from "@playwright/test";

// P20: the two roundup calendar routes and the two hosted email charts.
test.describe("P20: email calendar routes and charts", () => {
  test("the week calendar and one item are served, with stable UIDs", async ({
    request,
  }) => {
    const week = await request.get("/this-week/2026-W47/calendar.ics");
    expect(week.status()).toBe(200);
    expect(week.headers()["content-type"]).toContain("text/calendar");
    expect(week.headers()["content-disposition"]).toContain(
      'filename="strikehike-2026-W47.ics"',
    );
    const body = await week.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("UID:2026-W47-");
    const uid = /UID:(2026-W47-[^@]+)@strikehike\.com/.exec(body)?.[1];
    expect(uid).toBeTruthy();
    const key = uid!.replace("2026-W47-", "");

    const item = await request.get(
      `/this-week/2026-W47/calendar/${key}.ics`,
    );
    expect(item.status()).toBe(200);
    expect(item.headers()["content-type"]).toContain("text/calendar");
    expect(await item.text()).toContain(`UID:${uid}@strikehike.com`);

    expect(
      (await request.get("/this-week/2026-W99/calendar.ics")).status(),
    ).toBe(404);
    expect(
      (await request.get("/this-week/2026-W47/calendar/nope.ics")).status(),
    ).toBe(404);
  });

  test("the regime and activity charts are PNGs; unknown weeks 404", async ({
    request,
  }) => {
    for (const chart of ["regime", "activity"]) {
      const response = await request.get(
        `/this-week/2026-W47/email/${chart}.png`,
      );
      expect(response.status(), chart).toBe(200);
      expect(response.headers()["content-type"], chart).toContain("image/png");
      expect((await response.body()).length, chart).toBeGreaterThan(1000);
      const missing = await request.get(
        `/this-week/2026-W99/email/${chart}.png`,
      );
      expect(missing.status(), chart).toBe(404);
    }
  });
});
