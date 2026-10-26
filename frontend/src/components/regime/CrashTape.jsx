"use client";

import { memo } from "react";

function CrashChip({ crash, selected, onSelect }) {
  const startYear = crash.start?.slice(0, 4) ?? "—";
  const endYear = crash.end?.slice(0, 4) ?? "—";

  return (
    <button
      type="button"
      onClick={() => onSelect(crash)}
      aria-pressed={selected}
      title={`${crash.name} · ${crash.start} → ${crash.end}`}
      className={`group inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-micro transition-[border-color,background-color,color,box-shadow] duration-200 ${
        selected
          ? "border-[#ef4444]/35 bg-[#ef4444]/10 text-[#c0442f] shadow-[0_0_24px_rgba(239,68,68,0.14)] dark:border-[#fb7185]/30 dark:bg-[#fb7185]/10 dark:text-[#ff8b77]"
          : "border-black/5 bg-black/[0.025] text-black/50 hover:border-black/10 hover:bg-black/[0.05] hover:text-black/75 dark:border-white/5 dark:bg-white/[0.025] dark:text-white/50 dark:hover:border-white/10 dark:hover:bg-white/[0.06] dark:hover:text-white/75"
      }`}
    >
      <span className="font-medium">{crash.name}</span>
      <span className="font-mono text-[10px] text-current opacity-55">
        {startYear}–{endYear}
      </span>
    </button>
  );
}

function CrashTapeInner({ crashes, selectedId, onSelect }) {
  if (!Array.isArray(crashes) || crashes.length === 0) return null;

  return (
    <div className="border-t border-black/5 px-3 pb-3 pt-2.5 dark:border-white/5 sm:px-5 lg:px-8">
      <div className="mx-auto flex w-full max-w-[1600px] items-center gap-3">
        <span className="hidden shrink-0 text-[10px] font-medium uppercase tracking-[0.18em] text-black/30 dark:text-white/30 sm:inline">
          NBER dossiers
        </span>
        <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {crashes.map((crash) => (
            <CrashChip
              key={crash.id}
              crash={crash}
              selected={crash.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export const CrashTape = memo(CrashTapeInner);
