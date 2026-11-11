import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type RoundupDate = {
  id: string;
  name: string;
  start_date: string;
  start_time: string | null;
  path: string;
};
export type RoundupTheme = { id: string; name: string; events: RoundupDate[] };
export type Roundup = {
  week: string;
  start: string;
  end: string;
  generated_at: string;
  approved: boolean;
  regime?: {
    as_of: string;
    score: number;
    label: string;
    previous_score: number | null;
    change: number | null;
  };
  themes?: RoundupTheme[];
  sky?: RoundupDate[];
  lines?: { regime?: string; dates?: string; sky?: string };
};

const DIR = join(process.cwd(), "content", "roundups");

async function readAll(): Promise<Roundup[]> {
  let names: string[] = [];
  try {
    names = (await readdir(DIR)).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const rounds = await Promise.all(
    names.map(async (name) => {
      try {
        return JSON.parse(await readFile(join(DIR, name), "utf8")) as Roundup;
      } catch {
        return null;
      }
    }),
  );
  return rounds
    .filter((round): round is Roundup => Boolean(round?.week && round?.approved))
    .sort((left, right) => right.week.localeCompare(left.week));
}

export async function approvedRoundups() {
  return readAll();
}

export async function approvedRoundup(week: string) {
  return (await readAll()).find((round) => round.week === week) ?? null;
}

export async function latestApprovedRoundup() {
  return (await readAll())[0] ?? null;
}
