"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import gsap from "gsap";
import { AmbientCosmos } from "@/components/AmbientCosmos";
import { PlanetarySystem } from "@/components/PlanetarySystem";
import { useChronoStore } from "@/store/chronoStore";

// Camera keys are calibrated to the compact orrery radius (not literal AU scale).
const ORBITAL_VIEW = { x: 0, y: 12, z: 22 };
const ZENITH_VIEW = { x: 0, y: 34, z: 0 };
const INTRO_START = { x: 0, y: 80, z: 150 };
const INTRO_DURATION = 3;
const AUTO_ROTATE_SPEED = 0.16;
const IDLE_RESUME_MS = 4200;

function CameraRig({ onIntroComplete }) {
  const { camera } = useThree();
  const controlsRef = useRef(null);
  const idleTimerRef = useRef(null);
  const appliedViewRef = useRef(false);
  const introCallbackRef = useRef(onIntroComplete);

  const [introComplete, setIntroComplete] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [viewTweening, setViewTweening] = useState(false);

  const cameraView = useChronoStore((state) => state.cameraView);
  const cameraRevision = useChronoStore((state) => state.cameraRevision);

  useEffect(() => {
    introCallbackRef.current = onIntroComplete;
  }, [onIntroComplete]);

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
    camera.position.set(INTRO_START.x, INTRO_START.y, INTRO_START.z);
    camera.lookAt(0, 0, 0);
    if (controlsRef.current) {
      controlsRef.current.target.set(0, 0, 0);
      controlsRef.current.update();
    }

    const tween = gsap.to(camera.position, {
      ...ORBITAL_VIEW,
      duration: INTRO_DURATION,
      ease: "power3.inOut",
      onUpdate: () => controlsRef.current?.update(),
      onComplete: () => {
        setIntroComplete(true);
        emitCameraState("intro-complete", "orbital");
        introCallbackRef.current?.();
      },
    });

    return () => {
      tween.kill();
      clearTimeout(idleTimerRef.current);
    };
  }, [camera, emitCameraState]);

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

    const target = cameraView === "zenith" ? ZENITH_VIEW : ORBITAL_VIEW;
    setViewTweening(true);
    const tween = gsap.to(camera.position, {
      ...target,
      duration: 1.6,
      ease: "power3.inOut",
      onUpdate: () => controlsRef.current?.update(),
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
    introComplete,
  ]);

  const shouldAutoRotate =
    introComplete &&
    !interacting &&
    !viewTweening &&
    cameraView === "orbital";

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableZoom
      enablePan={false}
      maxPolarAngle={Math.PI / 2 - 0.05}
      autoRotate={shouldAutoRotate}
      autoRotateSpeed={AUTO_ROTATE_SPEED}
      enableDamping
      dampingFactor={0.055}
      minDistance={4}
      maxDistance={180}
      target={[0, 0, 0]}
    />
  );
}

export function Canvas3D({ isDark = true, mounted = false, onIntroComplete }) {
  return (
    <div className="absolute inset-0" aria-hidden="true">
      <Canvas
        dpr={[1, 2]}
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
      >
        {mounted ? (
          <>
            <AmbientCosmos isDark={isDark} />
            <PlanetarySystem isDark={isDark} />
            <CameraRig onIntroComplete={onIntroComplete} />
          </>
        ) : null}
      </Canvas>
    </div>
  );
}
