// A small server-rendered Core Index path (−50…+50) for a reference page.
// The shaded band marks the window; the line runs from six months before it to
// six months after. No client code and no new dependency.
type Point = { date: string; value: number };

const WIDTH = 720;
const HEIGHT = 150;
const PAD = 10;

export function ReferenceSparkline({
  points,
  start,
  end,
  label,
}: {
  points: Point[];
  start: string;
  end: string;
  label: string;
}) {
  if (points.length < 2) {
    return (
      <p className="rounded-xl border border-(--sh-line-1) px-3 py-6 text-center text-micro text-(--sh-text-3)">
        No weekly Core Index reading covers this span.
      </p>
    );
  }

  const x = (date: string) => {
    const from = Date.parse(`${points[0].date}T00:00:00Z`);
    const to = Date.parse(`${points.at(-1)!.date}T00:00:00Z`);
    const value = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(value) || to <= from) return WIDTH / 2;
    return PAD + ((value - from) / (to - from)) * (WIDTH - PAD * 2);
  };
  const y = (value: number) =>
    HEIGHT / 2 - (Math.max(-50, Math.min(50, value)) / 50) * (HEIGHT / 2 - PAD);
  const line = points
    .map((point, index) => `${index ? "L" : "M"}${x(point.date).toFixed(1)},${y(point.value).toFixed(1)}`)
    .join(" ");
  const windowLeft = x(start);
  const windowRight = x(end);

  return (
    <figure className="min-w-0">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full text-(--sh-signal-ink)"
      >
        <rect
          x={Math.max(PAD, windowLeft)}
          y={PAD}
          width={Math.max(1, Math.min(WIDTH - PAD, windowRight) - Math.max(PAD, windowLeft))}
          height={HEIGHT - PAD * 2}
          fill="currentColor"
          opacity="0.07"
        />
        <line
          x1={PAD}
          x2={WIDTH - PAD}
          y1={y(0)}
          y2={y(0)}
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
        <span>Core Index −50 to +50; shaded: the window</span>
        <span className="tabular-nums">
          {points[0].date} → {points.at(-1)!.date}
        </span>
      </figcaption>
    </figure>
  );
}
