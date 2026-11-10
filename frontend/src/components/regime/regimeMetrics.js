// The per-window figures the Recession windows table shows, read from the
// weekly timeline already on the page (no request, no new statistic): the
// equity proxy's peak-to-trough drawdown and the lowest Core Index in the
// window. RegimeTimeline uses the same function for its band tooltip.
export function buildCrashMetrics(timeline, crashes) {
  return (crashes ?? []).map((crash) => {
    const points = timeline.filter(
      (point) => point.date >= crash.start && point.date <= crash.end,
    );
    const equities = points
      .map((point) => Number(point.sp500_proxy))
      .filter((value) => Number.isFinite(value) && value > 0);
    const peak = equities.length ? Math.max(...equities) : null;
    const trough = equities.length ? Math.min(...equities) : null;
    const drawdown =
      peak != null && trough != null && peak > 0
        ? (trough / peak - 1) * 100
        : null;
    const scores = points
      .map((point) => Number(point.core_index))
      .filter((value) => Number.isFinite(value));
    return {
      id: crash.id,
      name: crash.name,
      start: crash.start,
      end: crash.end,
      drawdown,
      score: scores.length ? Math.min(...scores) : null,
    };
  });
}
