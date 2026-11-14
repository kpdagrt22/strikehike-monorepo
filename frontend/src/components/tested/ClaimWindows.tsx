"use client";

import { useState } from "react";
import { formatDate, formatPercent } from "@/components/regime/regimeUtils";

type WindowRow = {
  start: string;
  end: string;
  return: number;
  decline_start: boolean;
  kind: string;
};

// The window list is large, so it is fetched only when the reader opens it.
// The initial HTML carries the collapsed summary, not every row.
export function ClaimWindows({
  claimId,
  count,
}: {
  claimId: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<WindowRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function load() {
    if (rows || failed) return;
    try {
      const response = await fetch(`/tested/${claimId}/windows.json`);
      if (!response.ok) throw new Error("windows");
      const payload = (await response.json()) as { windows?: WindowRow[] };
      setRows(payload.windows ?? []);
    } catch {
      setFailed(true);
    }
  }

  return (
    <details
      className="group rounded-2xl border border-(--sh-line-1)"
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setOpen(next);
        if (next) void load();
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-micro font-medium uppercase tracking-[0.14em] text-(--sh-text-2)">
        <span>Windows ({count})</span>
        <span aria-hidden="true" className="text-base transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="border-t border-(--sh-line-1)">
        <div
          role="region"
          aria-label="Claim windows table"
          tabIndex={0}
          className="max-h-[24rem] overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--sh-focus)"
        >
          <table
            data-claim-windows=""
            hidden={!open}
            className="w-full border-collapse text-left text-micro"
          >
            <thead className="sticky top-0 bg-(--sh-surface-float) text-(--sh-text-3)">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium uppercase tracking-[0.12em]">Start</th>
                <th scope="col" className="px-3 py-2 font-medium uppercase tracking-[0.12em]">End</th>
                <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">Return</th>
                <th scope="col" className="px-3 py-2 text-right font-medium uppercase tracking-[0.12em]">20% fall start</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && !failed ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-(--sh-text-3)">
                    Loading the window list…
                  </td>
                </tr>
              ) : null}
              {failed ? (
                <tr>
                  <td colSpan={4} className="px-3 py-3 text-(--sh-text-3)">
                    The window list could not be loaded.
                  </td>
                </tr>
              ) : null}
              {(rows ?? []).map((window) => (
                <tr key={`${window.start}-${window.end}-${window.kind}`} className="border-t border-(--sh-line-1)">
                  <td className="whitespace-nowrap px-3 py-2 text-(--sh-text-2)">{formatDate(window.start)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-(--sh-text-2)">{formatDate(window.end)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-(--sh-text-2)">
                    {formatPercent(window.return * 100, 2)}
                  </td>
                  <td className="px-3 py-2 text-right text-(--sh-text-3)">
                    {window.decline_start ? "yes" : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
