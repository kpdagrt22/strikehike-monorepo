// The detail pages whose content is one backend read: a recession or a decline
// (the weekly atlas), an event, a year list (its events). Next cannot set a 503
// from inside a page (a rewrite's status is reset before the page renders), so
// the proxy runs that read first (proxy.ts):
//
// - the read succeeds, or the last-good memo has a copy: the page renders from
//   that copy, and a missing id still reaches the page's notFound(), a real 404;
// - the backend fails or times out with no copy: the proxy answers 503 with
//   Retry-After and a small "temporarily unavailable" page, never a 404.
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
    return new NextResponse(unavailablePage(request.nextUrl.pathname), {
      status: 503,
      headers: unavailableHeaders(503, { "Content-Type": "text/html; charset=utf-8" }),
    });
  }
}
