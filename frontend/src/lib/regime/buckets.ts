// The public names for the Core Index buckets. The raw keys ("calm_bullish",
// "extreme_bearish") are internal; the site prints these words everywhere else
// (RegimeTimeline's ribbon key) and the home snapshot must match.
export const BUCKET_LABELS: Record<string, string> = {
  strong_bullish: "risk elevated",
  calm_bullish: "steady",
  bearish_warning: "stressed",
  extreme_bearish: "max fear",
};

export function bucketLabel(bucket: string | null | undefined): string | null {
  if (!bucket) return null;
  return BUCKET_LABELS[bucket] ?? null;
}
