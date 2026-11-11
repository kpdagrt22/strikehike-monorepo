"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mounts children only when their slot approaches the viewport. The reserved
 * height is the final component's height, so the page never jumps.
 */
export function Deferred({
  children,
  minHeight = 240,
  label = "Loading section",
}) {
  const ref = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      const timer = window.setTimeout(() => setShow(true), 0);
      return () => window.clearTimeout(timer);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShow(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} style={{ minHeight }}>
      {show ? (
        children
      ) : (
        <div
          role="status"
          aria-label={label}
          className="h-full min-h-[inherit] animate-pulse rounded-2xl bg-(--sh-hover) motion-reduce:animate-none"
        />
      )}
    </div>
  );
}
