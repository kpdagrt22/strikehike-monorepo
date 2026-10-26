export const REGIME_TONES = {
  favorable: {
    label: "Favorable",
    dark: "#5eead4",
    light: "#0f766e",
  },
  neutral: {
    label: "Neutral",
    dark: "#9ca3af",
    light: "#6b7280",
  },
  disruptive: {
    label: "Disruptive",
    dark: "#fb923c",
    light: "#c2410c",
  },
};

export function getRegimeToneColor(tone, isDark = true) {
  const entry = REGIME_TONES[tone];
  if (!entry) return null;
  return isDark ? entry.dark : entry.light;
}

export function getRegimeToneLabel(tone) {
  return REGIME_TONES[tone]?.label ?? null;
}
