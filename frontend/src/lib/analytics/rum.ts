export function observeRum(
  update: (lcp: number, inp: number, cls: number) => void,
) {
  if (typeof PerformanceObserver === "undefined") return;
  let lcp = 0;
  let inp = 0;
  let cls = 0;
  try {
    type Entry = PerformanceEntry & {
      hadRecentInput?: boolean;
      value?: number;
      duration?: number;
    };
    const observer = new PerformanceObserver((list) => {
      list.getEntries().forEach((raw) => {
        const entry = raw as Entry;
        if (entry.entryType === "largest-contentful-paint")
          lcp = Math.round(entry.startTime);
        else if (entry.entryType === "layout-shift" && !entry.hadRecentInput)
          cls += entry.value || 0;
        else if (entry.entryType === "event")
          inp = Math.max(inp, Math.round(entry.duration || 0));
      });
      update(lcp, inp, cls);
    });
    for (const option of [
      { type: "largest-contentful-paint", buffered: true },
      { type: "layout-shift", buffered: true },
      { type: "event", buffered: true },
    ])
      try {
        observer.observe(option as PerformanceObserverInit);
      } catch {}
  } catch {}
}
