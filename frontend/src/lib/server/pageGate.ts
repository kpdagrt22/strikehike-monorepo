// The detail pages whose content is one backend read: a recession or a decline
// (the weekly atlas), an event, a year list (its events). Next cannot set a 503
// from inside a page (a rewrite's status is reset before the page renders), so
// the proxy runs that read first (proxy.ts):
//
// - the read succeeds, or the last-good memo has a copy: the page renders from
//   that copy, and a missing id still reaches the page's notFound(), a real 404;
// - the backend fails or times out with no copy: the proxy answers 503 with
//   Retry-After and a small "temporarily unavailable" page, never a 404;
// - except for an ISR page (event, year list) that Next still holds on disk:
//   the memo starts empty after a restart, but Next serves that copy and keeps
//   it when a background regeneration fails, so the proxy lets it answer.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { eventIdFromSlug } from "@/lib/events/eventId";
import { findYearList } from "@/lib/events/yearLists";
import { isBackendUnavailable } from "./lastGood";
import { readEvent, readRegimeAtlas } from "./pageData";
import { unavailableHeaders } from "./unavailable.js";

/** The backend read a gated path needs before it renders, or null for none. */
export function pageDataRead(pathname: string): (() => Promise<unknown>) | null {
  const parts = pathname.replace(/\/+$/, "").split("/").slice(1);
  const [section, first, second] = parts;
  if (!first) return null;
  if ((section === "recessions" || section === "declines") && parts.length === 2) {
    return readRegimeAtlas;
  }
  if (section === "events" && parts.length === 2) {
    const id = eventIdFromSlug(first);
    return id ? () => readEvent(id) : null;
  }
  if (section === "dates" && parts.length === 3 && second) {
    const list = findYearList(first, second);
    return list ? () => Promise.all(list.entries.map((entry) => readEvent(entry.id))) : null;
  }
  return null;
}

// The gated pages that are ISR pages, by their app-router page: Next keys its
// on-disk copies by that page (next/dist/server/lib/route-cache-key.js).
// Recession and decline pages are dynamic and have no such copy.
const ISR_PAGES: Record<string, string> = {
  events: "/(engine)/events/[id]/page",
  dates: "/(engine)/dates/[year]/[list]/page",
};

/**
 * True when Next has a rendered copy of `pathname` on disk: Next 16's
 * `<distDir>/server/route-cache/APP_PAGE/<sha256(page)>/$<path>.html`, or the
 * older `<distDir>/server/app/<path>.html`. Only called for a path whose id or
 * list pageDataRead already accepted; a layout Next no longer uses finds
 * nothing, which keeps the 503.
 */
export function hasIsrCopy(
  pathname: string,
  // A runtime lookup, not a build input: turbopackIgnore keeps Turbopack's
  // file tracing from copying the whole project into the standalone output.
  distDir = join(/* turbopackIgnore: true */ process.cwd(), process.env.NEXT_DIST_DIR || ".next"),
): boolean {
  const page = ISR_PAGES[pathname.split("/")[1] ?? ""];
  if (!page) return false;
  const server = resolve(distDir, "server");
  const owner = createHash("sha256").update(page).digest("hex");
  const candidates = [
    resolve(server, "route-cache", "APP_PAGE", owner, `$${pathname}.html`),
    resolve(server, "app", `.${pathname}.html`),
  ];
  return candidates.some((file) => {
    if (!file.startsWith(server + sep)) return false;
    try {
      return existsSync(file);
    } catch {
      return false;
    }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** The 503 page: self-contained (no script, inline style, light and dark). */
export function unavailablePage(pathname: string): string {
  const retry = /^\/[^/\\]/.test(pathname) ? escapeHtml(pathname) : "/";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Temporarily unavailable — StrikeHike</title>
<style>
:root{color-scheme:light dark;--bg:#f1ebe2;--card:rgb(255 255 255/.6);--ink:rgb(20 18 26/.88);--muted:rgb(20 18 26/.7);--line:rgb(20 18 26/.14);--accent:#c0442f}
@media (prefers-color-scheme:dark){:root{--bg:#0d0d16;--card:rgb(0 0 0/.3);--ink:rgb(242 237 228/.92);--muted:rgb(242 237 228/.72);--line:rgb(255 255 255/.14);--accent:#ff8b77}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.5 ui-sans-serif,system-ui,sans-serif}
main{width:100%;max-width:32rem;border:1px solid var(--line);border-radius:16px;background:var(--card);padding:24px;text-align:center}
.eyebrow{margin:0;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--accent)}
h1{margin:8px 0 0;font-size:24px;line-height:1.25;letter-spacing:-.03em;font-weight:600}
p.note{margin:8px 0 0;color:var(--muted);font-size:15px}
nav{margin-top:20px;display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:center}
a{color:var(--ink);font-size:14px;font-weight:500}
a.retry{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border:1px solid var(--line);border-radius:999px;text-decoration:none}
</style>
</head>
<body>
<main data-page-unavailable>
<p class="eyebrow">Temporarily unavailable</p>
<h1>This page could not load its data.</h1>
<p class="note">The history service did not answer in time. The page still exists; please try again in a minute.</p>
<nav aria-label="Next steps"><a class="retry" href="${retry}">Try again</a><a href="/">Go home</a></nav>
</main>
</body>
</html>
`;
}

export async function gatePage(request: NextRequest): Promise<NextResponse> {
  const read = pageDataRead(request.nextUrl.pathname);
  if (!read) return NextResponse.next();
  try {
    await read();
    return NextResponse.next();
  } catch (error) {
    // Anything other than "the backend did not answer" is left to the page.
    if (!isBackendUnavailable(error)) return NextResponse.next();
    // Next still holds this page on disk (a restart emptied the memo): it
    // serves that copy, fresh or stale, and keeps it if regeneration fails.
    if (hasIsrCopy(request.nextUrl.pathname)) return NextResponse.next();
    return new NextResponse(unavailablePage(request.nextUrl.pathname), {
      status: 503,
      headers: unavailableHeaders(503, { "Content-Type": "text/html; charset=utf-8" }),
    });
  }
}
