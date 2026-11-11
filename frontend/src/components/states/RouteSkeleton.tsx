import { PageShell } from "@/components/PageShell";

const BLOCK =
  "animate-pulse rounded-xl bg-(--sh-hover) motion-reduce:animate-none";

function Lines({ widths = ["70%", "92%", "84%"] }) {
  return (
    <div className="space-y-2">
      {widths.map((width, index) => (
        <div key={index} className={`h-3 ${BLOCK}`} style={{ width }} />
      ))}
    </div>
  );
}

/**
 * Route-level loading skeletons. Each variant reserves the final layout's
 * height: article and reference pages, the Upcoming rail + list, the Regime
 * readout + chart, and the full-bleed home.
 */
export function RouteSkeleton({ variant = "article" }) {
  if (variant === "home") {
    return (
      <main data-route-loading="home" className="relative h-full w-full overflow-hidden">
        <div className="absolute inset-x-3 top-24 max-w-[18rem] space-y-4 sm:left-5">
          <div className={`h-10 w-4/5 ${BLOCK}`} />
          <Lines widths={["96%", "88%", "92%"]} />
          <div className={`h-11 w-3/4 ${BLOCK}`} />
        </div>
        <div className={`absolute left-1/2 top-32 h-40 w-40 -translate-x-1/2 rounded-full ${BLOCK}`} />
        <div className={`absolute inset-x-8 bottom-24 h-[45vh] ${BLOCK}`} />
      </main>
    );
  }

  if (variant === "regime") {
    return (
      <PageShell data-route-loading={variant}>
        <div className="max-w-3xl space-y-3">
          <div className={`h-4 w-24 ${BLOCK}`} />
          <div className={`h-12 w-3/4 ${BLOCK}`} />
          <div className={`h-4 w-full ${BLOCK}`} />
        </div>
        <div className="mt-4 min-h-[9.5rem]">
          <div className={`h-4 w-28 ${BLOCK}`} />
          <div className={`mt-3 h-14 w-40 ${BLOCK}`} />
          <div className={`mt-3 h-4 w-64 ${BLOCK}`} />
        </div>
        <div className={`mt-4 h-[68vh] min-h-[560px] ${BLOCK}`} />
      </PageShell>
    );
  }

  if (variant === "list") {
    return (
      <PageShell data-route-loading={variant}>
        <div className="lg:grid lg:grid-cols-[20rem_minmax(0,1fr)] lg:gap-10">
          <div className="space-y-4">
            <div className={`h-4 w-20 ${BLOCK}`} />
            <div className={`h-11 w-4/5 ${BLOCK}`} />
            <Lines widths={["96%", "88%", "70%"]} />
            <div className={`h-11 w-40 ${BLOCK}`} />
            <div className={`h-64 w-full ${BLOCK}`} />
          </div>
          <div className="mt-8 space-y-3 lg:mt-0">
            <div className={`h-9 w-full ${BLOCK}`} />
            {Array.from({ length: 8 }).map((_, index) => (
              <div key={index} className={`h-16 w-full ${BLOCK}`} />
            ))}
          </div>
        </div>
      </PageShell>
    );
  }

  if (variant === "reference") {
    return (
      <PageShell data-route-loading={variant}>
        <div className="max-w-3xl space-y-3">
          <div className={`h-4 w-28 ${BLOCK}`} />
          <div className={`h-12 w-2/3 ${BLOCK}`} />
          <div className={`h-4 w-full ${BLOCK}`} />
        </div>
        <div className="mt-8 overflow-hidden rounded-2xl border border-(--sh-line-1)">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className={`h-12 border-b border-(--sh-line-1) ${BLOCK}`} />
          ))}
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell data-route-loading={variant}>
      <div className="mx-auto max-w-[760px] space-y-4">
        <div className={`h-4 w-36 ${BLOCK}`} />
        <div className={`h-10 w-4/5 ${BLOCK}`} />
        <div className={`h-4 w-40 ${BLOCK}`} />
        <Lines widths={["100%", "96%", "88%"]} />
        <div className={`mt-6 h-64 w-full ${BLOCK}`} />
      </div>
    </PageShell>
  );
}
