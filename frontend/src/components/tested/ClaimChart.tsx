// A small server-rendered line for a claim test: the mean in-window return for
// each year of the daily record, in the Regime chart's ink. Built at request
// time from the prebuilt JSON; no client code and no new dependency.

type Point = { year: number; value: number };

const WIDTH = 720;
const HEIGHT = 150;
const PAD = 12;

export function ClaimChart({ points, label }: { points: Point[]; label: string }) {
  if (points.length < 2) {
    return (
      <p className="rounded-xl border border-(--sh-line-1) px-3 py-6 text-center text-micro text-(--sh-text-3)">
        No yearly path to draw for this claim.
      </p>
    );
  }

  const span = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  const x = (index: number) => PAD + (index / (points.length - 1)) * (WIDTH - PAD * 2);
  const y = (value: number) =>
    HEIGHT / 2 - (Math.max(-span, Math.min(span, value)) / span) * (HEIGHT / 2 - PAD);
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" ");

  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full text-(--sh-signal-ink)"
      >
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={HEIGHT / 2}
          y2={HEIGHT / 2}
          stroke="currentColor"
          opacity="0.22"
          strokeWidth="1"
        />
        <path
          d={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <figcaption className="mt-1 flex flex-wrap items-center justify-between gap-2 text-micro text-(--sh-text-3)">
        <span>Mean in-window return each year (%); the middle line is zero</span>
        <span className="tabular-nums">
          {points[0].year} → {points.at(-1)!.year}
        </span>
      </figcaption>
    </figure>
  );
}
