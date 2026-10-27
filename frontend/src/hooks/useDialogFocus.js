import { useEffect, useRef } from "react";

const TABBABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function tabbables(container) {
  return Array.from(container.querySelectorAll(TABBABLE)).filter(
    (element) =>
      element.tabIndex >= 0 &&
      element.getClientRects().length > 0 &&
      !element.closest("[inert]"),
  );
}

// When the opener is gone, land at the top of the page's content instead of
// dropping focus to <body>.
function fallbackFocusTarget() {
  const heading = document.querySelector("main h1");
  if (heading && !heading.hasAttribute("tabindex")) {
    heading.setAttribute("tabindex", "-1");
  }
  return heading;
}

/**
 * Modal focus contract. While `open`: remembers the element that had focus,
 * moves focus into the dialog (initialFocusRef, else its first control),
 * keeps Tab and Shift+Tab inside it and calls onClose on Escape. On close it
 * hands focus back to the remembered element, or to `main h1`.
 */
export function useDialogFocus(open, { containerRef, initialFocusRef, onClose } = {}) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const container = containerRef?.current;
    if (!open || !container) return undefined;

    // autoFocus may already have moved focus inside; that is not the opener.
    const active = document.activeElement;
    const opener =
      active instanceof HTMLElement &&
      active !== document.body &&
      !container.contains(active)
        ? active
        : null;

    const focusInitial = () => {
      const target =
        initialFocusRef?.current ?? tabbables(container)[0] ?? container;
      target.focus({ preventScroll: true });
    };

    if (!container.contains(document.activeElement)) focusInitial();

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        // The topmost layer owns Escape: panels behind the dialog stay put.
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const items = tabbables(container);
      if (!items.length) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const current = document.activeElement;
      const inside = container.contains(current);

      if (event.shiftKey) {
        if (!inside || current === first || current === container) {
          event.preventDefault();
          last.focus();
        }
      } else if (!inside || current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Focus that escapes (a click on the scrim, assistive tech) comes back.
    const handleFocusIn = (event) => {
      if (!container.contains(event.target)) focusInitial();
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn);
      const target = opener?.isConnected ? opener : fallbackFocusTarget();
      target?.focus({ preventScroll: true });
    };
  }, [open, containerRef, initialFocusRef]);
}
