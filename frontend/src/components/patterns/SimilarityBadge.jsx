"use client";

function badgeTone(score, isDark, status) {
  if (score == null || status === "error") {
    return {
      color: null,
      label: status === "loading" ? "Reading match" : "Unavailable",
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

export function SimilarityBadge({ score, isDark, status }) {
  const tone = badgeTone(score, isDark, status);
  // Without a score the badge stays neutral (theme-aware ink, no tone colour).
  const toneStyle = tone.color ? { color: tone.color } : undefined;
  return (
    <div className="flex items-center justify-center py-1 lg:h-full lg:flex-col lg:px-2">
      <div className="relative w-full max-w-[230px] overflow-hidden rounded-2xl border border-black/5 bg-white/50 px-4 py-3 text-center dark:border-white/5 dark:bg-black/30 lg:max-w-none lg:px-3 lg:py-5">
        <div className="relative">
          <p className="text-micro font-medium uppercase tracking-[0.18em] text-black/60 dark:text-white/60">
            Pattern similarity
          </p>
          <p
            className="mt-1.5 font-mono text-3xl font-semibold leading-none tracking-[-0.06em] text-black/60 dark:text-white/60 sm:text-4xl lg:text-3xl"
            style={toneStyle}
          >
            {tone.color ? `${Math.round(score)}%` : "—"}
          </p>
          <p
            className="mt-1.5 text-micro font-medium uppercase tracking-[0.12em] text-black/60 dark:text-white/60"
            style={toneStyle}
          >
            {tone.label}
          </p>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/8 dark:bg-white/10">
            <div
              className="h-full rounded-full"
              style={{
                width: `${tone.color ? Math.max(0, Math.min(100, score)) : 0}%`,
                backgroundColor: tone.color ?? undefined,
              }}
            />
          </div>
          <p className="mt-2 text-micro leading-relaxed text-black/60 dark:text-white/60">
            normalized 12-month path correlation
          </p>
        </div>
      </div>
    </div>
  );
}
