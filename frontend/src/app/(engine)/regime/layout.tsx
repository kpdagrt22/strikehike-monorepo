import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo/site";

// Title, description, canonical, Open Graph and Twitter: one source, lib/seo/site.ts.
// The share image comes from ./opengraph-image.tsx.
export const metadata: Metadata = pageMetadata("/regime");

export default function RegimeLayout({ children }: { children: ReactNode }) {
  return children;
}
