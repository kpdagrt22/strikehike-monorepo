"use client";

/**
 * CasePicker: choose one market decline from the case catalogue
 * (GET /api/v1/regime/cases). Shared by /convergence and the Study of
 * Patterns compare panel; import it, do not fork it.
 *
 * Props
 *   side        "a" | "b"     Which side it sets. Drives the swatch colour, the letter and
 *                             the DOM ids (#cv-trigger-{side}, #cv-listbox-{side}).
 *   label       string        "Case A": the sheet title and the trigger's aria-label prefix.
 *   value       string|null   The current case id, or a pinned entry's id ("today").
 *   otherValue  string|null   The other side's case id; its option shows "on B". Omit on Patterns.
 *   cases       Case[]        Catalogue `cases`.
 *   kinds       Kind[]        Catalogue `kinds`: group order and labels.
 *   recessions  Recession[]   Catalogue `recessions`: searchable, revealed as context.
 *   pairs       {a, b}[]?     Catalogue `pairs`: a "Pairs" group shown when the query is empty
 *                             and the era is "All eras". Omit on Patterns.
 *   pinned      {id, name, short?, subline, description?}[]?
 *                             Entries above the groups, e.g. Patterns' Today
 *                             ({id: "today", name: "Today", subline: "S&P 500 · −1.2% from 6 Oct 2026"}).
 *   seriesKey   string?       The current Series key; an active case without it reveals a quiet
 *                             "no {series} data …" note (it stays in the list).
 *   coverage    object?       Catalogue `coverage`, for that note's dates.
 *   filter      (case) => bool?  Restricts the list (Patterns: the asset in `series_available`).
 *   onChange    (id) => void  A case or pinned entry was chosen. The caller handles swaps.
 *   onPair      ([a, b]) => void?  A pair was chosen (sets both sides).
 *   onPreview   (id|null) => void? The active case changed while open (callers prefetch its path).
 *
 * Behaviour
 *   ≥ 640 px a non-modal popover under the trigger; < 640 px a modal bottom sheet (focus is
 *   trapped and the rest of the page is inert). ARIA 1.2 combobox + grouped listbox:
 *   Enter / Space / ArrowDown on the trigger open it with focus in the search field (a touch
 *   tap opens the sheet without raising the keyboard); ArrowUp / ArrowDown move the active
 *   option (no wrap); PageUp / PageDown jump between groups; Ctrl+Home / Ctrl+End go to the
 *   first / last option; typing filters and the first match becomes active; Enter chooses;
 *   Escape clears the query, then closes and returns focus to the trigger; Tab leaves
 *   (closes, nothing chosen). Hover, the arrow keys and focus reveal the same lines for the
 *   active option (description, NBER recession, the matched event, a missing-series note) in
 *   a detail line at the panel's foot, so no row moves while the pointer travels the list;
 *   each option carries them as its aria-describedby, its name being name, pill and meta.
 *   Groups of more than 7 cases list their curated names first and fold the neutral ones
 *   behind "Show {n} more"; a query or an era shows every match, ranked, by group.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { DUR, EASE } from "@/lib/motion";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import {
  ERAS,
  buildCaseIndex,
  caseMeta,
  caseSeriesNote,
  caseSubline,
  formatCaseDate,
  highlightSegments,
  matchCase,
  queryTokens,
  recessionContext,
} from "@/lib/regime/caseCompare";

const FOLD_OVER = 7;
const POPOVER_WIDTH = 440;
const SIDE_COLOR = {
  a: "[--case-color:#14121a] dark:[--case-color:#f2ede4]",
  b: "[--case-color:#c0442f] dark:[--case-color:#ff8b77]",
};
const TABBABLE =
  "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])";
const OPAQUE_OVERLAY =
  "linear-gradient(var(--sh-surface-overlay), var(--sh-surface-overlay)), var(--engine-fallback)";

function chronological(x, y) {
  return x.peak < y.peak ? -1 : x.peak > y.peak ? 1 : 0;
}

function optionDomId(listboxId, kind, key) {
  return `${listboxId}-${kind}-${String(key).replace(/[^a-z0-9-]/gi, "-")}`;
}

/**
 * The visible list: groups of options plus the flat order for the keyboard.
 * Pure: derived from the props and the open panel's query, era and folds.
 */
