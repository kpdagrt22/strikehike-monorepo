import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import { PageViewTracker } from "@/components/analytics/PageViewTracker";
import { ThemeProvider } from "@/components/theme-provider";
import { HIDDEN_THEMES } from "@/lib/events/hidden";
import {
  APP_ID,
  ORG_ID,
  PAGES,
  PERSON_ID,
  PERSON_NAME,
  PERSON_SAME_AS,
  PERSON_URL,
  REPO_URL,
  SITE_NAME,
  SITE_URL,
  WEBSITE_ID,
} from "@/lib/seo/site";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  display: "swap",
});

const HOME = PAGES["/"];
const GOOGLE_SITE_VERIFICATION =
  process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION?.trim();

// The site-wide graph: who makes StrikeHike, who publishes it, the site and the app.
// Each page adds its own WebPage (and Dataset, BreadcrumbList) graph that points here by @id.
// No ratings or reviews, ever: the Software App rich result may flag their absence; that is accepted.
const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Person",
      "@id": PERSON_ID,
      name: PERSON_NAME,
      alternateName: "KP",
      url: PERSON_URL,
      sameAs: [...PERSON_SAME_AS],
    },
    {
      "@type": "Organization",
      "@id": ORG_ID,
      name: SITE_NAME,
      url: SITE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_URL}/icon.png?v=2`,
        width: 512,
        height: 512,
      },
      description:
        "Publisher of StrikeHike, a free research site that sets the US market and macro record beside the planetary sky, date by date.",
      founder: { "@id": PERSON_ID },
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        url: "https://thisiskp.in/consulting#enquire",
        availableLanguage: ["en-US", "en-IN"],
      },
    },
    {
      "@type": "WebSite",
      "@id": WEBSITE_ID,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: "StrikeHike Universal Chrono-Spatial Engine",
      description:
        "A free research site that sets the US market and macro record beside the planetary sky, date by date. Research, not investment advice.",
      inLanguage: "en",
      publisher: { "@id": ORG_ID },
      creator: { "@id": PERSON_ID },
    },
    {
      "@type": "WebApplication",
      "@id": APP_ID,
      name: "StrikeHike Universal Chrono-Spatial Engine",
      alternateName: ["StrikeHike", "StrikeHike Chrono Engine"],
      url: SITE_URL,
      description:
        "A date-addressable research engine that sets Swiss Ephemeris planetary positions (Lahiri sidereal) beside US market and macro history: a 3D orrery, every NBER recession since 1854, a weekly Core Index of US market trend and stress, a catalogue of market declines since 1871, and today's market beside its closest past setups. Descriptive history, not a forecast.",
      applicationCategory: "ReferenceApplication",
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
      creator: { "@id": PERSON_ID },
      author: { "@id": PERSON_ID },
      publisher: { "@id": ORG_ID },
      audience: {
        "@type": "Audience",
        audienceType: "market historians, researchers and students",
      },
      keywords:
        "market history, NBER recessions, stock market crashes, market declines, Core Index, S&P 500 history, Nifty 50, Bitcoin, gold, planetary positions, Swiss Ephemeris, financial astrology, StrikeHike",
      featureList: [
        "3D orrery of the Sun, Moon and planets by date (Swiss Ephemeris, Lahiri sidereal), with sign, nakshatra and retrograde state",
        "Archive of dated world events, and past and upcoming dates with similar planetary geometry",
        "US market and macro atlas with every NBER recession window since 1854",
        "Weekly Core Index of US market trend and stress on a −50 to +50 scale, with a trend warning",
        "Catalogue of market declines since 1871, compared side by side: US stocks, Nifty 50, Bitcoin, gold and Treasury bonds",
        "Study of Patterns: today's S&P 500 and Nifty 50 beside their closest past setups, and the 120-year mirror",
      ],
    },
    {
      "@type": "SoftwareSourceCode",
      "@id": `${SITE_URL}/#source`,
      name: "strikehike-monorepo",
      codeRepository: REPO_URL,
      programmingLanguage: ["TypeScript", "JavaScript", "Python"],
      author: { "@id": PERSON_ID },
      targetProduct: { "@id": APP_ID },
    },
  ],
};

// Site-wide defaults. No `alternates` and no openGraph `url` here: each page sets its own
// canonical and og:url (lib/seo/site.ts pageMetadata), so the 404 claims no URL.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: HOME.title,
    template: "%s — StrikeHike",
  },
  description: HOME.description,
  applicationName: SITE_NAME,
  authors: [{ name: PERSON_NAME, url: PERSON_URL }],
  creator: PERSON_NAME,
  publisher: SITE_NAME,
  icons: {
    icon: [
      {
        url: "/favicon.ico?v=2",
        type: "image/x-icon",
        sizes: "any",
      },
      {
        url: "/icon.png?v=2",
        type: "image/png",
        sizes: "512x512",
      },
    ],
    apple: [
      {
        url: "/apple-icon.png?v=2",
        type: "image/png",
        sizes: "180x180",
      },
    ],
    shortcut: "/favicon.ico?v=2",
  },
  category: "Finance",
  classification: "Finance, Astrology, History",
  keywords: [
    "StrikeHike",
    "market history",
    "NBER recessions",
    "stock market crashes",
    "market declines",
    "Core Index",
    "S&P 500 history",
    "Nifty 50",
    "Bitcoin",
    "gold",
    "planetary positions",
    "Swiss Ephemeris",
    "Lahiri sidereal",
    "financial astrology",
    "Universal Chrono-Spatial Engine",
  ],
  openGraph: {
    type: "website",
    locale: "en_IN",
    alternateLocale: ["en_US"],
    siteName: SITE_NAME,
    title: HOME.title,
    description: HOME.description,
  },
  twitter: {
    card: "summary_large_image",
    title: HOME.title,
    description: HOME.description,
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
        {/* Before first paint: reserve the "Your themes" slot only when this
            browser follows a theme that still has a page (a saved Politics
            follow from before D-12 is ignored here too), so the client-rendered
            group shifts nothing. The group itself is never in the server HTML. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `try{var h=${JSON.stringify(HIDDEN_THEMES)};var f=JSON.parse(localStorage.getItem("sh.follow.v1")||"[]");if(Array.isArray(f)&&f.some(function(t){return h.indexOf(t)<0}))document.documentElement.setAttribute("data-follows","");}catch(e){}`,
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
          <PageViewTracker />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
