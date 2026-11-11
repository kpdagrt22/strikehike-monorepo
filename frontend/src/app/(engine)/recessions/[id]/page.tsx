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
  findRecession,
  recessionFacts,
  recessionIndexable,
  recessionPath,
  recessionsComplete,
} from "@/lib/reference/reference";
import { getRegimeAtlas } from "@/lib/seo/data";
import { referenceDetailGraph } from "@/lib/seo/graphs";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

async function load(id: string) {
  const atlas = await getRegimeAtlas().catch(() => null);
  if (!recessionsComplete(atlas)) return null;
  const crash = findRecession(atlas, id);
  if (!crash) return null;
  return { atlas: atlas!, crash, facts: recessionFacts(atlas!, crash) };
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) {
    return { title: "Recession not found", robots: { index: false, follow: true } };
  }
  const { crash, facts } = loaded;
  const path = recessionPath(crash.id);
  const title = `${crash.name} · NBER recession · ${SITE_NAME}`;
  const description = `${crash.name}, ${formatDate(crash.start)} to ${formatDate(
    crash.end,
  )} (${facts.length} days)${
    facts.drawdown == null
      ? ""
      : `, with an S&P fall of ${formatPercent(facts.drawdown, 1)} inside the window`
  }.`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    robots: recessionIndexable(facts)
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

export default async function RecessionPage({ params }: Params) {
  const { id } = await params;
  const loaded = await load(id);
  if (!loaded) notFound();
  const { atlas, crash, facts } = loaded!;
  const path = recessionPath(crash.id);
  const sorted = atlas.crashes
    .slice()
    .sort((left, right) => left.start.localeCompare(right.start));
  const index = sorted.findIndex((item) => item.id === crash.id);
  const previous = index > 0 ? sorted[index - 1] : null;
  const next = index >= 0 && index < sorted.length - 1 ? sorted[index + 1] : null;
  const asOf = atlas.as_of?.slice(0, 10) ?? crash.end;

  return (
    <PageShell data-reference-detail="recession">
      <RecentTracker kind="recession" id={crash.id} title={crash.name} />
      <JsonLd
        data={referenceDetailGraph({
          path,
          name: crash.name,
          description: `${crash.name}, ${crash.start} to ${crash.end}.`,
          dateModified: asOf,
          start: crash.start,
          end: crash.end,
          crumbs: [
            { name: "StrikeHike", path: "/" },
            { name: "Regime", path: "/regime" },
            { name: "NBER recessions", path: "/recessions" },
            { name: crash.name, path },
          ],
        })}
      />

      <nav aria-label="Breadcrumb" className="text-micro text-(--sh-text-3)">
        <Link href="/" className="hover:text-(--sh-text-1)">StrikeHike</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/regime" className="hover:text-(--sh-text-1)">Regime</Link>
        <span aria-hidden="true"> / </span>
        <Link href="/recessions" className="hover:text-(--sh-text-1)">NBER recessions</Link>
        <span aria-hidden="true"> / </span>
        <span>{crash.name}</span>
      </nav>

      <header className="mt-4 max-w-[760px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          NBER recession
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          {crash.name}
        </h1>
        <p className="mt-3 text-body text-(--sh-text-2)">
          {formatDate(crash.start)} → {formatDate(crash.end)}
          {facts.length == null ? null : ` · ${formatNumber(facts.length)} days`}
          {crash.date_precision ? ` · ${crash.date_precision}-precise` : null}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ShareButton
            surface="recession"
            url={urlFor(path)}
            title={crash.name}
          />
          <Link
            href={`/regime?d=${crash.start}`}
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-2) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover)"
          >
            Open on the Regime chart
          </Link>
          <Link
            href={`/?d=${crash.start}`}
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1)"
          >
            Open the Orrery at this date
          </Link>
        </div>
      </header>

      <div className="mt-6 grid max-w-[760px] gap-3 sm:grid-cols-2">
        <Card
          label="S&P fall in the window"
          value={facts.drawdown == null ? "Not in the price series" : formatPercent(facts.drawdown, 1)}
          detail={
            facts.peakDate && facts.troughDate
              ? `${formatDate(facts.peakDate)} → ${formatDate(facts.troughDate)}`
              : undefined
          }
        />
        <Card
          label="Core Index low"
          value={facts.coreLow == null ? "Not yet scored" : formatSigned(facts.coreLow)}
          detail={facts.coreLow == null ? "The index starts at the end of 1928." : "Lowest weekly reading inside the window."}
        />
      </div>

      <section aria-labelledby="core-path" className="mt-8 max-w-[760px]">
        <h2 id="core-path" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
          Core Index path
        </h2>
        <p className="mt-1 text-micro leading-relaxed text-(--sh-text-3)">
          Six months before the window, through it, to six months after.
        </p>
        <div className="mt-3">
          <ReferenceSparkline
            points={facts.corePath}
            start={crash.start}
            end={crash.end}
            label={`Core Index from six months before ${crash.name} to six months after`}
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
              label: "Six months before",
              point: facts.before,
              change: facts.beforeChange,
              changeLabel: "to the window start",
            },
            {
              label: "Six months after",
              point: facts.after,
              change: facts.afterChange,
              changeLabel: "from the window end",
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

      <nav aria-label="Other NBER windows" className="mt-8 flex max-w-[760px] flex-wrap items-center justify-between gap-3 border-t border-(--sh-line-1) pt-4 text-micro">
        {previous ? (
          <Link
            href={recessionPath(previous.id)}
            className="inline-flex min-h-9 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            ← {previous.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link
            href={recessionPath(next.id)}
            className="inline-flex min-h-9 items-center text-(--sh-text-2) underline decoration-current/30 underline-offset-2 hover:text-(--sh-text-1) hover:decoration-current"
          >
            {next.name} →
          </Link>
        ) : (
          <span />
        )}
      </nav>

      <SiteColophon current="/recessions" />
    </PageShell>
  );
}
