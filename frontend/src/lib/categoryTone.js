export const CATEGORY_TONES = {
  Politics: {
    color: "#ef4444",
    soft: "rgba(239, 68, 68, 0.16)",
    glow: "rgba(239, 68, 68, 0.5)",
  },
  Finance: {
    color: "#22d3ee",
    soft: "rgba(34, 211, 238, 0.16)",
    glow: "rgba(34, 211, 238, 0.5)",
  },
  Science: {
    color: "#34d399",
    soft: "rgba(52, 211, 153, 0.16)",
    glow: "rgba(52, 211, 153, 0.5)",
  },
  "Culture/Religion": {
    color: "#a78bfa",
    soft: "rgba(167, 139, 250, 0.16)",
    glow: "rgba(167, 139, 250, 0.5)",
  },
  "Natural Disasters": {
    color: "#f59e0b",
    soft: "rgba(245, 158, 11, 0.16)",
    glow: "rgba(245, 158, 11, 0.5)",
  },
};

export const CATEGORY_ORDER = [
  "Science",
  "Politics",
  "Finance",
  "Culture/Religion",
  "Natural Disasters",
];

export function categoryTone(category, fallback = "#8b8b8b") {
  return (
    CATEGORY_TONES[category] ?? {
      color: fallback,
      soft: "rgba(139, 139, 139, 0.14)",
      glow: "rgba(139, 139, 139, 0.35)",
    }
  );
}
