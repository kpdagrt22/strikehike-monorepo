import assert from "node:assert/strict";
import test from "node:test";

import { isIndexableEvent, isIndexableTheme } from "./indexing.ts";

const ECLIPSE = {
  event_id: "science:astronomy_computed:solar-eclipse-total-2027-08-02",
  name: "Total solar eclipse",
  status: "scheduled",
  description: "The Moon fully covers the Sun along a narrow path.",
  source_id: "astronomy_computed",
  authority_url:
    "https://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html",
};

const FOMC = {
  event_id: "finance:curated_upcoming:fomc-2027-01",
  name: "Federal Reserve FOMC policy decision",
  status: "scheduled",
  description: "Federal Open Market Committee policy statement.",
  source_id: "curated_upcoming",
  authority_url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
};

test("a scheduled, described event with a per-event authority is indexed", () => {
  const eclipse = isIndexableEvent(ECLIPSE);
  assert.equal(eclipse.index, true);
  assert.match(eclipse.reason, /eclipse\.gsfc\.nasa\.gov/);
  assert.equal(isIndexableEvent(FOMC).index, true);
});

for (const status of ["tentative", "rescheduled", "cancelled", "completed", "unverified", ""]) {
  test(`status ${status || "(missing)"} is never indexed`, () => {
    const decision = isIndexableEvent({ ...ECLIPSE, status });
    assert.equal(decision.index, false);
    assert.match(decision.reason, /not scheduled/);
  });
}

for (const description of ["", "   ", null, undefined]) {
  test(`a missing description (${JSON.stringify(description)}) is not indexed`, () => {
    const decision = isIndexableEvent({ ...ECLIPSE, description });
    assert.deepEqual(decision, { index: false, reason: "no description" });
  });
}

for (const authority_url of [null, undefined, "", "  "]) {
  test(`no authority (${JSON.stringify(authority_url)}) is not indexed`, () => {
    const decision = isIndexableEvent({ ...ECLIPSE, authority_url });
    assert.deepEqual(decision, { index: false, reason: "no per-event authority page" });
  });
}

test("an authority that is not a URL is not indexed", () => {
  const decision = isIndexableEvent({ ...ECLIPSE, authority_url: "eclipse page" });
  assert.equal(decision.index, false);
  assert.match(decision.reason, /not a URL/);
});

test("an http authority is not indexed", () => {
  const decision = isIndexableEvent({
    ...ECLIPSE,
    authority_url: "http://eclipse.gsfc.nasa.gov/SEpath/SEpath2001/SE2027Aug02Tpath.html",
  });
  assert.equal(decision.index, false);
  assert.match(decision.reason, /https/);
});

test("the generic Swiss Ephemeris link is not an authority", () => {
  for (const authority_url of [
    "https://www.astro.com/swisseph/",
    "https://astro.com/swisseph/swephinfo_e.htm",
  ]) {
    const decision = isIndexableEvent({ ...ECLIPSE, authority_url });
    assert.equal(decision.index, false);
    assert.match(decision.reason, /generic method link/);
  }
});

test("a homepage is not an authority", () => {
  const decision = isIndexableEvent({
    ...ECLIPSE,
    event_id: "culture-religion:culture_computed:western-easter-2027",
    source_id: "culture_computed",
    authority_url: "https://www.churchofengland.org/",
  });
  assert.equal(decision.index, false);
  assert.match(decision.reason, /homepage/);
});

for (const name of [
  "Employment Situation",
  "Consumer Price Index",
  "Gross Domestic Product",
  "Personal Income and Outlays",
]) {
  test(`a recurring FRED release (${name}) is not indexed, even with an authority`, () => {
    const decision = isIndexableEvent({
      event_id: "finance:fred_release_dates:50-2026-12-04",
      name,
      status: "scheduled",
      description: `${name}, from the agency's release calendar.`,
      source_id: "fred_release_dates",
      authority_url: "https://www.bls.gov/schedule/news_release/empsit.htm",
    });
    assert.equal(decision.index, false);
    assert.match(decision.reason, /recurring statistical release/);
  });
}

test("the source falls back to the id when the payload has no source_id", () => {
  const decision = isIndexableEvent({
    event_id: "finance:fred_release_dates:10-2026-12-10",
    status: "scheduled",
    description: "Consumer Price Index.",
    authority_url: "https://www.bls.gov/schedule/news_release/cpi.htm",
  });
  assert.equal(decision.index, false);
  assert.match(decision.reason, /recurring/);
  const curated = { ...FOMC };
  delete curated.source_id;
  assert.equal(isIndexableEvent(curated).index, true);
});

test("a theme with at least three upcoming dates is indexed", () => {
  assert.deepEqual(isIndexableTheme({ name: "Finance", upcoming: 33 }), {
    index: true,
    reason: "33 upcoming dates",
  });
  assert.equal(isIndexableTheme({ name: "science", upcoming: 3 }).index, true);
});

test("a theme with fewer than three upcoming dates is not indexed", () => {
  const two = isIndexableTheme({ name: "Culture/Religion", upcoming: 2 });
  assert.equal(two.index, false);
  assert.match(two.reason, /2 upcoming dates; at least 3/);
  const one = isIndexableTheme({ name: "culture-religion", upcoming: 1 });
  assert.match(one.reason, /1 upcoming date;/);
  assert.equal(isIndexableTheme({ name: "Science", upcoming: Number.NaN }).index, false);
});

test("Politics and Natural Disasters are never indexed", () => {
  for (const name of ["Politics", "politics", "Natural Disasters", "natural-disasters"]) {
    const decision = isIndexableTheme({ name, upcoming: 50 });
    assert.equal(decision.index, false);
    assert.match(decision.reason, /never indexed/);
  }
});
