"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { animated, useSpring } from "@react-spring/three";
import { Sphere } from "@react-three/drei";
import gsap from "gsap";
import * as THREE from "three";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

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
    roughness: 0.48,
    metalness: 0.06,
    clearcoat: 0.28,
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
 * Procedural 512x256 albedo and bump maps. These are intentionally generated
 * in-browser so the shipped bundle stays asset-free while every body gets a
 * distinct, stable surface at retina resolution.
 */
function createPlanetTextures(planet) {
  if (typeof document === "undefined") return null;

  const width = 512;
  const height = 256;
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
    const y = (index / bandCount) * height + random() * 7;
    const bandHeight = 2 + random() * (planet.gas ? 9 : 4);
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

  // Fine-grain surface variation, strongest on the rocky bodies.
  const grainCount = planet.gas ? 900 : 1800;
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

function OrbitRing({ radius, isDark }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.0035, radius + 0.0035, 180]} />
      <meshBasicMaterial
        color={isDark ? "#8b7cff" : "#6f627d"}
        transparent
        opacity={isDark ? 0.075 : 0.1}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}

function Planet({ planet, body, isDark }) {
  const setHoveredEntity = useEntityStore((state) => state.setHoveredEntity);
  const clearHoveredEntity = useEntityStore(
    (state) => state.clearHoveredEntity,
  );
  const isHovered = useEntityStore(
    (state) => state.hoveredEntity?.name === planet.name,
  );

  const textures = useMemo(() => createPlanetTextures(planet), [planet]);

  useEffect(
    () => () => {
      textures?.map.dispose();
      textures?.bumpMap.dispose();
    },
    [textures],
  );

  const { scale } = useSpring({
    scale: isHovered ? 1.1 : 1,
    config: { tension: 300, friction: 26 },
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

    // GSAP owns x/z during time travel. The Nakshatra ring and dust have their
    // own useFrame loops and are never touched by this tween.
    const tween = gsap.to(group.position, {
      x: targetX,
      z: targetZ,
      duration: 2,
      ease: "expo.inOut",
      overwrite: true,
    });

    return () => {
      tween.kill();
    };
  }, [targetX, targetZ]);

  useEffect(() => {
    if (isHovered && entity) setHoveredEntity(entity);
  }, [entity, isHovered, setHoveredEntity]);

  if (!body || !entity) return null;

  const handlePointerOver = (event) => {
    event.stopPropagation();
    setHoveredEntity(entity);
  };

  const handlePointerOut = (event) => {
    event.stopPropagation();
    clearHoveredEntity();
  };

  const isSun = planet.name === "Sun";

  return (
    <group ref={positionRef}>
      <animated.group scale={scale}>
        <Sphere args={[planet.size, 64, 64]} raycast={() => {}}>
          <meshPhysicalMaterial
            color={textures?.map ? "#ffffff" : planet.color}
            map={textures?.map}
            bumpMap={textures?.bumpMap}
            bumpScale={planet.bumpScale}
            roughness={planet.roughness}
            metalness={planet.metalness}
            clearcoat={planet.clearcoat}
            clearcoatRoughness={0.18}
            envMapIntensity={0.45}
            emissive={isSun ? planet.color : "#000000"}
            emissiveMap={isSun ? textures?.map : undefined}
            emissiveIntensity={isSun ? (isDark ? 1.35 : 0.28) : 0}
            toneMapped={!isSun}
          />
        </Sphere>

        {/* Larger invisible hit volume: no click is needed to reveal the readout. */}
        <Sphere
          args={[Math.max(planet.size * 2.6, 0.14), 16, 16]}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            colorWrite={false}
          />
        </Sphere>
      </animated.group>
    </group>
  );
}

export function PlanetarySystem({ isDark = true }) {
  const positions = useChronoStore((state) => state.positions);
  const clearHoveredEntity = useEntityStore(
    (state) => state.clearHoveredEntity,
  );

  useEffect(() => () => clearHoveredEntity(), [clearHoveredEntity]);

  const ready =
    positions && PLANETS.every((planet) => positions[planet.name]);

  if (!ready) return null;

  return (
    <group>
      {PLANETS.filter((planet) => planet.radius > 0).map((planet) => (
        <OrbitRing
          key={`orbit-${planet.name}`}
          radius={planet.radius}
          isDark={isDark}
        />
      ))}

      {PLANETS.map((planet) => (
        <Planet
          key={planet.name}
          planet={planet}
          body={positions[planet.name]}
          isDark={isDark}
        />
      ))}
    </group>
  );
}
