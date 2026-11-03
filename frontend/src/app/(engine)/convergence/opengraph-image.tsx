// Share card for /convergence.
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike Convergence: market declines since 1871, side by side";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Convergence",
    title: "Two events. One macro lens.",
    line: "Market declines since 1871, side by side from each peak.",
    path: "/convergence",
  });
}
