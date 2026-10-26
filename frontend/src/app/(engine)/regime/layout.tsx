import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Regime Intelligence";
const DESCRIPTION =
  "A 120-year atlas of US macro regimes: NBER recession windows, a long-run equity proxy and the StrikeHike 0–100 macro strength meter. Descriptive history, not a forecast.";

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
