"use client";

// The Sky activity gauge's flame aura, drawn in the site's own palette
// (signal red, gold, pearl) as crisp, animated-style vector flames.
//   85+  one ring of signal-red tongues around the ring's upper half
//   90+  taller tongues around most of the ring, each with a gold inner flame
//   95+  the full crown, a pearl-hot inner layer, a pulsing core ring and
//        embers drifting up off the crown
//
// Motion is continuous (owner's choice, 4 Nov 2026): every tongue flickers
// and sways on its own rhythm with transform-only CSS animations. It pauses
// while a phone sheet covers the gauge, and under reduced motion the global
// rule stops it on a still frame. Purely decorative (aria-hidden): the
// number and its label carry the meaning.

const BOX = 240;
const C = BOX / 2; // the gauge ring's centre
const RING = 51; // tongue bases tuck under the ring's stroke (the ring draws on top)

const PALETTE = {
  dark: { outer: "#f05d49", mid: "#f2a54a", inner: "#ffe9c2", core: "#ffe9c2", ember: "#f7c56b" },
  light: { outer: "#c0442f", mid: "#e8892f", inner: "#f7c46a", core: "#f2a54a", ember: "#d98a2b" },
};

// One flame tongue, base at (0, 0), tip at (0, -1): an S-curved flat flame.
const TONGUE =
  "M-0.5 0C-0.62-0.3-0.28-0.5-0.2-0.72C-0.15-0.86-0.06-0.94 0.02-1C0.04-0.86 0.2-0.74 0.34-0.56C0.52-0.32 0.46-0.08 0.3 0Z";

export function auraTier(score) {
  if (!Number.isFinite(score)) return 0;
  if (score >= 95) return 3;
  if (score >= 90) return 2;
  if (score >= 85) return 1;
  return 0;
}

// Layers per tier: a red back silhouette, a gold middle and (at 95+) a
// pearl-hot centre. Wide, overlapping tongues read as one rising flame.
const LAYERS = {
  1: [{ key: "o", count: 9, arc: 0.58, crown: 26, width: 31, color: "outer", opacity: 0.92 }],
  2: [
    { key: "o", count: 10, arc: 0.62, crown: 32, width: 33, color: "outer", opacity: 0.92 },
    { key: "m", count: 8, arc: 0.48, crown: 22, width: 25, color: "mid", opacity: 1 },
  ],
  3: [
    { key: "o", count: 12, arc: 0.66, crown: 36, width: 34, color: "outer", opacity: 0.94 },
    { key: "m", count: 10, arc: 0.54, crown: 26, width: 26, color: "mid", opacity: 1 },
    { key: "i", count: 7, arc: 0.4, crown: 15, width: 17, color: "inner", opacity: 1 },
  ],
};

/** One layer of tongues: tallest at the crown, leaning hard toward vertical. */
function tongues(layer, compact) {
  const { count, arc, crown, width } = layer;
  const reach = compact ? 0.6 : 1; // phones: the gauge sits just under the header
  return Array.from({ length: count }, (_, index) => {
    const t = count === 1 ? 0 : index / (count - 1) - 0.5; // -0.5..0.5
    const angle = t * 2 * arc * 180; // degrees from the top
    const rad = (angle * Math.PI) / 180;
    const up = ((1 + Math.cos(rad)) / 2) ** 2.2; // 1 at the top, ~0 low down
    const jitter = ((index * 37) % 7) / 7 - 0.5; // so the crown never looks stamped
    return {
      key: `${layer.key}${index}`,
      x: C + Math.sin(rad) * RING,
      y: C - Math.cos(rad) * RING,
      lean: angle * 0.82,
      length: (3 + (crown - 3) * up * (1 + jitter * 0.25)) * reach,
      width: width * (0.7 + 0.35 * up),
      flip: index % 2 === 0 ? 1 : -1,
      duration: 0.52 + ((index * 53) % 9) * 0.05,
      delay: -(((index * 29) % 11) * 0.08),
    };
  });
}

function Tongue({ item, color, scale = 1, opacity = 1 }) {
  return (
    <g transform={`translate(${item.x} ${item.y}) rotate(${item.lean})`}>
      <g transform={`scale(${item.width * scale * item.flip} ${item.length * scale})`}>
        <path
          className="sh-tongue"
          d={TONGUE}
          fill={color}
          opacity={opacity}
          style={{
            animationDuration: `${item.duration}s`,
            animationDelay: `${item.delay}s`,
          }}
        />
      </g>
    </g>
  );
}

export function GaugeAura({ score, isDark = true, paused = false }) {
  const tier = auraTier(score);
  if (!tier) return null;
  const colors = isDark ? PALETTE.dark : PALETTE.light;
  // Rendered only once a score has arrived (client side), so this is safe.
  const compact =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 639.98px)").matches;

  return (
    <div
      aria-hidden="true"
      className="sh-aura pointer-events-none absolute left-1/2 top-1/2"
      style={{ width: BOX, height: BOX, marginLeft: -BOX / 2, marginTop: -BOX / 2 }}
      data-tier={tier}
      data-paused={paused ? "true" : undefined}
    >
      <svg viewBox={`0 0 ${BOX} ${BOX}`} className="h-full w-full overflow-visible">
        {/* A faint warm halo around the ring (stroke-opacity, so the halo's
            own opacity animation can breathe on top of it). */}
        <circle
          className="sh-aura-halo"
          cx={C}
          cy={C}
          r={RING + 4}
          fill="none"
          stroke={colors.outer}
          strokeWidth={6 + tier * 3}
          strokeOpacity={0.1 + tier * 0.05}
        />

        {LAYERS[tier].map((layer) =>
          tongues(layer, compact).map((item) => (
            <Tongue
              key={item.key}
              item={item}
              color={colors[layer.color]}
              opacity={layer.opacity}
            />
          )),
        )}

        {tier >= 3 ? (
          <>
            <circle
              className="sh-aura-core"
              cx={C}
              cy={C}
              r={RING + 1}
              fill="none"
              stroke={colors.core}
              strokeWidth="1.5"
            />
            {Array.from({ length: 7 }, (_, index) => (
              <circle
                key={`e${index}`}
                className="sh-ember"
                cx={C + (index - 3) * 12}
                cy={C - RING - 12 + Math.abs(index - 3) * 5}
                r={1.5}
                fill={colors.ember}
                style={{
                  animationDelay: `${-index * 0.37}s`,
                  animationDuration: `${1.8 + (index % 3) * 0.4}s`,
                  "--sh-ember-dx": `${(index - 3) * 2}px`,
                  "--sh-ember-rise": compact ? "-20px" : "-30px",
                }}
              />
            ))}
          </>
        ) : null}
      </svg>
    </div>
  );
}
