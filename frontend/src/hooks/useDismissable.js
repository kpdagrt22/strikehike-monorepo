"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Esc and outside-pointer dismissal for non-modal panels (floating utilities,
 * popovers, mobile sheets), with focus handed back to the control that
 * opened them.
 *
 * - Esc closes the most recently opened panel that owns focus: focus is inside
 *   its container, on its trigger, or nowhere (document.body).
 * - If focus was inside the panel (or already lost), it returns to the
 *   trigger, so keyboard, switch and screen-reader users keep their place.
 * - `closeOnOutside` also closes on a pointerdown outside the panel and its
 *   trigger, leaving focus wherever the pointer put it.
 *
 * `triggerRef` and `containerRef` take a ref object or a function returning an
 * element (for a trigger rendered by another component). Returns
 * `dismiss({ restoreFocus })` for close buttons.
 */

const openStack = [];

function resolve(target) {
  if (!target) return null;
  return typeof target === "function" ? target() : (target.current ?? null);
}

function handleEscape(event) {
  if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) {
    return;
  }

  for (let index = openStack.length - 1; index >= 0; index -= 1) {
    const entry = openStack[index];
    if (entry.ownsFocus()) {
      // Mark Escape as handled so other layers (nav, Info, planet readout)
      // stay open: one press closes one layer.
      event.preventDefault();
      entry.dismiss();
      return;
    }
  }
}

export function useDismissable(
  open,
  { onClose, triggerRef, containerRef, closeOnOutside = false } = {},
) {
  const optionsRef = useRef({ onClose, triggerRef, containerRef });

  useEffect(() => {
    optionsRef.current = { onClose, triggerRef, containerRef };
  });

  const ownsFocus = useCallback(() => {
    const active = document.activeElement;
    if (!active || active === document.body) return true;
    const { containerRef: container, triggerRef: trigger } = optionsRef.current;
    return Boolean(
      resolve(container)?.contains(active) || resolve(trigger)?.contains(active),
    );
  }, []);

  const dismiss = useCallback(
    ({ restoreFocus } = {}) => {
      const shouldRestore = restoreFocus ?? ownsFocus();
      // Resolve before closing: the trigger may depend on the open state.
      const trigger = resolve(optionsRef.current.triggerRef);
      optionsRef.current.onClose?.();
      if (shouldRestore) trigger?.focus({ preventScroll: true });
    },
    [ownsFocus],
  );

  useEffect(() => {
    if (!open) return undefined;

    const entry = { ownsFocus, dismiss };
    openStack.push(entry);
    if (openStack.length === 1) {
      document.addEventListener("keydown", handleEscape);
    }

    const onPointerDown = (event) => {
      const { containerRef: container, triggerRef: trigger } =
        optionsRef.current;
      if (
        resolve(container)?.contains(event.target) ||
        resolve(trigger)?.contains(event.target)
      ) {
        return;
      }
      dismiss({ restoreFocus: false });
    };
    if (closeOnOutside) {
      document.addEventListener("pointerdown", onPointerDown, true);
    }

    return () => {
      const index = openStack.indexOf(entry);
      if (index !== -1) openStack.splice(index, 1);
      if (openStack.length === 0) {
        document.removeEventListener("keydown", handleEscape);
      }
      if (closeOnOutside) {
        document.removeEventListener("pointerdown", onPointerDown, true);
      }
    };
  }, [open, closeOnOutside, ownsFocus, dismiss]);

  return dismiss;
}
