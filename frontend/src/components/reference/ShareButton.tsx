"use client";

import { useEffect, useRef, useState } from "react";
import { shareClicked } from "@/lib/analytics/events";

type ShareSurface =
  | "event"
  | "theme"
  | "date"
  | "recession"
  | "decline"
  | "regime"
  | "roundup";

// Copies the page's canonical URL (or uses the native sheet on touch). The
// status line is always in the DOM so a screen reader announces it.
export function ShareButton({
  surface,
  url,
  title = "StrikeHike",
  label = "Share",
}: {
  surface: ShareSurface;
  url: string;
  title?: string;
  label?: string;
}) {
  const [message, setMessage] = useState("");
  const timer = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const notify = (text: string) => {
    setMessage(text);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setMessage(""), 2400);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copied");
      return true;
    } catch {
      // A browser without the async clipboard: a temporary textarea still
      // copies, and never leaves the page.
      try {
        const field = document.createElement("textarea");
        field.value = url;
        field.setAttribute("readonly", "");
        field.style.position = "fixed";
        field.style.opacity = "0";
        document.body.appendChild(field);
        field.select();
        const ok = document.execCommand("copy");
        field.remove();
        if (ok) {
          notify("Link copied");
          return true;
        }
      } catch {
        // Report the failure below.
      }
      notify("Could not copy the link");
      return false;
    }
  };

  const handleClick = async () => {
    const coarse =
      typeof window !== "undefined" &&
      window.matchMedia("(pointer: coarse)").matches;
    if (coarse && typeof navigator.share === "function") {
      shareClicked(surface, "share");
      try {
        await navigator.share({ title, url });
        notify("Link shared");
      } catch {
        // The native sheet was dismissed: nothing to announce.
      }
      return;
    }
    shareClicked(surface, "clipboard");
    await copy();
  };

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        data-share-button=""
        data-share-surface={surface}
        onClick={handleClick}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-(--sh-line-1) px-3 text-micro font-medium text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) hover:text-(--sh-text-1) focus-visible:bg-(--sh-hover) focus-visible:text-(--sh-text-1) pointer-coarse:min-h-11"
      >
        <svg
          viewBox="0 0 16 16"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M8 10.5V2.5M5.2 5.3 8 2.5l2.8 2.8" />
          <path d="M3.2 8.5v3.8c0 .7.5 1.2 1.2 1.2h7.2c.7 0 1.2-.5 1.2-1.2V8.5" />
        </svg>
        {label}
      </button>
      <span
        role="status"
        aria-live="polite"
        data-share-status=""
        className={`pointer-events-none absolute left-0 top-full z-30 mt-2 whitespace-nowrap rounded-full border border-(--sh-line-1) bg-(--sh-surface-overlay) px-2.5 py-1 text-micro text-(--sh-text-2) shadow-(--sh-shadow-float) backdrop-blur-xl transition-opacity duration-(--sh-dur-reveal) ${
          message ? "opacity-100" : "opacity-0"
        }`}
      >
        {message || "\u00a0"}
      </span>
    </span>
  );
}
