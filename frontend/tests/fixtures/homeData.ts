import type { Page } from "@playwright/test";

// The home page's browser data, mocked so layout and gauge tests do not depend on the backend.
// The gauge's score comes from /api/chrono/positions (energy.score).

export const MOCK_CATEGORIES = [
  "Science",
  "Politics",
  "Finance",
  "Culture/Religion",
  "Natural Disasters",
];
export const MOCK_COUNTS = [43, 46, 28, 22, 20];

export const MOCK_BODIES = {
  Sun: { lon: 198.35, rashi: "Tula", nakshatra: "Swati", retro: false },
  Moon: {
    lon: 147.76,
    rashi: "Simha",
    nakshatra: "Uttara Phalguni",
    retro: false,
  },
  Mercury: { lon: 197.16, rashi: "Tula", nakshatra: "Swati", retro: true },
  Venus: { lon: 180.43, rashi: "Tula", nakshatra: "Chitra", retro: true },
  Mars: { lon: 116.36, rashi: "Karka", nakshatra: "Ashlesha", retro: false },
  Jupiter: { lon: 120.31, rashi: "Simha", nakshatra: "Magha", retro: false },
  Saturn: {
    lon: 344.94,
    rashi: "Meena",
    nakshatra: "Uttara Bhadrapada",
    retro: true,
  },
  Rahu: { lon: 301.62, rashi: "Kumbha", nakshatra: "Dhanishta", retro: true },
  Ketu: { lon: 121.62, rashi: "Simha", nakshatra: "Magha", retro: true },
};

export const MOCK_MATCHES = [
  {
    date: "2027-04-23",
    similarity_percent: 89.7,
    event: {
      name: "India-Pakistan military strikes",
      category: "Politics",
      date: "2025-04-23",
    },
  },
  {
    date: "2027-03-31",
    similarity_percent: 86.5,
    event: {
      name: "US national bank holiday",
      category: "Finance",
      date: "1933-03-31",
    },
  },
  {
    date: "2026-11-14",
    similarity_percent: 83.2,
    event: {
      name: "Bhola cyclone",
      category: "Natural Disasters",
      date: "1970-11-14",
    },
  },
  {
    date: "2027-01-15",
    similarity_percent: 78.1,
    event: {
      name: "A science echo",
      category: "Science",
      date: "1960-01-15",
    },
  },
];

export function mockRoster() {
  const total = MOCK_COUNTS.reduce((sum, count) => sum + count, 0);
  return {
    total,
    categories: Object.fromEntries(
      MOCK_CATEGORIES.map((category, index) => [
        category,
        Array.from({ length: MOCK_COUNTS[index] }, (_, event) => ({
          date: `2000-01-${String((event % 28) + 1).padStart(2, "0")}`,
          name: `${category} event ${event}`,
        })),
      ]),
    ),
  };
}

export function mockPositions(url: string, score = 99) {
  const datetime =
    new URL(url).searchParams.get("datetime") ?? "2026-10-28T00:00";
  return {
    datetime,
    date: datetime.slice(0, 10),
    source: "Swiss Ephemeris · Lahiri",
    bodies: MOCK_BODIES,
    energy: { score, polarity: "disruptive" },
    parallels: [
      {
        date: "1970-11-12",
        name: "Bhola cyclone",
        category: "Natural Disasters",
        similarity_percent: 80.3,
      },
    ],
  };
}

export async function mockHomeData(page: Page, { score = 99 } = {}) {
  await page.route("**/api/events", (route) =>
    route.fulfill({ json: mockRoster() }),
  );
  await page.route("**/api/chrono/**", (route) =>
    route.fulfill({ json: mockPositions(route.request().url(), score) }),
  );
  await page.route("**/api/forecast-ladder", (route) =>
    route.fulfill({ json: { matches: MOCK_MATCHES } }),
  );
  await page.route("**/api/v1/events/upcoming", (route) =>
    route.fulfill({ json: { themes: {} } }),
  );
}
