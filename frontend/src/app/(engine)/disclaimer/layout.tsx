import type { Metadata } from "next";
import type { ReactNode } from "react";

const TITLE = "Disclaimer";
const DESCRIPTION =
  "StrikeHike is descriptive historical research with astronomical context, not investment advice and not a forecast.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: "/disclaimer",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://strikehike.com/disclaimer",
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

export default function DisclaimerLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
