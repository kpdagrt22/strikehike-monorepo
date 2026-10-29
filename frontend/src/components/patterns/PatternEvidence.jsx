"use client";

// The closed-by-default content of the page, loaded after it: section 03
// (Evidence) and the bodies of section 02's two disclosures. The track-record
// copy lives here rather than in patternFormat.js for the same reason.

import { useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { PatternEraPanel } from "@/components/patterns/PatternEraPanel";
import { useNextYearLines } from "@/components/patterns/PatternCompare";
import { DisclosureRow } from "@/components/patterns/PatternMirror";
import {
  CADENCE_INTRO,
  DIRECTION_NO_EDGE,
  FALLS_NO_EDGE,
  MINUS,
  RANKING_NONE,
  basisLabel,
  categoryPair,
  closerThan,
  finite,
  firstEvent,
  formatChange,
  formatCount,
  formatDate,
  formatMonth,
  freshSkill,
  historyYears,
  mirrorExact,
  mirrorSourceTag,
  noEdgeRecord,
  setupsLabel,
  sourceLabel,
  thinRecord,
  windowLabel,
  yearOf,
} from "@/components/patterns/patternFormat";
import { ASSET_TARGETS, assetChartColor } from "@/components/regime/assetTargets";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/** A recorded share with one decimal: "67.7%". */
function formatRate(value) {
  return finite(value) ? `${Number(value).toFixed(1)}%` : "—";
}

/** Percentage points with a sign, never "−0.0". */
function formatPoints(value) {
  if (!finite(value)) return "—";
  const rounded = Number(Number(value).toFixed(1));
  if (rounded === 0) return "0.0";
  return `${rounded > 0 ? "+" : MINUS}${Math.abs(rounded).toFixed(1)}`;
}

/**
 * The Track record, as sentences: { thin } for a short record, { lines } for a
 * scored one, or null when it is missing or stale. Counts only: no blended
 * shares, no skill scores; "better" and "weak" codes render nothing.
 */
function trackRecord(engine, k) {
  const skill = freshSkill(engine);
  if (!skill) return null;
  const since = yearOf(skill.period?.[0]);
  if (thinRecord(engine)) {
    const years = Number(skill.independent_years);
    return Number.isFinite(years) && since
      ? { thin: `Too little history to score: about ${Math.round(years)} independent years since ${since}.` }
      : null;
  }
  const lines = [];
  const cadence = CADENCE_INTRO[skill.cadence];
  if (cadence && skill.period?.[1] && finite(skill.forecasts) && finite(skill.independent_years)) {
    lines.push(
      `${cadence} from ${formatMonth(skill.period[0])} to ${formatMonth(skill.period[1])}, this comparison was re-run using only the history available at the time, then checked against what followed: ${formatCount(skill.forecasts)} tests, about ${Math.round(Number(skill.independent_years))} independent years.`,
    );
  }
  const direction = skill.direction;
  if (DIRECTION_NO_EDGE.has(direction?.verdict) && finite(direction.hit_pct) && finite(direction.base_hit_pct)) {
    const usualCall = direction.base_call === "up" ? "“always up”" : "the usual call";
    const ci = direction.edge_ci95_pp;
    const range =
      Array.isArray(ci) && finite(ci[0]) && finite(ci[1])
        ? ` (difference ${formatPoints(ci[0])} to ${formatPoints(ci[1])} points)`
        : "";
    lines.push(
      `A year ahead, the setups’ majority was right ${formatRate(direction.hit_pct)} of the time; ${usualCall} was right ${formatRate(direction.base_hit_pct)}${range}.`,
    );
    if (skill.placebo?.verdict === "same") {
      lines.push(`${k === 10 ? "Ten" : k} past windows picked at random scored about the same.`);
    }
  }
  const warnings = skill.warnings;
  if (
    FALLS_NO_EDGE.has(skill.falls_20?.verdict) &&
    finite(warnings?.flagged_share_pct) &&
    finite(warnings?.flagged_followed_pct) &&
    finite(warnings?.other_followed_pct)
  ) {
    lines.push(
      `Falls of 20% or more: when the setups showed more of them than usual (${formatRate(warnings.flagged_share_pct)} of tests), one followed ${formatRate(warnings.flagged_followed_pct)} of the time; otherwise ${formatRate(warnings.other_followed_pct)}.`,
    );
  }
  const declines = skill.declines;
  if (
    declines &&
    [
      declines.declines,
      declines.became_20,
      declines.flagged,
      declines.flagged_became_20,
      declines.not_flagged,
      declines.not_flagged_became_20,
    ].every(finite) &&
    yearOf(declines.period?.[0])
  ) {
    lines.push(
      `At the first close 10% below a high, ${declines.became_20} of ${declines.declines} falls since ${yearOf(declines.period[0])} went on to 20% or more. When more setups than usual had fallen a further 10%, that happened in ${declines.flagged_became_20} of ${declines.flagged}; otherwise in ${declines.not_flagged_became_20} of ${declines.not_flagged}.`,
    );
  }
  if (RANKING_NONE.has(skill.ranking?.verdict)) {
    lines.push("Size of the next move: no consistent link.");
  }
  if (lines.length === 0) return null;
  lines.push(
    "A historical record, not a forecast. Neighbouring tests share most of their data, so the independent sample is far smaller than the test count. Past scoring does not carry into the future.",
  );
  return { lines, noEdge: noEdgeRecord(engine), since, until: yearOf(skill.period?.[1]) };
}

function eventText(events) {
  const event = firstEvent(events);
  if (!event) return "—";
  const more = events.length - 1;
  return more > 0 ? `${event.title} +${more} more` : event.title;
}

/**
 * A setup's month in the table. When its next year took part in a catalogue
 * decline, the month is a button: hover (the whole row), keyboard focus or a
 * tap reveals "The next year included …" in the line under the table, and
 * the button's description carries the same sentence. A tap or click only
 * pins (as the years' chips do), so a second tap hides the line again.
 */
function SetupMonth({ label, link, descId, onFocus, onBlur, onEscape }) {
  if (!link) return label;
  return (
    <>
      <button
        type="button"
        aria-describedby={descId}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) onFocus();
        }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          if (event.key === "Escape") onEscape(event);
        }}
        className="relative rounded underline decoration-(--sh-line-2) decoration-dotted underline-offset-4 transition-colors duration-(--sh-dur-micro) hover:decoration-(--sh-text-3) focus-visible:decoration-(--sh-text-3) motion-reduce:transition-none pointer-coarse:before:absolute pointer-coarse:before:-inset-x-2 pointer-coarse:before:top-1/2 pointer-coarse:before:h-11 pointer-coarse:before:-translate-y-1/2 pointer-coarse:before:content-['']"
      >
        {label}
      </button>
      <span id={descId} hidden>
        {link.text}
      </span>
    </>
  );
}

