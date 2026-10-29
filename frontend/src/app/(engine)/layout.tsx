import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";

export default function EngineLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-(image:--sh-engine-sky) p-0">
      <SiteHeader />
      {children}
    </div>
  );
}
