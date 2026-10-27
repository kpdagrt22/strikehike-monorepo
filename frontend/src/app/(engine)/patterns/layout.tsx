import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Study of Patterns";
const DESCRIPTION =
  "A 120-year magazine-style comparison of markets, geopolitics, science and the structural patterns that repeat across centuries.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/patterns",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://strikehike.com/patterns",
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

export default function PatternsLayout({ children }: { children: ReactNode }) {
  return children;
}
