import Link from "next/link";
import { formatDate } from "@/components/regime/regimeUtils";

// The home "At a glance" block is static server data. It is rendered here and
// passed into the client InfoModule as an already-rendered child, so the
// client bundle does not carry or hydrate this markup.
export type HomeSnapshotData = {
  week: string | null;
  weekLabel: string | null;
  regimeLine: string | null;
  core: { score: number; bucket: string | null; date: string } | null;
  next: Array<{
    name: string;
    date: string;
    time: string | null;
    allDay: boolean;
    theme: string;
  }>;
};

const LINK =
  "inline-flex min-h-6 items-center text-micro text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:min-h-11 dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

export function HomeSnapshot({ snapshot }: { snapshot: HomeSnapshotData }) {
  return (
    <div
      data-home-snapshot
      className="mt-4 rounded-xl border border-black/10 p-3 text-micro leading-relaxed text-black/70 dark:border-white/10 dark:text-white/70"
    >
      <p className="font-medium uppercase tracking-[0.14em] text-black/60 dark:text-white/60">
        At a glance
      </p>
      {snapshot.week && snapshot.weekLabel ? (
        <p className="mt-2">
          <Link
            href={`/this-week/${snapshot.week}`}
            prefetch={false}
            className={LINK}
          >
            {snapshot.weekLabel}
          </Link>
          {snapshot.regimeLine ? ` - ${snapshot.regimeLine}` : null}
        </p>
      ) : null}
      {snapshot.core ? (
        <p className="mt-1">
          Core Index{" "}
          {snapshot.core.score > 0 ? "+" : snapshot.core.score < 0 ? "\u2212" : ""}
          {Math.abs(snapshot.core.score).toFixed(1)}
          {snapshot.core.bucket ? ` (${snapshot.core.bucket})` : null} as of{" "}
          {formatDate(snapshot.core.date)}.
        </p>
      ) : null}
      {snapshot.next?.length ? (
        <ul data-home-snapshot-next className="mt-2 space-y-1">
          {snapshot.next.map((item) => (
            <li key={`${item.name}-${item.date}`}>
              {item.name} - {formatDate(item.date)}
              {item.allDay
                ? " (all day)"
                : item.time
                  ? ` (${item.time})`
                  : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
