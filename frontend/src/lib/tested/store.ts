import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The seven claim tests, fixed at build time by backend/scripts/build_claim_tests.py
// and committed under frontend/content/tested. The pages read them from the
// working directory, the same way the roundup store reads approved weeklies.

export const CLAIM_IDS = [
  "mercury-retrograde",
  "full-moon",
  "eclipses",
  "new-moon",
  "solstices-equinoxes",
  "mars-retrograde",
  "mars-saturn-conjunction",
] as const;
export type ClaimId = (typeof CLAIM_IDS)[number];

export type ClaimWindow = {
  start: string;
  end: string;
  kind: string;
  return: number;
  decline_start: boolean;
};

export type ClaimGroup = {
  n: number;
  mean_return: number;
  median_return: number;
  decline_starts: number;
  decline_share: number;
};

export type ClaimComparison = {
  in: ClaimGroup;
  out: ClaimGroup;
  mean_difference: number;
  median_difference: number;
  p_value: number;
  permutations: number;
  seed: number;
  meaningful: boolean;
};

export type ClaimFullHistory =
  | { available: false; reason: string; in_months: number; out_months: number }
  | ({ available: true } & ClaimComparison);

export type ClaimTest = {
  id: ClaimId;
  title: string;
  claim: string;
  result: string;
  result_code: "no_meaningful_difference" | "different" | "too_few_windows";
  published: boolean;
  too_few?: { windows: number };
  series: {
    name: string;
    column: string;
    frequency: string;
    start: string;
    end: string;
    years: string;
    full_record: { start: string; end: string; years: string; monthly_before: string };
  };
  source: {
    artifact: string;
    meta: string;
    market: string;
    astronomy: string;
    build_date: string;
    data_version?: string;
  };
  comparison: ClaimComparison | null;
  full_history: ClaimFullHistory;
  chart: { year: number; value: number }[];
  windows: ClaimWindow[];
  next_event: { date?: string; start?: string; end?: string; kind?: string } | null;
  method: string[];
  limitations: string[];
};

function isClaimId(value: string): value is ClaimId {
  return (CLAIM_IDS as readonly string[]).includes(value);
}

const DIR = join(process.cwd(), "content", "tested");

export async function readClaimTest(id: string): Promise<ClaimTest | null> {
  if (!isClaimId(id)) return null;
  try {
    const raw = await readFile(join(DIR, `${id}.json`), "utf8");
    const parsed = JSON.parse(raw) as ClaimTest;
    return parsed?.id === id ? parsed : null;
  } catch {
    return null;
  }
}

export async function readClaimTests(): Promise<ClaimTest[]> {
  const found = await Promise.all(CLAIM_IDS.map((id) => readClaimTest(id)));
  return found.filter((claim): claim is ClaimTest => claim !== null);
}