function buildModel({
  listboxId,
  cases,
  kinds,
  index,
  pairs,
  pinned,
  filter,
  tokens,
  era,
  expanded,
  byId,
}) {
  const searching = tokens.length > 0 || era !== "all";
  const eraTest = (ERAS.find((item) => item.key === era) ?? ERAS[0]).test;
  const groups = [];

  const pinnedOptions = (pinned ?? [])
    .filter((entry) => {
      if (!tokens.length) return true;
      const name = entry.name.toLowerCase();
      return tokens.every((token) => name.includes(token));
    })
    .map((entry) => ({
      type: "pinned",
      id: optionDomId(listboxId, "pin", entry.id),
      value: entry.id,
      entry,
    }));
  if (pinnedOptions.length) {
    groups.push({ key: "pinned", label: null, ariaLabel: "Pinned", count: null, options: pinnedOptions });
  }

  if (pairs?.length && !searching) {
    const options = pairs
      .filter((pair) => byId.get(pair.a) && byId.get(pair.b))
      .map((pair) => ({
        type: "pair",
        id: optionDomId(listboxId, "pair", `${pair.a}-${pair.b}`),
        a: byId.get(pair.a),
        b: byId.get(pair.b),
      }));
    if (options.length) {
      groups.push({ key: "pairs", label: "Pairs", suffix: "sets A and B", count: null, options });
    }
  }

  let matches = 0;
  for (const kind of kinds ?? []) {
    let items = cases.filter(
      (c) =>
        c.kind === kind.key &&
        (!filter || filter(c)) &&
        eraTest(Number(c.peak.slice(0, 4))),
    );
    let matchById = null;
    if (tokens.length) {
      const scored = [];
      for (const c of items) {
        const match = matchCase(index.get(c.id), tokens);
        if (match) scored.push([c, match]);
      }
      scored.sort(
        (x, y) =>
          x[1].score - y[1].score ||
          x[1].total - y[1].total ||
          chronological(x[0], y[0]),
      );
      items = scored.map(([c]) => c);
      matchById = new Map(scored.map(([c, match]) => [c.id, match]));
    } else {
      items = [...items].sort(chronological);
    }
    if (!items.length) continue;
    matches += items.length;

    const toOption = (c) => ({
      type: "case",
      id: optionDomId(listboxId, "case", c.id),
      value: c.id,
      case: c,
      match: matchById?.get(c.id) ?? null,
    });
    let options;
    if (!searching && items.length > FOLD_OVER) {
      const curated = items.filter((c) => c.name_source === "curated");
      const neutral = items.filter((c) => c.name_source !== "curated");
      if (expanded.has(kind.key)) {
        options = [
          ...curated.map(toOption),
          ...neutral.map(toOption),
          { type: "fewer", id: optionDomId(listboxId, "fewer", kind.key), kind: kind.key },
        ];
      } else {
        options = [
          ...curated.map(toOption),
          {
            type: "more",
            id: optionDomId(listboxId, "more", kind.key),
            kind: kind.key,
            n: neutral.length,
          },
        ];
      }
    } else {
      options = items.map(toOption);
    }
    groups.push({ key: kind.key, label: kind.label, count: items.length, options });
  }

  const flat = groups.flatMap((group) => group.options);
  return { groups, flat, matches, searching };
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[15px] w-[15px] shrink-0 text-(--sh-text-3)"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 text-(--sh-text-3) opacity-70 transition-opacity duration-(--sh-dur-micro) group-hover:opacity-100 group-focus-visible:opacity-100 group-aria-expanded:opacity-100"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Highlighted({ text, tokens }) {
  return highlightSegments(text, tokens).map((segment, index) =>
    segment.mark ? (
      <mark
        key={index}
        className="bg-transparent font-semibold text-[#14121a] dark:text-[#f2ede4]"
      >
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    ),
  );
}

function describeOption(option, { recessionsById, seriesKey, coverage }) {
  if (option.type === "pair") return [`${option.a.name} · ${option.b.name}`];
  if (option.type === "pinned") {
    return option.entry.description ? [option.entry.description] : [];
  }
  if (option.type !== "case") return [];
  const c = option.case;
  const lines = [c.description];
  const recession =
    option.match?.recession ??
    (c.recessions ?? []).map((id) => recessionsById.get(id)).find(Boolean);
  if (recession) lines.push(recessionContext(recession));
  if (option.match?.event) {
    lines.push(
      `Event: ${option.match.event.name}, ${formatCaseDate(option.match.event.date)}`,
    );
  }
  const note = caseSeriesNote(c, seriesKey, coverage);
  if (note) lines.push(note);
  return lines.filter(Boolean);
}

/** The revealed lines as one spoken description ("… 2009). Event: …"). */
function spokenLines(lines) {
  return lines.map((line) => (/[.!?]$/.test(line) ? line : `${line}.`)).join(" ");
}

/**
 * One row, always one height: the active option's description is revealed in
 * the panel's detail line (PickerDetail), never inside the list, so hovering
 * down the list moves no row (no layout shift, nothing jumps under the
 * pointer). Screen readers get the same lines through aria-describedby on a
 * hidden element; the name is the option's name, pill and meta only.
 */
function PickerOption({ option, active, selected, otherLetter, tokens, lines, sheet, onPick, onHover }) {
  const nameId = `${option.id}-name`;
  const metaId = `${option.id}-meta`;
  const descId = `${option.id}-desc`;
  const fold = option.type === "more" || option.type === "fewer";
  const base = `grid cursor-pointer grid-cols-[14px_minmax(0,1fr)_auto] items-baseline gap-x-2 rounded-[10px] px-2 ${
    sheet ? "min-h-11 py-[11px]" : "py-[7px] pointer-coarse:min-h-11 pointer-coarse:py-[11px]"
  } ${active ? "bg-(--sh-hover)" : ""}`;

  let name;
  let meta = null;
  if (option.type === "case") {
    name = <Highlighted text={option.case.name} tokens={tokens} />;
    meta = caseMeta(option.case);
  } else if (option.type === "pair") {
    name = (
      <>
        {option.a.short_name}{" "}
        <span className="text-(--sh-text-3)">vs</span> {option.b.short_name}
      </>
    );
    meta = `${option.a.peak.slice(0, 4)} · ${option.b.peak.slice(0, 4)}`;
  } else if (option.type === "pinned") {
    name = option.entry.name;
    meta = option.entry.subline ?? null;
  } else if (option.type === "more") {
    name = `Show ${option.n} more`;
  } else {
    name = "Show fewer";
  }

  return (
    <div
      id={option.id}
      role="option"
      aria-selected={selected}
      aria-labelledby={meta ? `${nameId} ${metaId}` : nameId}
      aria-describedby={lines.length ? descId : undefined}
      data-active={active ? "true" : undefined}
      className={base}
      onClick={() => onPick(option)}
      onPointerMove={() => onHover(option.id)}
    >
      <span
        className="text-[12px] leading-none text-[#c0442f] dark:text-[#ff8b77]"
        aria-hidden="true"
      >
        {selected ? "✓" : ""}
      </span>
      <span
        id={nameId}
        className={`min-w-0 text-body leading-[1.35] ${
          fold
            ? "text-(--sh-text-3) underline decoration-(--sh-line-2) underline-offset-4"
            : selected
              ? "font-medium text-[#14121a] dark:text-[#f2ede4]"
              : option.type === "pair"
                ? "text-(--sh-text-2)"
                : "text-(--sh-text-1)"
        }`}
      >
        {name}
        {otherLetter ? (
          <>
            {" "}
            <span className="ml-0.5 inline-block rounded-full border border-(--sh-line-1) px-1.5 align-[1px] font-mono text-micro leading-[1.2] text-(--sh-text-3)">
              on {otherLetter}
            </span>
          </>
        ) : null}
      </span>
      <span id={metaId} className="whitespace-nowrap font-mono text-micro text-(--sh-text-3)">
        {meta}
      </span>
      {lines.length ? (
        <span id={descId} hidden>
          {spokenLines(lines)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * The detail line at the foot of the panel: the active option's description,
 * NBER recession, matched event and missing-series note (hover, arrow keys
 * and focus reveal the same). Its height holds three lines, so moving through
 * the list changes the text only; aria-hidden, as the options carry it.
 */
function PickerDetail({ lines, activeId, sheet }) {
  return (
    <div
      aria-hidden="true"
      className={`shrink-0 border-t border-(--sh-line-1) text-micro leading-[1.45] text-(--sh-text-3) ${
        sheet ? "px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2.5" : "px-4 pb-3 pt-2.5"
      }`}
    >
      <div key={activeId ?? "none"} className="min-h-[4.35em]">
        {lines.map((line, index) => (
          <p key={index} className={index === 0 ? "text-(--sh-text-2)" : undefined}>
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}

function PickerBody({
  letter,
  total,
  listboxId,
  inputRef,
  listRef,
  query,
  era,
  model,
  activeId,
  tokens,
  sheet,
  maxListHeight,
  announced,
  value,
  otherValue,
  otherLetter,
  context,
  detail,
  onQuery,
  onEra,
  onKeyDown,
  onPick,
  onHover,
  onClear,
}) {
  const eraRefs = useRef([]);
  const eraIndex = Math.max(0, ERAS.findIndex((item) => item.key === era));

  const handleEraKey = (event) => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    let next = null;
    if (delta) next = (eraIndex + delta + ERAS.length) % ERAS.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = ERAS.length - 1;
    if (next == null) return;
    event.preventDefault();
    onEra(ERAS[next].key);
    eraRefs.current[next]?.focus();
  };

  return (
    <>
      <div
        className={`flex items-center gap-2.5 rounded-xl border border-(--sh-line-1) bg-black/[0.02] pl-3 pr-1.5 focus-within:border-(--sh-line-2) dark:bg-white/[0.025] ${
          sheet ? "mx-3 mt-2 h-11" : "mx-2.5 mt-2.5 h-10"
        }`}
      >
        <SearchIcon />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeId ?? undefined}
          aria-label={`Search cases for ${letter}`}
          placeholder={`Search ${total} cases`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 border-0 bg-transparent text-body text-[#14121a] outline-none placeholder:text-(--sh-text-3) dark:text-[#f2ede4]"
        />
        {query ? (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full text-(--sh-text-3) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) pointer-coarse:h-11 pointer-coarse:w-11"
          >
            <span aria-hidden="true">×</span>
          </button>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label="Era"
        className={`flex gap-0.5 overflow-x-auto [scrollbar-width:none] ${
          sheet ? "mx-3 mb-1 mt-2" : "mx-2.5 mb-1 mt-2"
        }`}
      >
        {ERAS.map((item, index) => {
          const checked = item.key === era;
          return (
            <button
              key={item.key}
              ref={(node) => {
                eraRefs.current[index] = node;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              onClick={() => onEra(item.key)}
              onKeyDown={handleEraKey}
              className={`shrink-0 rounded-full border px-2.5 py-[5px] text-micro transition-colors duration-(--sh-dur-micro) pointer-coarse:min-h-11 pointer-coarse:px-3 ${
                checked
                  ? "border-(--sh-line-1) bg-(--sh-hover) text-[#14121a] dark:text-[#f2ede4]"
                  : "border-transparent text-(--sh-text-3) hover:text-(--sh-text-2) focus-visible:text-(--sh-text-2)"
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      <div
        ref={listRef}
        id={listboxId}
        role="listbox"
        aria-label={`Cases for ${letter}`}
        // Focus stays in the search field (aria-activedescendant); the list
        // scrolls but is not a Tab stop of its own.
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        className={`overflow-y-auto overscroll-contain border-t border-(--sh-line-1) ${
          sheet ? "min-h-0 flex-1 px-2 pb-2 pt-1" : "px-1.5 pb-2 pt-1"
        }`}
        style={sheet ? undefined : { maxHeight: maxListHeight }}
      >
        {model.flat.length ? (
          model.groups.map((group) => {
            const headId = `${listboxId}-group-${group.key}`;
            return (
              <div
                key={group.key}
                role="group"
                aria-labelledby={group.label ? headId : undefined}
                aria-label={group.label ? undefined : group.ariaLabel}
              >
                {group.label ? (
                  <div
                    id={headId}
                    role="presentation"
                    className="flex items-baseline justify-between px-2 pb-1 pt-3 text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)"
                  >
                    <span>{group.label}</span>
                    <span className="font-mono normal-case tracking-normal">
                      {group.suffix ?? group.count}
                    </span>
                  </div>
                ) : null}
                {group.options.map((option) => (
                  <PickerOption
                    key={option.id}
                    option={option}
                    active={option.id === activeId}
                    selected={
                      (option.type === "case" || option.type === "pinned") &&
                      option.value === value
                    }
                    otherLetter={
                      option.type === "case" && otherValue && option.value === otherValue
                        ? otherLetter
                        : null
                    }
                    tokens={tokens}
                    lines={describeOption(option, context)}
                    sheet={sheet}
                    onPick={onPick}
                    onHover={onHover}
                  />
                ))}
              </div>
            );
          })
        ) : (
          <div className="px-3 py-7 text-center text-meta text-(--sh-text-3)">
            <p>No case matches “{query}”.</p>
            <button
              type="button"
              onClick={onClear}
              className="mt-2 rounded-full border border-(--sh-line-2) px-3 py-1.5 text-micro text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) pointer-coarse:min-h-11"
            >
              Clear search
            </button>
          </div>
        )}
      </div>
      <PickerDetail lines={detail} activeId={activeId} sheet={sheet} />
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
    </>
  );
}

const TRIGGER_BOX =
  "grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[14px] px-2.5 py-1.5 text-left max-sm:min-h-[52px] max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:px-2";

/**
 * The trigger's box while the catalogue loads: the same grid and line boxes as
 * the real trigger, with quiet blocks for the name and the subline, so the
 * bar keeps its height when the cases arrive. Props: side ("a" | "b").
 */
export function CaseTriggerPlaceholder({ side = "a" }) {
  return (
    <div aria-hidden="true" className={`${TRIGGER_BOX} ${SIDE_COLOR[side] ?? SIDE_COLOR.a}`}>
      <span className="inline-flex items-center gap-1.5 font-mono text-micro text-(--sh-text-3) max-sm:col-span-2">
        <span className="h-0.5 w-3.5 rounded-full bg-(--case-color)" />
        {side === "b" ? "B" : "A"}
      </span>
      <span className="min-w-0">
        <span className="block text-strong font-semibold leading-tight max-sm:text-body">
          <span className="inline-block h-[0.85em] w-36 max-w-full rounded bg-(--sh-hover) align-middle" />
        </span>
        <span className="mt-0.5 block font-mono text-micro">
          <span className="inline-block h-[0.85em] w-20 max-w-full rounded bg-(--sh-hover) align-middle" />
        </span>
      </span>
      <span className="h-3.5 w-3.5" />
    </div>
  );
}

// The trigger shows the full name from 640 px (sm) and the short name below.
// Its accessible name starts with what is shown, so the visible words are
// part of the name (WCAG 2.5.3, label in name; voice control).
const WIDE_QUERY = "(min-width: 40rem)";
function subscribeWide(onChange) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const getWide = () => window.matchMedia(WIDE_QUERY).matches;
const getWideOnServer = () => true;

export function CasePicker({
  side = "a",
  label,
  value,
  otherValue = null,
  cases = [],
  kinds = [],
  recessions = [],
  pairs = null,
  pinned = null,
  seriesKey = null,
  coverage = null,
  filter = null,
  onChange,
  onPair,
  onPreview,
}) {
  const letter = side === "b" ? "B" : "A";
  const otherLetter = side === "b" ? "A" : "B";
  const heading = label ?? `Case ${letter}`;
  // The popover fades in and out (140 ms), except under reduced motion: then
  // it is a plain element that appears and goes at once.
  const reduceMotion = usePrefersReducedMotion();
  const Popover = reduceMotion ? "div" : motion.div;
  const popoverMotion = reduceMotion
    ? {}
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: DUR.reveal, ease: EASE.out } },
        exit: { opacity: 0, transition: { duration: DUR.revealOut, ease: EASE.exit } },
      };
  const uid = useId().replace(/[^a-zA-Z0-9-]/g, "");
  const listboxId = `cv-listbox-${side}-${uid}`;
  const panelId = `cv-panel-${side}-${uid}`;

  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const sheetHostRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const openedByRef = useRef("mouse");

  // open: null | { mode: "popover" | "sheet", offset, maxList, focusInput }
  const [open, setOpen] = useState(null);
  const [query, setQuery] = useState("");
  const [era, setEra] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  const [activeId, setActiveId] = useState(null);
  const [announced, setAnnounced] = useState("");

  const byId = useMemo(() => new Map(cases.map((c) => [c.id, c])), [cases]);
  const recessionsById = useMemo(
    () => new Map(recessions.map((r) => [r.id, r])),
    [recessions],
  );
  const index = useMemo(
    () => buildCaseIndex(cases, kinds, recessions),
    [cases, kinds, recessions],
  );
  const tokens = useMemo(() => queryTokens(query), [query]);
  const model = useMemo(
    () =>
      buildModel({
        listboxId,
        cases,
        kinds,
        index,
        pairs,
        pinned,
        filter,
        tokens,
        era,
        expanded,
        byId,
      }),
    [listboxId, cases, kinds, index, pairs, pinned, filter, tokens, era, expanded, byId],
  );
  const total = useMemo(
    () => (filter ? cases.filter(filter).length : cases.length),
    [cases, filter],
  );

  const pinnedEntry = (pinned ?? []).find((entry) => entry.id === value) ?? null;
  const current = pinnedEntry ? null : byId.get(value) ?? null;
  const name = pinnedEntry?.name ?? current?.name ?? "Choose a case";
  const shortName = pinnedEntry?.short ?? current?.short_name ?? name;
  const subline = pinnedEntry?.subline ?? (current ? caseSubline(current) : "");
  // The accessible name follows the visible text in order (the letter, the
  // name shown at this width, the subline), then the full name where phones
  // show the short one.
  const wide = useSyncExternalStore(subscribeWide, getWide, getWideOnServer);
  const shownName = wide ? name : shortName;
  const ariaLabel = `${heading}: ${shownName}${subline ? `, ${subline}` : ""}${
    !wide && shortName !== name ? ` (${name})` : ""
  }. Change case`;

  // Active option: the one set by the arrows or the pointer while it is
  // visible; else the current case (no query) or the first match.
  const flatIds = model.flat.map((option) => option.id);
  const currentOptionId =
    model.flat.find(
      (option) =>
        (option.type === "case" || option.type === "pinned") && option.value === value,
    )?.id ?? null;
  const fallbackId =
    (!model.searching && currentOptionId) || flatIds[0] || null;
  const effectiveActiveId =
    activeId && flatIds.includes(activeId) ? activeId : fallbackId;
  const activeOption = model.flat.find((option) => option.id === effectiveActiveId) ?? null;
  const activeCaseId = activeOption?.type === "case" ? activeOption.value : null;

  const context = useMemo(
    () => ({ recessionsById, seriesKey, coverage }),
    [recessionsById, seriesKey, coverage],
  );
  const detail = activeOption ? describeOption(activeOption, context) : [];

  // Focus goes back to the trigger after the commit that closes the panel:
  // until then the sheet keeps the rest of the page inert.
  const restoreFocusRef = useRef(false);
  const close = useCallback((restoreFocus) => {
    restoreFocusRef.current = Boolean(restoreFocus);
    setOpen(null);
    setQuery("");
    setEra("all");
    setActiveId(null);
  }, []);

  const openPanel = useCallback(
    (openedBy) => {
      openedByRef.current = openedBy;
      const sheet =
        typeof window !== "undefined" &&
        !window.matchMedia("(min-width: 640px)").matches;
      let offset = 0;
      let maxList = 400;
      const root = rootRef.current;
      if (!sheet && root) {
        const rect = root.getBoundingClientRect();
        const width = Math.min(POPOVER_WIDTH, window.innerWidth - 24);
        offset = Math.min(0, window.innerWidth - 12 - width - rect.left);
        offset = Math.max(offset, 12 - rect.left);
        // Search field, era chips and margins take about 110 px above the
        // list, the detail line about 78 px below it.
        maxList = Math.max(
          180,
          Math.min(400, window.innerHeight - rect.bottom - 8 - 110 - 78 - 16),
        );
      }
      // A neutral current case inside a folded group: open that group.
      const currentCase = byId.get(value);
      if (currentCase && currentCase.name_source !== "curated") {
        const groupSize = cases.filter((c) => c.kind === currentCase.kind).length;
        if (groupSize > FOLD_OVER) {
          setExpanded((previous) => {
            if (previous.has(currentCase.kind)) return previous;
            const next = new Set(previous);
            next.add(currentCase.kind);
            return next;
          });
        }
      }
      setQuery("");
      setEra("all");
      setActiveId(null);
      setOpen({
        mode: sheet ? "sheet" : "popover",
        offset,
        maxList,
        focusInput: openedBy !== "touch",
      });
    },
    [byId, cases, value],
  );

  const choose = useCallback(
    (option) => {
      if (!option) return;
      if (option.type === "more" || option.type === "fewer") {
        setExpanded((previous) => {
          const next = new Set(previous);
          if (option.type === "more") next.add(option.kind);
          else next.delete(option.kind);
          return next;
        });
        // "Show more" lands on the first case it revealed; "Show fewer" on
        // the row that folds them back out.
        const firstRevealed = cases
          .filter(
            (c) =>
              c.kind === option.kind &&
              c.name_source !== "curated" &&
              (!filter || filter(c)),
          )
          .sort(chronological)[0];
        setActiveId(
          option.type === "more" && firstRevealed
            ? optionDomId(listboxId, "case", firstRevealed.id)
            : optionDomId(listboxId, "more", option.kind),
        );
        inputRef.current?.focus({ preventScroll: true });
        return;
      }
      if (option.type === "pair") {
        close(true);
        onPair?.([option.a.id, option.b.id]);
        return;
      }
      close(true);
      if (option.value !== value) onChange?.(option.value);
    },
    [cases, close, filter, listboxId, onChange, onPair, value],
  );

  // Focus the search field (or the sheet, after a touch) once the panel is
  // in; after it closes, hand focus back to the trigger when asked to.
  useEffect(() => {
    if (!open) {
      if (restoreFocusRef.current) {
        restoreFocusRef.current = false;
        triggerRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    if (open.focusInput) inputRef.current?.focus({ preventScroll: true });
    else panelRef.current?.focus({ preventScroll: true });
  }, [open]);

  // Keep the active option inside the list's scroll box (never scroll the page).
  useEffect(() => {
    if (!open || !effectiveActiveId) return;
    const list = listRef.current;
    const node = list ? document.getElementById(effectiveActiveId) : null;
    if (!list || !node) return;
    const top = node.offsetTop - list.offsetTop;
    const bottom = top + node.offsetHeight;
    if (top < list.scrollTop + 4) list.scrollTop = Math.max(0, top - 28);
    else if (bottom > list.scrollTop + list.clientHeight - 4) {
      list.scrollTop = bottom - list.clientHeight + 8;
    }
  }, [open, effectiveActiveId]);

  // A polite count for screen readers, after typing settles.
  useEffect(() => {
    if (!open) return undefined;
    const timer = window.setTimeout(() => {
      setAnnounced(`${model.matches} ${model.matches === 1 ? "case" : "cases"}`);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [open, model.matches]);

  // Callers prefetch the active case's path.
  useEffect(() => {
    if (open) onPreview?.(activeCaseId);
  }, [open, activeCaseId, onPreview]);

  // Popover: a pointer press outside closes it (focus stays where the pointer
  // put it); crossing the 640 px line closes either form.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (open.mode !== "popover") return;
      if (rootRef.current?.contains(event.target)) return;
      close(false);
    };
    const media = window.matchMedia("(min-width: 640px)");
    const onMedia = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    media.addEventListener("change", onMedia);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      media.removeEventListener("change", onMedia);
    };
  }, [open, close]);

  // Sheet: everything else is inert while it is up.
  useEffect(() => {
    if (open?.mode !== "sheet") return undefined;
    const host = sheetHostRef.current;
    if (!host) return undefined;
    const changed = [];
    for (const element of Array.from(document.body.children)) {
      if (element === host || element.contains(host)) continue;
      if (element.hasAttribute("inert") || element.tagName === "SCRIPT") continue;
      element.setAttribute("inert", "");
      changed.push(element);
    }
    return () => {
      for (const element of changed) element.removeAttribute("inert");
    };
  }, [open]);

  const move = (delta) => {
    if (!flatIds.length) return;
    const at = Math.max(0, flatIds.indexOf(effectiveActiveId));
    const next = Math.min(flatIds.length - 1, Math.max(0, at + delta));
    setActiveId(flatIds[next]);
  };

  const jumpGroup = (direction) => {
    const groups = model.groups.filter((group) => group.options.length);
    const at = groups.findIndex((group) =>
      group.options.some((option) => option.id === effectiveActiveId),
    );
    const target = groups[Math.min(groups.length - 1, Math.max(0, at + direction))];
    if (target) setActiveId(target.options[0].id);
  };

  const handleInputKey = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(-1);
        break;
      case "PageDown":
        event.preventDefault();
        jumpGroup(1);
        break;
      case "PageUp":
        event.preventDefault();
        jumpGroup(-1);
        break;
      case "Home":
      case "End":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          setActiveId(event.key === "Home" ? flatIds[0] : flatIds[flatIds.length - 1]);
        }
        break;
      case "Enter":
        event.preventDefault();
        choose(activeOption);
        break;
      case "Escape":
        // One press, one step: the query first, then the panel. Other layers
        // (the header's views, the info panel) stay as they are.
        event.preventDefault();
        event.stopPropagation();
        if (query) {
          setQuery("");
          setActiveId(null);
        } else {
          close(true);
        }
        break;
      default:
        break;
    }
  };

  const handlePanelKey = (event) => {
    if (event.key === "Escape" && event.target !== inputRef.current) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "Tab" || open?.mode !== "sheet") return;
    // The sheet is modal: Tab cycles inside it.
    const items = Array.from(panelRef.current?.querySelectorAll(TABBABLE) ?? []).filter(
      (node) => node.tabIndex >= 0 && node.getClientRects().length > 0,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // The popover closes when focus leaves it (Tab, Shift+Tab back to the
  // trigger), choosing nothing. A press on its own padding moves focus
  // nowhere and keeps it open.
  const handlePanelBlur = (event) => {
    if (open?.mode !== "popover") return;
    const next = event.relatedTarget;
    if (!next || panelRef.current?.contains(next)) return;
    close(false);
  };

  const handleTriggerKey = (event) => {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) close(true);
      else openPanel("keyboard");
    }
  };

  const handleTriggerPointer = (event) => {
    openedByRef.current = event.pointerType === "touch" ? "touch" : "mouse";
  };

  const handleTriggerClick = (event) => {
    // Keyboard activation is handled on keydown; a click with detail 0 is a
    // synthetic (assistive tech) press.
    if (open) {
      close(false);
      return;
    }
    openPanel(event.detail === 0 ? "keyboard" : openedByRef.current);
  };

  const body = open ? (
    <PickerBody
      letter={letter}
      total={total}
      listboxId={listboxId}
      inputRef={inputRef}
      listRef={listRef}
      query={query}
      era={era}
      model={model}
      activeId={effectiveActiveId}
      tokens={tokens}
      sheet={open.mode === "sheet"}
      maxListHeight={open.maxList}
      announced={announced}
      value={value}
      otherValue={otherValue}
      otherLetter={otherLetter}
      context={context}
      detail={detail}
      onQuery={(next) => {
        setQuery(next);
        setActiveId(null);
      }}
      onEra={(next) => {
        setEra(next);
        setActiveId(null);
      }}
      onKeyDown={handleInputKey}
      onPick={choose}
      onHover={setActiveId}
      onClear={() => {
        setQuery("");
        setActiveId(null);
        inputRef.current?.focus({ preventScroll: true });
      }}
    />
  ) : null;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${SIDE_COLOR[side] ?? SIDE_COLOR.a}`}>
      <button
        ref={triggerRef}
        id={`cv-trigger-${side}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={Boolean(open)}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        onPointerDown={handleTriggerPointer}
        onClick={handleTriggerClick}
        onKeyDown={handleTriggerKey}
        className={`group ${TRIGGER_BOX} transition-colors duration-(--sh-dur-micro) ease-(--sh-ease-out) hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover) aria-expanded:bg-(--sh-hover)`}
      >
        {/* Real spaces between the parts (they collapse in the layout), so
            the visible text reads "A GFC 2007–09 · −56.8%" as words, as the
            accessible name does (WCAG 2.5.3). */}
        <span className="inline-flex items-center gap-1.5 font-mono text-micro text-(--sh-text-3) max-sm:col-span-2">
          <span className="h-0.5 w-3.5 rounded-full bg-(--case-color)" aria-hidden="true" />
          {letter}
        </span>{" "}
        <span className="min-w-0">
          <span className="block text-strong font-semibold leading-tight tracking-[-0.02em] text-[#14121a] max-sm:text-body dark:text-[#f2ede4]">
            <span className="max-sm:hidden">{name}</span>
            <span className="sm:hidden">{shortName}</span>
          </span>{" "}
          <span className="mt-0.5 block font-mono text-micro text-(--sh-text-3)">
            {subline}
          </span>
        </span>
        <Chevron />
      </button>

      <AnimatePresence>
        {open?.mode === "popover" ? (
          <Popover
            key="popover"
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={`Choose case ${letter}`}
            onKeyDown={handlePanelKey}
            onBlur={handlePanelBlur}
            {...popoverMotion}
            className="absolute top-[calc(100%+8px)] z-40 w-[440px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[1.25rem] border border-(--sh-line-1) bg-(--sh-surface-overlay) shadow-(--sh-shadow-overlay) backdrop-blur-[16px]"
            // Inside the bar's own backdrop filter this one cannot blur the
            // page, so the overlay surface sits on the opaque engine colour.
            style={{ left: open.offset, background: OPAQUE_OVERLAY }}
          >
            {body}
          </Popover>
        ) : null}
      </AnimatePresence>

      {open?.mode === "sheet"
        ? createPortal(
            <div ref={sheetHostRef} className={`fixed inset-0 z-[90] ${SIDE_COLOR[side] ?? SIDE_COLOR.a}`}>
              <div
                className="absolute inset-0 bg-[rgb(8_8_14/0.32)]"
                aria-hidden="true"
                onClick={() => close(true)}
              />
              <div
                ref={panelRef}
                id={panelId}
                role="dialog"
                aria-modal="true"
                aria-label={`Choose case ${letter}`}
                tabIndex={-1}
                onKeyDown={handlePanelKey}
                className="animate-sheet-up absolute inset-x-0 bottom-0 flex h-[86dvh] flex-col rounded-t-[1.5rem] border border-b-0 border-(--sh-line-1) bg-(--sh-surface-overlay) shadow-(--sh-shadow-overlay) outline-none backdrop-blur-[16px]"
              >
                <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-(--sh-line-2)" aria-hidden="true" />
                <div className="flex shrink-0 items-center justify-between pl-4 pr-2 pt-1">
                  <span className="text-strong font-semibold tracking-[-0.02em] text-[#14121a] dark:text-[#f2ede4]">
                    {heading}
                  </span>
                  <button
                    type="button"
                    onClick={() => close(true)}
                    aria-label="Close"
                    className="grid h-11 w-11 place-items-center rounded-full text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-[18px] w-[18px]"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l12 12M18 6 6 18" />
                    </svg>
                  </button>
                </div>
                {body}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
