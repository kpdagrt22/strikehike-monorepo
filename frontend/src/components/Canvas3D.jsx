"use client";

import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import gsap from "gsap";
import { AmbientCosmos } from "@/components/AmbientCosmos";
import { PlanetarySystem } from "@/components/PlanetarySystem";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

// Camera keys are calibrated to the compact orrery radius (not literal AU scale).
const ORBITAL_VIEW = { x: 0, y: 8, z: 14 };
// Portrait phones: a closer, more top-down framing. The orbit is a flat disc,
// so tilting down makes the ring use the tall viewport instead of leaving a
// vertical dead zone above and below it.
const PORTRAIT_ORBITAL_VIEW = { x: 0, y: 16, z: 12 };
// Large desktops: pull in so the orrery commands the center of the canvas.
const WIDE_ORBITAL_VIEW = { x: 0, y: 5, z: 10 };
const ZENITH_VIEW = { x: 0, y: 22, z: 0 };
const PORTRAIT_ZENITH_VIEW = { x: 0, y: 28, z: 0 };
const INTRO_START = { x: 0, y: 55, z: 95 };
// Scene motion. The fly-in is short and any pointer, wheel or key input lands
// it at once; view changes are calm. Reduced motion places the camera.
const INTRO_DURATION = 1.8;
const INTRO_EASE = "power3.out";
const VIEW_DURATION = 1.2;
const VIEW_EASE = "power3.inOut";
const AUTO_ROTATE_SPEED = 0.16;
const IDLE_RESUME_MS = 4200;
// Ambient motion (auto-rotate, dust, ring, Earth spin) runs only while the sky
// is awake, within AWAKE_MS of the last intent. It then eases to rest and the
// canvas renders on demand until the next intent.
const AWAKE_MS = 12000;
const REST_EASE_SECONDS = 1.2;
const WAKE_THROTTLE_MS = 250;
const MAX_FRAME_DELTA = 1 / 30;
const CANVAS_INTENT_EVENTS = ["pointermove", "pointerdown", "wheel", "touchstart"];
const INTRO_SKIP_EVENTS = ["pointerdown", "wheel", "keydown"];

const CAMERA_FRAMING = {
  portrait: { orbital: PORTRAIT_ORBITAL_VIEW, zenith: PORTRAIT_ZENITH_VIEW },
  standard: { orbital: ORBITAL_VIEW, zenith: ZENITH_VIEW },
  wide: { orbital: WIDE_ORBITAL_VIEW, zenith: ZENITH_VIEW },
};

function getFramingKey(width, height) {
  const aspect = width / Math.max(height, 1);
  if (aspect < 0.8) return "portrait";
  if (width >= 1200) return "wide";
  return "standard";
}

