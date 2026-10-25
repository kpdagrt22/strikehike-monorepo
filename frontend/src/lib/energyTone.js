export function normalizePolarity(value) {
  const polarity = String(value ?? "").toLowerCase();
  if (
    polarity.includes("favorable") ||
    polarity.includes("positive") ||
    polarity.includes("bull")
  ) {
    return "positive";
  }
  if (
    polarity.includes("disruptive") ||
    polarity.includes("negative") ||
    polarity.includes("bear")
  ) {
    return "negative";
  }
  return "neutral";
}

export function getEnergyTone(polarity, isDark = true) {
  const kind = normalizePolarity(polarity);

  if (kind === "positive") {
    return {
      kind,
      stroke: isDark ? "#5eead4" : "#0f766e",
      glow: isDark ? "rgba(94, 234, 212, 0.42)" : "rgba(15, 118, 110, 0.22)",
      label: "Positive",
    };
  }

  if (kind === "negative") {
    return {
      kind,
      stroke: isDark ? "#fb923c" : "#c2410c",
      glow: isDark ? "rgba(251, 146, 60, 0.42)" : "rgba(194, 65, 12, 0.22)",
      label: "Negative",
    };
  }

  return {
    kind,
    stroke: isDark ? "#f4f1ea" : "#6b6560",
    glow: isDark ? "rgba(244, 241, 234, 0.25)" : "rgba(107, 101, 96, 0.18)",
    label: "Neutral",
  };
}
