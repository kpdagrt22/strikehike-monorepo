import assert from "node:assert/strict";
import test from "node:test";

import {
  allDayLabel,
  allDayLongLabel,
  dateLabel,
  longDateLabel,
  timeLabel,
  zoneLabel,
} from "./localTime.ts";

test("Kolkata shows the next day and IST", () => {
  const instant = "2026-12-21T20:50:15Z";
  assert.equal(dateLabel(instant, "Asia/Kolkata"), "Tue 22 Dec");
  assert.equal(timeLabel(instant, "Asia/Kolkata"), "02:20");
  assert.equal(zoneLabel(instant, "Asia/Kolkata"), "IST");
});

test("UTC keeps the same date and a UTC label", () => {
  const instant = "2026-12-21T20:50:15Z";
  assert.equal(dateLabel(instant, "UTC"), "Mon 21 Dec");
  assert.equal(timeLabel(instant, "UTC"), "20:50");
  assert.equal(zoneLabel(instant, "UTC"), "UTC");
});

test("New York follows EST and EDT", () => {
  const winter = "2026-12-04T13:30:00Z";
  assert.equal(timeLabel(winter, "America/New_York"), "08:30");
  assert.equal(zoneLabel(winter, "America/New_York"), "EST");

  const summer = "2027-07-02T12:30:00Z";
  assert.equal(timeLabel(summer, "America/New_York"), "08:30");
  assert.equal(zoneLabel(summer, "America/New_York"), "EDT");
});

test("New York crosses the DST change without shifting the UTC instant", () => {
  const before = "2026-10-30T13:30:00Z";
  const after = "2026-11-02T13:30:00Z";
  assert.equal(timeLabel(before, "America/New_York"), "09:30");
  assert.equal(zoneLabel(before, "America/New_York"), "EDT");
  assert.equal(timeLabel(after, "America/New_York"), "08:30");
  assert.equal(zoneLabel(after, "America/New_York"), "EST");
});

test("an all-day date is never shifted", () => {
  assert.equal(allDayLabel("2026-12-21", "Asia/Kolkata"), "Mon 21 Dec");
  assert.equal(allDayLabel("2026-12-21", "America/New_York"), "Mon 21 Dec");
  assert.equal(allDayLabel("2026-12-21", "UTC"), "Mon 21 Dec");
});

test("the long labels carry the year and follow the zone", () => {
  const instant = "2026-12-31T20:50:00Z";
  assert.equal(longDateLabel(instant, "UTC"), "Thu, 31 Dec 2026");
  assert.equal(longDateLabel(instant, "Asia/Kolkata"), "Fri, 1 Jan 2027");
  assert.equal(allDayLongLabel("2027-03-28"), "Sun, 28 Mar 2027");
});
