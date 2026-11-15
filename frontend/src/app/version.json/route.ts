import { NextResponse } from "next/server";

// The deploy verifier reads this. The value is inlined at build time from the
// same NEXT_PUBLIC_BUILD_SHA the UI uses.
export const dynamic = "force-static";

export function GET() {
  return NextResponse.json({
    sha: (process.env.NEXT_PUBLIC_BUILD_SHA || "dev").slice(0, 7),
  });
}
