"use client";

import Link from "next/link";
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useTheme } from "next-themes";
import { PeekIntoFuture } from "@/components/patterns/PeekIntoFuture";
import { PatternMirror } from "@/components/patterns/PatternMirror";
import {
  answerText,
  basisLabel,
  formatDate,
  isPatternEngine,
} from "@/components/patterns/patternFormat";
import {
  PATTERN_ASSET_ORDER,
  ASSET_TARGETS,
} from "@/components/regime/assetTargets";

function EvidencePlaceholder() {
  return (
    <div
      className="mt-3 rounded-[1.4rem] border border-(--sh-line-1) bg-white/45 px-5 py-1 dark:bg-black/40 sm:px-6"
      aria-hidden="true"
    >
      <div className="h-14" />
      <div className="h-14 border-t border-(--sh-line-1)" />
      <div className="h-14 border-t border-(--sh-line-1)" />
      <div className="h-14 border-t border-(--sh-line-1)" />
    </div>
  );
}

// Section 03 sits below the fold, closed until asked for: its code loads after
// the page, behind a placeholder of the same three rows. React.lazy (no
// next/dynamic runtime), rendered only once mounted, as with ssr: false.
const PatternEvidence = lazy(() =>
  import("@/components/patterns/PatternEvidence").then((mod) => ({
    default: mod.PatternEvidence,
  })),
);
// Evidence's "compare today with a past decline" row; it loads its picker
// and chart itself, only when the row is near the screen or opened.
const PatternCompare = lazy(() => import("@/components/patterns/PatternCompare"));

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
// A deep link, /patterns?case={id} (Convergence's "Compare with today"),
// opens the compare row on that case; a Nifty 50 case opens the Nifty 50
// lens. Read from the URL on the client only (the page is prerendered); the
// row only ever matches it against the catalogue's ids.
const getLinkedCase = () => new URLSearchParams(window.location.search).get("case");
const getNoLinkedCase = () => null;

function SectionLabel({ number, children }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-micro text-[#c0442f] dark:text-[#ff8b77]">
        {number}
      </span>
      <span className="h-px w-8 bg-black/10 dark:bg-white/15" aria-hidden="true" />
      <p className="text-micro font-medium uppercase tracking-[0.18em] text-black/60 dark:text-white/60">
        {children}
      </p>
    </div>
  );
}

// A local copy of the /regime status chip (that page belongs to another stream).
function StatusBadge({ status }) {
  const config =
    status === "ready"
      ? {
          label: "Archive online",
          dot: "bg-[#0f766e] dark:bg-[#5eead4]",
          pulse: false,
        }
      : status === "error"
        ? {
            label: "Archive offline",
            dot: "bg-[#ef4444]",
            pulse: false,
          }
        : {
            label: "Reading archive",
            dot: "bg-[#d8b47a]",
            pulse: true,
          };

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/45 px-3 py-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:border-white/5 dark:bg-black/30 dark:text-white/60">
      <span
        className={`h-1.5 w-1.5 rounded-full ${config.dot} ${
          config.pulse ? "animate-pulse" : ""
        }`}
        aria-hidden="true"
      />
      {config.label}
    </span>
  );
}

