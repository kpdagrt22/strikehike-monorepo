// One motion vocabulary for framer-motion and GSAP. Mirrors the --sh-* motion
// tokens in app/globals.css; change both together.
export const EASE = { out: [0.22, 1, 0.36, 1], inOut: [0.65, 0, 0.35, 1], exit: [0.4, 0, 1, 1] };
export const DUR = { micro: 0.14, reveal: 0.2, revealOut: 0.14, panel: 0.28, panelOut: 0.2, modal: 0.32, backdrop: 0.2, data: 0.6 };
export const SPRING = { panel: { type: "spring", stiffness: 380, damping: 36, mass: 0.9 } }; // ≈260 ms, no overshoot
export const INTENT = { hoverOpenMs: 120, hoverCloseMs: 300, clickGuardMs: 400, autoCollapseMs: 30000 };
export const PRESS_SCALE = 0.97;
export const reveal = {
  initial: { opacity: 0, y: 4, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: DUR.reveal, ease: EASE.out } },
  exit: { opacity: 0, y: 2, scale: 0.99, transition: { duration: DUR.revealOut, ease: EASE.exit } },
};
export const panel = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0, transition: { duration: DUR.panel, ease: EASE.out } },
  exit: { opacity: 0, y: 8, transition: { duration: DUR.panelOut, ease: EASE.exit } },
};
