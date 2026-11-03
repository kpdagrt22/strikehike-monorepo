import type { Metadata } from "next";
import { JsonLd } from "@/components/seo/JsonLd";
import { homeGraph } from "@/lib/seo/graphs";
import { pageMetadata } from "@/lib/seo/site";
import HomeClient from "./HomeClient";

// The orrery is a client view; this static server wrapper adds the home page's own
// metadata (its canonical and Open Graph URL) and its JSON-LD. No data is read here.
export const metadata: Metadata = pageMetadata("/");

export default function Page() {
  return (
    <>
      <HomeClient />
      <JsonLd data={homeGraph()} />
    </>
  );
}
