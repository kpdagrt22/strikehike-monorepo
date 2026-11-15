// The case trigger's box while the picker chunk loads: the same grid and line
// boxes as the real trigger, with quiet blocks for the name and the subline,
// so the compare bar keeps its height. Kept out of CasePicker.jsx so a page can
// import the skeleton without pulling the picker (and framer-motion) with it.
const SIDE_COLOR = {
  a: "[--case-color:#14121a] dark:[--case-color:#f2ede4]",
  b: "[--case-color:#c0442f] dark:[--case-color:#ff8b77]",
};

const TRIGGER_BOX =
  "grid min-h-12 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-[14px] px-2.5 py-1.5 text-left max-sm:min-h-[52px] max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:px-2";

export function CaseTriggerPlaceholder({ side = "a" }) {
  return (
    <div
      aria-hidden="true"
      className={`${TRIGGER_BOX} ${SIDE_COLOR[side] ?? SIDE_COLOR.a}`}
    >
      <span className="inline-flex items-center gap-1.5 font-mono text-micro text-(--sh-text-3) max-sm:col-span-2">
        <span className="h-0.5 w-3.5 rounded-full bg-(--case-color)" />
        {side === "b" ? "B" : "A"}
      </span>
      <span className="min-w-0">
        <span className="block text-strong font-semibold leading-tight max-sm:text-body">
          <span className="inline-block h-[0.85em] w-36 max-w-full rounded bg-(--sh-hover) align-middle" />
        </span>
        <span className="mt-0.5 block font-mono text-micro">
          <span className="inline-block h-[0.85em] w-20 max-w-full rounded bg-(--sh-hover) align-middle" />
        </span>
      </span>
      <span className="h-3.5 w-3.5" />
    </div>
  );
}
