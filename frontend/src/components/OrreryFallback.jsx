import { EARTH_RADIUS, PLANETS } from "@/components/PlanetarySystem";

// A static, server-safe orrery for browsers without WebGL. It uses the same
// positions already in the store: the Sun, every planet and Earth's orbit.
export function OrreryFallback({ positions }) {
  const centre = 300;
  const scale = 250 / 3.42;
  const lon = (name) => Number(positions?.[name]?.lon ?? 0);
  const point = (angle, radius) => ({
    x: centre + Math.cos((angle * Math.PI) / 180) * radius * scale,
    y: centre + Math.sin((angle * Math.PI) / 180) * radius * scale,
  });
  const sun = { x: centre, y: centre };
  const earthAngle = (lon("Sun") + 180) % 360;
  const earth = point(earthAngle, EARTH_RADIUS);

  return (
    <div
      data-orrery-fallback=""
      className="pointer-events-none absolute inset-0 grid place-items-center text-(--sh-text-2)"
    >
      <svg
        viewBox="0 0 600 600"
        className="h-[min(82vw,62vh)] w-[min(82vw,62vh)] text-(--sh-text-3)"
        role="img"
        aria-label="Static orrery: the Sun, planets and Earth's orbit at today's positions"
      >
        <circle
          cx={centre}
          cy={centre}
          r={3.42 * scale}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          opacity="0.55"
        />
        <circle cx={sun.x} cy={sun.y} r={0.27 * scale} fill="var(--sh-gold)" />
        {PLANETS.filter((planet) => planet.radius > 0).map((planet) => {
          const position = point(lon(planet.name), planet.radius);
          return (
            <circle
              key={planet.name}
              cx={position.x}
              cy={position.y}
              r={Math.max(2.2, planet.size * scale)}
              fill={planet.color}
            />
          );
        })}
        <circle cx={earth.x} cy={earth.y} r={Math.max(2, 0.09 * scale)} fill="var(--sh-signal-ink)" />
      </svg>
      <p className="absolute bottom-24 left-1/2 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 text-center text-meta leading-relaxed text-(--sh-text-2)">
        3D view isn&apos;t available in this browser.
      </p>
    </div>
  );
}
