import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { ReferenceSparkline } from "@/components/reference/ReferenceSparkline";
import { ShareButton } from "@/components/reference/ShareButton";
import { JsonLd } from "@/components/seo/JsonLd";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { RecentTracker } from "@/components/retention/RecentTracker";
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatSigned,
} from "@/components/regime/regimeUtils";
import {
  declineFacts,
  declineIndexable,
  declinePath,
  declinesComplete,
  findDecline,
  trendRecord,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";
import { referenceDetailGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  const atlas = await getRegimeAtlas().catch(() => null);
  if (!declinesComplete(atlas?.meta)) return null;
  const fall = findDecline(atlas?.meta, id);
  if (!fall) return null;
  return {
    atlas: atlas!,
    record: trendRecord(atlas?.meta)!,
    fall,
    facts: declineFacts(atlas, fall),
  };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) {
    return { title: "Decline not found", robots: { index: false, follow: true } };
  }
  const { fall, facts } = loaded;
  const path = declinePath(fall.id);
  const title = `${fall.name} · S&P fall · ${SITE_NAME}`;
  const description = `${fall.name}: the S&P 500 fell ${formatPercent(
    -facts.drawdown,
    0,
  )} from ${formatDate(fall.peak)} to ${formatDate(fall.low)}. The trend warning's first-20% record is shown.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: declineIndexable(facts)
      ? { index: true, follow: true }
      : { index: false, follow: true },
    openGraph: {
      type: "article",
      locale: "en_IN",
      alternateLocale: ["en_US"],
      siteName: SITE_NAME,
      url: urlFor(path),
      title,
      description,
    },
    twitter: { card: "summary_large_image", title, description },
  };
}

function Card({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-4">
      <p className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
        {label}
      </p>
      <p className="mt-1.5 font-mono text-xl font-medium tracking-[-0.03em] text-(--sh-text-1)">
        {value}
      </p>
      {detail ? <p className="mt-1 text-micro text-(--sh-text-3)">{detail}</p> : null}
    </div>
  );
}

export default async function DeclinePage({ params }: Params) {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) notFound();
  const { atlas, record, fall, facts } = loaded!;
  const path = declinePath(fall.id);
  const index = record.falls.findIndex((item) => item.id === fall.id);
  const previous = index > 0 ? record.falls[index - 1] : null;
  const next =
    index >= 0 && index < record.falls.length - 1
      ? record.falls[index + 1]
      : null;
  const asOf = atlas.as_of?.slice(0, 10) ?? fall.low;

  return (
    <PageShell data-reference-detail="decline">
      <RecentTracker kind="decline" id={fall.id} title={fall.name} />
      <JsonLd
        data={referenceDetailGraph({
          path,
          name: fall.name,
          description: `${fall.name}: S&P 500 fall from ${fall.peak} to ${fall.low}.`,
          dateModified: asOf,
          start: fall.peak,
          end: fall.low,
          crumbs: [
            { name: "StrikeHike", path: "/" },
            { name: "Regime", path: "/regime" },
            { name: "20% S&P falls", path: "/declines" },
            { name: fall.name, path },
          ],
        })}
      />

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/regime" className="hover:text-(--sh-text-1)">Regime</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/declines" className="hover:text-(--sh-text-1)">20% S&amp;P falls</Link>
        <span aria-hidden="true"> / </span>
        <span>{fall.name}</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          S&amp;P fall
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          {fall.name}
        </h1>
        <p className="mt-3 text-body text-(--sh-text-2)">
          {formatDate(fall.peak)} → {formatDate(fall.low)}
          {facts.length == null ? null : ` · ${formatNumber(facts.length)} days`}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ShareButton surface="decline" url={urlFor(path)} title={fall.name} />
          <Link
            href={`/regime?d=${fall.peak}`}
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover)"
          >
            Open on the Regime chart
          </Link>
          <Link
            href={`/?d=${fall.peak}`}
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            Open the Orrery at this date
          </Link>
        </div>
      </header>

      <div className="mt-6 grid max-w-[760px] gap-3 sm:grid-cols-3">
        <Card label="S&P fall" value={formatPercent(facts.drawdown, 0)} />
        <Card
          label="Length"
          value={facts.length == null ? "—" : `${formatNumber(facts.length)} days`}
        />
        <Card
          label="Core Index low"
          value={facts.coreLow == null ? "Not yet scored" : formatSigned(facts.coreLow)}
          detail={facts.coreLow == null ? "The index starts at the end of 1928." : "Lowest weekly reading in the fall."}
        />
      </div>

      <section aria-labelledby="warning-record" className="mt-8 max-w-[760px]">
        <h2 id="warning-record" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
          Trend warning record
        </h2>
        <div className="mt-3 rounded-2xl border border-(--sh-line-1) p-4">
          <p className="text-meta font-medium text-(--sh-text-1)">
            {fall.within_first_20pct
              ? "The warning was on before the first 20% of the fall."
              : "The warning came later than the first 20% of the fall."}
          </p>
          <p className="mt-1 text-micro leading-relaxed text-(--sh-text-3)">
            Method &amp; record counts this among the{" "}
            {fall.within_first_20pct ? "hits" : "misses"} as it defines them:
            a warning on before the first Friday whose close had done a fifth of
            the eventual fall.
          </p>
          <dl className="mt-4 grid gap-x-4 gap-y-3 text-micro sm:grid-cols-2">
            <div>
              <dt className="text-(--sh-text-3)">First warning</dt>
              <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                {fall.first_warning ? formatDate(fall.first_warning) : "No warning in the fall"}
              </dd>
            </div>
            <div>
              <dt className="text-(--sh-text-3)">Warning on since</dt>
              <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                {fall.warning_on_since ? formatDate(fall.warning_on_since) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-(--sh-text-3)">S&amp;P down then</dt>
              <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                {fall.down_then == null ? "—" : formatPercent(fall.down_then * 100, 0)}
              </dd>
            </div>
            <div>
              <dt className="text-(--sh-text-3)">Warnings before the 20% mark</dt>
              <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                {fall.warnings_before_20pct_mark ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-(--sh-text-3)">Left on from the previous decline</dt>
              <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                {fall.left_on_from_the_decline_before ? "Yes" : "No"}
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="core-path" className="mt-8 max-w-[760px]">
        <h2 id="core-path" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
          Core Index path
        </h2>
        <p className="mt-1 text-micro leading-relaxed text-(--sh-text-3)">
          Six months before the fall, through it, to six months after.
        </p>
        <div className="mt-3">
          <ReferenceSparkline
            points={facts.corePath}
            start={fall.peak}
            end={fall.low}
            label={`Core Index from six months before ${fall.name} to six months after`}
          />
        </div>
      </section>

      <section aria-labelledby="before-after" className="mt-8 max-w-[760px]">
        <h2 id="before-after" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
          Before and after
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            {
              label: "Six months before the peak",
              point: facts.before,
              change: facts.beforeChange,
              changeLabel: "to the peak",
            },
            {
              label: "Six months after the low",
              point: facts.after,
              change: facts.afterChange,
              changeLabel: "from the low",
            },
          ].map((entry) => (
            <div key={entry.label} className="rounded-2xl border border-(--sh-line-1) p-4">
              <p className="text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-3)">
                {entry.label}
              </p>
              <p className="mt-1 text-meta text-(--sh-text-2)">
                {entry.point ? formatDate(entry.point.date) : "No observation"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-micro">
                <div>
                  <dt className="text-(--sh-text-3)">Core Index</dt>
                  <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                    {formatSigned(entry.point?.core_index)}
                  </dd>
                </div>
                <div>
                  <dt className="text-(--sh-text-3)">S&amp;P proxy</dt>
                  <dd className="mt-0.5 font-mono text-(--sh-text-1)">
                    {formatNumber(entry.point?.sp500_proxy, 2)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 border-t border-(--sh-line-1) pt-2 text-micro text-(--sh-text-3)">
                {entry.change == null
                  ? "S&P change unavailable"
                  : `${formatPercent(entry.change, 1)} ${entry.changeLabel}`}
              </p>
            </div>
          ))}
        </div>
      </section>

      <nav aria-label="Other 20% falls" className="mt-8 flex max-w-[760px] flex-wrap items-center justify-between gap-3 border-t border-(--sh-line-1) pt-4 text-micro">
        {previous ? (
          <Link
            href={declinePath(previous.id)}
            className="inline-flex min-h-9 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            ← {previous.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={declinePath(next.id)}
            className="inline-flex min-h-9 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            {next.name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <SiteColophon current="/declines" />
    </PageShell>
  );
}
