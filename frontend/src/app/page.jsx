"use client";

import { useSyncExternalStore } from "react";
import { Canvas } from "@react-three/fiber";
import { useTheme } from "next-themes";
import { AmbientCosmos } from "@/components/AmbientCosmos";
import { EnergyGauge } from "@/components/EnergyGauge";
import { PlanetarySystem } from "@/components/PlanetarySystem";
import { Timeline } from "@/components/Timeline";
import { Tooltip } from "@/components/Tooltip";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export default function Home() {
  const { resolvedTheme } = useTheme();
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

      <div className="absolute inset-0" aria-hidden="true">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [0, 6.6, 9.2], fov: 50 }}
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
            </>
          ) : null}
        </Canvas>
      </div>

      <EnergyGauge isDark={isDark} />
      <Tooltip />
      <Timeline />
    </main>
  );
}