function CameraRig({
  onIntroComplete,
  reducedMotion,
  ambientRef,
  onRestChange,
  isDark,
  regimeTone,
}) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const eventSource = useThree((state) => state.events.connected);
  const framing = CAMERA_FRAMING[getFramingKey(size.width, size.height)];
  const controlsRef = useRef(null);
  const idleTimerRef = useRef(null);
  const appliedViewRef = useRef(false);
  const introStartedRef = useRef(false);
  const introDoneRef = useRef(false);
  const introCallbackRef = useRef(onIntroComplete);
  const framingRef = useRef(framing);
  const introTargetRef = useRef(framing.orbital);
  const reducedMotionRef = useRef(reducedMotion);
  const awakeRef = useRef(true);
  const restingRef = useRef(false);
  const sleepTimerRef = useRef(null);
  const lastWakeRef = useRef(0);

  const [introComplete, setIntroComplete] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [viewTweening, setViewTweening] = useState(false);

  const cameraView = useChronoStore((state) => state.cameraView);
  const cameraRevision = useChronoStore((state) => state.cameraRevision);

  useEffect(() => {
    introCallbackRef.current = onIntroComplete;
  }, [onIntroComplete]);

  useEffect(() => {
    framingRef.current = framing;
    introTargetRef.current = framing.orbital;
  }, [framing]);

  // Reduced motion: the sky is still from the first frame.
  useLayoutEffect(() => {
    reducedMotionRef.current = reducedMotion;
    if (reducedMotion) ambientRef.current = 0;
  }, [reducedMotion, ambientRef]);

  // Any intent wakes the sky: ambient motion resumes and every frame renders
  // until AWAKE_MS pass without another intent. Reduced motion stays on demand.
  const wake = useCallback(() => {
    if (reducedMotionRef.current) return;
    const now = performance.now();
    if (awakeRef.current && now - lastWakeRef.current < WAKE_THROTTLE_MS) {
      return;
    }
    lastWakeRef.current = now;
    awakeRef.current = true;
    clearTimeout(sleepTimerRef.current);
    sleepTimerRef.current = setTimeout(() => {
      awakeRef.current = false;
      invalidate();
    }, AWAKE_MS);
    if (restingRef.current) {
      restingRef.current = false;
      onRestChange(false);
    }
  }, [invalidate, onRestChange]);

  // Ease ambient motion toward awake (1) or rest (0). At rest, hand the
  // canvas to on-demand rendering; nothing here runs between demand frames.
  useFrame((_, delta) => {
    let factor = ambientRef.current;
    if (reducedMotion) {
      factor = 0;
    } else {
      const target = awakeRef.current ? 1 : 0;
      if (factor !== target) {
        const step = Math.min(delta, MAX_FRAME_DELTA) / REST_EASE_SECONDS;
        factor =
          target > factor
            ? Math.min(target, factor + step)
            : Math.max(target, factor - step);
      }
    }
    ambientRef.current = factor;
    if (controlsRef.current) {
      controlsRef.current.autoRotateSpeed = AUTO_ROTATE_SPEED * factor;
    }
    if (
      !reducedMotion &&
      factor === 0 &&
      !awakeRef.current &&
      !restingRef.current
    ) {
      restingRef.current = true;
      onRestChange(true);
    }
  });

  // Intent on the canvas, any key, or the tab coming back into view.
  useEffect(() => {
    const target = eventSource || null;
    const handleIntent = () => wake();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") wake();
    };
    if (target) {
      for (const type of CANVAS_INTENT_EVENTS) {
        target.addEventListener(type, handleIntent, { passive: true });
      }
    }
    window.addEventListener("keydown", handleIntent);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      if (target) {
        for (const type of CANVAS_INTENT_EVENTS) {
          target.removeEventListener(type, handleIntent);
        }
      }
      window.removeEventListener("keydown", handleIntent);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [eventSource, wake]);

  // Date, time, positions or view changes move the sky: wake it.
  useEffect(
    () =>
      useChronoStore.subscribe((state, previous) => {
        if (
          state.focusedDate !== previous.focusedDate ||
          state.focusedTime !== previous.focusedTime ||
          state.positions !== previous.positions ||
          state.cameraRevision !== previous.cameraRevision
        ) {
          wake();
        }
      }),
    [wake],
  );

  // A theme or regime-tone change restyles the sky, and turning reduced
  // motion off resumes ambient motion: both wake it.
  useEffect(() => {
    wake();
  }, [isDark, regimeTone, reducedMotion, wake]);

  useEffect(() => () => clearTimeout(sleepTimerRef.current), []);

  const emitCameraState = useCallback(
    (phase, view) => {
      if (typeof window === "undefined") return;
      const detail = {
        phase,
        view,
        position: camera.position
          .toArray()
          .map((value) => Number(value.toFixed(2))),
      };
      window.dispatchEvent(
        new CustomEvent("strikehike:camera", { detail }),
      );
      if (process.env.NODE_ENV !== "production") {
        console.info("[StrikeHike camera]", detail);
      }
    },
    [camera],
  );

  useEffect(() => {
    if (introStartedRef.current) return undefined;
    introStartedRef.current = true;

    camera.position.set(INTRO_START.x, INTRO_START.y, INTRO_START.z);
    camera.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }

    let tween = null;
    // The fly-in never blocks anyone: any pointer, wheel or key input lands it.
    const skipIntro = () => tween?.progress(1);
    const stopSkipListeners = () => {
      for (const type of INTRO_SKIP_EVENTS) {
        window.removeEventListener(type, skipIntro);
      }
    };

    // Under reduced motion the zero-length tween places the camera at its
    // framing and completes at once.
    tween = gsap.to(camera.position, {
      ...introTargetRef.current,
      duration: reducedMotionRef.current ? 0 : INTRO_DURATION,
      ease: INTRO_EASE,
      onUpdate: () => {
        controlsRef.current?.update();
        invalidate();
      },
      onComplete: () => {
        stopSkipListeners();
        introDoneRef.current = true;
        // Orientation may have changed mid-intro: land on the live framing.
        const liveFraming = framingRef.current;
        camera.position.set(
          liveFraming.orbital.x,
          liveFraming.orbital.y,
          liveFraming.orbital.z,
        );
        controlsRef.current?.update();
        invalidate();
        setIntroComplete(true);
        emitCameraState("intro-complete", "orbital");
        introCallbackRef.current?.();
        wake();
      },
    });

    if (!introDoneRef.current) {
      for (const type of INTRO_SKIP_EVENTS) {
        window.addEventListener(type, skipIntro, { passive: true });
      }
    }

    return () => {
      stopSkipListeners();
      tween.kill();
      // A StrictMode re-run must be able to start an unfinished intro again.
      if (!introDoneRef.current) introStartedRef.current = false;
      clearTimeout(idleTimerRef.current);
    };
  }, [camera, emitCameraState, invalidate, wake]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return undefined;

    const handleStart = () => {
      clearTimeout(idleTimerRef.current);
      setInteracting(true);
    };

    const handleEnd = () => {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = setTimeout(() => {
        setInteracting(false);
      }, IDLE_RESUME_MS);
    };

    controls.addEventListener("start", handleStart);
    controls.addEventListener("end", handleEnd);

    return () => {
      controls.removeEventListener("start", handleStart);
      controls.removeEventListener("end", handleEnd);
      clearTimeout(idleTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!introComplete) return undefined;

    if (!appliedViewRef.current) {
      appliedViewRef.current = true;
      return undefined;
    }

    const target =
      cameraView === "zenith" ? framing.zenith : framing.orbital;

    setViewTweening(true);
    const tween = gsap.to(camera.position, {
      ...target,
      duration: reducedMotionRef.current ? 0 : VIEW_DURATION,
      ease: VIEW_EASE,
      onUpdate: () => {
        controlsRef.current?.update();
        invalidate();
      },
      onComplete: () => {
        setViewTweening(false);
        emitCameraState("view-complete", cameraView);
      },
    });

    return () => {
      tween.kill();
      setViewTweening(false);
    };
  }, [
    camera,
    cameraView,
    cameraRevision,
    emitCameraState,
    framing,
    introComplete,
    invalidate,
  ]);

  const shouldAutoRotate =
    !reducedMotion &&
    introComplete &&
    !interacting &&
    !viewTweening &&
    cameraView === "orbital";

  // autoRotateSpeed is driven per frame by the ambient factor (see useFrame).
  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableZoom
      enablePan={false}
      maxPolarAngle={Math.PI / 2 - 0.05}
      autoRotate={shouldAutoRotate}
      enableDamping={!reducedMotion}
      dampingFactor={0.055}
      minDistance={4}
      maxDistance={180}
      target={[0, 0, 0]}
    />
  );
}

