"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { animated, useSpring } from "@react-spring/three";
import gsap from "gsap";
import { DoubleSide } from "three";
import { useChronoStore } from "@/store/chronoStore";
import { useEntityStore } from "@/store/entityStore";

/**
 * Visual orbit radii, inner to outer. The values are deliberately compressed:
 * the scene is a legible orrery, not a scale model of the solar system.
 */
const PLANETS = [
  { name: "Sun", symbol: "☉", radius: 0.95, size: 0.105, color: "#f6c76a" },
  { name: "Mercury", symbol: "☿", radius: 1.22, size: 0.052, color: "#b9b3a8" },
  { name: "Venus", symbol: "♀", radius: 1.5, size: 0.07, color: "#e8c9a0" },
  { name: "Mars", symbol: "♂", radius: 1.82, size: 0.062, color: "#d97a5a" },
  { name: "Jupiter", symbol: "♃", radius: 2.28, size: 0.1, color: "#d8b47a" },
  { name: "Saturn", symbol: "♄", radius: 2.72, size: 0.09, color: "#e0cf9a" },
  { name: "Rahu", symbol: "☊", radius: 3.12, size: 0.05, color: "#8b7cff" },
  { name: "Ketu", symbol: "☋", radius: 3.42, size: 0.05, color: "#7c9bb5" },
];

function PlanetMaterial({ isDark, color }) {
  if (isDark) {
    return (
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={0.9}
        metalness={0.35}
        roughness={0.32}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color={color}
      metalness={0.18}
      roughness={0.28}
      clearcoat={1}
      clearcoatRoughness={0.12}
    />
  );
}

function OrbitRing({ radius, isDark }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[radius - 0.0035, radius + 0.0035, 180]} />
      <meshBasicMaterial
        color={isDark ? "#8b7cff" : "#6f627d"}
        transparent
        opacity={isDark ? 0.11 : 0.14}
        side={DoubleSide}
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
  const targetX = Math.cos(angle) * planet.radius;
  const targetZ = Math.sin(angle) * planet.radius;

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

  return (
    <group ref={positionRef}>
      <animated.group scale={scale}>
        <mesh raycast={() => {}}>
          <sphereGeometry args={[planet.size, 24, 24]} />
          <PlanetMaterial isDark={isDark} color={planet.color} />
        </mesh>

        {/* Larger invisible hit volume: no click is needed to reveal the readout. */}
        <mesh
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          <sphereGeometry args={[Math.max(planet.size * 2.6, 0.14), 12, 12]} />
          <meshBasicMaterial
            transparent
            opacity={0}
            depthWrite={false}
            colorWrite={false}
          />
        </mesh>
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
      {PLANETS.map((planet) => (
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
