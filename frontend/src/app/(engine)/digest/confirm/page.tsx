import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { SITE_NAME } from "@/lib/seo/site";

export const metadata: Metadata = {
  title: { absolute: `Confirm subscription · ${SITE_NAME}` },
  robots: { index: false, follow: false },
};

type Props = {
  searchParams: Promise<{ t?: string | string[] }>;
};

export default async function ConfirmPage({ searchParams }: Props) {
  const params = await searchParams;
  const token = typeof params.t === "string" ? params.t : "";
  if (!token) redirect("/digest/invalid");

  return (
    <PageShell>
      <div className="max-w-[640px]">
        <p className="text-micro uppercase tracking-[0.2em] text-(--sh-signal-ink)">
          Weekly email
        </p>
        <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-(--sh-text-1) sm:text-5xl">
          Confirm your weekly email.
        </h1>
        <p className="mt-3 text-body leading-relaxed text-(--sh-text-2)">
          One button confirms the subscription. The link lasts 48 hours. If you
          did not ask for this, close this page and ignore the email.
        </p>
        <form
          method="post"
          action={`/api/digest/confirm?t=${encodeURIComponent(token)}`}
          className="mt-4"
        >
          <button
            type="submit"
            data-digest-confirm
            className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover)"
          >
            Confirm subscription
          </button>
        </form>
        <p className="mt-4 text-micro">
          <Link
            href="/this-week"
            className="underline decoration-current/30 underline-offset-2 hover:decoration-current"
          >
            Not now; return to this week
          </Link>
        </p>
      </div>
      <SiteColophon current="/this-week" />
    </PageShell>
  );
}
