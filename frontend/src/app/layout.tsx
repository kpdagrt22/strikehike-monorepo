import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  display: "swap",
});

const SITE_URL = "https://strikehike.com";
const SITE_NAME = "StrikeHike";
const SITE_TITLE = "StrikeHike — Universal Chrono-Spatial Engine";
const SITE_DESCRIPTION =
  "A neutral, date-addressable index of time, volatility, and historical parallel.";
const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.png`,
        width: 512,
        height: 512,
      },
      description:
        "Publisher of the StrikeHike Universal Chrono-Spatial Engine, a research surface for market cycles, planetary geometry, and historical parallels.",
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: `${SITE_URL}/#contact`,
        availableLanguage: ["en-US", "en-IN"],
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: ["en-US", "en-IN"],
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE_URL}/#software`,
      name: "StrikeHike Universal Chrono-Spatial Engine",
      alternateName: "StrikeHike Chrono Engine",
      url: SITE_URL,
      description:
        "A date-addressable chrono-spatial engine that combines a 120-year ML index of market regimes and volatility with Swiss Ephemeris planetary geometry. It returns deep historical parallels and recent manifestations for any date from 1900 to 2035.",
      applicationCategory: "FinanceApplication",
      applicationSubCategory:
        "Financial astrology, market history, and historical event parallels",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript and WebGL",
      isAccessibleForFree: true,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
      publisher: { "@id": `${SITE_URL}/#organization` },
      audience: {
        "@type": "Audience",
        audienceType:
          "Investors, market researchers, historians, and astrology researchers",
      },
      keywords:
        "Universal Chrono-Spatial Engine, financial astrology, market cycles, historical parallels, Swiss Ephemeris, astro-finance, StrikeHike",
      featureList: [
        "Date-addressable planetary geometry for 1900–2035",
        "120-year ML market-regime and volatility index",
        "Dual-epoch historical and recent event parallels",
        "Interactive 3D orrery and historical timeline",
      ],
    },
  ],
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_TITLE,
    template: "%s | StrikeHike",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "Finance",
  classification: "Finance, Astrology, History",
  keywords: [
    "Universal Chrono-Spatial Engine",
    "financial astrology",
    "astro-finance",
    "market cycles",
    "historical parallels",
    "Swiss Ephemeris",
    "Lahiri sidereal",
    "market volatility",
    "StrikeHike",
  ],
  alternates: {
    canonical: "/",
    languages: {
      "en-US": "/",
      "en-IN": "/",
      "x-default": "/",
    },
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    url: SITE_URL,
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  verification: GOOGLE_SITE_VERIFICATION
    ? { google: GOOGLE_SITE_VERIFICATION }
    : undefined,
  other: {
    "geo.region": "IN",
    "geo.placename": "India",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={onest.variable} suppressHydrationWarning>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="strikehike-theme"
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
