// Share card for /patterns.
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike Study of Patterns: today's market beside its closest past setups";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Study of Patterns",
    title: "The 120-year mirror.",
    line: "Today’s market beside its closest past setups, and what followed.",
    path: "/patterns",
  });
}
