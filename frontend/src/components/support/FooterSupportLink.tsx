import { PAYPAL_URL } from "@/lib/support/copy";

// The footer's only support affordance is this link, so it reports the same
// pair the home panel does: the support action and the link click, both with
// surface "footer". The link is a server component; the one EventActionTracker
// on the page records the click by delegation.
export function FooterSupportLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={PAYPAL_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-support-link="footer"
      data-support-action="paypal"
      className={className}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
