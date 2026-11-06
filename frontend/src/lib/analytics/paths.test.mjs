import assert from "node:assert/strict";
import test from "node:test";

import { pageTemplate } from "./paths.ts";

test("known pages keep their path", () => {
  for (const path of [
    "/",
    "/regime",
    "/convergence",
    "/patterns",
    "/disclaimer",
    "/upcoming",
  ]) {
    assert.equal(pageTemplate(path), path);
  }
});

test("event pages map to their template, never a raw id", () => {
  assert.equal(
    pageTemplate("/events/finance~curated_upcoming~fomc-2027-01"),
    "/events/[id]",
  );
  assert.equal(
    pageTemplate("/events/science~astronomy_computed~solar-eclipse-total-2027-08-02/"),
    "/events/[id]",
  );
  assert.equal(pageTemplate("/events/nope"), "/events/[id]");
});

test("theme pages map to their template only for the three known themes", () => {
  for (const theme of ["science", "finance", "culture-religion"]) {
    assert.equal(pageTemplate(`/upcoming/${theme}`), "/upcoming/[theme]");
  }
  assert.equal(pageTemplate("/upcoming/politics"), "404");
  assert.equal(pageTemplate("/upcoming/natural-disasters"), "404");
});

test("year pages map to their template", () => {
  assert.equal(pageTemplate("/dates/2027/fomc-meetings"), "/dates/[year]/[list]");
  assert.equal(pageTemplate("/dates/2027/eclipses"), "/dates/[year]/[list]");
  assert.equal(pageTemplate("/dates/2027"), "404");
});

test("anything else is 404", () => {
  for (const path of ["/nope", "/upcoming/science/extra", "/events", "/dates/a"]) {
    assert.equal(pageTemplate(path), "404");
  }
  // A trailing slash is the same page (Next redirects it anyway).
  assert.equal(pageTemplate("/upcoming/"), "/upcoming");
});
