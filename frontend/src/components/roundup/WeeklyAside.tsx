import Link from "next/link";
import { DigestSignupGate } from "@/components/digest/DigestSignupGate";
import type { LedgerEntry } from "@/lib/ledger/store";
import { shortHash } from "@/lib/ledger/store";

type Surface = "this_week" | "footer";

const SECTIONS = [
  ["Regime", "the Core Index reading and how it moved"],
  ["Dates", "scheduled releases, central-bank decisions and festivals"],
  ["Sky", "eclipses, retrogrades and other sky events"],
] as const;

/**
 * The roundup pages' side column: the email signup (only when the digest is
 * on), what every roundup carries, and this week's ledger line. Sticky beside
 * the roundup from lg; below it on phones.
 */
export function WeeklyAside({
  surface,
  ledger,
}: {
  surface: Surface;
  ledger: LedgerEntry | null;
}) {
  return (
    <aside
      aria-label="The weekly roundup"
      data-weekly-aside
      className="mt-10 flex flex-col gap-4 lg:sticky lg:top-[calc(var(--sh-header-clear)+0.5rem)] lg:mt-0 lg:self-start"
    >
      <DigestSignupGate surface={surface} />

      <section className="rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-card) p-5">
        <h2 className="text-micro font-medium uppercase tracking-[0.18em] text-(--sh-text-3)">
          In every roundup
        </h2>
        <ul className="mt-3 space-y-2.5">
          {SECTIONS.map(([name, what]) => (
            <li key={name} className="text-meta leading-snug text-(--sh-text-2)">
              <span className="font-semibold text-(--sh-text-1)">{name}</span>
              {" · "}
              {what}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-(--sh-line-1) pt-3 text-micro leading-relaxed text-(--sh-text-3)">
          Each approved roundup is recorded in the public{" "}
          <Link
            href={ledger ? `/ledger#${ledger.seq}` : "/ledger"}
            className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            ledger
          </Link>
          {ledger ? ` (#${ledger.seq} · ${shortHash(ledger.hash)})` : ""}, so
          past weeks can&apos;t be quietly edited.{" "}
          <a
            href="/this-week/rss.xml"
            className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            RSS
          </a>
        </p>
      </section>
    </aside>
  );
}
