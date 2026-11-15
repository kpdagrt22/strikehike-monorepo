"use client";

import { OrreryFallback } from "@/components/OrreryFallback";
import { useChronoStore } from "@/store/chronoStore";

// The phone poster: the static orrery at the current positions, with one
// button that starts the WebGL scene. Used only when NEXT_PUBLIC_ORRERY_PHONE
// is "poster"; the default build keeps the live scene on phones.
export function OrreryPoster({ onStart }: { onStart: () => void }) {
  const positions = useChronoStore((state) => state.positions);
  return (
    <div data-orrery-poster="" className="absolute inset-0 z-0">
      <OrreryFallback positions={positions} />
      <div className="pointer-events-none absolute inset-x-0 bottom-48 z-30 flex justify-center px-4">
        <button
          type="button"
          onClick={onStart}
          className="pointer-events-auto inline-flex min-h-11 items-center rounded-full bg-[#f05d49] px-5 text-meta font-semibold text-[#14121a] shadow-(--sh-shadow-float) transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f05d49]"
        >
          Start the 3D view
        </button>
      </div>
    </div>
  );
}
