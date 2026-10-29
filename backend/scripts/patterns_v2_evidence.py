"""Offline evidence for Study of Patterns v2 (walk-forward track record, placebo, declines, mirror test).

Port of the judge's r2 evidence code. Writes
``data/processed/patterns_v2_skill.json``, which the API reads; the API never
runs this per request. Each asset's record is pinned to a fingerprint of that
asset's price inputs (``patterns_v2.inputs_fingerprint``): a parquet rewrite
that leaves the prices alone (a Core Index recompute) keeps it fresh, any price
change marks it stale until it is regenerated (the ingestion pipeline does this
automatically; a CI test fails while a fingerprint differs from the parquet):

    cd backend
    PYTHONPATH="src;." python -m scripts.patterns_v2_evidence \
        --parquet data/processed/macro_regime_history.parquet \
        --out data/processed/patterns_v2_skill.json

numpy/pandas only: the ingestion workflow and CI install
requirements-minimal.txt, and nothing here may need scipy. Runtime is about
one minute for all five assets.

Every test is causal: at each date i the engine sees only setups whose
forward 12 months ended by the start of the window that ends at i
(``patterns_v2.eligible``), feature scales come from that library, and the
usual rate uses the same past. Nothing here is fitted; the configuration is
``patterns_v2.PRIMARY`` (the setups) and ``patterns_v2.MIRROR`` (the mirror).
"""

from __future__ import annotations

import argparse
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
N_PLACEBO = 20
PLACEBO_SEED = 20261028
MIN_LIBRARY_YEARS = {"sp500": 20.0, "gold": 20.0, "bonds": 20.0, "nifty": 5.0, "bitcoin": 5.0}
RECENT_FROM: dict[str, str] = {}  # empty: every bank uses the midpoint of its own test period
DECLINE_ASSETS = ("sp500",)  # equity weekly banks with a 20-year library
DECLINE_READ = 0.10  # every fall read at its first close 10% below its peak
DECLINE_RESET = 0.20  # a fall ends when a close regains the peak or rallies 20% off the trough
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


def greedy_sep(order: np.ndarray, k: int, sep: int) -> np.ndarray:
    """The first k windows in ``order`` whose end points are at least ``sep`` apart."""
    chosen: list[int] = []
    for j in order:
        j = int(j)
        if all(abs(j - c) >= sep for c in chosen):
            chosen.append(j)
            if len(chosen) == k:
                break
    return np.array(chosen, dtype=int)


# --------------------------------------------------------------------------
# Walk-forward
# --------------------------------------------------------------------------


def walk_forward(bank: P2.WindowBank, asset: str) -> pd.DataFrame:
    """One causal test per month (every 4th week on weekly banks).

    Each row also carries N_PLACEBO placebo sets: k random eligible windows
    with the same separation (one seeded stream per bank, in test order).
    """
    cfg = bank.cfg
    H = cfg.horizon
    step = 4 if cfg.resolution == "W" else 1
    need = int(MIN_LIBRARY_YEARS[asset] * cfg.periods_per_year)
    jj = np.arange(bank.n)
    rng = np.random.default_rng(PLACEBO_SEED)
    rows = []
    for i in range(0, bank.n, step):
        if not (bank.valid_win[i] and bank.valid_fwd[i]):
            continue  # need today's window and the realised outcome
        if int((bank.valid_win & bank.valid_fwd & (jj + H <= i)).sum()) < need:
            continue
        fc = P2.analog_forecast(bank, i)
        if fc is None:
            continue
        base = fc["base"]
        # Causality check on every test: every setup's outcome ended by the
        # start of today's window.
        assert int(fc["chosen"].max()) + H <= i - cfg.window
        h3, h12 = cfg.horizons[0], cfg.horizons[-1]
        row: dict[str, Any] = {
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
            "share_20": fc["fell_20"] / fc["k"],
            "real_mdd": float(bank.fwd_mdd[i]),
        }
        cand = fc["cand"]
        for s in range(N_PLACEBO):
            placebo = greedy_sep(rng.permutation(cand), cfg.k, cfg.sep)
            row[f"pl{s}_up"] = float((bank.fwd_ret[h12][placebo] > 0).mean())
            row[f"pl{s}_f20"] = float((bank.fwd_mdd[placebo] <= LOG20).mean())
        rows.append(row)
    return pd.DataFrame(rows)


