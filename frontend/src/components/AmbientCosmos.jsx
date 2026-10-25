"use client";

import { useLayoutEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const DUST_COUNT = 720;
const NAKSHATRA_COUNT = 27;
const RING_RADIUS = 4.15;
const DUST_RADIUS = 3.82;

/** Deterministic dust layout, so a remount never reshuffles the sky. */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function DustField({ isDark }) {
  const meshRef = useRef(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const random = seededRandom(0x5eedc0de);
    const dummy = new THREE.Object3D();

    for (let i = 0; i < DUST_COUNT; i += 1) {
      // Uniform inside a slightly flattened sphere, held inside the ring.
      const radius = DUST_RADIUS * Math.cbrt(random());
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);

      dummy.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta) * 0.18,
        radius * Math.cos(phi),
      );
      dummy.rotation.set(
        random() * Math.PI,
        random() * Math.PI,
        random() * Math.PI,
      );
      dummy.scale.setScalar(0.35 + random() * 1.55);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, DUST_COUNT]}
      frustumCulled={false}
    >
      <icosahedronGeometry args={[0.014, 0]} />
      <meshStandardMaterial
        color={isDark ? "#f4e6c8" : "#6f627d"}
        emissive={isDark ? "#f4e6c8" : "#000000"}
        emissiveIntensity={isDark ? 0.55 : 0}
        metalness={0.1}
        roughness={0.65}
        transparent
        opacity={isDark ? 0.9 : 0.34}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

function RingMaterial({ isDark }) {
  if (isDark) {
    return (
      <meshStandardMaterial
        color="#7d6cff"
        emissive="#7d6cff"
        emissiveIntensity={2.6}
        metalness={0.6}
        roughness={0.24}
        toneMapped={false}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color="#7b7088"
      metalness={0.12}
      roughness={0.24}
      clearcoat={1}
      clearcoatRoughness={0.14}
      transparent
      opacity={0.9}
    />
  );
}

function TickMaterial({ isDark }) {
  if (isDark) {
    return (
      <meshStandardMaterial
        color="#cdbcff"
        emissive="#9b84ff"
        emissiveIntensity={2}
        metalness={0.45}
        roughness={0.28}
        toneMapped={false}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color="#5e536b"
      metalness={0.2}
      roughness={0.3}
      clearcoat={1}
      clearcoatRoughness={0.16}
      transparent
      opacity={0.82}
    />
  );
}

function NodeMaterial({ isDark }) {
  if (isDark) {
    return (
      <meshStandardMaterial
        color="#ffffff"
        emissive="#a78bfa"
        emissiveIntensity={4}
        metalness={0.2}
        roughness={0.18}
        toneMapped={false}
      />
    );
  }

  return (
    <meshPhysicalMaterial
      color="#6f5f86"
      metalness={0.25}
      roughness={0.16}
      clearcoat={1}
      clearcoatRoughness={0.1}
    />
  );
}

function NakshatraRing({ isDark }) {
  const ticksRef = useRef(null);

  useLayoutEffect(() => {
    const mesh = ticksRef.current;
    if (!mesh) return;

    const dummy = new THREE.Object3D();

    for (let i = 0; i < NAKSHATRA_COUNT; i += 1) {
      const angle = (i / NAKSHATRA_COUNT) * Math.PI * 2;

      dummy.position.set(
        Math.cos(angle) * RING_RADIUS,
        Math.sin(angle) * RING_RADIUS,
        0,
      );
      dummy.rotation.set(0, 0, angle);
      // Every third tick reads as a nakshatra boundary; the rest as pada marks.
      dummy.scale.set(i % 3 === 0 ? 1.55 : 0.85, 1, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  return (
    <group>
      <mesh>
        <torusGeometry args={[RING_RADIUS, 0.01, 12, 256]} />
        <RingMaterial isDark={isDark} />
      </mesh>

      <instancedMesh
        ref={ticksRef}
        args={[undefined, undefined, NAKSHATRA_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.18, 0.012, 0.012]} />
        <TickMaterial isDark={isDark} />
      </instancedMesh>

      <mesh position={[RING_RADIUS, 0, 0]}>
        <sphereGeometry args={[0.042, 16, 16]} />
        <NodeMaterial isDark={isDark} />
      </mesh>
    </group>
  );
}

function ThemeLights({ isDark }) {
  return (
    <>
      <ambientLight intensity={isDark ? 0.12 : 0.8} />
      <hemisphereLight
        color={isDark ? "#6d5cff" : "#ffffff"}
        groundColor={isDark ? "#05050a" : "#d9cfc2"}
        intensity={isDark ? 0.32 : 1.1}
      />
      <directionalLight
        position={[5, 7, 8]}
        color={isDark ? "#cfc6ff" : "#fff8ee"}
        intensity={isDark ? 1.5 : 2.6}
      />
      <pointLight
        position={[-5, 4, 5]}
        color={isDark ? "#7c6cff" : "#e4d6ff"}
        intensity={isDark ? 24 : 9}
        distance={22}
        decay={2}
      />
    </>
  );
}

export function AmbientCosmos({ isDark = true }) {
  const dustRef = useRef(null);
  const ringRef = useRef(null);
  const viewport = useThree((state) => state.viewport);

  // Keep the ring inside a portrait viewport without changing its geometry.
  const fit = Math.min(1, viewport.width / 9.2);

  useFrame((_, delta) => {
    // Unconditional, delta-based motion. No date, planet or time-travel state is read here.
    if (dustRef.current) {
      dustRef.current.rotation.y += delta * 0.008;
    }

    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.024;
    }
  });

  return (
    <>
      <ThemeLights isDark={isDark} />

      <group scale={fit}>
        <group ref={dustRef}>
          <DustField isDark={isDark} />
        </group>

        <group ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
          <NakshatraRing isDark={isDark} />
        </group>
      </group>
    </>
  );
}
