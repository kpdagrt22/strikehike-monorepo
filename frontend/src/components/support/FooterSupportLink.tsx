"use client";

import { supportLinkClicked, supportOpened } from "@/lib/analytics/events";
import { PAYPAL_URL } from "@/lib/support/copy";

// The footer's only support affordance is this link, so it reports the same
// pair the home panel does: the support action and the link click, both with
// surface "footer".
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
      onClick={() => {
        supportOpened("footer_link", "footer");
        supportLinkClicked("paypal", "footer");
      }}
      className={className}
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
