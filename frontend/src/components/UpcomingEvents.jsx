"use client";

import { useEffect, useState } from "react";
import { categoryTone } from "@/lib/categoryTone";

const THEMES = [
  "Politics",
  "Science",
  "Finance",
  "Culture/Religion",
  "Natural Disasters",
];
const THEME_SET = new Set(THEMES);
const STATUS_LABELS = {
  tentative: "Tentative",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
  unverified: "Unverified",
  completed: "Completed",
};
const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function parseThemes(value) {
  if (!value) return [];
  const selected = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => THEME_SET.has(part));
  return THEMES.filter((theme) => selected.includes(theme));
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}

function timeLabel(event) {
  if (event.all_day) return "All day";
  const time = (event.start_time ?? "").slice(0, 5);
  return `${time || "Time TBC"} ${event.timezone ?? "UTC"}`;
}

function daysLabel(days) {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days > 1) return `In ${days} days`;
  return `${Math.abs(days)} days ago`;
}

function countLabel(total, shown) {
  if (total === 0) return "No scheduled events in the next 12 months.";
  if (total < 5) {
    return `${total} upcoming event${total === 1 ? "" : "s"} in the next 12 months`;
  }
  return `${shown} of ${total} upcoming events in the next 12 months`;
}

function Skeleton() {
  return (
    <div
      className="h-[19rem] space-y-2 px-1 py-3 sm:h-[21rem]"
      aria-busy="true"
      aria-label="Loading upcoming events"
    >
      {[0, 1, 2, 3].map((row) => (
        <div
          key={row}
          className="h-16 rounded-xl bg-black/[0.04] dark:bg-white/[0.05]"
        />
      ))}
    </div>
  );
}