/** Section 02's "{n} moments" list, inside its closed disclosure. */
export function MirrorMoments({ events }) {
  return (
    <div className="relative ml-1 border-l border-black/10 pl-4 dark:border-white/10">
      {events.map((event) => {
        const pair = categoryPair(event.category);
        return (
          <article
            key={`${event.date}-${event.title}`}
            className="relative pb-4 last:pb-0"
            style={{ "--cat-light": pair.light, "--cat-dark": pair.dark }}
          >
            <span
              className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-[#f5f0e8] bg-(--cat-light) dark:border-[#07070b] dark:bg-(--cat-dark)"
              aria-hidden="true"
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-micro text-black/60 dark:text-white/60">
                {formatDate(event.date)}
              </span>
              <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-micro font-medium uppercase tracking-[0.08em] text-(--cat-light) dark:bg-(--cat-dark)/9 dark:text-(--cat-dark)">
                {event.category}
              </span>
            </div>
            <h3 className="mt-1 text-meta font-semibold leading-snug text-[#14121a] dark:text-[#f2ede4]">
              {event.title}
            </h3>
            <p className="mt-1 text-micro leading-relaxed text-black/60 dark:text-white/60">
              {event.summary}
            </p>
          </article>
        );
      })}
    </div>
  );
}

/** Section 02's "Geopolitics & science" body, inside its closed disclosure.
 * Server-rendered; the server cannot know the theme, so the accent is the
 * dark one until mounted (as on the page), then follows the resolved theme. */
export function GeopoliticsBody({ asset }) {
  const { resolvedTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const accent = assetChartColor(
    ASSET_TARGETS[asset] ?? ASSET_TARGETS.sp500,
    !mounted || resolvedTheme !== "light",
  );
  const nifty = asset === "nifty";
  return (
    <>
      <h3 className="text-xl font-semibold tracking-[-0.035em] text-[#14121a] dark:text-[#f2ede4]">
        Different tools, familiar tensions.
      </h3>
      <p className="mt-2 max-w-xl text-micro leading-relaxed text-black/60 dark:text-white/60">
        A general-purpose technology, a contested chokepoint, and a political
        order under strain. The nouns change; the grammar repeats.
      </p>
      <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/70 dark:text-white/70">
        Human emotion, debt and technological booms are the constants. The 1906
        boom in rails and electricity, the 2008 credit shock and the 2026 boom
        in AI and compute are different expressions of the same sequence: a
        general-purpose technology attracts capital, leverage amplifies the
        build-out, and the bill arrives when the story stops compounding.
      </p>
      <div className="mt-4 grid sm:grid-cols-2">
        {[
          ["Emotion", "Fear and greed do not update with the technology."],
          ["Debt", "Every boom finds a new way to borrow against the future."],
          ["Technology", "A general-purpose tool attracts capital, then overcapacity."],
          ["Power", "Geopolitical competition follows the money and the chokepoint."],
        ].map(([label, text]) => (
          <div
            key={label}
            className="border-t border-(--sh-line-1) py-3 sm:odd:border-r sm:odd:pr-4 sm:even:pl-4"
          >
            <p className="text-micro font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
              {label}
            </p>
            <p className="mt-1 text-micro leading-relaxed text-black/70 dark:text-white/70">
              {text}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid items-stretch gap-4 xl:grid-cols-2">
        <PatternEraPanel
          side="Now"
          era="2026"
          title="AI, security and the new industrial race"
          summary="The general-purpose technology is AI. The contested chokepoint is compute, energy and the supply chain that makes both possible."
          bullets={[
            "AI infrastructure and data-centre capex become strategic assets.",
            "US–China technology competition redraws trade and alliance maps.",
            "European security and energy transition compete for fiscal space.",
            "A concentrated market leadership group becomes a political actor.",
          ]}
          accent={accent}
        />
        {nifty ? (
          <PatternEraPanel
            side="Then"
            era="2008"
            title="Lehman, Mumbai and the Satyam shock"
            summary="A global funding crisis met a domestic security shock and a corporate-governance failure. The Indian market had to reprice all three at once."
            bullets={[
              "Lehman Brothers collapses in September 2008 and global credit freezes.",
              "The Mumbai attacks of November 2008 raise sovereign and security risk.",
              "Satyam's accounting fraud tests confidence in Indian corporate governance.",
              "The 2009 election result becomes a political-risk release valve.",
            ]}
            accent={accent}
          />
        ) : (
          <PatternEraPanel
            side="Then"
            era="1906"
            title="Earthquake, dreadnoughts and electricity"
            summary="The general-purpose technology was electricity. The contested chokepoint was rail, coal and the coaling stations that connected empires."
            bullets={[
              "The San Francisco earthquake (April 1906) exposes infrastructure fragility.",
              "HMS Dreadnought resets the naval arms race in 1906.",
              "The Anglo-Russian Entente rearranges the great-power map.",
              "Rapid industrialisation and trust consolidation set up the Panic of 1907.",
            ]}
            accent={accent}
          />
        )}
      </div>
    </>
  );
}

function methodNotes(engine, label) {
  const k = engine.outlook?.k ?? engine.analogs?.length ?? 10;
  const unit = windowLabel(engine);
  const basis = basisLabel(engine.basis) ?? "closes";
  const since = engine.outlook?.usual_since_year;
  const usual = engine.outlook?.usual_windows;
  const notes = [
    `Each ${unit} window of ${basis} is compared with every earlier one on shape (the path, scaled by its own volatility) and state (its return, distance below its high, distance from its average, last-quarter move, and volatility against its 10-year median).`,
    `The ${k === 1 ? "closest window is" : `${k} closest windows are`} kept, each a full window from the others, so no two overlap, and every setup’s following year ended before today’s window began. Scales come only from windows that were complete at the time.`,
  ];
  if (since) {
    const step = engine.window?.unit === "week" ? "week" : "month";
    notes.push(
      `“Usual” and “all years since ${since}” mean every complete ${unit} stretch of the ${label}, one starting each ${step}${
        usual ? ` (${formatCount(usual)} of them)` : ""
      }. With ${k} setups, one setup moves a share by ${Math.round(100 / k)} points.`,
    );
  }
  if (engine.asset === "sp500" && engine.basis === "weekly_close") {
    notes.push(
      "Weekly closes since 1928 come from the S&P 90 until March 1957 and the S&P 500 after; the record has no Saturday sessions before 1952.",
    );
  }
  if (mirrorExact(engine)) {
    notes.push(
      "The 120-year mirror uses monthly averages since 1871 (the Cowles monthly index until 1927), which smooth and blunt short crashes.",
    );
  }
  const years = historyYears(engine);
  if (engine.asset !== "sp500" && years != null && years < 25) {
    notes.push(
      `The ${label} record begins on ${formatDate(engine.history_start)}: about ${years} years, so every setup is recent and the sample is thin.`,
    );
  }
  if (engine.asset === "gold") {
    notes.push("Flat years, such as the pegged price before 1971, never count as setups or as usual years.");
  }
  return notes;
}

/**
 * Section 03: the evidence behind section 01, closed until asked for: the
 * setups table, the measured track record (counts only) and the method.
 * `children` is the slot for one more closed row (a later "compare today
 * with any case" disclosure).
 */
export function PatternEvidence({ engine, assetKey, children }) {
  const asset = ASSET_TARGETS[engine?.asset] ? engine.asset : assetKey;
  const label = (ASSET_TARGETS[asset] ?? ASSET_TARGETS.sp500).label;
  const analogs = [...(engine?.analogs ?? [])].sort(
    (a, b) => Number(a.position) - Number(b.position) || Number(a.rank) - Number(b.rank),
  );
  const k = engine?.outlook?.k ?? (engine ? analogs.length : 10);
  const title = k === 1 ? "The closest setup" : `The ${setupsLabel(k)}`;
  const exact = mirrorExact(engine);
  const showData = asset === "sp500";
  const showEvents =
    analogs.some((analog) => analog.events?.length > 0) || (exact?.events?.length ?? 0) > 0;
  const ends = analogs.map((analog) => yearOf(analog.window?.end)).filter(Number.isFinite);
  const span = ends.length ? `${Math.min(...ends)}–${Math.max(...ends)}` : null;
  const record = engine ? trackRecord(engine, k) : null;
  const notes = engine ? methodNotes(engine, label) : [];
  const wide = "max-sm:hidden";
  const cell = "border-t border-(--sh-line-1) py-2 pl-3 text-right font-mono tabular-nums";

  // "The next year included …" (the case catalogue, once the page is idle):
  // one line under the table for the hovered, focused or tapped row (from
  // 640 px; below it, for the tapped row only). On touch every row is 44 px
  // tall, so a month's 44 px hit area stays inside its own row.
  const TOUCH_ROW = "pointer-coarse:h-11";
  const nextYear = useNextYearLines(engine);
  const [reveal, setReveal] = useState({ engine: null, hover: null, pinned: null });
  const revealed = reveal.engine === engine ? reveal : { hover: null, pinned: null };
  const shownKey = revealed.hover ?? revealed.pinned;
  const setRow = (patch) =>
    setReveal((previous) => ({
      ...(previous.engine === engine ? previous : { hover: null, pinned: null }),
      ...patch,
      engine,
    }));
  const monthOf = (key) =>
    key === "mirror"
      ? formatMonth(exact?.window?.end)
      : formatMonth(analogs.find((analog) => `setup:${analog.rank}` === key)?.window?.end);
  const shown = shownKey ? nextYear?.get(shownKey) ?? null : null;
  const pinnedLine = revealed.pinned ? nextYear?.get(revealed.pinned) ?? null : null;
  const lineText = (key, line) => (
    <span key={key}>
      <span className="font-mono tabular-nums text-(--sh-text-2)">{monthOf(key)}</span>
      {` · ${line.lead} `}
      <span className="text-(--sh-text-1)">the {line.name}</span>{" "}
      <span className="whitespace-nowrap font-mono tabular-nums">{line.detail}</span>
      {line.more > 0 ? ` +${line.more} more` : null}
    </span>
  );
  const rowReveal = (key) =>
    nextYear?.get(key)
      ? {
          onPointerEnter: (event) => {
            if (event.pointerType === "mouse") setRow({ hover: key });
          },
          onPointerLeave: (event) => {
            if (event.pointerType === "mouse") setRow({ hover: null });
          },
          onClick: () => setRow({ pinned: revealed.pinned === key ? null : key }),
          className: `cursor-pointer ${shownKey === key ? "bg-(--sh-hover)" : ""}`,
        }
      : {};
  const monthProps = (key) => ({
    link: nextYear?.get(key) ?? null,
    descId: `pattern-next-year-${key.replace(":", "-")}`,
    onFocus: () => setRow({ hover: key }),
    onBlur: () => setRow({ hover: null }),
    // Esc hides the line whether a tap pinned it or keyboard focus revealed it.
    onEscape: (event) => {
      if (revealed.pinned == null && revealed.hover == null) return;
      event.preventDefault();
      setRow({ hover: null, pinned: null });
    },
  });

  return (
    <div className="mt-3 rounded-[1.4rem] border border-(--sh-line-1) bg-white/45 px-5 py-1 dark:bg-black/40 sm:px-6 [&>details:first-child]:border-t-0">
      {/* Phones show the label alone, so it stays on one line. */}
      <DisclosureRow
        label={title}
        metaLong={span ? `${span} · ranked by closeness` : "ranked by closeness"}
      >
        {engine ? (
          <div
            role="region"
            aria-label={title}
            tabIndex={0}
            className="overflow-x-auto rounded-lg"
          >
            <table className="w-full border-collapse text-micro text-(--sh-text-2)">
              <caption className="sr-only">
                {title}, closest first, and what followed each
              </caption>
              <thead>
                <tr className="text-(--sh-text-3)">
                  {[
                    ["Setup", ""],
                    ["Rank", ""],
                    ["Its 12 months", wide],
                    ["Next 12 months", ""],
                    ["Worst fall", wide],
                    ...(showData ? [["Data", wide]] : []),
                    ...(showEvents ? [["What happened", wide]] : []),
                  ].map(([heading, hide], index) => (
                    <th
                      key={heading}
                      scope="col"
                      className={`whitespace-nowrap py-1.5 font-medium uppercase tracking-[0.08em] ${
                        index === 0 ? "text-left" : "pl-3 text-right"
                      } ${hide}`}
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analogs.map((analog) => (
                  <tr key={`row-${analog.rank}`} {...rowReveal(`setup:${analog.rank}`)}>
                    <th
                      scope="row"
                      className={`whitespace-nowrap border-t border-(--sh-line-1) py-2 text-left font-mono font-normal tabular-nums text-(--sh-text-1) ${TOUCH_ROW}`}
                    >
                      <SetupMonth
                        label={formatMonth(analog.window?.end)}
                        {...monthProps(`setup:${analog.rank}`)}
                      />
                    </th>
                    <td className={`${cell} whitespace-nowrap`}>
                      #{formatCount(analog.position)} of {formatCount(analog.of)}
                    </td>
                    <td className={`${cell} ${wide}`}>{formatChange(analog.window?.return_pct)}</td>
                    <td className={`${cell} text-(--sh-text-1)`}>
                      {formatChange(analog.forward?.return_12m_pct)}
                    </td>
                    <td className={`${cell} ${wide}`}>
                      {formatChange(analog.forward?.max_drawdown_pct)}
                    </td>
                    {showData ? (
                      <td className={`${cell} whitespace-nowrap font-sans ${wide}`}>
                        {sourceLabel(analog.source) ?? "—"}
                      </td>
                    ) : null}
                    {showEvents ? (
                      <td className={`${cell} font-sans ${wide}`}>{eventText(analog.events ?? [])}</td>
                    ) : null}
                  </tr>
                ))}
                {exact ? (
                  <tr {...rowReveal("mirror")}>
                    <th
                      scope="row"
                      className={`whitespace-nowrap border-t border-(--sh-line-1) py-2 text-left font-mono font-normal tabular-nums text-(--sh-text-1) ${TOUCH_ROW}`}
                    >
                      <span
                        className="mr-1.5 inline-block w-2.5 -translate-y-[3px] border-t-2 border-[#a16207] dark:border-[#d8b47a]"
                        aria-hidden="true"
                      />
                      <SetupMonth label={formatMonth(exact.window?.end)} {...monthProps("mirror")} />
                      <span className="sr-only"> (exactly 120 years ago)</span>
                    </th>
                    <td className={`${cell} whitespace-nowrap`}>
                      closer than {closerThan(exact.closer_than_pct)}
                    </td>
                    <td className={`${cell} ${wide}`}>{formatChange(exact.window?.return_pct)}</td>
                    <td className={`${cell} text-(--sh-text-1)`}>
                      {formatChange(exact.forward?.return_12m_pct)}
                    </td>
                    <td className={`${cell} ${wide}`}>
                      {formatChange(exact.forward?.max_drawdown_pct)}
                    </td>
                    {showData ? (
                      <td className={`${cell} whitespace-nowrap font-sans ${wide}`}>
                        {mirrorSourceTag(exact.window?.end) ?? sourceLabel("sp500")}
                      </td>
                    ) : null}
                    {showEvents ? (
                      <td className={`${cell} font-sans ${wide}`}>{eventText(exact.events ?? [])}</td>
                    ) : null}
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-meta text-(--sh-text-3)">—</p>
        )}
        {/* From 640 px the line is reserved (two lines to 767 px, one from
            768, at their measured heights with the mono dates), so a hovered
            row never moves what is below; below 640 px it appears for a
            tapped row only, on the press. */}
        {engine ? (
          <p
            data-next-year-table=""
            aria-hidden="true"
            className="mt-2 text-micro leading-[1.35] text-(--sh-text-3) max-sm:hidden sm:min-h-8 md:min-h-4 lg:min-h-[1.0625rem]"
          >
            {shown ? lineText(shownKey, shown) : null}
          </p>
        ) : null}
        {engine && pinnedLine ? (
          <p
            key={revealed.pinned}
            data-next-year-table=""
            aria-hidden="true"
            className="mt-2 text-micro leading-[1.35] text-(--sh-text-3) sm:hidden"
          >
            {lineText(revealed.pinned, pinnedLine)}
          </p>
        ) : null}
      </DisclosureRow>

      {children}

      {record ? (
        <DisclosureRow
          label="Track record"
          metaLong={record.thin ? null : record.since && record.until ? `${record.since}–${record.until}` : null}
          meta={record.thin ? null : record.noEdge ? "no edge over the usual rate" : null}
        >
          <div className="max-w-[54rem] space-y-2.5 text-meta leading-relaxed text-(--sh-text-2)">
            {record.thin ? (
              <p>{record.thin}</p>
            ) : (
              record.lines.map((line, index) => (
                <p
                  key={line}
                  className={index === record.lines.length - 1 ? "text-(--sh-text-3)" : undefined}
                >
                  {line}
                </p>
              ))
            )}
          </div>
        </DisclosureRow>
      ) : null}

      <DisclosureRow label="Method & limits">
        {engine ? (
          <>
            <ul className="space-y-2.5">
              {notes.map((note) => (
                <li
                  key={note}
                  className="flex gap-2 text-meta leading-relaxed text-black/60 dark:text-white/60"
                >
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#f05d49]" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 border-t border-black/5 pt-3 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
              Engine {engine.version} · as of {formatDate(engine.as_of)} · Descriptive
              historical research. Not investment advice.
            </p>
          </>
        ) : (
          <p className="text-meta text-(--sh-text-3)">—</p>
        )}
      </DisclosureRow>
    </div>
  );
}
