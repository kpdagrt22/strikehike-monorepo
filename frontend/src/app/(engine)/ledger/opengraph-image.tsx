// Share card for /ledger.
import { ogCard } from "@/app/_og/card";

export const alt = "StrikeHike published ledger";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-static";

export default function Image() {
  return ogCard({
    eyebrow: "Published ledger",
    title: "Every published roundup, fingerprinted.",
    line: "An append-only public record: the week, the reading, the publication time and a hash chain.",
    path: "/ledger",
  });
}
