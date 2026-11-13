"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function UnsubscribeButton({ token }: { token: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "sending" | "error">("idle");

  const unsubscribe = async () => {
    if (state === "sending") return;
    setState("sending");
    try {
      const response = await fetch(
        `/api/digest/unsubscribe?t=${encodeURIComponent(token)}`,
        { method: "POST" },
      );
      // Consume the body before navigating or showing the error state.
      await response.text();
      if (response.ok) {
        router.push("/digest/unsubscribed");
        return;
      }
      setState("error");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={unsubscribe}
        disabled={state === "sending" || !token}
        data-digest-unsubscribe
        className="inline-flex min-h-9 items-center rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) disabled:cursor-not-allowed disabled:opacity-40"
      >
        {state === "sending" ? "Unsubscribing…" : "Unsubscribe me"}
      </button>
      <p aria-live="polite" className="mt-2 text-micro text-(--sh-text-3)">
        {!token || state === "error"
          ? "This link is invalid or has expired."
          : "One click removes this address from the weekly email."}
      </p>
    </div>
  );
}