// Memoised: a date step re-renders the page, not the scene graph.
export const Canvas3D = memo(function Canvas3D({
  isDark = true,
  mounted = false,
  onIntroComplete,
  regimeTone = null,
}) {
  const reducedMotion = usePrefersReducedMotion();
  // Full motion renders every frame while the sky is awake and on demand at
  // rest; reduced motion renders on demand from the first frame.
  const [resting, setResting] = useState(false);
  const ambientRef = useRef(reducedMotion ? 0 : 1);
  const clearPinnedEntity = useEntityStore(
    (state) => state.clearPinnedEntity,
  );

  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 1.5]}
        frameloop={reducedMotion || resting ? "demand" : "always"}
        camera={{
          position: [INTRO_START.x, INTRO_START.y, INTRO_START.z],
          fov: 50,
          near: 0.1,
          far: 1000,
        }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: "transparent" }}
        onCreated={({ gl, camera }) => {
          gl.setClearColor(0x000000, 0);
          camera.lookAt(0, 0, 0);
        }}
        // A tap or click on empty sky closes a pinned planet readout.
        onPointerMissed={clearPinnedEntity}
      >
        {mounted ? (
          <>
            <AmbientCosmos isDark={isDark} ambientRef={ambientRef} />
            <Suspense fallback={null}>
              <PlanetarySystem
                isDark={isDark}
                regimeTone={regimeTone}
                reducedMotion={reducedMotion}
                ambientRef={ambientRef}
              />
            </Suspense>
            <CameraRig
              onIntroComplete={onIntroComplete}
              reducedMotion={reducedMotion}
              ambientRef={ambientRef}
              onRestChange={setResting}
              isDark={isDark}
              regimeTone={regimeTone}
            />
          </>
        ) : null}
      </Canvas>
    </div>
  );
});
