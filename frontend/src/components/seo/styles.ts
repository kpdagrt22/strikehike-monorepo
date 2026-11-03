// Classes the server-rendered SEO blocks share with the views around them, copied from each
// page's own Method & limits and footer links, so the new rows read as part of the page.

/** The engine pages' quiet footer link (/regime, /patterns), 44 px tall on touch. */
export const LINK =
  "text-black/60 underline decoration-black/20 underline-offset-4 transition-colors hover:text-[#14121a] focus-visible:text-[#14121a] hover:decoration-[#f05d49] focus-visible:decoration-[#f05d49] pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center dark:text-white/60 dark:decoration-white/20 dark:hover:text-[#f2ede4] dark:focus-visible:text-[#f2ede4] dark:hover:decoration-[#ff8b77] dark:focus-visible:decoration-[#ff8b77]";

/** The "+" that turns 45° while its closed row is open. */
export const PLUS =
  "text-base font-normal text-black/60 transition-transform group-open:rotate-45 dark:text-white/60";

/** A wide table's scroll box: focusable, so a keyboard can scroll it (Patterns spec). */
export const TABLE_REGION = "overflow-x-auto rounded-lg";

/** Header cells, in the micro capitals the views use for labels: TH_WRAP may wrap (a long
 *  label in a narrow column), TH_COL stays on one line. */
export const TH_WRAP =
  "py-1.5 pr-4 text-left align-bottom text-micro font-medium uppercase tracking-[0.14em] text-black/60 last:pr-0 dark:text-white/60";
export const TH_COL = `whitespace-nowrap ${TH_WRAP}`;

/** A body row: a hairline above, as in the views' own tables. */
export const ROW = "border-t border-(--sh-line-1) align-baseline";

/** A figure inside running text: monospaced like the Convergence read. */
export const FIGURE = "whitespace-nowrap font-mono text-[0.94em] tabular-nums";

/** The closing source line under a block, as under Method & limits. */
export const SOURCE_LINE =
  "mt-4 border-t border-black/5 pt-3 text-micro leading-relaxed text-black/60 dark:border-white/5 dark:text-white/60";
