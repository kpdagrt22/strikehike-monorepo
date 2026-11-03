/**
 * A server read the page can do without. The build never depends on the backend: the Docker
 * build stage has none, and a build whose CHRONO_API_URL points at an unreachable backend must
 * still succeed. So during `next build`, and on the dev server, a failed read renders the page
 * without its server data, and every view loads its own data in the browser as before.
 *
 * A production server rethrows on purpose: an ISR regeneration that throws keeps serving the
 * last good page (incremental-static-regeneration.md, "Handling uncaught exceptions") instead of
 * replacing it with one that lacks the data.
 */
export async function readOrNull<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    const building = process.env.NEXT_PHASE === "phase-production-build";
    if (building || process.env.NODE_ENV !== "production") {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[seo] server data unavailable, rendering without it: ${reason}`);
      return null;
    }
    throw error;
  }
}
