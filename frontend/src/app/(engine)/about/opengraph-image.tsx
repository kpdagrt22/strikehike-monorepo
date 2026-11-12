// Share card for /about.
// Built once at build time (force-static); og:image, og:image:* and twitter:image come from here.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike about: how the site is built, and where its data come from";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "StrikeHike",
    title: "About",
    line: "How it works, where the data come from, and who builds it.",
    path: "/about",
  });
}
