"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Canvas3D } from "@/components/Canvas3D";
import { EnergyGauge } from "@/components/EnergyGauge";
import { FilterControls } from "@/components/FilterControls";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { Timeline } from "@/components/Timeline";
import { Tooltip } from "@/components/Tooltip";
import { ViewControls } from "@/components/ViewControls";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function Home() {
  const { resolvedTheme } = useTheme();
  const [introComplete, setIntroComplete] = useState(false);

  const handleIntroComplete = useCallback(() => {
    setIntroComplete(true);
  }, []);

  // false during SSR/hydration, true after: avoids a dark-material flash on a light theme.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = resolvedTheme !== "light";

  return (
    <main className="relative h-[100dvh] w-screen overflow-hidden border-0 bg-[radial-gradient(ellipse_at_50%_28%,#ffffff_0%,#faf7f2_30%,#f1ebe2_62%,#e3dbcf_100%)] p-0 dark:bg-[radial-gradient(ellipse_at_50%_28%,#232330_0%,#141420_30%,#090910_62%,#020204_100%)]">
      <h1 className="sr-only">StrikeHike Universal Chrono-Spatial Engine</h1>

      <Canvas3D
        isDark={isDark}
        mounted={mounted}
        onIntroComplete={handleIntroComplete}
      />

      <EnergyGauge isDark={isDark} />
      <Tooltip />
      <Timeline />
      <FilterControls />
      <ViewControls />
      <OnboardingOverlay introComplete={introComplete} />
    </main>
  );
}
