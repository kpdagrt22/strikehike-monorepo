// Backend reads for the detail pages that must tell "no such record" (404)
// from "the backend did not answer" (503): the recession and decline pages
// (the weekly atlas) and the event and year-list pages (one event each).
//
// Each read goes through a last-good memo (lastGood.ts): after one good load a
// slow or failing backend serves the stored copy, and with no copy at all the
// read throws BackendUnavailableError. The memo lives on globalThis so the
// proxy (which checks a page's data before it renders, proxy.ts) and the pages
// in the same server process share one copy: the atlas is ~12 MB, over Next's
// 2 MB data-cache limit, so without this every page view fetched it again.
import type { EventDetailPayload, RegimeAtlas } from "@/lib/seo/data";
import { createLastGoodStore, type LastGoodStore } from "./lastGood";

const BACKEND = process.env.CHRONO_API_URL?.replace(/\/+$/, "");
const TIMEOUT_MS = 8_000;
const FRESH_MS = 60_000;
const GLOBAL_KEY = "__strikehikePageData";

type Stores = { atlas: LastGoodStore; events: LastGoodStore };

function stores(): Stores {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: Stores };
  holder[GLOBAL_KEY] ??= {
    atlas: createLastGoodStore({ maxEntries: 1 }),
    // A real event is ~2 KB; unknown ids are kept too (as null), so a crawl
    // of bad ids cannot reach the backend once per request.
    events: createLastGoodStore({ maxEntries: 5_000 }),
  };
  return holder[GLOBAL_KEY];
}

function backend(): string {
  if (!BACKEND) throw new Error("CHRONO_API_URL is not set");
  return BACKEND;
}

async function fetchAtlas(): Promise<RegimeAtlas> {
  const response = await fetch(
    `${backend()}/api/v1/regime/macro-history?resolution=weekly&view=atlas`,
    {
      // Over the 2 MB data-cache limit: the memo is its only cache. Every
      // reader is a dynamic route, so no-store changes no rendering mode.
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`regime atlas returned ${response.status}`);
  const payload: unknown = await response.json();
  const atlas = payload as Partial<RegimeAtlas> | null;
  if (
    !atlas ||
    typeof atlas !== "object" ||
    !Array.isArray(atlas.timeline) ||
    !Array.isArray(atlas.crashes) ||
    !atlas.meta
  ) {
    throw new Error("regime atlas shape");
  }
  return atlas as RegimeAtlas;
}

async function fetchEvent(id: string): Promise<EventDetailPayload | null> {
  const response = await fetch(`${backend()}/api/v1/events/${encodeURIComponent(id)}`, {
    // The event and year-list pages are ISR pages: keep the fetch cacheable.
    next: { revalidate: 60 },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // No such event in the bundle (404) or not a valid id (422): a real 404.
  if (response.status === 404 || response.status === 422) return null;
  if (!response.ok) throw new Error(`event ${id} returned ${response.status}`);
  const data: unknown = await response.json();
  if (!data || typeof data !== "object" || !("event_id" in data)) {
    throw new Error("event shape");
  }
  return data as EventDetailPayload;
}

/** The weekly atlas (`view=atlas`); throws BackendUnavailableError, never returns null. */
export function readRegimeAtlas(): Promise<RegimeAtlas> {
  return stores().atlas.read("atlas", FRESH_MS, fetchAtlas, "The regime atlas");
}

/** One event, or null when the bundle has no such event; throws BackendUnavailableError. */
export function readEvent(id: string): Promise<EventDetailPayload | null> {
  return stores().events.read(id, FRESH_MS, () => fetchEvent(id), `Event ${id}`);
}
