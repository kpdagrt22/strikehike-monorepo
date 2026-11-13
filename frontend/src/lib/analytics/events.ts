import { trackEvent, trackPageView } from "./track";

type NavType = "load" | "client" | "back_forward";
type ViewPanel =
  | "nav"
  | "info"
  | "archive"
  | "ladder_sheet"
  | "alignment_insight"
  | "planet_pinned"
  | "timeline"
  | "precise_picker"
  | "regime_overlay"
  | "mobile_events"
  | "mobile_data"
  | "feedback"
  | "nber_table"
  | "catalogue_table";
type ViewMethod = "click" | "tap" | "keyboard" | "hover_intent" | "hash";
type TravelMethod =
  | "scrub"
  | "crash_marker"
  | "page_key"
  | "today"
  | "precise_picker"
  | "archive_event"
  | "sky_ladder"
  | "ladder_lane"
  | "crash_band"
  | "nber_select"
  | "market_tape"
  | "deep_link";
type Asset = "sp500" | "gold" | "bonds" | "nifty50";
type CasePage = "/convergence" | "/patterns";
type CaseSlot = "a" | "b" | "pair" | "compare";
type CaseMethod =
  | "picker"
  | "picker_search"
  | "suggested_pair"
  | "swap"
  | "cross_link"
  | "deep_link";
type Theme =
  | "politics"
  | "science"
  | "finance"
  | "culture-religion"
  | "natural-disasters";
type ShareSurface =
  | "event"
  | "theme"
  | "date"
  | "recession"
  | "decline"
  | "regime"
  | "roundup"
  | "tested";
type SupportSurface = "home" | "footer";
type DigestSurface = "this_week" | "footer";

function ordinary(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 64);
}

function yearOf(value: string | number | Date) {
  if (typeof value === "number") return value;
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : new Date().getUTCFullYear();
}

export function pageViewed(path: string, navType: NavType) {
  trackPageView(path, navType);
}

export function onboardingDismissed(method: "enter" | "escape", msShown?: "<3s" | "3–10s" | ">10s") {
  trackEvent("onboarding_dismissed", { method, ...(msShown ? { ms_shown: msShown } : {}) });
}

export function viewOpened(panel: ViewPanel, method: ViewMethod) {
  trackEvent("view_opened", { panel, method });
}

export function dateTravelled(method: TravelMethod, target: string | number, targetRef?: string) {
  const year = yearOf(target);
  // The schema accepts 1800-2200; a hand-edited ?d= outside it is not sent.
  if (!(year >= 1800 && year <= 2200)) return;
  const future =
    typeof target === "string"
      ? Date.parse(`${target.slice(0, 10)}T00:00:00Z`) > Date.now()
      : year > new Date().getUTCFullYear();
  trackEvent("date_travelled", {
    method,
    target_year: year,
    is_future: future ? 1 : 0,
    ...(targetRef ? { target_ref: targetRef.slice(0, 64) } : {}),
  });
}

export function assetCompared(
  action: "select" | "add" | "remove" | "compare_on" | "compare_off",
  asset: Asset | "",
  assetsOn?: number,
) {
  trackEvent("asset_compared", {
    action,
    asset,
    ...(Number.isFinite(assetsOn) ? { assets_on: assetsOn } : {}),
  });
}

export function cycleMapToggled(state: "on" | "off") {
  trackEvent("cycle_map_toggled", { state });
}

const CASE_ID = /^[a-z0-9-]{3,48}$/;

export function caseOpened(
  page: CasePage,
  slot: CaseSlot,
  method: CaseMethod,
  caseId: string,
  caseIdB?: string,
) {
  // Only catalogue-shaped ids, the same grammar the backend enforces.
  if (!CASE_ID.test(caseId) || (caseIdB !== undefined && !CASE_ID.test(caseIdB))) return;
  trackEvent("case_opened", {
    page,
    slot,
    method,
    case_id: caseId,
    ...(caseIdB ? { case_id_b: caseIdB } : {}),
  });
}

