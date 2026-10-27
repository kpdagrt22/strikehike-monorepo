export const ASSET_ORDER = ["sp500", "gold", "bonds"];
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
    dark: "#d8b47a",
    light: "#8a6a3a",
    darkSoft: "rgba(216, 180, 122, 0.18)",
    lightSoft: "rgba(138, 106, 58, 0.14)",
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
    dark: "#f4c95d",
    light: "#a16207",
    darkSoft: "rgba(244, 201, 93, 0.18)",
    lightSoft: "rgba(161, 98, 7, 0.14)",
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
    dark: "#c4b5fd",
    light: "#6d5bd0",
    darkSoft: "rgba(196, 181, 253, 0.18)",
    lightSoft: "rgba(109, 91, 208, 0.14)",
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
