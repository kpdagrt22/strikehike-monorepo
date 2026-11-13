import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isIsoWeek } from "@/lib/roundup/week";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ week: string }> };

const DIR = join(process.cwd(), "content", "roundups");

export async function GET(_request: Request, { params }: Params) {
  const { week } = await params;
  if (!isIsoWeek(week)) {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  try {
    const raw = await readFile(join(DIR, `${week}.json`), "utf8");
    const text = raw.replace(/\r\n/g, "\n");
    const roundup = JSON.parse(text);
    if (roundup?.approved !== true || roundup?.week !== week) {
      return new Response("Not found\n", {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }
    return new Response(text, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
      },
    });
  } catch {
    return new Response("Not found\n", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
