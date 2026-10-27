"use client";

function badgeTone(score, isDark) {
  if (score == null) {
    return {
      color: isDark ? "#9ca3af" : "#6b7280",
      label: "Reading match",
    };
  }
  if (score > 80) {
    return {
      color: isDark ? "#34d399" : "#047857",
      label: "Strong echo",
    };
  }
  if (score >= 50) {
    return {
      color: isDark ? "#e2e8f0" : "#475569",
      label: "Partial echo",
    };
  }
  return {
    color: isDark ? "#fb7185" : "#c0442f",
    label: "Different path",
  };
}

export function SimilarityBadge({ score, isDark }) {
  const tone = badgeTone(score, isDark);
  return (
    <div className="flex items-center justify-center py-1 lg:h-full lg:flex-col lg:px-2">
      <div
        className="relative w-full max-w-[230px] overflow-hidden rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-center backdrop-blur-xl lg:max-w-none lg:px-3 lg:py-5"
        style={{
          boxShadow: `0 0 36px ${tone.color}22, 0 16px 50px rgba(0,0,0,0.35)`,
        }}
      >
        <span
          className="pointer-events-none absolute -inset-8 opacity-30 blur-2xl"
          style={{
            background: `radial-gradient(circle, ${tone.color}55 0%, transparent 65%)`,
          }}
          aria-hidden="true"
        />
        <div className="relative">
          <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
            Pattern similarity
          </p>
          <p
            className="mt-1.5 font-mono text-3xl font-semibold leading-none tracking-[-0.06em] sm:text-4xl lg:text-3xl"
            style={{ color: tone.color, textShadow: `0 0 24px ${tone.color}55` }}
          >
            {score == null ? "—" : `${Math.round(score)}%`}
          </p>
          <p
            className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.12em]"
            style={{ color: tone.color }}
          >
            {tone.label}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, score ?? 0))}%`,
                backgroundColor: tone.color,
                boxShadow: `0 0 12px ${tone.color}`,
              }}
            />
          </div>
          <p className="mt-2 text-[9px] leading-relaxed text-white/30">
            normalized 12-month path correlation
          </p>
        </div>
      </div>
    </div>
  );
}
