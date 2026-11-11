// Server-rendered Regime header: the first text paint does not wait for the
// client bundle.
export function RegimeHeader() {
  return (
    <header className="max-w-3xl">
      <p className="text-micro uppercase tracking-[0.2em] text-[#a83a27] dark:text-[#ff8b77]">
        Macro atlas
      </p>
      <h1 className="mt-2 text-[2rem] font-semibold leading-[0.98] tracking-[-0.05em] text-[#14121a] dark:text-[#f2ede4] sm:text-5xl">
        The −50 to +50 macro atlas.
      </h1>
      <p className="mt-3 max-w-2xl text-meta leading-relaxed text-black/60 dark:text-white/60 sm:text-body">
        A weekly −50 to +50 reading of US market stress since 1854, set against
        every NBER recession.
      </p>
    </header>
  );
}