def score(df: pd.DataFrame, bank: P2.WindowBank, asset: str) -> dict[str, Any]:
    cfg = bank.cfg
    step = 4 if cfg.resolution == "W" else 1
    block = max(2, int(round(2 * cfg.periods_per_year / step)))  # two years of tests
    n = len(df)
    up = (df.real_12.to_numpy() > 0).astype(float)
    call_base = (df.base_p_up_12.to_numpy() > 0.5).astype(float)
    share = df.share_up_12.to_numpy()
    call = np.where(share > 0.5, 1.0, np.where(share < 0.5, 0.0, call_base))
    hit_a, hit_b = (call == up).astype(float), (call_base == up).astype(float)
    edge = boot_ci(lambda ix: float(hit_a[ix].mean() - hit_b[ix].mean()), n, block)
    edge_pp = [round(v * 100, 1) for v in edge] if edge else None
    direction_verdict = "worse" if edge and edge[1] < 0 else ("better" if edge and edge[0] > 0 else "no_edge")
    base_up = df.base_p_up_12.to_numpy() > 0.5
    base_call = "up" if base_up.all() else ("down" if not base_up.any() else "mixed")

    out: dict[str, Any] = {
        "available": True,
        "period": [df.date.iloc[0], df.date.iloc[-1]],
        "cadence": "monthly" if cfg.resolution == "M" else "every_4_weeks",
        "forecasts": n,
        "independent_years": round(n * step / cfg.periods_per_year, 1),
        "direction": {
            "horizon_months": 12,
            "hit_pct": round(hit_a.mean() * 100, 1),
            "base_hit_pct": round(hit_b.mean() * 100, 1),
            "edge_ci95_pp": edge_pp,
            "verdict": direction_verdict,
            "base_call": base_call,
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
    out["placebo"] = placebo_summary(df, cfg, out["direction"])
    out["warnings"] = warnings_record(df)
    out["declines"] = declines_record(bank, asset) if asset in DECLINE_ASSETS else None
    return out


def placebo_summary(df: pd.DataFrame, cfg: P2.Config, direction: dict[str, Any]) -> dict[str, Any] | None:
    """The same walk-forward scored with N_PLACEBO sets of k random eligible windows."""
    if df.empty or "pl0_up" not in df:
        return None
    up = (df.real_12.to_numpy() > 0).astype(float)
    bcall = (df.base_p_up_12.to_numpy() > 0.5).astype(float)
    hb = (bcall == up).mean()
    o = (df.real_mdd.to_numpy() <= LOG20).astype(float)
    b = df.base_p_dd20.to_numpy()
    gaps, skills = [], []
    for s in range(N_PLACEBO):
        sh = df[f"pl{s}_up"].to_numpy()
        call = np.where(sh > 0.5, 1.0, np.where(sh < 0.5, 0.0, bcall))
        gaps.append(((call == up).mean() - hb) * 100)
        raw = df[f"pl{s}_f20"].to_numpy()
        p = (raw * cfg.k + cfg.shrink_m * b) / (cfg.k + cfg.shrink_m)
        bss = brier_skill(p, b, o)
        skills.append(np.nan if bss is None else bss)
    lo, hi = _round_or_none(np.nanquantile(gaps, 0.05)), _round_or_none(np.nanquantile(gaps, 0.95))
    mean = _round_or_none(np.nanmean(gaps))
    if lo is None or hi is None or mean is None:
        return None
    # The setups' gap from the rounded hit rates; +/-0.05 absorbs that rounding.
    gap = direction["hit_pct"] - direction["base_hit_pct"]
    verdict = "same" if lo - 0.05 <= gap <= hi + 0.05 else ("setups_worse" if gap < lo else "setups_better")
    return {
        "seeds": N_PLACEBO,
        "direction_gap_pp_mean": mean,
        "direction_gap_pp_p05": lo,
        "direction_gap_pp_p95": hi,
        "falls_20_brier_skill_mean": _round_or_none(np.nanmean(skills)) if np.isfinite(skills).any() else None,
        "verdict": verdict,
    }


def warnings_record(df: pd.DataFrame) -> dict[str, Any] | None:
    """Falls of 20%+: how often one followed when the setups showed more of them than usual, and otherwise."""
    o = df.real_mdd.to_numpy() <= LOG20
    if not 0 < o.mean() < 1:
        return None
    flag = df.share_20.to_numpy() > df.base_p_dd20.to_numpy()
    if not flag.any() or flag.all():
        return None
    return {
        "threshold_pct": 20,
        "flagged_share_pct": round(float(flag.mean()) * 100, 1),
        "flagged_followed_pct": round(float(o[flag].mean()) * 100, 1),
        "other_followed_pct": round(float(o[~flag].mean()) * 100, 1),
    }


# --------------------------------------------------------------------------
# Declines: every finished fall that reached -10%, read at its first -10% close
# --------------------------------------------------------------------------


def declines(v: np.ndarray, c: float = DECLINE_READ, reset: float = DECLINE_RESET) -> list[dict[str, Any]]:
    """Peak -> trough falls of at least ``c`` on the relative level ``v``.

    A fall starts at a running peak, counts once a close is ``c`` below that
    peak (``hit``), and ends when a close regains the peak or rallies
    ``reset`` off the trough; nested crashes are split by that rally. Every
    fall is read at the same depth (its first close at -c), so its eventual
    depth cannot decide when it is read. ``end`` is None for a fall still
    under way.
    """
    finite = np.flatnonzero(np.isfinite(v))
    out: list[dict[str, Any]] = []
    if not len(finite):
        return out
    peak = trough = int(finite[0])
    hit: int | None = None
    falling = False
    for j in range(peak + 1, len(v)):
        if falling:
            if v[j] < v[trough]:
                trough = j
            elif v[j] >= v[peak] or v[j] >= v[trough] * (1 + reset):
                out.append({"peak": peak, "hit": hit, "trough": trough, "end": j})
                falling, peak = False, j
        else:
            if v[j] >= v[peak]:
                peak = j
            elif v[j] <= v[peak] * (1 - c):
                falling, trough, hit = True, j, j
    if falling:
        out.append({"peak": peak, "hit": hit, "trough": trough, "end": None})
    for d in out:
        d["depth"] = v[d["trough"]] / v[d["peak"]] - 1.0
    return out


def _decline_reading(bank: P2.WindowBank, i: int, asset: str) -> tuple[float, float] | None:
    """(setups, usual): shares whose next 12 months fell a further 10% below their start, at i."""
    cfg = bank.cfg
    jj = np.arange(bank.n)
    if not bank.valid_win[i]:
        return None
    base_mask = bank.valid_fwd & (jj + cfg.horizon <= i)
    if int((base_mask & bank.valid_win).sum()) < MIN_LIBRARY_YEARS[asset] * cfg.periods_per_year:
        return None
    cand = P2.eligible(bank, i)
    if not len(cand):
        return None
    setups = P2.pick_analogs(cand, P2.distances(bank, i, cand), cfg.k, cfg.sep)
    usual = np.flatnonzero(base_mask)
    # Valid forward windows are finite throughout: min = the worst level within 12 months.
    further = lambda idx: float((np.min(bank.fwd_path[idx], axis=1) <= LOG10).mean())  # noqa: E731
    return further(setups), further(usual)


def declines_record(bank: P2.WindowBank, asset: str) -> dict[str, Any] | None:
    """Counts only (the named list of declines belongs to the case catalogue)."""
    v = np.exp(bank.x - np.nanmax(bank.x))
    scored, unscored = [], []
    for d in declines(v):
        if d["end"] is None:
            continue  # still under way: its eventual depth is unknown
        reading = _decline_reading(bank, d["hit"], asset)
        if reading is None:
            unscored.append(d["hit"])
            continue
        scored.append({"hit": d["hit"], "became_20": bool(d["depth"] <= -0.20), "setups": reading[0], "flagged": reading[0] > reading[1]})
    if not scored:
        return None
    o = np.array([r["became_20"] for r in scored], dtype=float)
    flagged = np.array([r["flagged"] for r in scored], dtype=bool)
    a = auc(np.array([r["setups"] for r in scored]), o)
    return {
        "read_at_pct": int(round(DECLINE_READ * 100)),
        "period": [P2._iso(bank.dates[scored[0]["hit"]]), P2._iso(bank.dates[scored[-1]["hit"]])],
        "declines": len(scored),
        "became_20": int(o.sum()),
        "flagged": int(flagged.sum()),
        "flagged_became_20": int(o[flagged].sum()),
        "not_flagged": int((~flagged).sum()),
        "not_flagged_became_20": int(o[~flagged].sum()),
        "auc": None if a is None else round(a, 3),
        "before_record": sum(1 for hit in unscored if hit < scored[0]["hit"]),
    }


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


def build_skill_doc(frame: pd.DataFrame) -> dict[str, Any]:
    assets: dict[str, Any] = {}
    fingerprints: dict[str, str] = {}
    for asset in P2.PRIMARY:
        try:
            fingerprints[asset] = P2.inputs_fingerprint(frame, asset)
            bank = P2.bank_for(frame, asset)
            df = walk_forward(bank, asset)
            if df.empty:
                assets[asset] = {"available": False}
                continue
            block: dict[str, Any] = {"available": True, "inputs_fingerprint": fingerprints[asset], **score(df, bank, asset)}
            if asset in P2.MIRROR:
                ev = mirror_evidence(P2.bank_for(frame, asset, P2.MIRROR[asset]))
                if ev:
                    block["mirror_evidence"] = ev
            assets[asset] = block
        except Exception as exc:  # noqa: BLE001 - one asset must not sink the artifact
            assets[asset] = {"available": False, "error": f"{type(exc).__name__}: {exc}"}
    config: dict[str, Any] = {
        asset: {"resolution": cfg.resolution, "window": cfg.window, "horizon": cfg.horizon, "k": cfg.k, "sep": cfg.sep}
        for asset, cfg in P2.PRIMARY.items()
    }
    for asset, cfg in P2.MIRROR.items():
        config[f"{asset}_mirror"] = {"resolution": cfg.resolution, "window": cfg.window, "horizon": cfg.horizon}
    return P2.json_safe({
        "schema_version": P2.SKILL_SCHEMA_VERSION,
        "engine_version": P2.PATTERNS_V2_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "config": config,
        "inputs_fingerprint": fingerprints,
        "assets": assets,
    })


def write_skill_artifact(frame: pd.DataFrame, path: Path) -> Path:
    """Build the skill artifact from ``frame`` and write it atomically (strict JSON)."""
    frame = frame[P2.asset_columns(frame.columns)].copy()
    frame.index = pd.to_datetime(frame.index, utc=True)
    frame = frame.sort_index()
    doc = build_skill_doc(frame)
    text = json.dumps(doc, indent=1, ensure_ascii=False, allow_nan=False) + "\n"
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    tmp.replace(path)
    return path


def _summary_lines(doc: dict[str, Any]) -> list[str]:
    lines = [f"generated_at {doc.get('generated_at')}  inputs_fingerprint {doc.get('inputs_fingerprint')}"]
    for asset, block in (doc.get("assets") or {}).items():
        if not block.get("available"):
            lines.append(f"{asset}: unavailable {block.get('error', '')}".rstrip())
            continue
        d, f20, pl = block["direction"], block["falls_20"], block.get("placebo") or {}
        line = (
            f"{asset}: {block['forecasts']} tests {block['period'][0]}..{block['period'][1]} "
            f"(~{block['independent_years']} yrs); direction {d['hit_pct']} vs usual {d['base_hit_pct']} "
            f"gap {d['edge_ci95_pp']} -> {d['verdict']} (usual call {d['base_call']}); "
            f"falls>=20% BSS {f20['brier_skill']} {f20['ci95']} -> {f20['verdict']}; "
            f"ranking {block['ranking']['verdict']}; placebo {pl.get('verdict')}"
        )
        dec = block.get("declines")
        if dec:
            line += (
                f"; declines {dec['declines']} ({dec['became_20']} to -20%), flagged {dec['flagged']}->"
                f"{dec['flagged_became_20']}, not {dec['not_flagged']}->{dec['not_flagged_became_20']}"
            )
        lines.append(line)
    return lines


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--parquet", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--meta", default=None, help="Ignored: the record is pinned to price-input fingerprints.")
    a = ap.parse_args(argv)
    columns = P2.asset_columns()
    try:
        frame = pd.read_parquet(a.parquet, columns=columns)
    except (KeyError, ValueError):  # an older artifact without one of the assets
        frame = pd.read_parquet(a.parquet)
    out = write_skill_artifact(frame, Path(a.out))
    print(out)
    for line in _summary_lines(json.loads(out.read_text(encoding="utf-8"))):
        print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
