export const ASSET_ORDER = ["sp500", "gold", "bonds", "nifty"];
export const PATTERN_ASSET_ORDER = ["sp500", "nifty"];
export const CONVERGENCE_ASSET_ORDER = [...ASSET_ORDER, "bitcoin"];
export const ALL_ASSET_ORDER = CONVERGENCE_ASSET_ORDER;

export const ASSET_TARGETS = {
  sp500: {
    key: "sp500",
    label: "S&P 500",
    fullLabel: "S&P 500 proxy",
    metricLabel: "S&P 500",
    valueField: "sp500_proxy",
    sourceField: "proxy_source",
    volatilityField: "volatility_1y",
    drawdownField: "drawdown_1y",
    percentileField: "1y_volatility_percentile",
    precision: 0,
    unit: "index",
    dark: "#67e8f9",
    light: "#0e7490",
    darkSoft: "rgba(103, 232, 249, 0.22)",
    lightSoft: "rgba(14, 116, 144, 0.16)",
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
    dark: "#8b5cf6",
    light: "#5b21b6",
    darkSoft: "rgba(139, 92, 246, 0.24)",
    lightSoft: "rgba(91, 33, 182, 0.16)",
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
    dark: "#34d399",
    light: "#047857",
    darkSoft: "rgba(52, 211, 153, 0.22)",
    lightSoft: "rgba(4, 120, 87, 0.16)",
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
    dark: "#f7931a",
    light: "#c2410c",
    darkSoft: "rgba(247, 147, 26, 0.18)",
    lightSoft: "rgba(194, 65, 12, 0.14)",
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
