"use client";

import { useId, useState } from "react";

// A quiet info control for a definition. It draws 20 px but takes a 44 px hit
// area on touch, opens on hover, focus or tap, and closes on leave, blur, a
// second tap or Escape. The definition is plain text (role="tooltip"), on the
// overlay surface, with the reveal timing from the motion tokens.
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
        aria-describedby={open ? id : undefined}
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
            event.stopPropagation();
            setHovered(false);
            setPinned(false);
          }
        }}
        className="relative grid h-5 w-5 shrink-0 place-items-center rounded-full text-(--sh-text-3) transition-colors duration-(--sh-dur-micro) before:absolute before:-inset-3 before:content-[''] hover:bg-(--sh-hover) hover:text-(--sh-text-1) aria-expanded:text-(--sh-text-1) pointer-fine:before:-inset-2"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 7.25v3.5" />
          <path d="M8 5.1v.05" strokeWidth="1.6" />
        </svg>
      </button>
      <span
        id={id}
        role="tooltip"
        hidden={!open}
        className={`absolute top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-(--sh-line-2) bg-(--sh-surface-overlay) p-3 text-left text-micro font-normal normal-case leading-relaxed tracking-normal text-(--sh-text-2) shadow-(--sh-shadow-overlay) backdrop-blur-xl ${position}`}
      >
        {description}
      </span>
    </span>
  );
}
