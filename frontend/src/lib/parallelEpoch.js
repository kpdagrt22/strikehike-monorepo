export const EPOCH_CUTOFF_YEAR = 2015;

export function parallelEpoch(parallel) {
  if (parallel?.epoch === "historical" || parallel?.epoch === "recent") {
    return parallel.epoch;
  }

  const year = Number(String(parallel?.date ?? "").slice(0, 4));
  return Number.isFinite(year) && year < EPOCH_CUTOFF_YEAR
    ? "historical"
    : "recent";
}

export function splitParallels(parallels = []) {
  const groups = { historical: [], recent: [] };
  for (const parallel of parallels) {
    groups[parallelEpoch(parallel)].push(parallel);
  }
  return groups;
}