export function UpcomingEvents() {
  // This component mounts only after the reader switches to the Upcoming tab,
  // so reading the shareable filter in the lazy initializer never runs during
  // SSR and cannot create a hydration mismatch.
  const [selected, setSelected] = useState(() => {
    if (typeof window === "undefined") return [];
    return parseThemes(new URLSearchParams(window.location.search).get("themes"));
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState({ status: "loading", payload: null });

  useEffect(() => {
    const url = new URL(window.location.href);
    if (selected.length > 0) {
      url.searchParams.set("themes", selected.join(","));
    } else {
      url.searchParams.delete("themes");
    }
    window.history.replaceState(null, "", url);
  }, [selected]);

  // One request, debounced, for the full five-theme response. Chip changes
  // filter that response in place, so theme toggles never cause a request
  // storm; a retry is the only other fetch.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setState({ status: "loading", payload: null });
      try {
        const response = await fetch("/api/v1/events/upcoming", {
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }
        setState({ status: "ready", payload });
      } catch (error) {
        if (error.name !== "AbortError") {
          setState({ status: "error", payload: null });
        }
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [reloadKey]);

  const allSelected = selected.length === 0;
  const visibleThemes = allSelected
    ? THEMES
    : THEMES.filter((theme) => selected.includes(theme));

  const toggleTheme = (theme) => {
    setSelected((current) => {
      const next =
        current.length === 0
          ? [theme]
          : current.includes(theme)
            ? current.filter((item) => item !== theme)
            : [...current, theme];
      // Keep the shareable URL in the fixed theme order, not click order.
      return THEMES.filter((item) => next.includes(item));
    });
  };

  const chipClass = (active) =>
    `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-micro font-medium transition-colors duration-[140ms] ${
      active
        ? "border-black/10 bg-black/[0.07] text-[#14121a] dark:border-white/10 dark:bg-white/[0.08] dark:text-[#f2ede4]"
        : "border-transparent text-black/60 hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:text-white/60 dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]"
    }`;

  const focusChip = (event) => {
    event.currentTarget.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  };

  const payload = state.payload;
  const themes = payload?.themes ?? {};
  const message = payload?.message;

  return (
    <div className="px-2.5 pb-4">
      <div
        role="group"
        aria-label="Filter upcoming events by theme"
        className="flex items-center gap-1 overflow-x-auto py-2 [mask-image:linear-gradient(to_right,#000_calc(100%_-_2rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <button
          type="button"
          aria-pressed={allSelected}
          onClick={() => setSelected([])}
          onFocus={focusChip}
          className={chipClass(allSelected)}
        >
          All
        </button>
        {THEMES.map((theme) => {
          const active = selected.includes(theme);
          const tone = categoryTone(theme);
          return (
            <button
              key={theme}
              type="button"
              aria-pressed={active}
              onClick={() => toggleTheme(theme)}
              onFocus={focusChip}
              className={chipClass(active)}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: tone.color }}
                aria-hidden="true"
              />
              {theme}
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setSelected([])}
          onFocus={focusChip}
          className={chipClass(false)}
        >
          Clear
        </button>
      </div>

      {state.status === "loading" ? <Skeleton /> : null}

      {state.status === "error" ? (
        <div className="px-2 py-4 text-meta text-black/80 dark:text-white/80">
          <p>
            <span
              className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#f05d49] align-middle"
              aria-hidden="true"
            />
            Upcoming events are unavailable.
          </p>
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="mt-2 font-medium underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === "ready" && message ? (
        <p className="px-2 py-5 text-meta leading-relaxed text-black/60 dark:text-white/60">
          {message}
        </p>
      ) : null}

      {state.status === "ready" && !message
        ? visibleThemes.map((theme) => {
            const data = themes[theme];
            if (!data) return null;
            const tone = categoryTone(theme);
            const events = data.events ?? [];
            const total = data.total_available ?? events.length;
            const schedulable = data.schedulable !== false;

            return (
              <section
                key={theme}
                aria-labelledby={`upcoming-${theme.replace(/[^a-z0-9]+/gi, "-")}`}
                className="mt-2 first:mt-0"
              >
                <div className="flex items-baseline justify-between gap-2 px-1">
                  <h3
                    id={`upcoming-${theme.replace(/[^a-z0-9]+/gi, "-")}`}
                    className="flex items-center gap-1.5 text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60"
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: tone.color }}
                      aria-hidden="true"
                    />
                    {theme}
                  </h3>
                  {schedulable ? (
                    <span className="text-micro tabular-nums text-black/45 dark:text-white/45">
                      {total}
                    </span>
                  ) : null}
                </div>

                {!schedulable ? (
                  <p className="mt-1 px-1 text-meta leading-relaxed text-black/60 dark:text-white/60">
                    Natural disasters cannot be scheduled; this theme shows
                    history only.
                  </p>
                ) : (
                  <>
                    <p className="mt-0.5 px-1 text-micro text-black/50 dark:text-white/50">
                      {countLabel(total, events.length)}
                    </p>
                    {events.length === 0 ? null : (
                      <ul className="mt-1.5 space-y-1.5">
                        {events.map((event) => {
                          const status = STATUS_LABELS[event.status];
                          return (
                            <li
                              key={event.event_id}
                              className="rounded-xl border border-black/5 bg-white/45 p-2.5 dark:border-white/5 dark:bg-white/[0.03]"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-body font-medium leading-snug text-black/80 dark:text-white/80">
                                  {event.name}
                                </p>
                                {status ? (
                                  <span className="shrink-0 rounded-full border border-black/10 px-1.5 py-0.5 text-micro text-black/60 dark:border-white/10 dark:text-white/60">
                                    {status}
                                  </span>
                                ) : null}
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-micro text-black/60 dark:text-white/60">
                                <span
                                  className="rounded-full px-1.5 py-0.5"
                                  style={{
                                    backgroundColor: tone.soft,
                                    color: tone.color,
                                  }}
                                >
                                  {theme}
                                </span>
                                <span className="tabular-nums">
                                  {formatDate(event.start_date)}
                                </span>
                                <span>{timeLabel(event)}</span>
                                <span className="tabular-nums">
                                  {daysLabel(event.days_until)}
                                </span>
                              </div>

                              <a
                                href={event.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Source for ${event.name}`}
                                className="mt-1.5 inline-flex items-center gap-1 text-micro text-black/55 underline decoration-current/30 underline-offset-2 transition-colors hover:text-black/80 hover:decoration-current dark:text-white/55 dark:hover:text-white/80"
                              >
                                Source
                                <svg
                                  viewBox="0 0 12 12"
                                  className="h-2.5 w-2.5"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.2"
                                  aria-hidden="true"
                                >
                                  <path d="M4 2h6v6M10 2L2 10" />
                                </svg>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
              </section>
            );
          })
        : null}

      {state.status === "ready" && payload?.as_of ? (
        <p className="mt-3 px-1 text-micro text-black/40 dark:text-white/40">
          As of {formatDate(payload.as_of)}
        </p>
      ) : null}
    </div>
  );
}
