import Link from "next/link";
import type { ReactNode } from "react";
import { WeeklyAside } from "@/components/roundup/WeeklyAside";
import type { LedgerEntry } from "@/lib/ledger/store";
import { shortHash } from "@/lib/ledger/store";

/**
 * The two roundup pages share one frame: the roundup on the left, the weekly
 * column (signup, what each roundup carries, the ledger) on the right from lg,
 * and below the roundup on phones.
 */
export function RoundupLayout({
  children,
  ledger,
  surface,
}: {
  children: ReactNode;
  ledger: LedgerEntry | null;
  surface: "this_week" | "footer";
}) {
  return (
    <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0">
        {children}
        {ledger ? (
          <p data-ledger-line className="mt-6 max-w-[760px] border-t border-(--sh-line-1) pt-4 text-micro text-(--sh-text-3)">
            Approved roundup ·{" "}
            <Link
              href={`/ledger#${ledger.seq}`}
              className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
            >
              Ledger #{ledger.seq} · {shortHash(ledger.hash)}
            </Link>
          </p>
        ) : null}
      </div>
      <WeeklyAside surface={surface} ledger={ledger} />
    </div>
  );
}
