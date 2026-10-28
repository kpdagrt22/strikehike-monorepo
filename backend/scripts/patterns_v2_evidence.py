"""Offline evidence for Study of Patterns v2 (walk-forward skill, mirror test, bear markets).

Writes ``data/processed/patterns_v2_skill.json``, which the API reads; the API
never runs this per request. Regenerate it whenever the parquet changes (the
ingestion pipeline does this automatically; a CI test fails when its
``data_version`` differs from ``macro_regime_history.meta.json``):

    cd backend
    PYTHONPATH="src;." python -m scripts.patterns_v2_evidence \
        --parquet data/processed/macro_regime_history.parquet \
        --meta data/processed/macro_regime_history.meta.json \
        --out data/processed/patterns_v2_skill.json

numpy/pandas only: the ingestion workflow and CI install
requirements-minimal.txt, and nothing here may need scipy. Runtime is about
10-20 s for all five assets.

Every forecast is causal: at each date i the engine sees only setups whose
forward 12 months ended by the start of the window that ends at i
(``patterns_v2.eligible``), feature scales come from that library, and the
base rate uses the same past. Nothing here is fitted; the configuration is
``patterns_v2.PRIMARY``.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from regime import patterns_v2 as P2  # noqa: E402

LOG10, LOG20 = math.log(0.90), math.log(0.80)
N_BOOT = 1000
SEED = 1
MIN_LIBRARY_YEARS = {"sp500": 20.0, "gold": 20.0, "bonds": 20.0, "nifty": 5.0, "bitcoin": 5.0}
RECENT_FROM = {"sp500": "1959-01-01"}  # others: midpoint of their forecast period
MIRROR_OFFSETS = range(60, 151)


# --------------------------------------------------------------------------
# numpy-only statistics
# --------------------------------------------------------------------------


def _rank(a: np.ndarray) -> np.ndarray:
    return pd.Series(a).rank(method="average").to_numpy()


def spearman(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 3:
        return float("nan")
    ra, rb = _rank(a), _rank(b)
    if ra.std() == 0 or rb.std() == 0:
        return float("nan")
    return float(np.corrcoef(ra, rb)[0, 1])


def auc(p: np.ndarray, o: np.ndarray) -> float | None:
    pos, neg = int(o.sum()), int((1 - o).sum())
    if pos == 0 or neg == 0:
        return None
    r = _rank(p)
    return float((r[o == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def brier_skill(p: np.ndarray, base: np.ndarray, o: np.ndarray) -> float | None:
    ref = float(np.mean((base - o) ** 2))
    if ref <= 1e-12:
        return None
    return float(1.0 - np.mean((p - o) ** 2) / ref)


def block_indices(n: int, block: int, rng: np.random.Generator) -> np.ndarray:
    starts = rng.integers(0, n, size=int(np.ceil(n / block)))
    return np.concatenate([(np.arange(s, s + block) % n) for s in starts])[:n]


def boot_ci(fn, n: int, block: int, seed: int = SEED) -> list[float] | None:
    rng = np.random.default_rng(seed)
    vals = []
    for _ in range(N_BOOT):
        v = fn(block_indices(n, block, rng))
        if v is not None and np.isfinite(v):
            vals.append(v)
    if len(vals) < N_BOOT // 2:
        return None
    return [round(float(np.quantile(vals, 0.025)), 3), round(float(np.quantile(vals, 0.975)), 3)]


def _round_or_none(value: float | None, digits: int = 3) -> float | None:
    if value is None or not np.isfinite(value):
        return None
    return round(float(value), digits)


# --------------------------------------------------------------------------
# Walk-forward
# --------------------------------------------------------------------------


def walk_forward(bank: P2.WindowBank, asset: str) -> pd.DataFrame:
    cfg = bank.cfg
    step = 4 if cfg.resolution == "W" else 1
    need = int(MIN_LIBRARY_YEARS[asset] * cfg.periods_per_year)
    jj = np.arange(bank.n)
    rows = []
    for i in range(0, bank.n, step):
        if not (bank.valid_win[i] and bank.valid_fwd[i]):
            continue  # need today's window and the realised outcome
        if int((bank.valid_win & bank.valid_fwd & (jj + cfg.horizon <= i)).sum()) < need:
            continue
        fc = P2.analog_forecast(bank, i)
        if fc is None:
            continue
        base = fc["base"]
        # Causality check on every forecast: every setup's outcome ended by
        # the start of today's window.
        assert int(fc["chosen"].max()) + cfg.horizon <= i - cfg.window
        h3, h12 = cfg.horizons[0], cfg.horizons[-1]
        rows.append({
            "i": i,
            "date": P2._iso(bank.dates[i]),
            "k": fc["k"],
            "share_up_12": fc[f"share_up_{h12}"],
            "base_p_up_12": base[f"p_up_{h12}"],
            "median_3": fc[f"median_ret_{h3}"],
            "real_3": float(bank.fwd_ret[h3][i]),
            "real_12": float(bank.fwd_ret[h12][i]),
            "p_dd10": fc["p_dd10"], "base_p_dd10": base["p_dd10"],
            "p_dd20": fc["p_dd20"], "base_p_dd20": base["p_dd20"],
            "fell_20": fc["fell_20"],
            "real_mdd": float(bank.fwd_mdd[i]),
        })
    return pd.DataFrame(rows)


def score(df: pd.DataFrame, bank: P2.WindowBank, asset: str) -> dict[str, Any]:
    cfg = bank.cfg
    step = 4 if cfg.resolution == "W" else 1
    block = max(2, int(round(2 * cfg.periods_per_year / step)))  # two years of forecasts
    n = len(df)
    up = (df.real_12.to_numpy() > 0).astype(float)
    call_base = (df.base_p_up_12.to_numpy() > 0.5).astype(float)
    share = df.share_up_12.to_numpy()
    call = np.where(share > 0.5, 1.0, np.where(share < 0.5, 0.0, call_base))
    hit_a, hit_b = (call == up).astype(float), (call_base == up).astype(float)
    edge = boot_ci(lambda ix: float(hit_a[ix].mean() - hit_b[ix].mean()), n, block)
    edge_pp = [round(v * 100, 1) for v in edge] if edge else None
    direction_verdict = "worse" if edge and edge[1] < 0 else ("better" if edge and edge[0] > 0 else "no_edge")

    out: dict[str, Any] = {
        "available": True,
        "period": [df.date.iloc[0], df.date.iloc[-1]],
        "forecasts": n,
        "independent_years": round(n * step / cfg.periods_per_year, 1),
        "direction": {
            "horizon_months": 12,
            "hit_pct": round(hit_a.mean() * 100, 1),
            "base_hit_pct": round(hit_b.mean() * 100, 1),
            "edge_ci95_pp": edge_pp,
            "verdict": direction_verdict,
        },
    }
    for key, thr, pct in (("falls_20", LOG20, 20), ("falls_10", LOG10, 10)):
        o = (df.real_mdd.to_numpy() <= thr).astype(float)
        p, b = df[f"p_dd{pct}"].to_numpy(), df[f"base_p_dd{pct}"].to_numpy()
        bss = brier_skill(p, b, o)
        if bss is None or o.mean() in (0.0, 1.0):
            out[key] = {"threshold_pct": pct, "realised_pct": round(o.mean() * 100, 1), "brier_skill": None, "ci95": None, "auc": None, "verdict": "not_measurable"}
            continue
        ci = boot_ci(lambda ix: brier_skill(p[ix], b[ix], o[ix]), n, block)
        verdict = "no_edge" if not ci else ("better" if ci[0] > 0 else ("worse" if ci[1] < 0 else "no_edge"))
        a = auc(p, o)
        out[key] = {"threshold_pct": pct, "realised_pct": round(o.mean() * 100, 1), "brier_skill": round(bss, 3), "ci95": ci,
                    "auc": None if a is None else round(a, 3), "verdict": verdict}

    med, real = df.median_3.to_numpy(), df.real_3.to_numpy()
    rho = spearman(med, real)
    ci = boot_ci(lambda ix: spearman(med[ix], real[ix]), n, block)
    recent_from = RECENT_FROM.get(asset) or df.date.iloc[n // 2]
    rec = df.date.to_numpy() >= recent_from
    r_med, r_real = med[rec], real[rec]
    r_rho = spearman(r_med, r_real) if rec.sum() >= 24 else None
    r_ci = boot_ci(lambda ix: spearman(r_med[ix], r_real[ix]), int(rec.sum()), block) if rec.sum() >= 24 else None
    full_pos = bool(ci and ci[0] > 0)
    recent_pos = bool(r_ci and r_ci[0] > 0)
    out["ranking"] = {
        "horizon_months": 3,
        "rank_corr": _round_or_none(rho),
        "ci95": ci,
        "recent_from": recent_from[:10],
        "recent_rank_corr": _round_or_none(r_rho),
        "recent_ci95": r_ci,
        "verdict": "weak" if (full_pos and recent_pos) else ("unstable" if full_pos else "none"),
    }
    out.update(episodes(bank, df))
    return out


def bear_markets(bank: P2.WindowBank, threshold: float = 0.20) -> list[tuple[int, int, int]]:
    """(peak, trough, read) for every bear market, by the standard +/-20% rule.

    A bear market starts at a peak, is confirmed once the series is 20% below
    it, and ends at the trough once the series is 20% above that trough. Unlike
    "peak until full recovery", this keeps nested crashes (1937-38 inside the
    1929-54 recovery, 2007-09 inside 2000-13) as separate episodes.

    The read point is the first period at which the fall reached one fifth of
    its eventual depth (for a 50% fall, the first point 10% below the peak). The
    depth is known only afterwards: it fixes WHEN we read the causal forecast,
    never what the forecast saw.
    """
    x, seg, n = bank.x, bank.seg, bank.n
    up, down = math.log(1 + threshold), -math.log(1 - threshold)
    pairs: list[tuple[int, int]] = []
    i = 0
    while i < n:
        if not np.isfinite(x[i]):
            i += 1
            continue
        s, state, peak, trough, j = seg[i], "bull", i, i, i + 1
        while j < n and np.isfinite(x[j]) and seg[j] == s:
            if state == "bull":
                if x[j] > x[peak]:
                    peak = j
                elif x[peak] - x[j] >= down:
                    state, trough = "bear", j
            else:
                if x[j] < x[trough]:
                    trough = j
                elif x[j] - x[trough] >= up:
                    pairs.append((peak, trough))
                    state, peak = "bull", j
            j += 1
        if state == "bear":
            pairs.append((peak, trough))
        i = j
    out = []
    for p, t in pairs:
        depth = math.expm1(x[t] - x[p])
        mark_level = x[p] + math.log1p(0.2 * depth)
        k = p
        while x[k] > mark_level:
            k += 1
        out.append((p, t, k))
    return out


def episodes(bank: P2.WindowBank, df: pd.DataFrame) -> dict[str, Any]:
    step = 4 if bank.cfg.resolution == "W" else 1
    rows, before = [], []
    by_i = df.set_index("i")
    first_forecast = pd.Timestamp(df.date.iloc[0], tz="UTC")
    for p, t, k in bear_markets(bank):
        stub = {
            "peak": P2._iso(bank.dates[p]),
            "trough": P2._iso(bank.dates[t]),
            "depth_pct": round(math.expm1(bank.x[t] - bank.x[p]) * 100, 1),
            "source": P2._source_code(bank, p),
        }
        cands = [c for c in range(k, k - step, -1) if c in by_i.index]
        if not cands:
            if bank.dates[k] < first_forecast:
                before.append(stub)
            continue  # otherwise the 12-month outcome is not known yet
        r = by_i.loc[cands[0]]
        rows.append({
            **stub,
            "read_on": r.date,
            "drawdown_at_read_pct": round(math.expm1(bank.x[cands[0]] - bank.x[p]) * 100, 1),
            "setups_fell_20": int(r.fell_20),
            "of": int(r.k),
            "base_share_20_pct": round(float(r.base_p_dd20) * 100, 1),
            "further_fall_20": bool(r.real_mdd <= LOG20),
            "remaining_fall_pct": round(math.expm1(bank.x[t] - bank.x[cands[0]]) * 100, 1),
        })
    above = [e for e in rows if e["setups_fell_20"] / max(e["of"], 1) * 100 > e["base_share_20_pct"]]
    below = [e for e in rows if e not in above]
    summary = {
        "with_reading": len(rows),
        "above_usual": len(above),
        "above_usual_followed": sum(e["further_fall_20"] for e in above),
        "not_above_usual": len(below),
        "not_above_usual_followed": sum(e["further_fall_20"] for e in below),
    }
    return {"episodes": rows, "episodes_before_record": before, "episodes_summary": summary}


# --------------------------------------------------------------------------
# Mirror evidence (S&P only: the only series that reaches back 120 years)
# --------------------------------------------------------------------------


def mirror_evidence(bank: P2.WindowBank) -> dict[str, Any] | None:
    cfg = bank.cfg
    P = cfg.periods_per_year
    if cfg.resolution != "M":
        return None
    ranks: dict[int, list[float]] = {k: [] for k in MIRROR_OFFSETS}
    pairs, months, hits, base_hits = [], [], [], []
    for i in range(bank.n):
        if not bank.valid_win[i]:
            continue
        cand = P2.eligible(bank, i)
        if len(cand) < 240:
            continue
        d = P2.distances(bank, i, cand)
        order = np.sort(d)
        pos = {int(c): q for q, c in enumerate(cand)}
        for k in MIRROR_OFFSETS:
            j = i - P * k
            if j in pos:
                ranks[k].append(100.0 * np.searchsorted(order, d[pos[j]], side="left") / len(d))
        j = i - P * P2.MIRROR_YEARS
        if j in pos:
            months.append(P2._iso(bank.dates[i]))
            if bank.valid_fwd[i]:
                pairs.append((bank.fwd_ret[12][j], bank.fwd_ret[12][i]))
                base_up = float((bank.fwd_ret[12][cand] > 0).mean()) > 0.5
                hits.append((bank.fwd_ret[12][j] > 0) == (bank.fwd_ret[12][i] > 0))
                base_hits.append(base_up == (bank.fwd_ret[12][i] > 0))
    r120 = np.array(ranks[P2.MIRROR_YEARS])
    if len(r120) < 24:
        return None
    se = (100 / math.sqrt(12)) / math.sqrt(len(r120) / 12.0)  # ~1 independent rank per year
    z = (float(r120.mean()) - 50.0) / se
    means = {k: float(np.mean(v)) for k, v in ranks.items() if len(v) >= 24}
    rank_of_120 = int(sum(1 for v in means.values() if v < means[P2.MIRROR_YEARS]) + 1)
    pr = np.array(pairs)
    return {
        "months_tested": int(len(r120)),
        "period": [months[0], months[-1]],
        "mean_rank_pct": round(float(r120.mean()), 1),
        "chance_rank_pct": 50.0,
        "z": round(z, 2),
        "share_in_closest_10pct": round(float((r120 <= 10).mean() * 100), 1),
        "rank_among_offsets": [rank_of_120, len(means)],
        "offsets_years": [MIRROR_OFFSETS[0], MIRROR_OFFSETS[-1]],
        "forward_12m_rank_corr": None if len(pr) < 24 else _round_or_none(spearman(pr[:, 0], pr[:, 1])),
        "direction_hit_12m_pct": None if not hits else round(float(np.mean(hits)) * 100, 1),
        "base_hit_12m_pct": None if not base_hits else round(float(np.mean(base_hits)) * 100, 1),
        "verdict": "no_information" if abs(z) < 2 else ("closer_than_chance" if z < 0 else "farther_than_chance"),
    }


# --------------------------------------------------------------------------
# Artifact
# --------------------------------------------------------------------------


def build_skill_doc(frame: pd.DataFrame, *, data_version: str | None) -> dict[str, Any]:
    assets: dict[str, Any] = {}
    for asset in P2.PRIMARY:
        try:
            bank = P2.bank_for(frame, asset)
            df = walk_forward(bank, asset)
            if df.empty:
                assets[asset] = {"available": False}
                continue
            block = score(df, bank, asset)
            ev = mirror_evidence(bank) if asset == "sp500" else None
            if ev:
                block["mirror_evidence"] = ev
            assets[asset] = block
        except Exception as exc:  # noqa: BLE001 - one asset must not sink the artifact
            assets[asset] = {"available": False, "error": f"{type(exc).__name__}: {exc}"}
    return P2.json_safe({
        "schema_version": P2.SKILL_SCHEMA_VERSION,
        "engine_version": P2.PATTERNS_V2_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_version": data_version,
        "assets": assets,
    })


def write_skill_artifact(frame: pd.DataFrame, path: Path, *, data_version: str | None) -> Path:
    """Build the skill artifact from ``frame`` and write it atomically (strict JSON)."""
    frame = frame[P2.asset_columns(frame.columns)].copy()
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame = frame.sort_index()
    doc = build_skill_doc(frame, data_version=data_version)
    text = json.dumps(doc, indent=1, ensure_ascii=False, allow_nan=False) + "\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return path


def _summary_lines(doc: dict[str, Any]) -> list[str]:
    lines = [f"data_version {doc.get('data_version')}  generated_at {doc.get('generated_at')}"]
    for asset, block in (doc.get("assets") or {}).items():
        if not block.get("available"):
            lines.append(f"{asset}: unavailable {block.get('error', '')}".rstrip())
            continue
        d, f20 = block["direction"], block["falls_20"]
        lines.append(
            f"{asset}: {block['forecasts']} forecasts {block['period'][0]}..{block['period'][1]} "
            f"(~{block['independent_years']} yrs); direction {d['hit_pct']} vs usual {d['base_hit_pct']} "
            f"gap {d['edge_ci95_pp']} -> {d['verdict']}; falls>=20% BSS {f20['brier_skill']} {f20['ci95']} -> {f20['verdict']}; "
            f"ranking {block['ranking']['verdict']}"
        )
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--parquet", required=True)
    ap.add_argument("--meta", default=None, help="Default: the parquet's sibling .meta.json")
    ap.add_argument("--out", required=True)
    a = ap.parse_args(argv)
    parquet = Path(a.parquet)
    meta_path = Path(a.meta) if a.meta else parquet.with_suffix(".meta.json")
    columns = P2.asset_columns()
    try:
        frame = pd.read_parquet(parquet, columns=columns)
    except (KeyError, ValueError):  # an older artifact without one of the assets
        frame = pd.read_parquet(parquet)
    data_version = None
    if meta_path.exists():
        data_version = json.loads(meta_path.read_text(encoding="utf-8")).get("data_version")
        parquet_version = hashlib.sha256(parquet.read_bytes()).hexdigest()[:12]
        if data_version != parquet_version:
            print(f"warning: {meta_path.name} data_version {data_version} != parquet {parquet_version}", file=sys.stderr)
    else:
        print(f"warning: {meta_path} not found; data_version is null", file=sys.stderr)
    out = write_skill_artifact(frame, Path(a.out), data_version=data_version)
    print(out)
    for line in _summary_lines(json.loads(out.read_text(encoding="utf-8"))):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
