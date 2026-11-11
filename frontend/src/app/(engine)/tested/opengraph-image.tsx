// Share card for /tested.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike claim tests";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Tested",
    title: "Popular claims, tested",
    line: "Mercury retrograde, the full moon and eclipses, against the daily S&P 500 record.",
    path: "/tested",
  });
}
