"use client";

import { methodOpened } from "@/lib/analytics/events";

/** The interactive shell around the server-rendered Method & record body. */
export function MethodDetails({ children }) {
  return (
    <details
      id="regime-method"
      onToggle={(event) => {
        if (event.currentTarget.open) methodOpened("method_limits", "/regime");
      }}
      className="group mt-4 scroll-mt-24 rounded-[1.4rem] border border-(--sh-line-1) bg-white/45 p-5 dark:bg-black/25 sm:p-6"
    >
      <summary className="-m-2 flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl p-2 text-micro font-medium uppercase tracking-[0.16em] text-black/60 [&::-webkit-details-marker]:hidden dark:text-white/60">
        Method &amp; record
        <span
          className="text-base font-normal text-black/60 transition-transform group-open:rotate-45 dark:text-white/60"
          aria-hidden="true"
        >
          +
        </span>
      </summary>
      {children}
    </details>
  );
}
