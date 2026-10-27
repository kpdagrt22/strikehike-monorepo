import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Regime Intelligence";
const DESCRIPTION =
  "A 170-year atlas of US macro regimes: NBER recession windows, the Core Index -50 to +50 contrarian sentiment composite, and S&P 500, gold, Treasury and Nifty 50 comparison. Descriptive history, not a forecast.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/regime",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://strikehike.com/regime",
    siteName: "StrikeHike",
    title: `${TITLE} | StrikeHike`,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: `${TITLE} | StrikeHike`,
    description: DESCRIPTION,
  },
};

export default function RegimeLayout({ children }: { children: ReactNode }) {
  return children;
}
