import type { Metadata } from "next";
import Link from "next/link";
import { PageShell } from "@/components/PageShell";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { UnsubscribeButton } from "@/components/digest/UnsubscribeButton";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: `Unsubscribe — ${SITE_NAME}` },
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ t?: string | string[] }>;
};

export default async function UnsubscribePage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : "";
  return (
    <PageShell>
      <div className="max-w-[640px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Weekly email
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          Unsubscribe from the weekly email?
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          One click removes this address. No further weekly emails are sent.
        </p>
        <UnsubscribeButton token={token} />
        <p className="mt-4 text-micro">
          <Link
            href="/this-week"
            className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            Keep the subscription and return to this week
          </Link>
        </p>
      </div>
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
