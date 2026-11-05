"use client";

import { useEffect, useId, useRef, useState } from "react";
import { calendarSubscribed } from "@/lib/analytics/events";
import { calendarName, calendarSlug } from "@/lib/events/calendar";
import { useDismissable } from "@/hooks/useDismissable";
import { SITE_URL } from "@/lib/seo/site";

const MENU_LINK =
  "flex min-h-11 items-center rounded-xl px-3 text-meta text-(--sh-text-1) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)";
const GUTTER = 16;
const DESKTOP_WIDTH = 288;

export function SubscribeControl({ scope, label = "Subscribe" }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const triggerRef = useRef(null);
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const panelId = useId();
  const slug = calendarSlug(scope);
  const name = calendarName(scope);
  const httpsUrl = `${SITE_URL}/calendar/${slug}.ics`;
  const webcalUrl = httpsUrl.replace(/^https:\/\//, "webcal://");
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`;
  const outlookUrl = `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(httpsUrl)}&name=${encodeURIComponent(name)}`;

  useDismissable(open, {
    onClose: () => setOpen(false),
    triggerRef,
    containerRef,
    closeOnOutside: true,
  });

  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  // The panel is fixed so a narrow list or a wrapped header can never push it
  // past the viewport. On phones it is full width minus the 16 px gutters; from
  // 640 px it is a compact panel pinned to the trigger's right edge.
  useEffect(() => {
    if (!open) return undefined;
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!panel || !trigger) return undefined;

    const place = () => {
      const width =
        window.innerWidth < 640
          ? window.innerWidth - GUTTER * 2
          : Math.min(DESKTOP_WIDTH, window.innerWidth - GUTTER * 2);
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${window.innerHeight - GUTTER * 2}px`;

      const rect = trigger.getBoundingClientRect();
      const height = panel.offsetHeight;
      const left = Math.min(
        Math.max(GUTTER, rect.right - width),
        window.innerWidth - width - GUTTER,
      );
      let top = rect.bottom + 8;
      if (top + height > window.innerHeight - GUTTER) {
        top = rect.top - height - 8;
      }
      top = Math.max(
        GUTTER,
        Math.min(top, window.innerHeight - height - GUTTER),
      );
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.visibility = "visible";
    };

    place();
    const first = panel.querySelector("a, button");
    first?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  const track = (method) => calendarSubscribed(scope, method);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(httpsUrl);
      track("copy");
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        data-subscribe-trigger={scope}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-(--sh-line-2) px-3 text-micro font-medium uppercase tracking-[0.12em] text-(--sh-text-2) transition-colors hover:bg-(--sh-hover) focus-visible:bg-(--sh-hover)"
      >
        {label}
        <svg
          viewBox="0 0 12 12"
          className={`h-2.5 w-2.5 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          aria-hidden="true"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </button>

      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          data-subscribe-menu={scope}
          aria-label={`${label} options`}
          style={{ position: "fixed", visibility: "hidden" }}
          className="z-[80] overflow-y-auto rounded-2xl border border-(--sh-line-1) bg-(--sh-surface-overlay) p-1.5 shadow-(--sh-shadow-overlay)"
        >
          <a
            href={webcalUrl}
            className={MENU_LINK}
            onClick={() => track("apple")}
          >
            Apple Calendar / Outlook desktop
          </a>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={MENU_LINK}
            onClick={() => track("google")}
          >
            Google Calendar
          </a>
          <a
            href={outlookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={MENU_LINK}
            onClick={() => track("outlook")}
          >
            Outlook.com
          </a>
          <button
            type="button"
            onClick={copy}
            className={`${MENU_LINK} w-full text-left`}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
          <a
            href={httpsUrl}
            download
            className={MENU_LINK}
            onClick={() => track("download")}
          >
            Download .ics
          </a>
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? "Link copied" : ""}
          </span>
        </div>
      ) : null}
    </div>
  );
}
