import { JsonLd } from "@/components/seo/JsonLd";
import { NberTable } from "@/components/seo/NberTable";
import { readOrNull } from "@/components/seo/readOrNull";
import { SiteColophon } from "@/components/seo/SiteColophon";
import { getCaseCatalogue, getRegimeSummary, type RegimeSummary } from "@/lib/seo/data";
import { regimeGraph } from "@/lib/seo/graphs";
import RegimeClient from "./RegimeClient";

// ISR: the page is prerendered (without data when the build has no backend) and regenerated
// on the server at most once a minute. Metadata comes from the route layout.
export const revalidate = 60;

// The meta fields RegimeClient reads (the Stat row and Method & limits). The prop is
// serialised into the page, so the monthly points and the unused meta stay out of it.
const META_FIELDS = [
  "data_version",
  "core_index_version",
  "strength_version",
  "core_index_first_scored",
  "core_index_severities",
  "core_index_trend_warning",
  "core_index_fast_warning",
  "latest_core_index",
  "proxy_sources",
  "assets",
  "notes",
];

function initialSummary(summary: RegimeSummary | null) {
  if (!summary) return null;
  const meta = Object.fromEntries(
    META_FIELDS.filter((key) => key in summary.meta).map((key) => [key, summary.meta[key]]),
  );
  return {
    as_of: summary.as_of,
    coverage: summary.coverage,
    meta,
    windows: summary.crashes.length,
  };
}

export default async function Page() {
  const [summary, catalogue] = await Promise.all([
    readOrNull(getRegimeSummary),
    readOrNull(getCaseCatalogue),
  ]);
  return (
    <>
      <RegimeClient
        initialSummary={initialSummary(summary)}
        after={<NberTable summary={summary} catalogue={catalogue} />}
        colophon={<SiteColophon current="/regime" />}
      />
      <JsonLd data={regimeGraph(summary)} />
    </>
  );
}