function AssetLens({ assetKey, onChange }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className="text-micro font-medium uppercase tracking-[0.16em] text-black/60 dark:text-white/60">
        Market lens
      </span>
      <div
        role="group"
        aria-label="Pattern market lens"
        className="inline-flex items-center gap-0.5 rounded-full border border-black/5 bg-black/[0.025] p-0.5 dark:border-white/5 dark:bg-white/[0.035]"
      >
        {PATTERN_ASSET_ORDER.map((key) => {
          const target = ASSET_TARGETS[key];
          const selected = key === assetKey;
          // Both theme colours ride on CSS variables so the server markup is
          // theme-agnostic; the .dark class picks the pair, never JS.
          return (
            <button
              key={key}
              id={`pattern-lens-${key}`}
              type="button"
              onClick={() => onChange(key)}
              aria-pressed={selected}
              className={`relative rounded-full px-3 py-1.5 text-micro font-medium transition-colors pointer-coarse:before:absolute pointer-coarse:before:inset-x-0 pointer-coarse:before:-inset-y-2.5 pointer-coarse:before:content-[''] ${
                selected
                  ? "bg-white/80 text-(--lens-light) dark:bg-(--lens-dark)/12 dark:text-(--lens-dark)"
                  : "text-black/60 hover:text-black/75 focus-visible:text-black/75 dark:text-white/60 dark:hover:text-white/75 dark:focus-visible:text-white/75"
              }`}
              style={
                selected
                  ? { "--lens-light": target.light, "--lens-dark": target.dark }
                  : undefined
              }
            >
              {target.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function PatternsPage() {
  const { resolvedTheme } = useTheme();
  // false during SSR/hydration, true after: the server cannot know the theme, so
  // JS-computed colours switch to the resolved theme only once mounted.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = !mounted || resolvedTheme !== "light";
  const linkedCase = useSyncExternalStore(subscribe, getLinkedCase, getNoLinkedCase);
  const titleRef = useRef(null);
  const announceNextRef = useRef(false);
  const [chosenAsset, setChosenAsset] = useState(null);
  const assetKey = chosenAsset ?? (linkedCase?.startsWith("nifty-") ? "nifty" : "sp500");
  const [reloadKey, setReloadKey] = useState(0);
  const [, startSwitch] = useTransition();
  // loading (nothing yet) · ready · switching (the previous lens stays, dimmed)
  // · error. `data` is the validated `engine` block; v1 fields are not read.
  const [state, setState] = useState({
    status: "loading",
    data: null,
    error: null,
    announce: "",
  });

  useEffect(() => {
    // The deep link was rendered before the URL settled (hydration, or a
    // client-side navigation): the store renders it at once, so fetch then.
    if (getLinkedCase() !== linkedCase) return undefined;
    const controller = new AbortController();

    fetch(`/api/v1/patterns?asset=${encodeURIComponent(assetKey)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(
            payload?.detail ||
              payload?.error ||
              `Pattern archive returned ${response.status}.`,
          );
        }
        return response.json();
      })
      .then((payload) => {
        const engine = payload?.engine;
        if (!isPatternEngine(engine) || engine.asset !== assetKey) {
          throw new Error("The pattern archive returned an unexpected payload.");
        }
        // Only a lens the reader chose is announced, never the first load.
        const announce = announceNextRef.current ? answerText(engine) ?? "" : "";
        announceNextRef.current = false;
        setState({ status: "ready", data: engine, error: null, announce });
      })
      .catch((error) => {
        if (error.name !== "AbortError") {
          announceNextRef.current = false;
          setState({
            status: "error",
            data: null,
            error: error.message,
            announce: "",
          });
        }
      });

    return () => controller.abort();
  }, [assetKey, reloadKey, linkedCase]);

  const handleAssetChange = (key) => {
    if (key === assetKey) return;
    announceNextRef.current = true;
    // A transition: the press paints at once and the page's switching render
    // (the previous lens dimmed) follows without blocking it (INP).
    startSwitch(() => {
      setState((previous) => ({
        ...previous,
        status: previous.data ? "switching" : "loading",
        error: null,
      }));
      setChosenAsset(key);
    });
  };

  const handleRetry = () => {
    // The alert (and this button) unmount on retry; keep focus in the section.
    titleRef.current?.focus({ preventScroll: true });
    setState({ status: "loading", data: null, error: null, announce: "" });
    setReloadKey((key) => key + 1);
  };

  const handleOpenMirror = () => {
    handleAssetChange("sp500");
    document.getElementById("pattern-lens-sp500")?.focus();
  };

  const engine = state.data;
  const switching = state.status === "switching";
  const asset = ASSET_TARGETS[assetKey] ?? ASSET_TARGETS.sp500;
  const basis = basisLabel(engine?.basis);

  return (
    <main className="relative h-full w-full scroll-pt-(--sh-header-clear) overflow-y-auto overflow-x-hidden pb-24 pt-(--sh-header-clear)">
      <div className="mx-auto w-full max-w-[1600px] px-3 sm:px-5 lg:px-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
              Study of Patterns
            </p>
            <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
              {assetKey === "nifty"
                ? "The Indian market mirror."
                : "The 120-year mirror."}
            </h1>
            <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70 sm:text-body">
              A rolling comparison of today’s market with its closest
              historical setups, and what happened in the year that followed.
              Different technology, different headlines, familiar human
              mechanics.
            </p>
            <AssetLens
              assetKey={assetKey}
              onChange={handleAssetChange}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
            <StatusBadge status={switching ? "loading" : state.status} />
            <span
              className={`inline-flex items-center rounded-full border border-black/5 bg-white/35 px-3 py-1.5 font-mono text-micro text-black/60 dark:border-white/5 dark:bg-black/25 dark:text-white/60 ${
                engine ? "" : "invisible"
              }`}
            >
              As of {engine ? formatDate(engine.as_of) : "00 Mon 0000"} ·{" "}
              {basis ?? "weekly closes"}
            </span>
          </div>
        </header>

        <div
          className={`transition-opacity duration-(--sh-dur-micro) motion-reduce:transition-none ${
            switching ? "pointer-events-none opacity-60" : ""
          }`}
          aria-busy={switching || undefined}
          inert={switching || undefined}
        >
          <section className="mt-10 lg:mt-8" aria-labelledby="peek-future-title">
            <SectionLabel number="01">What happened next</SectionLabel>

            {state.status === "error" ? (
              <div
                role="alert"
                className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ef4444]/25 bg-[#ef4444]/4 px-4 py-3"
              >
                <p className="text-micro text-[#c0442f] dark:text-[#ff8b77]">
                  Pattern archive unavailable: {state.error}
                </p>
                <button
                  type="button"
                  onClick={handleRetry}
                  className="shrink-0 rounded-full border border-black/14 px-3.5 py-1.5 text-micro font-medium text-black/70 transition-colors hover:bg-black/4 focus-visible:bg-black/4 pointer-coarse:min-h-11 dark:border-white/14 dark:text-white/70 dark:hover:bg-white/6 dark:focus-visible:bg-white/6"
                >
                  Retry
                </button>
              </div>
            ) : null}

            <PeekIntoFuture
              engine={engine}
              status={state.status}
              assetKey={assetKey}
              isDark={isDark}
              mounted={mounted}
              titleRef={titleRef}
            />
          </section>

          <section className="mt-14">
            <SectionLabel number="02">Repeatability index</SectionLabel>
            <PatternMirror
              engine={engine}
              assetKey={assetKey}
              onOpenMirror={handleOpenMirror}
            />
          </section>

          <section className="mt-14" aria-labelledby="pattern-evidence-title">
            <SectionLabel number="03">Evidence</SectionLabel>
            <h2 id="pattern-evidence-title" className="sr-only">
              Evidence
            </h2>
            {mounted ? (
              <Suspense fallback={<EvidencePlaceholder />}>
                <PatternEvidence engine={engine} assetKey={assetKey}>
                  <Suspense
                    fallback={<div className="h-[57px] border-t border-(--sh-line-1)" aria-hidden="true" />}
                  >
                    <PatternCompare
                      engine={engine}
                      assetKey={assetKey}
                      linkedCase={linkedCase}
                    />
                  </Suspense>
                </PatternEvidence>
              </Suspense>
            ) : (
              <EvidencePlaceholder />
            )}
          </section>
        </div>

        <div className="mt-6 flex flex-col gap-3 border-t border-black/5 pt-4 text-micro text-black/60 dark:border-white/5 dark:text-white/60 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Study of Patterns · {asset.label} lens · data from the StrikeHike
            macro archive
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/regime"
              className="text-black/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/70 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]"
            >
              Open the Core Index atlas
            </Link>
            <Link
              href="/convergence"
              className="text-black/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/70 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]"
            >
              Compare two events
            </Link>
            <Link
              href="/disclaimer"
              className="text-black/70 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/70 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]"
            >
              Disclaimer
            </Link>
          </div>
        </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {state.announce}
      </p>
    </main>
  );
}
