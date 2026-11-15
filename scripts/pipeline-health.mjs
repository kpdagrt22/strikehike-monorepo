#!/usr/bin/env node
// PIPELINES health: did each scheduled workflow run recently and succeed?
//
//   GH_TOKEN=... GITHUB_REPOSITORY=owner/repo node scripts/pipeline-health.mjs --summary=pipeline-health.md

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const WORKFLOWS = [
  { file: "events-weekly.yml", name: "events-weekly", intervalHours: 168, graceHours: 24 },
  { file: "roundup-draft.yml", name: "roundup-draft", intervalHours: 168, graceHours: 24 },
  { file: "digest-send.yml", name: "digest-send", intervalHours: 168, graceHours: 24 },
  { file: "deps-watch.yml", name: "deps-watch", intervalHours: 168, graceHours: 24 },
  { file: "fresh-watch.yml", name: "fresh-watch", intervalHours: 24, graceHours: 6 },
  { file: "perf-measure.yml", name: "perf-measure", intervalHours: 168, graceHours: 24 },
];

function arg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

// `workflowCreatedAt` (the workflow's registration time) separates a workflow
// that is too new to have run from one whose schedule never fires.
export function evaluate(runs, now, intervalHours, graceHours, workflowCreatedAt = null) {
  const completed = runs
    .filter((run) => run.conclusion)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (completed.length === 0) {
    const addedHours = workflowCreatedAt
      ? (now.getTime() - Date.parse(workflowCreatedAt)) / 3_600_000
      : null;
    if (addedHours !== null && Number.isFinite(addedHours) && addedHours <= intervalHours + graceHours) {
      return { ok: true, detail: `not due yet (added ${addedHours.toFixed(1)} h ago)`, ageHours: null };
    }
    return { ok: false, detail: "no completed scheduled run", ageHours: null };
  }
  const newest = completed[0];
  const ageHours = (now.getTime() - Date.parse(newest.created_at)) / 3_600_000;
  const inWindow = ageHours <= intervalHours + graceHours;
  return {
    ok: inWindow && newest.conclusion === "success",
    detail: `${newest.conclusion} ${ageHours.toFixed(1)} h ago`,
    ageHours,
  };
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const summary = arg("summary", "");
  if (!repo || !token) {
    throw new Error("GITHUB_REPOSITORY and GH_TOKEN/GITHUB_TOKEN are required");
  }
  const now = new Date();
  const rows = [];
  for (const workflow of WORKFLOWS) {
    const response = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${workflow.file}/runs?event=schedule&per_page=30`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "StrikeHike-pipeline-health/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) {
      rows.push({
        name: workflow.name,
        ok: false,
        detail: `API ${response.status}`,
      });
      continue;
    }
    const data = await response.json();
    let createdAt = null;
    if (!(data.workflow_runs ?? []).some((run) => run.conclusion)) {
      const meta = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${workflow.file}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "StrikeHike-pipeline-health/1.0",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (meta.ok) createdAt = (await meta.json()).created_at ?? null;
    }
    const result = evaluate(
      data.workflow_runs ?? [],
      now,
      workflow.intervalHours,
      workflow.graceHours,
      createdAt,
    );
    rows.push({ name: workflow.name, ...result });
  }

  const lines = [
    "## pipeline-health",
    "",
    "| Workflow | Expected | Newest completed scheduled run | Result |",
    "|---|---|---|---|",
  ];
  for (const row of rows) {
    const workflow = WORKFLOWS.find((item) => item.name === row.name);
    lines.push(
      `| ${row.name} | every ${workflow.intervalHours} h (+${workflow.graceHours} h grace) | ${row.detail} | ${row.ok ? "PASS" : "**FAIL**"} |`,
    );
  }
  lines.push("");
  lines.push(`Overall: **${rows.every((row) => row.ok) ? "PASS" : "FAIL"}**`);
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (summary) writeFileSync(summary, text, "utf8");
  if (!rows.every((row) => row.ok)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
