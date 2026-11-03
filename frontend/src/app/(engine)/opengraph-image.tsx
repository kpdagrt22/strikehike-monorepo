// Share card for / (it sits beside the home page in (engine), so the home page's own openGraph keeps it).
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike: the planetary sky beside market history";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Orrery",
    title: "The planetary sky beside market history.",
    line: "A 3D orrery, a macro atlas since 1854 and market declines since 1871.",
    path: "",
  });
}
