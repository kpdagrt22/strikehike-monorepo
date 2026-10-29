export const ASSET_ORDER = ["sp500", "gold", "bonds", "nifty"];
export const PATTERN_ASSET_ORDER = ["sp500", "nifty"];
export const CONVERGENCE_ASSET_ORDER = [...ASSET_ORDER, "bitcoin"];
export const ALL_ASSET_ORDER = CONVERGENCE_ASSET_ORDER;

// Line colours: gold keeps its yellow; the others avoid the Core Index state
// colours (regimeUtils.js), so a line never reads as a state. Checked with
// the dataviz palette validator on the chart surfaces (#06060a, #f1ebe2):
// every asset pair at least 18 OKLab ΔE apart for normal vision and 8 under
// simulated colour blindness, every colour at least 3:1 on its surface.
export const ASSET_TARGETS = {
  sp500: {
    key: "sp500",
    label: "S&P 500",
    fullLabel: "S&P 500",
    metricLabel: "S&P 500",
    valueField: "sp500_proxy",
    sourceField: "proxy_source",
    volatilityField: "volatility_1y",
    drawdownField: "drawdown_1y",
    percentileField: "1y_volatility_percentile",
    precision: 0,
    unit: "index",
    dark: "#5b9df9",
    light: "#0c4a6e",
    darkSoft: "rgba(91, 157, 249, 0.22)",
    lightSoft: "rgba(12, 74, 110, 0.16)",
  },
  gold: {
    key: "gold",
    label: "Gold",
    fullLabel: "Gold — London bullion",
    metricLabel: "Gold $/oz",
    valueField: "gold_proxy",
    sourceField: "gold_proxy_source",
    volatilityField: "gold_volatility_1y",
    drawdownField: "gold_drawdown_1y",
    percentileField: "gold_1y_volatility_percentile",
    precision: 0,
    unit: "$/troy oz",
    dark: "#facc15",
    light: "#a16207",
    darkSoft: "rgba(250, 204, 21, 0.22)",
    lightSoft: "rgba(161, 98, 7, 0.16)",
  },
  bonds: {
    key: "bonds",
    label: "Bonds",
    fullLabel: "Treasury bonds",
    metricLabel: "Bond index",
    valueField: "bond_proxy",
    sourceField: "bond_proxy_source",
    volatilityField: "bond_volatility_1y",
    drawdownField: "bond_drawdown_1y",
    percentileField: "bond_1y_volatility_percentile",
    precision: 1,
    unit: "index",
    dark: "#a855f7",
    light: "#6b21a8",
    darkSoft: "rgba(168, 85, 247, 0.24)",
    lightSoft: "rgba(107, 33, 168, 0.16)",
  },
  nifty: {
    key: "nifty",
    label: "Nifty 50",
    fullLabel: "Nifty 50 — India",
    metricLabel: "Nifty 50",
    valueField: "nifty_proxy",
    sourceField: "nifty_proxy_source",
    volatilityField: "nifty_volatility_1y",
    drawdownField: "nifty_drawdown_1y",
    percentileField: "nifty_1y_volatility_percentile",
    precision: 0,
    unit: "index",
    dark: "#f0abfc",
    light: "#c026d3",
    darkSoft: "rgba(240, 171, 252, 0.22)",
    lightSoft: "rgba(192, 38, 211, 0.16)",
  },
  bitcoin: {
    key: "bitcoin",
    label: "Bitcoin",
    fullLabel: "Bitcoin — USD market price",
    metricLabel: "Bitcoin $",
    valueField: "btc_proxy",
    sourceField: "btc_proxy_source",
    volatilityField: "btc_volatility_1y",
    drawdownField: "btc_drawdown_1y",
    percentileField: "btc_1y_volatility_percentile",
    precision: 0,
    unit: "$",
    dark: "#f5f5f4",
    light: "#1c1917",
    darkSoft: "rgba(245, 245, 244, 0.18)",
    lightSoft: "rgba(28, 25, 23, 0.14)",
  },
};

export function getAssetTarget(key) {
  return ASSET_TARGETS[key] ?? ASSET_TARGETS.sp500;
}

export function assetChartColor(asset, isDark) {
  return isDark ? asset.dark : asset.light;
}

export function assetChartSoft(asset, isDark) {
  return isDark ? asset.darkSoft : asset.lightSoft;
}
