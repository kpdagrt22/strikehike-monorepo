"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { dateTravelled } from "@/lib/analytics/events";
import { bestParallel } from "@/lib/parallelEpoch";
import { useOrreryStage } from "@/hooks/useOrreryStage";
import { useChronoStore } from "@/store/chronoStore";
import { EnergyGauge } from "@/components/EnergyGauge";
import { FeedbackModule } from "@/components/FeedbackModule";
import { FilterControls } from "@/components/FilterControls";
import { FutureLadder } from "@/components/FutureLadder";
import { HomeIntro } from "@/components/HomeIntro";
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
    parts.push(`Sky activity ${Math.round(score)} / 100`);
  }

  const parallel = bestParallel(parallels);
  const match = Number(parallel?.similarity_percent);
  if (parallel?.name && Number.isFinite(match)) {
    parts.push(
      `Closest past sky: ${parallel.name}, geometry match ${match.toFixed(1)}%`,
    );
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

const subscribeMounted = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const PHONE_QUERY = "(max-width: 639.98px)";
const SHORT_PHONE_QUERY = "(max-width: 639.98px) and (max-height: 760px)";

function subscribePhone(onChange) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getPhone = () => window.matchMedia(PHONE_QUERY).matches;
const getPhoneServer = () => false;

function subscribeShortPhone(onChange) {
  const query = window.matchMedia(SHORT_PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const getShortPhone = () => window.matchMedia(SHORT_PHONE_QUERY).matches;
const getShortPhoneServer = () => false;

function subscribeIntroSeen(onChange) {
  window.addEventListener("strikehike:intro-dismissed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("strikehike:intro-dismissed", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getIntroSeen() {
  try {
    return Boolean(window.localStorage.getItem("hasSeenIntro"));
  } catch {
    return false;
  }
}

const getIntroSeenServer = () => false;

export default function Home() {
  const { resolvedTheme } = useTheme();
  const stage = useOrreryStage();

  useEffect(() => {
    const date = new URLSearchParams(window.location.search).get("d");
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const store = useChronoStore.getState();
    if (store.focusedDate !== date) {
      dateTravelled("deep_link", date);
      store.setFocusedDate(date);
    }
  }, []);

  // false during SSR/hydration, true after: avoids a dark-material flash on a light theme.
  const mounted = useSyncExternalStore(
    subscribeMounted,
    getClientSnapshot,
    getServerSnapshot,
  );
  const phone = useSyncExternalStore(subscribePhone, getPhone, getPhoneServer);
  const shortPhone = useSyncExternalStore(
    subscribeShortPhone,
    getShortPhone,
    getShortPhoneServer,
  );
  const introSeen = useSyncExternalStore(
    subscribeIntroSeen,
    getIntroSeen,
    getIntroSeenServer,
  );
  // The short-phone first visit gets the compact intro too: at 740 px the full
  // promise plus the gauge would leave the orrery no room above the hint.
  const compactIntro = phone && (introSeen || shortPhone);
  // Dark until mounted, so the server HTML and the hydration render agree; the
  // post-mount render then patches the light colours (React 19 does not patch
  // mismatched attributes during hydration).
  const isDark = mounted ? resolvedTheme !== "light" : true;
  const regimeTone = useChronoStore((state) => state.regimeTone);

  return (
    <main className="relative h-full w-full overflow-hidden border-0 p-0">
      <Canvas3D isDark={isDark} mounted={mounted} regimeTone={regimeTone} stage={stage} />

      <HomeIntro compact={compactIntro} />
      <RegimeOverlaySync />
      <EnergyGauge
        isDark={isDark}
        homeIntro
        gaugeTop={stage?.gaugeTop ?? null}
      />
      <Tooltip />
      {/* Before the tray in DOM order: forward Tab reaches the dock before the
          tray's focus-expansion hides it. */}
      <MobileDock />
      <TimeControls />
      <div
        data-home-left-column
        className="contents lg:fixed lg:bottom-20 lg:left-5 lg:z-30 lg:flex lg:w-[min(18rem,calc(100vw-1.5rem))] lg:flex-col lg:gap-2 lg:top-[23.5rem] xl:top-[21rem]"
      >
        <FilterControls />
        <FutureLadder />
      </div>
      <RightPanel />
      <ViewControls />
      <InfoModule />
      <FeedbackModule />
      <SponsorModule />
      <OnboardingOverlay />
      <DateChangeAnnouncer />
    </main>
  );
}
