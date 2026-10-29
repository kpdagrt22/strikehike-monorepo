import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Convergence";
const DESCRIPTION =
  "Side-by-side comparison of market declines since 1871: the fall from each peak, the Core Index or macro strength on the same days, and the Sun / Moon / Saturn ephemeris at each peak.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/convergence",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://strikehike.com/convergence",
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

export default function ConvergenceLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
