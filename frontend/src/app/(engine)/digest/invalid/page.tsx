import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: `Link not valid — ${SITE_NAME}` },
  robots: { index: false, follow: false },
};

export default function InvalidPage() {
  return (
    <PageShell>
      <div className="max-w-[640px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Weekly email
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          This link is invalid or has expired.
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          Confirmation links last 48 hours. Request a new one from the weekly
          email form; unsubscribe links do not expire.
        </p>
        <p className="mt-4 text-micro">
          <Link
            href="/this-week#weekly-email"
            className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            Request a new confirmation
          </Link>
        </p>
      </div>
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
