"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useTheme } from "next-themes";
import { bestParallel } from "@/lib/parallelEpoch";
import { useChronoStore } from "@/store/chronoStore";
import { EnergyGauge } from "@/components/EnergyGauge";
import { FeedbackModule } from "@/components/FeedbackModule";
import { FilterControls } from "@/components/FilterControls";
import { FutureLadder } from "@/components/FutureLadder";
import { InfoModule } from "@/components/InfoModule";
import { MobileDock } from "@/components/MobileDock";
import { OnboardingOverlay } from "@/components/OnboardingOverlay";
import { RegimeOverlaySync } from "@/components/RegimeOverlaySync";
import { RightPanel } from "@/components/RightPanel";
import { SponsorModule } from "@/components/SponsorModule";
import { TimeControls } from "@/components/TimeControls";
import { Tooltip } from "@/components/Tooltip";
import { ViewControls } from "@/components/ViewControls";

// The WebGL stack (three, R3F, drei, GSAP) loads after the HUD has painted.
// The engine layout's radial gradient is the poster, and the canvas is
// absolute inset-0, so nothing shifts when it arrives.
const Canvas3D = dynamic(
  () => import("@/components/Canvas3D").then((mod) => mod.Canvas3D),
  { ssr: false, loading: () => null },
);

// A date change counts as the visitor's own when it follows a pointer, key or
// input event this closely. Load, deep links and hover are never announced.
const USER_INTENT_WINDOW_MS = 1500;
// Long enough that deliberate one-step-a-second travel is announced once,
// when it stops.
const ANNOUNCE_SETTLE_MS = 1500;

const announceDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

const announceTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

function describeMoment(date, time) {
  try {
    const day = announceDateFormatter.format(new Date(`${date}T00:00:00Z`));
    if (!time || time === "00:00") return day;
    const clock = announceTimeFormatter.format(new Date(`${date}T${time}:00Z`));
    return `${day} · ${clock} UTC`;
  } catch {
    return date;
  }
}

function buildAnnouncement({ focusedDate, focusedTime, energy, parallels }) {
  const parts = [describeMoment(focusedDate, focusedTime)];

  const score = Number(energy?.score);
  if (energy && Number.isFinite(score)) {
    parts.push(
      `Energy ${Math.round(score)}${energy.polarity ? `, ${energy.polarity}` : ""}`,
    );
  }

  const parallel = bestParallel(parallels);
  const match = Number(parallel?.similarity_percent);
  if (parallel?.name && Number.isFinite(match)) {
    parts.push(`Most similar: ${parallel.name}, ${match.toFixed(1)}% match`);
  }

  return parts.join(" · ");
}

// One polite, atomic announcement after a user-initiated date change settles,
// so screen-reader users hear the outcome of time travel.
function DateChangeAnnouncer() {
  const focusedDate = useChronoStore((state) => state.focusedDate);
  const focusedTime = useChronoStore((state) => state.focusedTime);
  const status = useChronoStore((state) => state.status);
  const energy = useChronoStore((state) => state.energy);
  const parallels = useChronoStore((state) => state.parallels);
  const [announcement, setAnnouncement] = useState({ id: 0, text: "" });
  const lastInputAt = useRef(Number.NEGATIVE_INFINITY);
  const pendingMoment = useRef(null);
  const moment = `${focusedDate}T${focusedTime}`;

  useEffect(() => {
    const markInput = () => {
      lastInputAt.current = performance.now();
    };
    const options = { capture: true, passive: true };
    window.addEventListener("pointerdown", markInput, options);
    window.addEventListener("keydown", markInput, options);
    window.addEventListener("input", markInput, options);
    return () => {
      window.removeEventListener("pointerdown", markInput, options);
      window.removeEventListener("keydown", markInput, options);
      window.removeEventListener("input", markInput, options);
    };
  }, []);

  useEffect(() => {
    pendingMoment.current =
      performance.now() - lastInputAt.current < USER_INTENT_WINDOW_MS
        ? moment
        : null;
  }, [moment]);

  useEffect(() => {
    if (status !== "ready" || pendingMoment.current !== moment) {
      return undefined;
    }

    const timer = setTimeout(() => {
      pendingMoment.current = null;
      setAnnouncement((current) => ({
        id: current.id + 1,
        text: buildAnnouncement({
          focusedDate,
          focusedTime,
          energy,
          parallels,
        }),
      }));
    }, ANNOUNCE_SETTLE_MS);

    return () => clearTimeout(timer);
  }, [status, moment, focusedDate, focusedTime, energy, parallels]);

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      <span key={announcement.id}>{announcement.text}</span>
    </p>
  );
}

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
  // Dark until mounted, so the server HTML and the hydration render agree; the
  // post-mount render then patches the light colours (React 19 does not patch
  // mismatched attributes during hydration).
  const isDark = mounted ? resolvedTheme !== "light" : true;
  const regimeTone = useChronoStore((state) => state.regimeTone);

  return (
    <main className="relative h-full w-full overflow-hidden border-0 p-0">
      <h1 className="sr-only">StrikeHike Universal Chrono-Spatial Engine</h1>

      <Canvas3D
        isDark={isDark}
        mounted={mounted}
        onIntroComplete={handleIntroComplete}
        regimeTone={regimeTone}
      />

      <RegimeOverlaySync />
      <EnergyGauge isDark={isDark} />
      <Tooltip />
      {/* Before the tray in DOM order: forward Tab reaches the dock before the
          tray's focus-expansion hides it. */}
      <MobileDock />
      <TimeControls />
      <FilterControls />
      <FutureLadder />
      <RightPanel />
      <ViewControls />
      <InfoModule />
      <FeedbackModule />
      <SponsorModule />
      <OnboardingOverlay introComplete={introDone} />
      <DateChangeAnnouncer />
    </main>
  );
}
