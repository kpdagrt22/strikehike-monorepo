// The per-window figures the Recession windows table shows, read from the
// weekly timeline already on the page (no request, no new statistic): the
// largest fall from a running peak to a later low inside the window (never a
// low that came before the high), and the lowest Core Index in the window.
// RegimeTimeline uses the same function for its band tooltip.
export function buildCrashMetrics(timeline, crashes) {
  return (crashes ?? []).map((crash) => {
    const points = timeline.filter(
      (point) => point.date >= crash.start && point.date <= crash.end,
    );
    let peak = null;
    let peakDate = null;
    let troughDate = null;
    let drawdownPeakDate = null;
    let drawdown = 0;
    const scores = [];
    for (const point of points) {
      const value = Number(point.sp500_proxy);
      if (Number.isFinite(value) && value > 0) {
        if (peak == null || value > peak) {
          peak = value;
          peakDate = point.date;
        } else if (peak > 0) {
          const fall = value / peak - 1;
          if (fall < drawdown) {
            drawdown = fall;
            drawdownPeakDate = peakDate;
            troughDate = point.date;
          }
        }
      }
      const score = point.core_index;
      if (score != null && Number.isFinite(Number(score))) {
        scores.push(Number(score));
      }
    }
    return {
      id: crash.id,
      name: crash.name,
      start: crash.start,
      end: crash.end,
      drawdown: peak == null ? null : drawdown * 100,
      peak_date: drawdownPeakDate ?? peakDate,
      trough_date: troughDate,
      score: scores.length ? Math.min(...scores) : null,
    };
  });
}
