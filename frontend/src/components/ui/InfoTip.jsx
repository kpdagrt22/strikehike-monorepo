"use client";

import { useId, useState } from "react";

// A quiet 24 px info control: the definition opens on hover, keyboard focus or
// a tap, and closes when the pointer/focus leaves or the control is tapped
// again. The tooltip is plain text, not a second interactive surface.
export function InfoTip({
  label,
  description,
  align = "center",
  className = "",
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hovered || pinned;
  const position =
    align === "start"
      ? "left-0"
      : align === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <span
      className={`pointer-events-auto relative inline-flex ${className}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setHovered(false);
      }}
    >
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setPinned((value) => !value);
        }}
        onFocus={() => setHovered(true)}
        onBlur={() => {
          setHovered(false);
          setPinned(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setHovered(false);
            setPinned(false);
            event.currentTarget.blur();
          }
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-black/10 text-black/60 transition-colors hover:border-black/20 hover:text-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sh-focus) dark:border-white/15 dark:text-white/60 dark:hover:border-white/25 dark:hover:text-white/85"
      >
        <span aria-hidden="true" className="font-serif text-[13px] italic leading-none">
          i
        </span>
      </button>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-1.5 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-black/10 bg-[#f5f0e8] p-2.5 text-left text-micro font-normal normal-case leading-relaxed tracking-normal text-black/70 shadow-[0_12px_36px_rgba(20,18,26,0.16)] dark:border-white/10 dark:bg-[#14121a] dark:text-white/70 dark:shadow-[0_12px_36px_rgba(0,0,0,0.45)] ${position}`}
        >
          {description}
        </span>
      ) : null}
    </span>
  );
}
