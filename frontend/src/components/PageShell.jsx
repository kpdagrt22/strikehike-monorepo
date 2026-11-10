/**
 * The shared shell for the Upcoming family: one centred rail, the same side
 * padding as the Regime page, and the header clearance at the top. The
 * optional `className` goes on the scroll container, so a page can add its own
 * state but never its own width.
 */
export function PageShell({ children, className = "", ...rest }) {
  return (
    <main
      className={`relative h-full w-full overflow-y-auto overflow-x-hidden pb-24 ${className}`}
      {...rest}
    >
      <div
        data-page-shell=""
        className="mx-auto w-full max-w-[1280px] px-3 pt-(--sh-header-clear) sm:px-5 lg:px-8"
      >
        {children}
      </div>
    </main>
  );
}
