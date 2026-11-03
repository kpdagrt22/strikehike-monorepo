import { CatalogueTable } from "@/components/seo/CatalogueTable";
import { JsonLd } from "@/components/seo/JsonLd";
import { readOrNull } from "@/components/seo/readOrNull";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { getCaseCatalogue } from "@/lib/seo/data";
import { convergenceGraph } from "@/lib/seo/graphs";
import ConvergenceClient from "./ConvergenceClient";

// ISR: the page is prerendered (without data when the build has no backend) and regenerated
// on the server at most once a minute. Metadata comes from the route layout.
export const revalidate = 60;

export default async function Page() {
  const catalogue = await readOrNull(getCaseCatalogue);
  return (
    <>
      <ConvergenceClient
        initialCatalogue={catalogue}
        after={<CatalogueTable catalogue={catalogue} />}
        colophon={<SiteColophon current="/convergence" />}
      />
      <JsonLd data={convergenceGraph(catalogue)} />
    </>
  );
}
