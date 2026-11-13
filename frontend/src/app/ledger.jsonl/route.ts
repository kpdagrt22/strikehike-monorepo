import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const LEDGER = join(process.cwd(), "content", "ledger", "ledger.jsonl");

export async function GET() {
  try {
    const text = await readFile(LEDGER, "utf8");
    return new Response(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300, stale-while-revalidate=300",
      },
    });
  } catch {
    return new Response("Ledger unavailable\n", {
      status: 404,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
}
