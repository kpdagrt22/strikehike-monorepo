"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  CATEGORY_ORDER,
  categoryTone,
} from "@/lib/categoryTone";
import { useDismissable } from "@/hooks/useDismissable";
import { useChronoStore } from "@/store/chronoStore";

// Desktop keeps the flyout beside the archive; below lg the category's events
// open inline under the tapped row, inside the visible sheet.
const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange) {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const getDesktopOnServer = () => true;

const categoryButtonId = (category) =>
  `chrono-category-${category.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

const getEventsDockButton = () =>
  document.getElementById("chrono-dock-archive");

const SELECTED_ROW = "bg-black/[0.07] dark:bg-white/[0.08]";
const HOVER_ROW =
  "hover:bg-black/[0.04] focus-visible:bg-black/[0.04] dark:hover:bg-white/[0.06] dark:focus-visible:bg-white/[0.06]";

export function FilterControls() {
  const [roster, setRoster] = useState(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeCategory, setActiveCategory] = useState(null);
  const sheetRef = useRef(null);
  const regionRef = useRef(null);
  // Set when the keyboard opens a category's flyout on desktop, so focus can
  // follow into its first event.
  const focusFirstEvent = useRef(false);
  const isDesktop = useSyncExternalStore(
    subscribeDesktop,
    getDesktop,
    getDesktopOnServer,
  );
  const mobileSheet = useChronoStore((state) => state.mobileSheet);
  const setMobileSheet = useChronoStore((state) => state.setMobileSheet);
  const setActiveEventCategory = useChronoStore(
    (state) => state.setActiveEventCategory,
  );
  // Only an open category list highlights the focused date; while it is
  // closed, scrubbing the timeline does not re-render the archive.
  const focusedDate = useChronoStore((state) =>
    activeCategory ? state.focusedDate : null,
  );
  const setFocusedDate = useChronoStore((state) => state.setFocusedDate);
  const sheetOpen = mobileSheet === "archive";

  const dismissSheet = useDismissable(sheetOpen, {
    onClose: () => {
      setActiveCategory(null);
      setMobileSheet(null);
    },
    triggerRef: getEventsDockButton,
    containerRef: sheetRef,
  });

  const dismissCategory = useDismissable(Boolean(activeCategory), {
    onClose: () => setActiveCategory(null),
    triggerRef: () =>
      activeCategory
        ? document.getElementById(categoryButtonId(activeCategory))
        : null,
    containerRef: regionRef,
  });

  useEffect(() => {
    const controller = new AbortController();

    async function loadRoster() {
      try {
        const response = await fetch("/api/events", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setRoster(await response.json());
      } catch (loadError) {
        if (loadError.name !== "AbortError") setError(true);
      }
    }

    loadRoster();
    return () => controller.abort();
  }, [reloadKey]);

  // Below lg the inline events can open beneath the sheet's fold.
  useEffect(() => {
    if (isDesktop || !activeCategory) return;
    regionRef.current?.scrollIntoView({ block: "nearest" });
  }, [activeCategory, isDesktop]);

  // The desktop flyout sits apart from its category: move keyboard focus into
  // it. Esc hands focus back to the category.
  useEffect(() => {
    if (!focusFirstEvent.current) return;
    focusFirstEvent.current = false;
    regionRef.current?.querySelector("button")?.focus({ preventScroll: true });
  }, [activeCategory]);

  useEffect(() => {
    setActiveEventCategory(activeCategory);
  }, [activeCategory, setActiveEventCategory]);

  useEffect(
    () => () => setActiveEventCategory(null),
    [setActiveEventCategory],
  );

  const categories = roster?.categories ?? {};
  const activeEvents =
    activeCategory && categories[activeCategory]
      ? categories[activeCategory]
      : [];

  const toggleCategory = (category) => {
    setActiveCategory((current) => (current === category ? null : category));
  };

  const travelToEvent = (eventDate) => {
    setFocusedDate(eventDate);
    // Hand focus back rather than dropping it with the closing list: to the
    // category on desktop, to the dock's Events button when the sheet closes.
    if (sheetOpen) {
      dismissSheet({ restoreFocus: true });
    } else {
      dismissCategory({ restoreFocus: true });
    }
  };

  const showLadder = () => {
    setActiveCategory(null);
    setMobileSheet("future");
    // Focus follows the swap to the ladder sheet's matching control.
    requestAnimationFrame(() =>
      document.getElementById("chrono-ladder-to-archive")?.focus(),
    );
  };

  const retryRoster = () => {
    // Retry unmounts with the error line: keep focus on the panel heading.
    document
      .getElementById("chrono-archive-title")
      ?.focus({ preventScroll: true });
    setError(false);
    setReloadKey((key) => key + 1);
  };

  const renderEvents = (inline) => (
    <motion.div
      key={activeCategory}
      ref={regionRef}
      initial={inline ? { opacity: 0 } : { opacity: 0, x: -4, scale: 0.98 }}
      animate={{
        opacity: 1,
        x: 0,
        scale: 1,
        transition: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
      }}
      exit={{
        opacity: 0,
        x: -2,
        scale: 0.99,
        transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
      }}
      className={
        inline
          ? "mx-1 mb-1 mt-1 scroll-mt-2.5 overflow-hidden rounded-2xl border border-black/10 bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]"
          : "absolute left-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-black/10 bg-white/92 shadow-[0_20px_70px_rgba(20,18,26,0.18)] backdrop-blur-2xl lg:left-full lg:top-0 lg:ml-2 lg:mt-0 dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:shadow-[0_20px_70px_rgba(0,0,0,0.6)]"
      }
      id="chrono-category-events"
      role="region"
      aria-label={`${activeCategory} events`}
    >
      <div className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
        <div>
          <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            {activeCategory}
          </p>
          <p className="mt-0.5 text-meta text-black/60 dark:text-white/60">
            Select a date to travel
          </p>
        </div>
        <span className="text-micro tabular-nums text-black/60 dark:text-white/60">
          {activeEvents.length}
        </span>
      </div>

      {/* Inline (below lg) the sheet card is the one scroller; the desktop
          list scrolls itself and ends in a soft fade. */}
      <div
        className={
          inline
            ? "p-1.5"
            : "max-h-[min(24rem,55vh)] overflow-y-auto overscroll-contain px-1.5 pt-1.5 pb-5 [mask-image:linear-gradient(to_bottom,#000_calc(100%_-_1.25rem),transparent)] [scrollbar-width:thin]"
        }
      >
        {activeEvents.map((event) => {
          const isFocused = focusedDate === event.date;

          return (
            <button
              key={`${event.date}-${event.name}`}
              type="button"
              onClick={() => travelToEvent(event.date)}
              className={`group flex min-h-11 w-full items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors lg:min-h-0 ${
                isFocused ? SELECTED_ROW : HOVER_ROW
              }`}
            >
              <span
                className="mt-1 h-1 w-1 shrink-0 rounded-full"
                style={{
                  backgroundColor: categoryTone(activeCategory).color,
                }}
              />
              <span className="min-w-0">
                <span className="block text-micro font-medium tabular-nums uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
                  {event.date}
                </span>
                <span className="mt-0.5 block text-body leading-snug text-black/75 transition-colors group-hover:text-[#14121a] dark:text-white/70 dark:group-hover:text-white">
                  {event.name}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );

  return (
    <div
      ref={sheetRef}
      className={`${
        mobileSheet === "archive"
          ? "animate-sheet-up fixed inset-x-3 bottom-[8.5rem] z-50 block"
          : "hidden"
      } pointer-events-auto lg:fixed lg:left-5 lg:top-[6.75rem] lg:z-30 lg:block lg:w-[min(18rem,calc(100vw-1.5rem))] lg:max-h-none lg:overflow-visible`}
    >
      <div className="relative">
        <div
          id="chrono-events-sheet"
          className="rounded-2xl border border-black/10 bg-white/92 p-1.5 shadow-[0_18px_60px_rgba(20,18,26,0.14)] backdrop-blur-xl max-lg:max-h-[70dvh] max-lg:overflow-y-auto max-lg:overscroll-contain dark:border-white/10 dark:bg-[rgb(11_11_18/0.92)] dark:shadow-[0_18px_60px_rgba(0,0,0,0.5)] lg:bg-white/45 lg:dark:bg-black/25"
        >
          <div className="flex items-start justify-between gap-2 px-2.5 pb-2 pt-2">
            <div>
              <h2
                id="chrono-archive-title"
                tabIndex={-1}
                className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 focus:outline-none dark:text-white/60"
              >
                Event archive
              </h2>
              <p className="mt-0.5 text-meta tabular-nums text-black/60 dark:text-white/60">
                {roster?.total
                  ? `${roster.total} curated moments`
                  : "Curated moments"}
              </p>
            </div>
            <div className="flex items-center gap-1 lg:hidden">
              <button
                id="chrono-archive-to-ladder"
                type="button"
                onClick={showLadder}
                className="h-11 rounded-full border border-black/10 px-3 text-micro font-medium uppercase tracking-[0.1em] text-black/60 dark:border-white/10 dark:text-white/60"
              >
                Ladder
              </button>
              <button
                type="button"
                onClick={() => dismissSheet({ restoreFocus: true })}
                aria-label="Close event archive"
                className="grid h-11 w-11 place-items-center rounded-full border border-black/10 text-black/60 dark:border-white/10 dark:text-white/60"
              >
                <svg
                  viewBox="0 0 16 16"
                  className="h-3.5 w-3.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </div>
          </div>

          <div className="space-y-1">
            {CATEGORY_ORDER.map((category) => {
              const isActive = activeCategory === category;
              const count = categories[category]?.length ?? 0;

              return (
                <Fragment key={category}>
                  <button
                    id={categoryButtonId(category)}
                    type="button"
                    onClick={(event) => {
                      // detail 0: Enter or Space, not a pointer click.
                      if (event.detail === 0 && isDesktop && !isActive) {
                        focusFirstEvent.current = true;
                      }
                      toggleCategory(category);
                    }}
                    aria-expanded={isActive}
                    aria-controls={isActive ? "chrono-category-events" : undefined}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-xl border border-transparent px-2.5 py-2 text-left text-meta font-medium tracking-[-0.01em] transition-colors duration-[140ms] lg:min-h-0 lg:py-1.5 ${
                      isActive
                        ? `${SELECTED_ROW} text-[#14121a] dark:text-[#f2ede4]`
                        : `${HOVER_ROW} text-black/60 hover:text-[#14121a] dark:text-white/60 dark:hover:text-[#f2ede4]`
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ backgroundColor: categoryTone(category).color }}
                    />
                    <span className="truncate">{category}</span>
                    <span className="ml-auto text-micro tabular-nums text-black/60 dark:text-white/60">
                      {count || ""}
                    </span>
                  </button>
                  {!isDesktop && isActive ? renderEvents(true) : null}
                </Fragment>
              );
            })}
          </div>

          {error ? (
            <p className="px-2 pb-1 pt-1 text-meta leading-relaxed text-black/80 dark:text-white/80">
              <span
                className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[#f05d49] align-middle"
                aria-hidden="true"
              />
              {"Archive unavailable · "}
              <button
                type="button"
                onClick={retryRoster}
                className="-my-3 inline-block py-3 font-medium underline decoration-current/40 underline-offset-2 transition-colors hover:decoration-current lg:-my-1 lg:py-1"
              >
                Retry
              </button>
            </p>
          ) : null}
        </div>

        {isDesktop ? (
          <AnimatePresence>
            {activeCategory ? renderEvents(false) : null}
          </AnimatePresence>
        ) : null}
      </div>
    </div>
  );
}
