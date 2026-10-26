import type { ReactNode } from "react";
import { SiteHeader } from "@/components/SiteHeader";

export default function EngineLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden bg-[radial-gradient(ellipse_at_50%_28%,#ffffff_0%,#faf7f2_30%,#f1ebe2_62%,#e3dbcf_100%)] p-0 dark:bg-[radial-gradient(ellipse_at_50%_28%,#232330_0%,#141420_30%,#090910_62%,#020204_100%)]">
      <SiteHeader />
      {children}
    </div>
  );
}
