"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { Sphere } from "@react-three/drei";
import gsap from "gsap";
import * as THREE from "three";
import { getRegimeToneColor } from "@/lib/regimeTone";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

const EARTH_RADIUS = 1.66;
const EARTH_SIZE = 0.09;
const MOON_SIZE = EARTH_SIZE * 0.42;
const MOON_ORBIT_RADIUS = EARTH_SIZE * 2.8;
const SATURN_TILT = Math.PI / 2 + 0.47;
// Time travel keeps its 2 s expo.inOut identity; reduced motion jumps.
const TRAVEL_DURATION = 2;
// Hover/pin scale: a damped lerp that requests frames only until it settles.
const HOVER_SCALE = 1.1;
const HOVER_DAMPING = 14;
// A pointer that moved further than this between down and up was orbiting
// the camera, not tapping a planet.
const TAP_SLOP_PX = 6;
// After an on-demand pause the frame delta spans the whole pause.
const MAX_FRAME_DELTA = 1 / 30;
// The small procedural bodies are a few pixels wide; a 128x64 map is plenty.
const PROCEDURAL_WIDTH = 128;
const PROCEDURAL_HEIGHT = 64;
// The surface recipe was authored at 512x256; its pixel units scale with it.
const PROCEDURAL_SCALE = PROCEDURAL_WIDTH / 512;
const TEXTURE_PATHS = [
  "/textures/sun.webp",
  "/textures/earth-day.webp",
  "/textures/earth-clouds.webp",
  "/textures/earth-normal.webp",
  "/textures/earth-specular.webp",
  "/textures/moon.webp",
  "/textures/jupiter.webp",
  "/textures/saturn.webp",
  "/textures/saturn-ring.webp",
];

/**
 * Visual orbit radii, inner to outer. The values are deliberately compressed:
 * the scene is a legible orrery, not a scale model of the solar system. The
 * Sun is the central anchor; the rest are perceptual relative sizes.
 */
