// Share card for /disclaimer.
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike disclaimer: descriptive historical research, not investment advice";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "StrikeHike",
    title: "Disclaimer",
    line: "Descriptive historical research. Not investment advice.",
    path: "/disclaimer",
  });
}
