"use client";

import { useState } from "react";
import { ledgerHash } from "@/lib/ledger/canonical";

const ZERO_HASH = "0".repeat(64);

class Break extends Error {
  seq: number;

  constructor(seq: number, message: string) {
    super(message);
    this.seq = seq;
  }
}

type State = "idle" | "checking" | "ok" | "broken" | "error";

export function LedgerVerify() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");

  const verify = async () => {
    setState("checking");
    setMessage("");
    try {
      const response = await fetch("/ledger.jsonl", { cache: "no-store" });
      const text = await response.text();
      if (!response.ok) throw new Error("ledger unavailable");
      const lines = text.split(/\r?\n/).filter((line) => line.trim());
      let previous = ZERO_HASH;
      for (let index = 0; index < lines.length; index += 1) {
        let entry: Record<string, unknown>;
        try {
          entry = JSON.parse(lines[index]);
        } catch {
          throw new Break(index + 1, "line is not JSON");
        }
        const seq = index + 1;
        if (entry.seq !== seq) throw new Break(seq, `expected seq ${seq}`);
        if (entry.prev_hash !== previous) {
          throw new Break(seq, "prev_hash does not link");
        }
        if (typeof entry.hash !== "string" || entry.hash.length !== 64) {
          throw new Break(seq, "bad hash");
        }
        let computed;
        try {
          computed = await ledgerHash(entry);
        } catch (error) {
          throw new Break(
            seq,
            error instanceof Error ? error.message : "canonical form rejected",
          );
        }
        if (computed !== entry.hash) {
          throw new Break(seq, "hash does not match");
        }
        previous = entry.hash;
      }
      setState("ok");
      setMessage(`✓ chain intact (${lines.length} entries)`);
    } catch (error) {
      if (error instanceof Break) {
        setState("broken");
        setMessage(`✗ break at seq ${error.seq}`);
      } else {
        setState("error");
        setMessage("Couldn't verify the ledger in this browser.");
      }
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={verify}
        disabled={state === "checking"}
        data-ledger-verify
        className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === "checking" ? "Verifying…" : "Verify in your browser"}
      </button>
      <p
        aria-live="polite"
        data-ledger-verify-result
        className={`mt-2 text-micro ${
          state === "ok"
            ? "text-(--sh-text-1)"
            : state === "broken" || state === "error"
              ? "text-(--sh-text-2)"
              : "text-(--sh-text-3)"
        }`}
      >
        {message}
      </p>
    </div>
  );
}
