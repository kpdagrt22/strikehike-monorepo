import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { LedgerVerify } from "@/components/ledger/LedgerVerify";
import { SiteColophon } from "@/components/seo/SiteColophon";
import {
  readLedger,
  shortHash,
  signedReading,
  type LedgerEntry,
} from "@/lib/ledger/store";
import { SITE_NAME, urlFor } from "@/lib/seo/site";

export const dynamic = "force-dynamic";

const TITLE = "Ledger";
const DESCRIPTION =
  "A public, append-only record of the weekly StrikeHike roundups: the week, the reading, the publication time and a hash chain.";

export const metadata: Metadata = {
  title: { absolute: `${TITLE} · ${SITE_NAME}` },
  description: DESCRIPTION,
  alternates: { canonical: "/ledger" },
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    siteName: SITE_NAME,
    url: urlFor("/ledger"),
    title: `${TITLE} · ${SITE_NAME}`,
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: `${TITLE} · ${SITE_NAME}`, description: DESCRIPTION },
};

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function publishedDate(entry: LedgerEntry): string {
  const date = new Date(entry.published_at);
  return Number.isFinite(date.getTime()) ? DATE.format(date) : entry.published_at;
}

function Reading({ entry }: { entry: LedgerEntry }) {
  return (
    <span>
      {entry.kind === "correction" ? (
        <span className="mr-1 text-(--sh-text-3)">Corrected</span>
      ) : null}
      <span className="font-medium text-(--sh-text-1)">
        {signedReading(entry.reading.core_index)}
      </span>{" "}
      <span className="text-(--sh-text-2)">{entry.reading.label}</span>
    </span>
  );
}

export default async function LedgerPage() {
  let entries: LedgerEntry[] | null = null;
  try {
    entries = await readLedger();
  } catch {
    entries = null;
  }

  return (
    <PageShell>
      <header className="max-w-[820px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Published record
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          Ledger
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          The ledger starts at 2026-W46, the first approved roundup. It records
          what was published, not performance. Earlier weeks are not backfilled.
          Every new line carries the hash of the line before it, and a
          correction is a new line; old lines are never edited.
        </p>
        <LedgerVerify />
      </header>

      <section aria-labelledby="ledger-table-heading" className="mt-8 max-w-[1100px]">
        <h2 id="ledger-table-heading" className="sr-only">
          Published ledger
        </h2>
        {entries && entries.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-(--sh-line-1)">
            <table className="w-full table-fixed border-collapse text-left text-micro">
              <thead className="bg-(--sh-surface-card) text-(--sh-text-3)">
                <tr>
                  <th scope="col" className="w-[5.5rem] px-2 py-2 font-medium">
                    Week
                  </th>
                  <th scope="col" className="px-2 py-2 font-medium">
                    Reading
                  </th>
                  <th scope="col" className="hidden w-[7rem] px-2 py-2 font-medium sm:table-cell">
                    Published
                  </th>
                  <th scope="col" className="w-[7.5rem] px-2 py-2 font-medium">
                    Hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-(--sh-line-1)">
                {entries.map((entry) => (
                  <tr key={entry.seq} id={String(entry.seq)} className="align-top">
                    <td className="px-2 py-3 align-top">
                      <span className="block font-medium text-(--sh-text-1)">
                        {entry.week}
                      </span>
                      {entry.kind === "correction" ? (
                        <span className="mt-1 block text-[10px] leading-tight text-(--sh-text-3)">
                          Correction of #{entry.corrects_seq}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[10px] text-(--sh-text-3) sm:hidden">
                        {publishedDate(entry)}
                      </span>
                    </td>
                    <td className="px-2 py-3 align-top">
                      <Reading entry={entry} />
                      {entry.kind === "correction" && entry.reason ? (
                        <span className="mt-1 block text-[10px] leading-tight text-(--sh-text-3)">
                          {entry.reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-2 py-3 align-top text-(--sh-text-2) sm:table-cell">
                      <time dateTime={entry.published_at}>{publishedDate(entry)}</time>
                    </td>
                    <td className="px-2 py-3 align-top">
                      <details id={`hash-${entry.seq}`} className="group">
                        <summary className="cursor-pointer font-mono text-[11px] text-(--sh-text-1) underline decoration-current/30 underline-offset-2 hover:decoration-current">
                          {shortHash(entry.hash)}
                        </summary>
                        <code className="mt-1 block break-all font-mono text-[10px] leading-tight text-(--sh-text-3)">
                          {entry.hash}
                        </code>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-2xl border border-(--sh-line-1) p-4 text-meta text-(--sh-text-2)">
            {entries === null
              ? "The ledger file could not be read."
              : "No entries yet."}
          </p>
        )}
      </section>

      <section aria-labelledby="ledger-check-heading" className="mt-8 max-w-[820px]">
        <h2 id="ledger-check-heading" className="text-strong font-semibold tracking-[-0.02em] text-(--sh-text-1)">
          Check it yourself
        </h2>
        <p className="mt-1 text-meta leading-relaxed text-(--sh-text-2)">
          The button above recomputes the chain in this browser. To do the same
          outside it:
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-(--sh-line-1) bg-(--sh-surface-card) p-3 text-[11px] leading-relaxed text-(--sh-text-2)">
          <code>{`curl -s https://strikehike.com/ledger.jsonl -o ledger.jsonl
python -m astro_finance.ledger verify --path ledger.jsonl
sha256sum ledger.jsonl
curl -s https://strikehike.com/this-week/2026-W46/roundup.json | sha256sum`}</code>
        </pre>
        <p className="mt-2 text-micro leading-relaxed text-(--sh-text-3)">
          The first command downloads the same file this page reads. The second
          recomputes every line hash and every previous-hash link. The third
          records the whole-file hash, so a later copy can be compared with it.
          The fourth hashes the committed roundup file; it should equal the
          <code className="mx-1">roundup_sha256</code> in that week&apos;s ledger
          line.
        </p>
      </section>

      <p className="mt-6 max-w-[820px] text-micro text-(--sh-text-3)">
        <Link href="/this-week" className="underline decoration-current/30 underline-offset-2 hover:decoration-current">
          Read this week&apos;s roundup
        </Link>
      </p>
      <SiteColophon current="/ledger" />
    </PageShell>
  );
}