const PLANETS = [
  {
    name: "Sun",
    symbol: "☉",
    radius: 0,
    size: 0.27,
    color: "#f6c76a",
    roughness: 0.5,
    metalness: 0.0,
    clearcoat: 0.1,
    bumpScale: 0.014,
    gas: false,
  },
  {
    name: "Mercury",
    symbol: "☿",
    radius: 1.22,
    size: 0.038,
    color: "#b9b3a8",
    roughness: 0.72,
    metalness: 0.28,
    clearcoat: 0.05,
    bumpScale: 0.032,
    gas: false,
  },
  {
    name: "Venus",
    symbol: "♀",
    radius: 1.5,
    size: 0.09,
    color: "#e8c9a0",
    roughness: 0.52,
    metalness: 0.12,
    clearcoat: 0.22,
    bumpScale: 0.018,
    gas: false,
  },
  {
    name: "Mars",
    symbol: "♂",
    radius: 1.82,
    size: 0.058,
    color: "#d97a5a",
    roughness: 0.74,
    metalness: 0.16,
    clearcoat: 0.06,
    bumpScale: 0.03,
    gas: false,
  },
  {
    name: "Jupiter",
    symbol: "♃",
    radius: 2.28,
    size: 0.175,
    color: "#d8b47a",
    roughness: 0.7,
    metalness: 0.1,
    clearcoat: 0.12,
    bumpScale: 0.012,
    gas: true,
  },
  {
    name: "Saturn",
    symbol: "♄",
    radius: 2.72,
    size: 0.148,
    color: "#e0cf9a",
    roughness: 0.54,
    metalness: 0.04,
    clearcoat: 0.2,
    bumpScale: 0.014,
    gas: true,
  },
  {
    name: "Rahu",
    symbol: "☊",
    radius: 3.12,
    size: 0.035,
    color: "#8b7cff",
    roughness: 0.36,
    metalness: 0.42,
    clearcoat: 0.4,
    bumpScale: 0.02,
    gas: false,
  },
  {
    name: "Ketu",
    symbol: "☋",
    radius: 3.42,
    size: 0.035,
    color: "#7c9bb5",
    roughness: 0.36,
    metalness: 0.42,
    clearcoat: 0.4,
    bumpScale: 0.02,
    gas: false,
  },
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Procedural 128x64 albedo and bump maps. These are intentionally generated
 * in-browser so the shipped bundle stays asset-free while every body gets a
 * distinct, stable surface. The bodies render only a few pixels wide, so the
 * small map keeps startup work and GPU memory light.
 */
function createPlanetTextures(planet) {
  if (typeof document === "undefined") return null;

  const width = PROCEDURAL_WIDTH;
  const height = PROCEDURAL_HEIGHT;
  const unit = PROCEDURAL_SCALE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return null;

  const bumpCanvas = document.createElement("canvas");
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bumpContext = bumpCanvas.getContext("2d");
  if (!bumpContext) return null;

  const random = seededRandom(hashString(planet.name));
  const base = new THREE.Color(planet.color);
  const light = base.clone().offsetHSL(0.01, -0.05, 0.16);
  const dark = base.clone().offsetHSL(-0.01, 0.02, -0.13);

  const gradient = context.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, `#${light.getHexString()}`);
  gradient.addColorStop(0.48, `#${base.getHexString()}`);
  gradient.addColorStop(1, `#${dark.getHexString()}`);
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  bumpContext.fillStyle = "#7d7d7d";
  bumpContext.fillRect(0, 0, width, height);

  const bandCount = planet.gas ? 26 : 13;
  for (let index = 0; index < bandCount; index += 1) {
    const y = (index / bandCount) * height + random() * 7 * unit;
    const bandHeight = (2 + random() * (planet.gas ? 9 : 4)) * unit;
    const lightness = random() > 0.5 ? 0.24 : -0.2;
    const bandColor = base
      .clone()
      .offsetHSL(
        (random() - 0.5) * 0.035,
        planet.gas ? 0.08 : 0.02,
        lightness * 0.45,
      );

    context.fillStyle = `rgba(${Math.round(bandColor.r * 255)}, ${Math.round(
      bandColor.g * 255,
    )}, ${Math.round(bandColor.b * 255)}, ${0.1 + random() * 0.18})`;
    context.fillRect(0, y, width, bandHeight);

    bumpContext.fillStyle = `rgba(${lightness > 0 ? 255 : 0}, ${
      lightness > 0 ? 255 : 0
    }, ${lightness > 0 ? 255 : 0}, ${0.06 + random() * 0.1})`;
    bumpContext.fillRect(0, y, width, bandHeight);
  }

  // Fine-grain surface variation, strongest on the rocky bodies. Grains stay
  // texel-sized; their count follows the map area so the coverage is unchanged.
  const grainCount = Math.round((planet.gas ? 900 : 1800) * unit * unit);
  for (let index = 0; index < grainCount; index += 1) {
    const x = random() * width;
    const y = random() * height;
    const radius = 0.35 + random() * (planet.gas ? 2.2 : 1.4);
    const alpha = 0.015 + random() * 0.045;
    context.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();

    bumpContext.fillStyle = `rgba(255, 255, 255, ${0.04 + random() * 0.08})`;
    bumpContext.beginPath();
    bumpContext.arc(x, y, radius * 0.8, 0, Math.PI * 2);
    bumpContext.fill();
  }

  if (planet.name === "Jupiter") {
    // The spot is placed in 512x256 units; scale it onto the smaller map.
    context.save();
    context.scale(unit, unit);
    bumpContext.save();
    bumpContext.scale(unit, unit);
    const spot = context.createRadialGradient(345, 158, 4, 345, 158, 40);
    spot.addColorStop(0, "rgba(166, 72, 46, 0.95)");
    spot.addColorStop(0.55, "rgba(184, 93, 56, 0.7)");
    spot.addColorStop(1, "rgba(184, 93, 56, 0)");
    context.save();
    context.translate(345, 158);
    context.scale(1, 0.48);
    context.fillStyle = spot;
    context.beginPath();
    context.arc(0, 0, 40, 0, Math.PI * 2);
    context.fill();
    context.restore();

    bumpContext.save();
    bumpContext.translate(345, 158);
    bumpContext.scale(1, 0.48);
    bumpContext.fillStyle = "rgba(0, 0, 0, 0.2)";
    bumpContext.beginPath();
    bumpContext.arc(0, 0, 40, 0, Math.PI * 2);
    bumpContext.fill();
    bumpContext.restore();
    bumpContext.restore();
    context.restore();
  }

  if (planet.name === "Sun") {
    const glow = context.createRadialGradient(
      width * 0.5,
      height * 0.45,
      8,
      width * 0.5,
      height * 0.45,
      width * 0.65,
    );
    glow.addColorStop(0, "rgba(255, 255, 225, 0.85)");
    glow.addColorStop(0.35, "rgba(255, 212, 110, 0.3)");
    glow.addColorStop(1, "rgba(255, 150, 40, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
  }

  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.anisotropy = 2;

  return { map, bumpMap };
}

/**
 * Sun corona and Earth atmosphere: the additive back-face shell fades toward
 * its silhouette, so it reads as a soft glow instead of a hard-edged disc.
 * Module-level, so both shells share one program (stable cache key).
 */
function rimFade(shader) {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", "#include <common>\nvarying float vShRim;")
    .replace(
      "#include <project_vertex>",
      "#include <project_vertex>\nvShRim = abs(dot(normalize(normalMatrix * normal), normalize(-mvPosition.xyz)));",
    );
  shader.fragmentShader = shader.fragmentShader
    .replace("#include <common>", "#include <common>\nvarying float vShRim;")
    .replace(
      "#include <opaque_fragment>",
      "diffuseColor.a *= pow(vShRim, 1.5);\n#include <opaque_fragment>",
    );
}

function rimFadeKey() {
  return "sh-rim-fade";
}

function OrbitRing({ radius, isDark, regimeColor = null }) {
  const materialRef = useRef(null);
  const invalidate = useThree((state) => state.invalidate);
  const baseColor = isDark ? "#8b7cff" : "#6f627d";
  const baseOpacity = isDark ? 0.075 : 0.1;

  // The regime overlay is a colour/opacity uniform update on the existing ring
  // material. It does not add geometry or draw calls, and it is only applied
  // when the opt-in overlay is active.
  useLayoutEffect(() => {
    const material = materialRef.current;
    if (!material) return;
    material.color.set(regimeColor ?? baseColor);
    material.opacity = regimeColor ? (isDark ? 0.28 : 0.3) : baseOpacity;
    material.needsUpdate = true;
    // Imperative change: request a frame when rendering on demand.
    invalidate();
  }, [regimeColor, baseColor, baseOpacity, isDark, invalidate]);

  // Front side only: the rings face +Y and OrbitControls keeps the camera
  // above the plane (maxPolarAngle), so the back side is never seen.
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.0035, radius + 0.0035, 180]} />
      <meshBasicMaterial
        ref={materialRef}
        color={baseColor}
        transparent
        opacity={baseOpacity}
        side={THREE.FrontSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function SaturnRing({ texture, planetSize }) {
  const geometry = useMemo(() => {
    const inner = planetSize * 1.55;
    const outer = planetSize * 2.55;
    const ring = new THREE.RingGeometry(inner, outer, 192, 8);
    const positions = ring.attributes.position;
    const uvs = ring.attributes.uv;

    // The source ring map is a radial strip. Map its width across the ring's
    // radius instead of stretching a square texture around the hole.
    for (let index = 0; index < positions.count; index += 1) {
      const radius = Math.hypot(
        positions.getX(index),
        positions.getY(index),
      );
      uvs.setXY(
        index,
        THREE.MathUtils.clamp((radius - inner) / (outer - inner), 0, 1),
        0.5,
      );
    }
    uvs.needsUpdate = true;
    return ring;
  }, [planetSize]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh
      geometry={geometry}
      rotation={[SATURN_TILT, 0, 0]}
      renderOrder={2}
      raycast={() => {}}
    >
      <meshStandardMaterial
        map={texture}
        alphaMap={texture}
        transparent
        opacity={0.92}
        side={THREE.DoubleSide}
        forceSinglePass
        depthWrite={false}
        roughness={0.85}
        metalness={0.05}
        emissive="#4a3c22"
        emissiveIntensity={0.3}
      />
    </mesh>
  );
}

function Earth({
  isDark,
  angle,
  moonLon,
  earthMap,
  earthClouds,
  earthNormal,
  earthSpecular,
  moonMap,
  reducedMotion = false,
  ambientRef = null,
}) {
  const invalidate = useThree((state) => state.invalidate);
  const groupRef = useRef(null);
  const surfaceRef = useRef(null);
  const cloudRef = useRef(null);
  const moonOrbitRef = useRef(null);
  const initialPosition = useRef({
    x: Math.cos(angle) * EARTH_RADIUS,
    z: Math.sin(angle) * EARTH_RADIUS,
  });

  useLayoutEffect(() => {
    groupRef.current?.position.set(
      initialPosition.current.x,
      0,
      initialPosition.current.z,
    );
  }, []);

  useLayoutEffect(() => {
    if (!groupRef.current) return undefined;
    const position = groupRef.current.position;
    const x = Math.cos(angle) * EARTH_RADIUS;
    const z = Math.sin(angle) * EARTH_RADIUS;
    if (position.x === x && position.z === z) return undefined;

    if (reducedMotion) {
      gsap.killTweensOf(position);
      position.x = x;
      position.z = z;
      invalidate();
      return undefined;
    }

    const tween = gsap.to(position, {
      x,
      z,
      duration: TRAVEL_DURATION,
      ease: "expo.inOut",
      overwrite: true,
      onUpdate: () => invalidate(),
    });

    return () => tween.kill();
  }, [angle, invalidate, reducedMotion]);

  useLayoutEffect(() => {
    if (!moonOrbitRef.current) return;
    moonOrbitRef.current.rotation.y = (Number(moonLon) * Math.PI) / 180;
    invalidate();
  }, [moonLon, invalidate]);

  useFrame((_, delta) => {
    // Spins follow the shared ambient factor: they ease to rest with the sky
    // and never run under reduced motion.
    const step = Math.min(delta, MAX_FRAME_DELTA) * (ambientRef?.current ?? 1);
    if (step === 0) return;
    if (surfaceRef.current) surfaceRef.current.rotation.y += step * 0.018;
    if (cloudRef.current) cloudRef.current.rotation.y += step * 0.045;
    if (moonOrbitRef.current) moonOrbitRef.current.rotation.y += step * 0.12;
  });

  return (
    <group ref={groupRef}>
      <mesh ref={surfaceRef} raycast={() => {}}>
        <sphereGeometry args={[EARTH_SIZE, 96, 96]} />
        <meshPhysicalMaterial
          map={earthMap}
          normalMap={earthNormal}
          normalScale={[0.9, 0.9]}
          metalnessMap={earthSpecular}
          metalness={0.18}
          roughness={0.62}
          clearcoat={0.32}
          clearcoatRoughness={0.28}
          envMapIntensity={0.6}
        />
      </mesh>

      <mesh ref={cloudRef} scale={1.02} raycast={() => {}}>
        <sphereGeometry args={[EARTH_SIZE, 96, 96]} />
        <meshPhysicalMaterial
          map={earthClouds}
          alphaMap={earthClouds}
          transparent
          opacity={0.6}
          depthWrite={false}
          roughness={1}
          metalness={0}
          color="#ffffff"
          side={THREE.FrontSide}
        />
      </mesh>

      <mesh scale={1.055} raycast={() => {}}>
        <sphereGeometry args={[EARTH_SIZE, 48, 48]} />
        <meshBasicMaterial
          color={isDark ? "#4d9fff" : "#8dc8ff"}
          transparent
          opacity={0.2}
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          onBeforeCompile={rimFade}
          customProgramCacheKey={rimFadeKey}
        />
      </mesh>

      <group ref={moonOrbitRef}>
        <mesh position={[MOON_ORBIT_RADIUS, 0, 0]} raycast={() => {}}>
          <sphereGeometry args={[MOON_SIZE, 48, 48]} />
          <meshStandardMaterial
            map={moonMap}
            roughness={0.95}
            metalness={0}
            emissive="#b9b2a6"
            emissiveIntensity={0.06}
          />
        </mesh>

        <mesh rotation={[-Math.PI / 2, 0, 0]} raycast={() => {}}>
          <ringGeometry
            args={[
              MOON_ORBIT_RADIUS - 0.0012,
              MOON_ORBIT_RADIUS + 0.0012,
              96,
            ]}
          />
          <meshBasicMaterial
            color={isDark ? "#a8b4d8" : "#7b7088"}
            transparent
            opacity={0.24}
            side={THREE.FrontSide}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}

function Planet({
  planet,
  body,
  isDark,
  texture,
  ringTexture,
  reducedMotion = false,
}) {
  const invalidate = useThree((state) => state.invalidate);
  const setHoveredEntity = useEntityStore((state) => state.setHoveredEntity);
  const clearHoveredEntity = useEntityStore(
    (state) => state.clearHoveredEntity,
  );
  const pinEntity = useEntityStore((state) => state.pinEntity);
  const clearPinnedEntity = useEntityStore(
    (state) => state.clearPinnedEntity,
  );
  const setReadoutSide = useEntityStore((state) => state.setReadoutSide);
  const isHovered = useEntityStore(
    (state) => state.hoveredEntity?.name === planet.name,
  );
  const isPinned = useEntityStore(
    (state) => state.pinnedEntity?.name === planet.name,
  );
  const scaleRef = useRef(null);

  const textures = useMemo(
    () => (texture ? null : createPlanetTextures(planet)),
    [planet, texture],
  );

  useEffect(
    () => () => {
      textures?.map.dispose();
      textures?.bumpMap.dispose();
    },
    [textures],
  );

  // Hover or pin lifts the body slightly. A damped lerp asks for frames only
  // until it settles, and snaps under reduced motion.
  const scaleTarget = isHovered || isPinned ? HOVER_SCALE : 1;

  useEffect(() => {
    invalidate();
  }, [scaleTarget, invalidate]);

  useFrame((_, delta) => {
    const group = scaleRef.current;
    if (!group || group.scale.x === scaleTarget) return;
    const next = reducedMotion
      ? scaleTarget
      : THREE.MathUtils.damp(
          group.scale.x,
          scaleTarget,
          HOVER_DAMPING,
          Math.min(delta, MAX_FRAME_DELTA),
        );
    const settled = Math.abs(next - scaleTarget) < 1e-3;
    group.scale.setScalar(settled ? scaleTarget : next);
    if (!settled) invalidate();
  });

  const entity = useMemo(() => {
    if (!body) return null;

    return {
      name: planet.name,
      degree: body.lon,
      rashi: body.rashi,
      nakshatra: body.nakshatra,
      retrograde: body.retro,
      ml_insight: body.ml_insight,
      sample_size: body.sample_size,
      color: planet.color,
      symbol: planet.symbol,
    };
  }, [body, planet]);

  const angle = body ? (body.lon * Math.PI) / 180 : 0;
  const targetX = planet.radius ? Math.cos(angle) * planet.radius : 0;
  const targetZ = planet.radius ? Math.sin(angle) * planet.radius : 0;

  const positionRef = useRef(null);
  const initialPosition = useRef({ x: targetX, z: targetZ });

  useLayoutEffect(() => {
    const group = positionRef.current;
    if (!group) return;

    group.position.set(
      initialPosition.current.x,
      0,
      initialPosition.current.z,
    );
  }, []);

  useLayoutEffect(() => {
    const group = positionRef.current;
    if (!group) return;
    const position = group.position;
    // Already there (first mount): no tween, no frames.
    if (position.x === targetX && position.z === targetZ) return;

    // Reduced motion: the body is placed, not flown.
    if (reducedMotion) {
      gsap.killTweensOf(position);
      position.x = targetX;
      position.z = targetZ;
      invalidate();
      return;
    }

    // GSAP owns x/z during time travel. The Nakshatra ring and dust have their
    // own useFrame loops and are never touched by this tween.
    const tween = gsap.to(position, {
      x: targetX,
      z: targetZ,
      duration: TRAVEL_DURATION,
      ease: "expo.inOut",
      overwrite: true,
      onUpdate: () => invalidate(),
    });

    return () => {
      tween.kill();
    };
  }, [targetX, targetZ, invalidate, reducedMotion]);

  useEffect(() => {
    if (isHovered && entity) setHoveredEntity(entity);
  }, [entity, isHovered, setHoveredEntity]);

  // Keep a pinned readout current while the date travels.
  useEffect(() => {
    if (isPinned && entity) pinEntity(entity);
  }, [entity, isPinned, pinEntity]);

  if (!body || !entity) return null;

  // The readout docks opposite the body (event.pointer is in NDC). It is
  // chosen once per hover, and never while another readout is pinned.
  const handlePointerOver = (event) => {
    event.stopPropagation();
    if (!useEntityStore.getState().pinnedEntity) {
      setReadoutSide(event.pointer.x > 0 ? "left" : "right");
    }
    setHoveredEntity(entity);
  };

  const handlePointerOut = (event) => {
    event.stopPropagation();
    clearHoveredEntity();
  };

  // Touch has no hover: a tap (or click) pins the readout, a second tap on
  // the same body closes it. A drag that orbited the camera is ignored.
  const handleClick = (event) => {
    event.stopPropagation();
    if (event.delta > TAP_SLOP_PX) return;
    if (isPinned) {
      clearPinnedEntity();
    } else {
      setReadoutSide(event.pointer.x > 0 ? "left" : "right");
      pinEntity(entity);
    }
  };

  const isSun = planet.name === "Sun";

  return (
    <group ref={positionRef}>
      <group ref={scaleRef}>
        {isSun ? (
          <mesh scale={1.3} raycast={() => {}}>
            <sphereGeometry args={[planet.size, 48, 48]} />
            <meshBasicMaterial
              color="#ffb347"
              transparent
              opacity={isDark ? 0.22 : 0.14}
              side={THREE.BackSide}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
              onBeforeCompile={rimFade}
              customProgramCacheKey={rimFadeKey}
            />
          </mesh>
        ) : null}

        <Sphere args={[planet.size, 64, 64]} raycast={() => {}}>
          {texture ? (
            // Textured Sun, Jupiter and Saturn keep their identity material.
            <meshPhysicalMaterial
              color="#ffffff"
              map={texture}
              roughness={planet.roughness}
              metalness={planet.metalness}
              clearcoat={planet.clearcoat}
              clearcoatRoughness={0.18}
              envMapIntensity={0.45}
              emissive={isSun ? planet.color : "#000000"}
              emissiveMap={isSun ? texture : undefined}
              emissiveIntensity={isSun ? (isDark ? 1.35 : 0.28) : 0}
              toneMapped={!isSun}
            />
          ) : (
            // The small procedural bodies: map + bump on a standard material.
            // Clearcoat is invisible at their size and costs a shader variant.
            <meshStandardMaterial
              color={textures?.map ? "#ffffff" : planet.color}
              map={textures?.map}
              bumpMap={textures?.bumpMap}
              bumpScale={planet.bumpScale}
              roughness={planet.roughness}
              metalness={planet.metalness}
              envMapIntensity={0.45}
            />
          )}
        </Sphere>

        {planet.name === "Saturn" && ringTexture ? (
          <SaturnRing texture={ringTexture} planetSize={planet.size} />
        ) : null}

        {/* Larger invisible hit volume: hover reveals the readout, a tap or
            click pins it. Never drawn; raycasting ignores material visibility.
            `transparent` only lets a shader precompile reuse the orbit-ring
            program instead of building one for a material that never draws. */}
        <Sphere
          args={[Math.max(planet.size * 2.6, 0.14), 16, 16]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          <meshBasicMaterial visible={false} transparent />
        </Sphere>
      </group>
    </group>
  );
}

export function PlanetarySystem({
  isDark = true,
  regimeTone = null,
  reducedMotion = false,
  ambientRef = null,
}) {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const invalidate = useThree((state) => state.invalidate);
  const positions = useChronoStore((state) => state.positions);
  const regimeColor = regimeTone
    ? getRegimeToneColor(regimeTone, isDark)
    : null;
  const clearHoveredEntity = useEntityStore(
    (state) => state.clearHoveredEntity,
  );
  const clearPinnedEntity = useEntityStore(
    (state) => state.clearPinnedEntity,
  );
  const groupRef = useRef(null);
  // The bodies stay hidden until their shaders are compiled off the main
  // thread and their textures are uploaded one per task, so the page never
  // freezes while the sky appears.
  const [prepared, setPrepared] = useState(false);
  const [
    sunMap,
    earthMap,
    earthClouds,
    earthNormal,
    earthSpecular,
    moonMap,
    jupiterMap,
    saturnMap,
    saturnRing,
  ] = useLoader(THREE.TextureLoader, TEXTURE_PATHS);

  // Layout effect: the colour space and anisotropy are set before the first
  // frame uploads these textures, so each is uploaded once.
  useLayoutEffect(() => {
    for (const texture of [
      sunMap,
      earthMap,
      earthClouds,
      moonMap,
      jupiterMap,
      saturnMap,
      saturnRing,
    ]) {
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
    for (const texture of [earthNormal, earthSpecular]) {
      texture.colorSpace = THREE.NoColorSpace;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
    }
    invalidate();
  }, [
    sunMap,
    earthMap,
    earthClouds,
    earthNormal,
    earthSpecular,
    moonMap,
    jupiterMap,
    saturnMap,
    saturnRing,
    invalidate,
  ]);

  useEffect(
    () => () => {
      clearHoveredEntity();
      clearPinnedEntity();
    },
    [clearHoveredEntity, clearPinnedEntity],
  );

  const ready =
    positions && PLANETS.every((planet) => positions[planet.name]);

  useLayoutEffect(() => {
    if (!ready || prepared) return undefined;
    const group = groupRef.current;
    if (!group) return undefined;

    let cancelled = false;
    let timer = null;
    const pending = [
      sunMap,
      earthMap,
      earthClouds,
      earthNormal,
      earthSpecular,
      moonMap,
      jupiterMap,
      saturnMap,
      saturnRing,
    ];
    const uploadNext = () => {
      if (cancelled) return;
      const texture = pending.shift();
      if (texture) {
        gl.initTexture(texture);
        timer = setTimeout(uploadNext, 0);
        return;
      }
      setPrepared(true);
      invalidate();
    };

    // KHR_parallel_shader_compile lets the driver link in the background.
    Promise.resolve(gl.compileAsync?.(group, camera, scene))
      .catch(() => {})
      .then(uploadNext);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    ready,
    prepared,
    gl,
    camera,
    scene,
    invalidate,
    sunMap,
    earthMap,
    earthClouds,
    earthNormal,
    earthSpecular,
    moonMap,
    jupiterMap,
    saturnMap,
    saturnRing,
  ]);

  if (!ready) return null;

  const earthAngle =
    (((Number(positions.Sun.lon) + 180) % 360) * Math.PI) / 180;

  return (
    <group ref={groupRef} visible={prepared}>
      {PLANETS.filter((planet) => planet.radius > 0).map((planet) => (
        <OrbitRing
          key={`orbit-${planet.name}`}
          radius={planet.radius}
          isDark={isDark}
          regimeColor={regimeColor}
        />
      ))}
      <OrbitRing
        radius={EARTH_RADIUS}
        isDark={isDark}
        regimeColor={regimeColor}
      />

      {PLANETS.map((planet) => (
        <Planet
          key={planet.name}
          planet={planet}
          body={positions[planet.name]}
          isDark={isDark}
          texture={
            planet.name === "Sun"
              ? sunMap
              : planet.name === "Jupiter"
                ? jupiterMap
                : planet.name === "Saturn"
                  ? saturnMap
                  : null
          }
          ringTexture={planet.name === "Saturn" ? saturnRing : null}
          reducedMotion={reducedMotion}
        />
      ))}

      <Earth
        isDark={isDark}
        angle={earthAngle}
        moonLon={positions.Moon?.lon ?? 0}
        earthMap={earthMap}
        earthClouds={earthClouds}
        earthNormal={earthNormal}
        earthSpecular={earthSpecular}
        moonMap={moonMap}
        reducedMotion={reducedMotion}
        ambientRef={ambientRef}
      />
    </group>
  );
}
