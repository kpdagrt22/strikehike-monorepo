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
export type RoundupSkyItem = {
  kind: string;
  body: string;
  at: string;
  path: string;
  label?: string;
  rashi?: number;
  eclipse_type?: string;
  season?: string;
  name?: string;
};
export type RoundupActivity = {
  daily: { date: string; score: number }[];
  min: number;
  max: number;
  peak_date: string;
  closest_past: {
    date: string;
    name: string;
    similarity_percent: number;
  } | null;
  note: string;
};
export type RoundupRecord = {
  claim_id: string;
  title: string;
  result: string;
  result_code: string;
  path: string;
};
export type Roundup = {
  schema?: number;
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
    weekly?: { date: string; score: number }[];
  };
  themes?: RoundupTheme[];
  sky?: RoundupDate[];
  sky_week_items?: RoundupSkyItem[];
  activity?: RoundupActivity;
  next_two_weeks?: RoundupDate[];
  from_record?: RoundupRecord;
  lines?: {
    regime?: string;
    dates?: string;
    sky?: string;
    activity?: string;
    next?: string;
    record?: string;
  };
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
