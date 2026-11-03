// Share card for /regime.
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike Regime: the −50 to +50 macro atlas";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Regime",
    title: "The −50 to +50 macro atlas.",
    line: "Every NBER recession since 1854, beside the weekly Core Index.",
    path: "/regime",
  });
}
