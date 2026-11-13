import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type LedgerReading = {
  core_index: number;
  label: string;
  as_of: string;
};

export type LedgerEntry = {
  seq: number;
  week: string;
  published_at: string;
  kind: "roundup" | "correction";
  reading: LedgerReading;
  roundup_sha256: string;
  prev_hash: string;
  hash: string;
  corrects_seq?: number;
  reason?: string;
};

const LEDGER = join(process.cwd(), "content", "ledger", "ledger.jsonl");

export async function readLedger(): Promise<LedgerEntry[]> {
  const text = await readFile(LEDGER, "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LedgerEntry);
}

export async function ledgerForWeek(week: string): Promise<LedgerEntry | null> {
  const entries = await readLedger();
  return [...entries].reverse().find((entry) => entry.week === week) ?? null;
}

export function shortHash(value: string): string {
  return (value || "").slice(0, 12);
}

export function signedReading(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}
