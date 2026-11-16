// Classes the server-rendered SEO blocks share with the views around them, copied from each
// page's own Method & limits and footer links, so the new rows read as part of the page.

/** The engine pages' quiet footer link (/regime, /patterns), 44 px tall on touch. The
 *  utilities live in globals.css (.sh-link): the footer repeats this link about 15 times on
 *  every page, and each copy is in both the HTML and the RSC payload (S3.2). */
export const LINK = "sh-link";

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
