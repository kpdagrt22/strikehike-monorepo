import type { Metadata } from "next";
import { Onest } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";

const onest = Onest({
  variable: "--font-onest",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://strikehike.com"),
  title: "StrikeHike — Universal Chrono-Spatial Engine",
  description:
    "A neutral, date-addressable index of time, volatility, and historical parallel.",
  applicationName: "StrikeHike",
  authors: [{ name: "StrikeHike", url: "https://strikehike.com" }],
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: "https://strikehike.com",
    siteName: "StrikeHike",
    title: "StrikeHike — Universal Chrono-Spatial Engine",
    description:
      "A neutral, date-addressable index of time, volatility, and historical parallel.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={onest.variable} suppressHydrationWarning>
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
