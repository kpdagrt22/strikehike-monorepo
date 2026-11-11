import { MARKET_FLAGS, sourcePeriods } from "@/components/regime/regimeChart";
import { formatDate } from "@/components/regime/regimeUtils";

const CORE_INDEX_NOTE =
  "Core Index v2 is a weekly trend-and-stress state machine: the equity proxy against its 40-week average and its own volatility, with credit spreads, unemployment and the yield curve as stress inputs, each lagged by its publication delay; it is decided at the Friday close and starts at the end of 1928.";
const BAND_NOTE =
  "The Core Index is a descriptive sentiment map: +25 begins the Risk elevated band; -25 begins the Maximum fear band.";
const SPLICE_NOTE =
  "The chart joins the Cowles index to the S&P 90 at 30 Dec 1927 for display only; the two indices' levels do not compare across that date.";

const isNumber = (value) => typeof value === "number" && Number.isFinite(value);

function monthOf(value) {
  const text = formatDate(value);
  return text === "—" ? null : text.slice(3);
}

function shareOf(value) {
  const percent = value * 100;
  return `${percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

function flagLabel(field) {
  const flag = MARKET_FLAGS.find((item) => item.field === field);
  return `${flag.label}: ${flag.text}.`;
}

function recordPassage(record, { define = false } = {}) {
  const falls = record?.falls_of_20pct_or_more;
  const count = falls?.count;
  const hits = falls?.on_within_first_20pct ?? falls?.within_first_20pct;
  const misses = falls?.not_within_first_20pct;
  const rates = record?.false_alarms_per_decade;
  if (![count, hits, misses, rates?.all].every(isNumber)) return null;
  const kinds = [];
  if (isNumber(falls.during_the_fall) && isNumber(falls.before_the_peak_only)) {
    kinds.push(
      `${falls.during_the_fall} during the fall`,
      `${falls.before_the_peak_only} only before the peak`,
    );
  }
  if (falls.left_on_from_the_decline_before > 0) {
    kinds.push(
      `${falls.left_on_from_the_decline_before} of them only because it was still on from the decline before`,
    );
  }
  const eras = Object.entries(rates)
    .filter(([key, value]) => key !== "all" && isNumber(value))
    .map(([key, value]) => `${value.toFixed(1)} in ${key.replace("-", "–")}`);
  const from = monthOf(record.measured_on?.first_week ?? record.measured_on?.first_day);
  const to = monthOf(record.measured_on?.last_week ?? record.measured_on?.last_day);
  const weeksOn = record.share_of_weeks_on?.all;
  const daysOn = record.share_of_days_on?.all;
  const definition = define ? record.definitions?.false_alarm : null;
  return [
    from && to ? `Its record, ${from} to ${to}: it` : "Its record: it",
    ` came on before the market had done a fifth of the fall in ${hits} of the ${count} falls of 20% or more`,
    kinds.length ? ` (${kinds.join(", ")})` : "",
    ` and later than that in ${misses} of ${count}; it gave ${rates.all.toFixed(1)} false warnings a decade`,
    eras.length ? ` (${eras.join(", ")})` : "",
    isNumber(weeksOn)
      ? ` and was on in ${shareOf(weeksOn)} of weeks.`
      : isNumber(daysOn)
        ? ` and was on ${shareOf(daysOn)} of days.`
        : ".",
    definition ? ` A false warning is ${definition}.` : "",
    " A historical record, not a forecast.",
  ].join("");
}

function trendNote(trend) {
  if (!trend) return null;
  const rule = isNumber(trend.weeks)
    ? ` It is on when the S&P 500's (the S&P 90's before March 1957) Friday close is below the average of its last ${trend.weeks} Friday closes: a textbook rule${
        trend.fitted === false ? ", not fitted to this history" : ""
      }, chosen after seeing its record${
        trend.changes_core_index === false
          ? ", and shown beside the Core Index without changing it"
          : ""
      }.`
    : "";
  const record = recordPassage(trend.record, { define: true });
  return `${flagLabel("core_index_trend_warning")}${rule}${record ? ` ${record}` : ""}`;
}

function fastNote(fast) {
  if (!fast) return null;
  const rule =
    isNumber(fast.drop) && isNumber(fast.days)
      ? ` It is on when the S&P 500 (the S&P 90 before March 1957) closes ${Math.round(fast.drop * 100)}% or more below its close ${fast.days} calendar days earlier, decided at each close (a week shows it if it was on any day): a reaction to a sharp fall, chosen after seeing this history${
          fast.changes_core_index === false
            ? ", and shown beside the Core Index without changing it"
            : ""
        }.`
      : "";
  const record = recordPassage(fast.record);
  return `${flagLabel("core_index_fast_warning")}${rule}${record ? ` ${record}` : ""}`;
}

/** The body of Method & record. A Server Component: it stays in the HTML but is not hydrated. */
export function MethodDetailsBody({ meta }) {
  const notes = Array.isArray(meta?.notes) ? meta.notes : [];
  const sources = sourcePeriods([
    ...(Array.isArray(meta?.proxy_sources) ? meta.proxy_sources : []),
    ...(meta?.assets?.nifty
      ? [
          {
            source: meta.assets.nifty.source ?? "YAHOO_FINANCE_NSEI",
            start: meta.assets.nifty.first_observation,
            end: meta.assets.nifty.last_observation,
          },
        ]
      : []),
  ]);
  const firstScored = monthOf(meta?.core_index_first_scored);
  const severities = (
    Array.isArray(meta?.core_index_severities) ? meta.core_index_severities : []
  ).filter((name) => name !== "none");
  const v2Index = notes.findIndex(
    (note) => typeof note === "string" && note.startsWith("Core Index v2"),
  );
  const allNotes = [
    v2Index >= 0 ? notes[v2Index] : CORE_INDEX_NOTE,
    BAND_NOTE,
    "Every NBER window carries its own drawdown and Core Index low; select one under the chart to zoom to it.",
    "Compare the S&P 500, gold, Treasuries and Nifty 50 on one percentage scale.",
    `${firstScored ? `Every weekly reading from ${firstScored} is shown. ` : ""}The rules were designed and tuned on the years from 1971 on, so 1929–71 served as the out-of-sample test, and few stress inputs existed before 1953.`,
    `Severity, shown as the decline class${
      severities.length > 1
        ? ` (${severities.slice(0, -1).join(", ")} or ${severities.at(-1)})`
        : ""
    }, is the class a decline has reached in the current spell. It only steps up within a spell, so it can still read crash in a recovery; in Maximum fear it is the class of the decline being measured. A warning can show while Steady or Risk elevated; it does not change the band.`,
    trendNote(meta?.core_index_trend_warning),
    fastNote(meta?.core_index_fast_warning),
    ...notes.filter((_, index) => index !== v2Index),
  ].filter(Boolean);

  return (
    <>
      <div className="mt-4 grid gap-5 sm:grid-cols-[1.15fr_0.85fr]">
        <ul className="space-y-2.5">
          {allNotes.map((note, index) => (
            <li
              key={`${index}-${note}`}
              className="flex gap-2 text-meta leading-relaxed text-black/60 dark:text-white/60"
            >
              <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[#f05d49]" />
              <span>{note}</span>
            </li>
          ))}
        </ul>
        <div>
          <p className="text-micro uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
            Asset proxy sources
          </p>
          <ul className="mt-2 space-y-1.5">
            {sources.map((source) => (
              <li
                key={`${source.source}-${source.start}`}
                title={source.source}
                className="text-micro text-black/60 dark:text-white/60"
              >
                {source.label} ·{" "}
                <span className="font-mono">
                  {formatDate(source.start)} → {formatDate(source.end)}
                </span>
              </li>
            ))}
          </ul>
          {sources.some((source) => source.source === "M1125AUSM343NNBR") ? (
            <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
              {SPLICE_NOTE}
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-4 border-t border-black/5 pt-3 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60">
        Data version {meta?.data_version ?? "—"} ·{" "}
        {meta?.core_index_version ?? meta?.strength_version ?? "—"} · Source
        FRED, World Bank, Blockchain.com, Yahoo Finance. Descriptive historical
        research. Not investment advice.
      </p>
    </>
  );
}
