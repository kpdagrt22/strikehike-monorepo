import { JsonLd } from "@/components/seo/JsonLd";
import { readOrNull } from "@/components/seo/readOrNull";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { getPatternsDefault, type PatternsPayload } from "@/lib/seo/data";
import { patternsGraph } from "@/lib/seo/graphs";
import PatternsClient from "./PatternsClient";

// ISR: the page is prerendered (without data when the build has no backend) and regenerated
// on the server at most once a minute. Metadata comes from the route layout.
export const revalidate = 60;

// The keys PatternsClient reads (it renders only the validated `engine` block); the v1 arrays
// (current, historical, forward) stay out of the serialised prop.
function initialData(payload: PatternsPayload | null) {
  if (!payload) return null;
  const { as_of, asset, asset_label, engine, notes } = payload;
  return { as_of, asset, asset_label, engine, notes };
}

export default async function Page() {
  const payload = await readOrNull(getPatternsDefault);
  return (
    <>
      <PatternsClient
        initialData={initialData(payload)}
        colophon={<SiteColophon current="/patterns" />}
      />
      <JsonLd data={patternsGraph(payload)} />
    </>
  );
}