export function upcomingOpened(method: "tab" | "mobile_sheet" | "deep_link" | "page", eventsShown?: number) {
  trackEvent("upcoming_opened", {
    method,
    ...(Number.isFinite(eventsShown) ? { events_shown: eventsShown } : {}),
  });
}

export function themeSelected(
  theme: Theme | "all" | "clear",
  state: "on" | "off",
  selectedCount?: number,
  shownCount?: number,
) {
  trackEvent("theme_selected", {
    theme,
    state,
    ...(Number.isFinite(selectedCount) ? { selected_count: selectedCount } : {}),
    ...(Number.isFinite(shownCount) ? { shown_count: shownCount } : {}),
  });
}

export function eventSourceClicked(
  eventId: string,
  theme: Theme,
  daysUntil?: number,
  sourceUrl?: string,
) {
  const bucket =
    daysUntil == null
      ? undefined
      : daysUntil <= 7
        ? "0–7"
        : daysUntil <= 30
          ? "8–30"
          : daysUntil <= 90
            ? "31–90"
            : "91–365";
  let sourceHost;
  try {
    sourceHost = sourceUrl ? new URL(sourceUrl).host.slice(0, 160) : undefined;
  } catch {
    sourceHost = undefined;
  }
  trackEvent("event_source_clicked", {
    event_id: eventId.slice(0, 64),
    theme,
    ...(bucket ? { days_until_bucket: bucket } : {}),
    ...(sourceHost ? { source_host: sourceHost } : {}),
  });
}

export function methodOpened(which: "method_limits" | "how_it_works", page: "/regime" | "/convergence") {
  trackEvent("method_opened", { which, page });
}

export function supportOpened(
  trigger: "click" | "tap" | "keyboard" | "footer_link",
  surface: SupportSurface,
) {
  trackEvent("support_opened", { trigger, surface });
}

export function supportLinkClicked(
  target: "paypal" = "paypal",
  surface: SupportSurface,
) {
  trackEvent("support_link_clicked", { target, surface });
}

export function feedbackSubmitted(length: number) {
  const bucket = length < 50 ? "<50" : length <= 200 ? "50–200" : ">200";
  trackEvent("feedback_submitted", { length_bucket: bucket });
}

export function calendarSubscribed(
  scope: "all" | "science" | "finance" | "culture-religion",
  method: "apple" | "google" | "outlook" | "copy" | "download",
) {
  trackEvent("calendar_subscribed", { scope, method });
}

export function shareClicked(
  surface: ShareSurface,
  method: "clipboard" | "share",
) {
  trackEvent("share_clicked", { surface, method });
}

const FOLLOW_THEMES = new Set([
  "politics",
  "science",
  "finance",
  "culture-religion",
  "natural-disasters",
]);

export function themeFollowed(theme: string, action: "follow" | "unfollow") {
  if (!FOLLOW_THEMES.has(theme)) return;
  trackEvent("theme_followed", { theme, action });
}

export function changeNote(action: "shown" | "dismissed" | "clicked") {
  trackEvent("change_note", { action });
}

// Fired only after the digest endpoint accepts the address. The event carries
// the surface and nothing else: never the email or any part of it.
export function digestSubscribed(surface: DigestSurface) {
  trackEvent("digest_subscribed", { surface });
}

const EXP_TOKEN = /^[a-z0-9-]{1,32}$/;

// One report per session per experiment, only when a real variant is shown.
export function experimentExposed(experiment: string, variant: string) {
  if (!EXP_TOKEN.test(experiment) || !EXP_TOKEN.test(variant)) return;
  trackEvent("experiment_exposed", { exp: experiment, variant });
}

export function themeSlug(theme: string) {
  return ordinary(theme);
}

export function soundChanged(
  choice: "off" | "drift" | "orbit" | "wind",
  trigger: "auto" | "click",
) {
  trackEvent("sound_changed", { choice, trigger });
}
