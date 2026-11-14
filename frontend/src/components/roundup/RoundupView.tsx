import Link from "next/link";
import { LocalDateTime } from "@/components/upcoming/LocalDateTime";
import { ShareButton } from "@/components/reference/ShareButton";
import type {
  Roundup,
  RoundupDate,
  RoundupSkyItem,
} from "@/lib/roundup/store";
import { weekLabel, isoWeekOf } from "@/lib/roundup/week";
import { urlFor } from "@/lib/seo/site";

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function humanDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${
    MONTH[date.getUTCMonth()]
  } ${date.getUTCFullYear()}`;
}

function humanShortDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${
    MONTH[date.getUTCMonth()]
  }`;
}

// Signed, one decimal, with a true minus sign.
function signed(value: number) {
  const text = Math.abs(value).toFixed(1);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

function RoundupDateLine({
  event,
  className = "",
}: {
  event: RoundupDate;
  className?: string;
}) {
  const allDay = !event.start_time;
  return (
    <span className={className}>
      <LocalDateTime
        startDate={event.start_date}
        startTime={event.start_time}
        startUtc={event.start_utc ?? null}
        timezone={event.timezone ?? null}
        allDay={allDay}
        part="date"
      />
      {allDay ? null : (
        <>
          {" · "}
          <LocalDateTime
            startDate={event.start_date}
            startTime={event.start_time}
            startUtc={event.start_utc ?? null}
            timezone={event.timezone ?? null}
            allDay={false}
            part="time"
          />
        </>
      )}
    </span>
  );
}

function RoundupViewV1({
  roundup,
  heading,
}: {
  roundup: Roundup;
  heading: string;
}) {
  const path = `/this-week/${roundup.week}`;
  const readingDate = roundup.regime
    ? new Date(`${roundup.regime.as_of}T00:00:00Z`)
    : null;
  const readingWeek = roundup.regime
    ? isoWeekOf(roundup.regime.as_of)
    : null;
  const staleReading =
    readingDate && roundup.start
      ? (new Date(`${roundup.start}T00:00:00Z`).getTime() -
          readingDate.getTime()) /
          86_400_000 >
        7
      : false;
  return (
    <article data-roundup={roundup.week}>
      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/this-week" className="hover:text-(--sh-text-1)">This week</Link>
        <span aria-hidden="true"> / </span>
        <span>{roundup.week}</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="flex flex-wrap items-center gap-2 text-micro font-medium uppercase tracking-[0.2em] text-(--sh-weekly)">
          <span className="sh-weekly-dot" aria-hidden="true" />
          Weekly roundup
          <span className="rounded-full border border-(--sh-weekly-line) bg-(--sh-weekly-soft) px-2 py-0.5 text-[0.6875rem] tracking-[0.12em]">
            {roundup.week}
          </span>
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          {heading}
        </h1>
        <p className="mt-3 text-body text-(--sh-text-2)">
          {weekLabel(roundup.week)}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ShareButton
            surface="roundup"
            url={urlFor(path)}
            title={`This week: macro + sky, ${roundup.week}`}
          />
          <a
            href="/this-week/rss.xml"
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            RSS
          </a>
        </div>
      </header>

      {roundup.regime ? (
        <section
          aria-labelledby="roundup-regime"
          data-roundup-regime
          className="mt-8 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5"
        >
          <h2 id="roundup-regime" className="text-micro font-medium uppercase tracking-[0.18em] text-(--sh-text-3)">
            Regime · Core Index
          </h2>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[2.75rem] font-light leading-none tracking-[-0.04em] text-(--sh-text-1) tabular-nums">
              {signed(roundup.regime.score)}
            </span>
            <span className="rounded-full border border-(--sh-line-2) px-2.5 py-0.5 text-micro font-medium text-(--sh-text-1)">
              {roundup.regime.label}
            </span>
            {typeof roundup.regime.change === "number" ? (
              <span className="text-meta text-(--sh-text-2) tabular-nums">
                {signed(roundup.regime.change)} from the week before
              </span>
            ) : null}
          </p>
          <p className="mt-3 text-meta leading-relaxed text-(--sh-text-2)">
            Latest reading: week of{" "}
            {readingDate ? DATE.format(readingDate) : roundup.regime.as_of}
            {staleReading && readingWeek
              ? ` (from ${readingWeek}, before ${roundup.week})`
              : ""}
            .{" "}
            <Link
              href="/regime"
              className="whitespace-nowrap underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              Open the Regime chart
            </Link>
          </p>
        </section>
      ) : null}

      {!roundup.themes?.length && !roundup.sky?.length ? (
        <p data-roundup-quiet className="mt-4 max-w-[760px] text-meta leading-relaxed text-(--sh-text-3)">
          No scheduled dates or sky events fell inside this week, so this
          roundup is the Regime reading alone.{" "}
          <Link href="/upcoming" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
            See what comes next
          </Link>
          .
        </p>
      ) : null}

      {roundup.themes?.length ? (
        <section aria-labelledby="roundup-dates" className="mt-8 max-w-[760px]">
          <h2 id="roundup-dates" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Dates
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.dates}
          </p>
          <div className="mt-3 space-y-4">
            {roundup.themes.map((theme) => (
              <div key={theme.id}>
                <h3 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                  {theme.name}
                </h3>
                <ul className="mt-1">
                  {theme.events.map((event) => (
                    <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                      <Link
                        href={event.path}
                        className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                      >
                        {event.name}
                      </Link>
                      <RoundupDateLine
                        event={event}
                        className="ml-2 text-micro text-(--sh-text-3)"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {roundup.sky?.length ? (
        <section aria-labelledby="roundup-sky" className="mt-8 max-w-[760px]">
          <h2 id="roundup-sky" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Sky
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.sky}
          </p>
          <ul className="mt-2">
            {roundup.sky.map((event) => (
              <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                <Link
                  href={event.path}
                  className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                >
                  {event.name}
                </Link>
                <RoundupDateLine
                  event={event}
                  className="ml-2 text-micro text-(--sh-text-3)"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  );
}

function Sparkline({ points }: { points: { date: string; score: number }[] }) {
  const width = 180;
  const height = 44;
  const pad = 4;
  const values = points.map((point) => point.score);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  const step = points.length > 1 ? (width - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((point, index) => {
    const x = pad + step * index;
    const y = height - pad - ((point.score - low) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const label = `Last ${points.length} weekly readings: ${points
    .map(
      (point) =>
        `${DATE.format(new Date(`${point.date}T00:00:00Z`))} ${signed(point.score)}`,
    )
    .join(", ")}.`;
  return (
    <svg
      data-roundup-sparkline
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      className="h-11 w-44 text-(--sh-text-2)"
    >
      <title>{label}</title>
      <polyline
        points={coords.map(([x, y]) => `${x},${y}`).join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {coords.map(([x, y], index) => (
        <circle key={points[index].date} cx={x} cy={y} r="2" fill="currentColor" />
      ))}
    </svg>
  );
}

function SkyRow({ item }: { item: RoundupSkyItem }) {
  const startDate = item.at.slice(0, 10);
  const startTime = item.at.slice(11, 19);
  return (
    <li className="border-b border-(--sh-line-1) py-2 last:border-b-0">
      <Link
        href={item.path}
        className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
      >
        {item.label ?? `${item.body} event`}
      </Link>
      <span className="ml-2 text-micro text-(--sh-text-3)">
        <LocalDateTime
          startDate={startDate}
          startTime={startTime}
          startUtc={item.at}
          timezone="UTC"
          allDay={false}
          part="date"
        />
        {" · "}
        <LocalDateTime
          startDate={startDate}
          startTime={startTime}
          startUtc={item.at}
          timezone="UTC"
          allDay={false}
          part="time"
        />
      </span>
    </li>
  );
}

function RoundupHeader({
  roundup,
  heading,
}: {
  roundup: Roundup;
  heading: string;
}) {
  const path = `/this-week/${roundup.week}`;
  return (
    <header className="mt-4 max-w-[760px]">
      <p className="flex flex-wrap items-center gap-2 text-micro font-medium uppercase tracking-[0.2em] text-(--sh-weekly)">
        <span className="sh-weekly-dot" aria-hidden="true" />
        Weekly roundup
        <span className="rounded-full border border-(--sh-weekly-line) bg-(--sh-weekly-soft) px-2 py-0.5 text-[0.6875rem] tracking-[0.12em]">
          {roundup.week}
        </span>
      </p>
      <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
        {heading}
      </h1>
      <p className="mt-3 text-body text-(--sh-text-2)">{weekLabel(roundup.week)}</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <ShareButton
          surface="roundup"
          url={urlFor(path)}
          title={`This week: macro + sky, ${roundup.week}`}
        />
        <a
          href="/this-week/rss.xml"
          className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
        >
          RSS
        </a>
      </div>
    </header>
  );
}

function RoundupViewV2({
  roundup,
  heading,
}: {
  roundup: Roundup;
  heading: string;
}) {
  const readingDate = roundup.regime
    ? new Date(`${roundup.regime.as_of}T00:00:00Z`)
    : null;
  const readingWeek = roundup.regime
    ? isoWeekOf(roundup.regime.as_of)
    : null;
  const staleReading =
    readingDate && roundup.start
      ? (new Date(`${roundup.start}T00:00:00Z`).getTime() -
          readingDate.getTime()) /
          86_400_000 >
        7
      : false;
  const sky = roundup.sky_week_items ?? [];
  const next = roundup.next_two_weeks ?? [];
  const activity = roundup.activity;
  const quiet =
    !roundup.themes?.length &&
    !sky.length &&
    !activity &&
    !next.length &&
    !roundup.from_record;
  return (
    <article data-roundup={roundup.week} data-roundup-schema="2">
      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/this-week" className="hover:text-(--sh-text-1)">This week</Link>
        <span aria-hidden="true"> / </span>
        <span>{roundup.week}</span>
      </nav>

      <RoundupHeader roundup={roundup} heading={heading} />

      {roundup.regime ? (
        <section
          aria-labelledby="roundup-regime"
          data-roundup-regime
          className="mt-8 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5"
        >
          <h2 id="roundup-regime" className="text-micro font-medium uppercase tracking-[0.18em] text-(--sh-text-3)">
            Regime · Core Index
          </h2>
          <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-[2.75rem] font-light leading-none tracking-[-0.04em] text-(--sh-text-1) tabular-nums">
              {signed(roundup.regime.score)}
            </span>
            <span className="rounded-full border border-(--sh-line-2) px-2.5 py-0.5 text-micro font-medium text-(--sh-text-1)">
              {roundup.regime.label}
            </span>
            {typeof roundup.regime.change === "number" ? (
              <span className="text-meta text-(--sh-text-2) tabular-nums">
                {signed(roundup.regime.change)} from the week before
              </span>
            ) : null}
          </p>
          {roundup.regime.weekly && roundup.regime.weekly.length > 1 ? (
            <div className="mt-4 border-t border-(--sh-line-1) pt-3">
              <p className="text-micro text-(--sh-text-3)">Last {roundup.regime.weekly.length} weekly readings</p>
              <Sparkline points={roundup.regime.weekly} />
            </div>
          ) : null}
          <p className="mt-3 text-meta leading-relaxed text-(--sh-text-2)">
            Latest reading: week of{" "}
            {readingDate ? DATE.format(readingDate) : roundup.regime.as_of}
            {staleReading && readingWeek
              ? ` (from ${readingWeek}, before ${roundup.week})`
              : ""}
            .{" "}
            <Link
              href="/regime"
              className="whitespace-nowrap underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              Open the Regime chart
            </Link>
          </p>
        </section>
      ) : null}

      {quiet ? (
        <p data-roundup-quiet className="mt-4 max-w-[760px] text-meta leading-relaxed text-(--sh-text-3)">
          No scheduled dates or sky events fell inside this week, so this
          roundup is the Regime reading alone.{" "}
          <Link href="/upcoming" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
            See what comes next
          </Link>
          .
        </p>
      ) : null}

      {sky.length ? (
        <section aria-labelledby="roundup-sky" className="mt-8 max-w-[760px]">
          <h2 id="roundup-sky" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Sky this week
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.sky}
          </p>
          <ul data-roundup-sky className="mt-2">
            {sky.map((item) => (
              <SkyRow key={`${item.kind}-${item.body}-${item.at}`} item={item} />
            ))}
          </ul>
        </section>
      ) : null}

      {activity ? (
        <section
          aria-labelledby="roundup-activity"
          data-roundup-activity
          className="mt-8 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5"
        >
          <h2 id="roundup-activity" className="text-micro font-medium uppercase tracking-[0.18em] text-(--sh-text-3)">
            Sky activity
          </h2>
          <p className="mt-2 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.activity}
          </p>
          <p className="mt-2 text-micro text-(--sh-text-3)">
            Min {activity.min} · max {activity.max}
            {activity.peak_date
              ? ` · peak ${DATE.format(
                  new Date(`${activity.peak_date}T00:00:00Z`),
                )}`
              : ""}
            .
          </p>
          {activity.closest_past ? (
            <p
              data-roundup-closest-past
              className="mt-1 text-micro text-(--sh-text-3)"
            >
              Closest past sky to{" "}
              {humanShortDate(
                activity.closest_past.for_date ??
                  activity.peak_date ??
                  roundup.start,
              )}:{" "}
              <Link
                href={`/?d=${activity.closest_past.date}`}
                className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
              >
                {activity.closest_past.name}
              </Link>, {humanDate(activity.closest_past.date)}{" "}
              ({activity.closest_past.similarity_percent}% geometry match).
            </p>
          ) : null}
          <p className="mt-2 text-micro leading-relaxed text-(--sh-text-3)">
            {activity.note}
          </p>
        </section>
      ) : null}

      {roundup.themes?.length ? (
        <section aria-labelledby="roundup-dates" className="mt-8 max-w-[760px]">
          <h2 id="roundup-dates" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Dates
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.dates}
          </p>
          <div className="mt-3 space-y-4">
            {roundup.themes.map((theme) => (
              <div key={theme.id}>
                <h3 className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                  {theme.name}
                </h3>
                <ul className="mt-1">
                  {theme.events.map((event) => (
                    <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                      <Link
                        href={event.path}
                        className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                      >
                        {event.name}
                      </Link>
                      <RoundupDateLine
                        event={event}
                        className="ml-2 text-micro text-(--sh-text-3)"
                      />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {next.length ? (
        <section aria-labelledby="roundup-next" className="mt-8 max-w-[760px]">
          <h2 id="roundup-next" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
            Next two weeks
          </h2>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.lines?.next}
          </p>
          <ul data-roundup-next className="mt-2">
            {next.map((event) => (
              <li key={event.id} className="border-b border-(--sh-line-1) py-2 last:border-b-0">
                <Link
                  href={event.path}
                  className="text-body text-(--sh-text-1) underline decoration-transparent underline-offset-2 hover:decoration-current"
                >
                  {event.name}
                </Link>
                <RoundupDateLine
                  event={event}
                  className="ml-2 text-micro text-(--sh-text-3)"
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {roundup.from_record ? (
        <section
          aria-labelledby="roundup-record"
          data-roundup-record
          className="mt-8 max-w-[760px] rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5"
        >
          <h2 id="roundup-record" className="text-micro font-medium uppercase tracking-[0.18em] text-(--sh-text-3)">
            From the record
          </h2>
          <Link
            href={roundup.from_record.path}
            className="mt-2 block text-body font-medium text-(--sh-text-1) underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            {roundup.from_record.title}
          </Link>
          <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
            {roundup.from_record.result}
          </p>
        </section>
      ) : null}
    </article>
  );
}

export function RoundupView({
  roundup,
  heading = "This week: macro + sky",
}: {
  roundup: Roundup;
  heading?: string;
}) {
  return roundup.schema === 2 ? (
    <RoundupViewV2 roundup={roundup} heading={heading} />
  ) : (
    <RoundupViewV1 roundup={roundup} heading={heading} />
  );
}
