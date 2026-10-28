"use client";

function PlaceholderVisual({ era, accent }) {
  return (
    <div className="relative h-44 overflow-hidden rounded-2xl border border-(--sh-line-1) bg-[#f2ede4] dark:border-white/10 dark:bg-[#111119]">
      {/* The plate's base stops are CSS variables, so the server markup is
          already theme-correct; only the accent comes from JS. */}
      <div
        className="absolute inset-0 opacity-90 [--plate-a:#faf7f2] [--plate-b:#f1ebe2] dark:[--plate-a:#090910] dark:[--plate-b:#171722]"
        style={{
          background: `radial-gradient(circle at 78% 30%, ${accent}55 0%, transparent 38%), radial-gradient(circle at 20% 80%, ${accent}33 0%, transparent 42%), linear-gradient(135deg, var(--plate-a) 0%, var(--plate-b) 100%)`,
        }}
      />
      <div
        className="absolute right-6 top-6 h-20 w-20 rounded-full border opacity-70"
        style={{ borderColor: accent }}
      />
      <div
        className="absolute right-11 top-11 h-10 w-10 rounded-full opacity-50"
        style={{ backgroundColor: accent }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
        <div>
          <p className="text-micro font-medium uppercase tracking-[0.2em] text-black/70 dark:text-white/60">
            Editorial visual placeholder
          </p>
          <p className="mt-1 font-mono text-3xl font-medium tracking-[-0.05em] text-black/80 dark:text-white/80">
            {era}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-micro uppercase tracking-[0.14em] text-black/70 dark:text-white/70"
          style={{ borderColor: `${accent}66`, backgroundColor: `${accent}18` }}
        >
          Field note
        </span>
      </div>
    </div>
  );
}

export function PatternEraPanel({
  side,
  era,
  title,
  summary,
  bullets,
  accent,
}) {
  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-(--sh-line-1) bg-white/45 p-4 dark:bg-black/35 sm:p-5">
      <PlaceholderVisual era={era} accent={accent} />
      <div className="mt-4">
        <p
          className="text-micro font-medium uppercase tracking-[0.16em]"
          style={{ color: accent }}
        >
          {side}
        </p>
        <h3 className="mt-1 text-xl font-semibold tracking-[-0.035em] text-[#14121a] dark:text-[#f2ede4]">
          {title}
        </h3>
        <p className="mt-2 text-meta leading-relaxed text-black/70 dark:text-white/70">
          {summary}
        </p>
        <ul className="mt-3 grid gap-1.5 border-t border-black/5 pt-3 dark:border-white/5">
          {bullets.map((bullet) => (
            <li
              key={bullet}
              className="flex gap-2 text-micro leading-relaxed text-black/60 dark:text-white/60"
            >
              <span
                className="mt-1.5 h-1 w-1 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />
              {bullet}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
