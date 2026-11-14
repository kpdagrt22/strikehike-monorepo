import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { latestApprovedRoundup } from "@/lib/roundup/store";
import { homeGraph } from "@/lib/seo/graphs";
import { pageMetadata } from "@/lib/seo/site";
import HomeClient from "./HomeClient";

// The orrery is a client view; this server wrapper adds the home page's own
// metadata (its canonical and Open Graph URL) and its JSON-LD. The latest
// roundup date feeds the page's dateModified; the page is rebuilt on deploy.
export const metadata: Metadata = pageMetadata("/");

export default async function Page() {
  const latest = await latestApprovedRoundup().catch(() => null);
  return (
    <>
      <HomeClient />
      <JsonLd data={homeGraph(latest?.generated_at)} />
    </>
  );
}
