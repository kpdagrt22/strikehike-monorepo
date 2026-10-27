import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Convergence";
const DESCRIPTION =
  "Side-by-side macro and crypto event comparison: Core Index regime, asset drawdowns and the Sun / Moon / Saturn ephemeris at each peak.";

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
