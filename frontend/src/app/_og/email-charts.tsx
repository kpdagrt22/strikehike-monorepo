// Hosted email charts. 1120 px wide is @2x for a 560 px email column.
import { ImageResponse } from "next/og";
import type { Roundup } from "@/lib/roundup/store";

const INK = "#f2ede4";
const MUTED = "#a9a294";
const GOLD = "#ff8b77";
const BG = "#14121a";
const GRID = "#2a2730";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function shortDay(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

function signed(value: number) {
  const text = Math.abs(value).toFixed(1);
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text;
}

export function regimeChart(roundup: Roundup) {
  const points = roundup.regime?.weekly ?? [];
  if (points.length < 2) return null;
  const width = 1120;
  const height = 240;
  const chartWidth = width - 96;
  const chartHeight = height - 120;
  const left = 20;
  const right = chartWidth - 20;
  const top = 34;
  const bottom = chartHeight - 24;
  const scores = points.map((point) => point.score);
  const min = Math.min(...scores) - 1;
  const max = Math.max(...scores) + 1;
  const span = Math.max(1, max - min);
  const x = (index: number) =>
    left + (index * (right - left)) / Math.max(1, points.length - 1);
  const y = (score: number) => bottom - ((score - min) / span) * (bottom - top);
  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(1)} ${y(point.score).toFixed(1)}`)
    .join(" ");
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: INK,
          padding: "28px 48px 24px",
          fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: GOLD }}>
            Core Index · last four weeks
          </span>
          <span style={{ fontSize: 20, color: MUTED }}>{roundup.week}</span>
        </div>
        <svg width={chartWidth} height={chartHeight} viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          {[0.25, 0.5, 0.75].map((fraction) => (
            <line
              key={fraction}
              x1={left}
              x2={right}
              y1={top + fraction * (bottom - top)}
              y2={top + fraction * (bottom - top)}
              stroke={GRID}
              strokeWidth={1}
            />
          ))}
          <path d={path} fill="none" stroke={GOLD} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => (
            <circle key={point.date} cx={x(index)} cy={y(point.score)} r={7} fill={INK} />
          ))}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
          {points.map((point) => (
            <div key={point.date} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <span style={{ fontSize: 20, color: INK }}>{signed(point.score)}</span>
              <span style={{ fontSize: 18, color: MUTED }}>{shortDay(point.date)}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      width,
      height,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}

export function activityChart(roundup: Roundup) {
  const daily = roundup.activity?.daily ?? [];
  if (daily.length === 0) return null;
  const width = 1120;
  const height = 160;
  const left = 48;
  const right = width - 48;
  const top = 44;
  const bottom = height - 76;
  const barWidth = Math.max(24, (right - left) / daily.length - 28);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: BG,
          color: INK,
          padding: "24px 48px 18px",
          fontFamily: "-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 22, letterSpacing: 3, textTransform: "uppercase", color: GOLD }}>
            Sky activity
          </span>
          <span style={{ fontSize: 20, color: MUTED }}>0–100</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 28, flexGrow: 1 }}>
          {daily.map((point) => {
            const day = new Date(`${point.date}T00:00:00Z`);
            const barHeight = Math.max(8, ((bottom - top) * point.score) / 100);
            return (
              <div key={point.date} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: barWidth }}>
                <span style={{ fontSize: 18, color: INK, marginBottom: 6 }}>{point.score}</span>
                <div style={{ width: barWidth, height: barHeight, background: GOLD, borderRadius: 4 }} />
                <span style={{ fontSize: 18, color: MUTED, marginTop: 8 }}>{DAYS[day.getUTCDay()]}</span>
              </div>
            );
          })}
        </div>
      </div>
    ),
    {
      width,
      height,
      headers: { "Cache-Control": "public, max-age=31536000, immutable" },
    },
  );
}
