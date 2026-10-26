"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { useRegimeOverlay } from "@/hooks/useRegimeOverlay";
import { useChronoStore } from "@/store/chronoStore";
import { Canvas3D } from "@/components/Canvas3D";
import { EnergyGauge } from "@/components/EnergyGauge";
import { FeedbackModule } from "@/components/FeedbackModule";
import { FilterControls } from "@/components/FilterControls";
import { FutureLadder } from "@/components/FutureLadder";
import { InfoModule } from "@/components/InfoModule";
import { MobileDock } from "@/components/MobileDock";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { RightPanel } from "@/components/RightPanel";
import { SponsorModule } from "@/components/SponsorModule";
import { TimeControls } from "@/components/TimeControls";
import { Tooltip } from "@/components/Tooltip";
import { ViewControls } from "@/components/ViewControls";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;
const getIntroSeen = () =>
  typeof window !== "undefined" &&
  window.sessionStorage.getItem("strikehike-intro-seen") === "1";
const getIntroServerSnapshot = () => false;

export default function Home() {
  const { resolvedTheme } = useTheme();
  const [introComplete, setIntroComplete] = useState(false);
  const introSeen = useSyncExternalStore(
    subscribe,
    getIntroSeen,
    getIntroServerSnapshot,
  );
  const introDone = introComplete || introSeen;

  const handleIntroComplete = useCallback(() => {
    setIntroComplete(true);
    window.sessionStorage.setItem("strikehike-intro-seen", "1");
  }, []);

  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("d");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const store = useChronoStore.getState();
    if (store.focusedDate !== date) store.setFocusedDate(date);
  }, []);

  // false during SSR/hydration, true after: avoids a dark-material flash on a light theme.
  const mounted = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const isDark = resolvedTheme !== "light";
  const regimeTone = useChronoStore((state) => state.regimeTone);
  useRegimeOverlay();

  return (
    <main className="relative h-full w-full overflow-hidden border-0 p-0">
      <h1 className="sr-only">StrikeHike Universal Chrono-Spatial Engine</h1>

      <Canvas3D
        isDark={isDark}
        mounted={mounted}
        onIntroComplete={handleIntroComplete}
        regimeTone={regimeTone}
      />

      <EnergyGauge isDark={isDark} />
      <Tooltip />
      <TimeControls />
      <FilterControls />
      <FutureLadder />
      <RightPanel />
      <ViewControls />
      <MobileDock />
      <InfoModule />
      <FeedbackModule />
      <SponsorModule />
      <OnboardingOverlay introComplete={introDone} />
    </main>
  );
}
