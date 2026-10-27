"use client";

function PlaceholderVisual({ era, accent, isDark }) {
  return (
    <div className="relative h-44 overflow-hidden rounded-2xl border border-black/5 bg-[#111119] dark:border-white/10">
      <div
        className="absolute inset-0 opacity-90"
        style={{
          background: `radial-gradient(circle at 22% 30%, ${accent}55 0%, transparent 38%), radial-gradient(circle at 80% 72%, ${accent}33 0%, transparent 42%), linear-gradient(135deg, ${isDark ? "#090910" : "#171721"} 0%, ${isDark ? "#171722" : "#2a2530"} 100%)`,
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.18) 1px, transparent 1px)",
          backgroundSize: "36px 36px",
        }}
      />
      <div
        className="absolute left-6 top-6 h-24 w-24 rounded-full border opacity-70"
        style={{ borderColor: accent }}
      />
      <div
        className="absolute left-12 top-12 h-12 w-12 rounded-full opacity-50"
        style={{ backgroundColor: accent }}
      />
      <div
        className="absolute right-7 top-7 h-px w-28 opacity-50"
        style={{ backgroundColor: accent, transform: "rotate(-28deg)" }}
      />
      <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5">
        <div>
          <p className="text-micro font-medium uppercase tracking-[0.2em] text-white/60">
            Editorial visual placeholder
          </p>
          <p className="mt-1 font-mono text-3xl font-medium tracking-[-0.05em] text-white/80">
            {era}
          </p>
        </div>
        <span
          className="shrink-0 rounded-full border px-2.5 py-1 font-mono text-micro uppercase tracking-[0.14em] text-white/70"
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
  isDark,
}) {
  return (
    <article className="overflow-hidden rounded-[1.6rem] border border-black/5 bg-white/45 p-4 shadow-[0_18px_60px_rgba(20,18,26,0.1)] backdrop-blur-2xl dark:border-white/5 dark:bg-black/35 sm:p-5">
      <PlaceholderVisual era={era} accent={accent} isDark={isDark} />
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
