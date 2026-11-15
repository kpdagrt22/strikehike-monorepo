import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";
import { EventActionTracker } from "@/components/upcoming/EventActionTracker";
import { LocalTimeSync } from "@/components/upcoming/LocalTimeSync";

export default function EngineLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-(image:--sh-engine-sky) p-0">
      <SiteHeader />
      <LocalTimeSync />
      <EventActionTracker />
      {children}
    </div>
  );
}
