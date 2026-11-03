// Shared Open Graph card (1200 × 630) for the opengraph-image files. Built at build time
// (each file exports dynamic = "force-static"), so the server never reads these fonts at runtime.
// Fonts: Onest Light 300 and Medium 500, static TTF instances (SIL OFL 1.1, see OFL.txt here).
// The _og folder is private: nothing in it routes.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

const INK = "#f2ede4";
const CORAL = "#ff8b77";

// The nakshatra halo of the header's brand mark (SiteHeader.jsx), copied rather than imported
// because that file is a client module: 27 hairline ticks in a 96-unit box, 0° at three o'clock,
// every third tick long. Unrounded here, since the card draws it 560 px wide. The ring sits
// partly behind the text column, so each tick fades from 16% ink (right) to about 6% (left),
// where it crosses the words.
const HALO_TICKS = Array.from({ length: 27 }, (_, index) => {
  const angle = (index / 27) * Math.PI * 2;
  const inner = index % 3 === 0 ? 35 : 37.5;
  const point = (radius: number) =>
    `${(48 + Math.cos(angle) * radius).toFixed(3)} ${(48 + Math.sin(angle) * radius).toFixed(3)}`;
  const alpha = 0.16 * (0.4 + 0.6 * ((1 + Math.cos(angle)) / 2));
  return { d: `M${point(inner)}L${point(42.5)}`, stroke: `rgba(242,237,228,${alpha.toFixed(3)})` };
});

export type OgCardCopy = {
  eyebrow: string;
  title: string;
  line: string;
  /** The page path shown after the domain: "" for home, "/regime" for /regime. */
  path: string;
};

export async function ogCard({ eyebrow, title, line, path }: OgCardCopy) {
  const dir = join(process.cwd(), "src", "app", "_og");
  const [light, medium, icon] = await Promise.all([
    readFile(join(dir, "Onest-Light.ttf")),
    readFile(join(dir, "Onest-Medium.ttf")),
    readFile(join(process.cwd(), "public", "icon.png"), "base64"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          padding: "56px 72px 48px",
          backgroundColor: "#090910",
          backgroundImage:
            "radial-gradient(ellipse at 50% 28%, #232330 0%, #141420 30%, #090910 62%, #020204 100%)",
          color: INK,
          fontFamily: "Onest",
        }}
      >
        <svg
          width="560"
          height="560"
          viewBox="0 0 96 96"
          style={{ position: "absolute", right: 24, top: 35 }}
        >
          {HALO_TICKS.map((tick) => (
            <path key={tick.d} d={tick.d} stroke={tick.stroke} strokeWidth="0.42" strokeLinecap="round" />
          ))}
        </svg>

        <div style={{ display: "flex", alignItems: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain <img> only */}
          <img
            src={`data:image/png;base64,${icon}`}
            width={56}
            height={56}
            alt=""
            style={{ borderRadius: 28, border: "1px solid rgba(255,255,255,0.1)" }}
          />
          <div style={{ display: "flex", alignItems: "baseline", marginLeft: 16 }}>
            <span style={{ fontSize: 34, fontWeight: 500, letterSpacing: -1 }}>strikehike</span>
            <span style={{ fontSize: 24, fontWeight: 500, color: CORAL, letterSpacing: 0.5 }}>.com</span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flexGrow: 1,
            maxWidth: 760,
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 22,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: 4.4,
              color: CORAL,
            }}
          >
            {eyebrow}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 20,
              fontSize: 68,
              fontWeight: 300,
              lineHeight: 1.04,
              letterSpacing: -2.72,
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 24,
              fontSize: 28,
              fontWeight: 300,
              lineHeight: 1.3,
              color: "rgba(242,237,228,0.72)",
            }}
          >
            {line}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: 20,
            borderTop: "1px solid rgba(240,93,73,0.35)",
            fontSize: 22,
            fontWeight: 300,
            color: "rgba(242,237,228,0.6)",
          }}
        >
          <span>{`strikehike.com${path}`}</span>
          <span>Research, not investment advice.</span>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Onest", data: light, weight: 300, style: "normal" },
        { name: "Onest", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
