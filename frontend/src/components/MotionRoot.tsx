"use client";

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

// reducedMotion="user": under the OS reduce setting framer-motion drops
// transform and layout animation and keeps opacity. Mounted only by the client
// trees that actually animate (home, regime, convergence), so routes that do
// not animate never download framer-motion.
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
