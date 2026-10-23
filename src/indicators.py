"""Compute transparent district indicators from the tidy NISR data.

Definitions (all computed from NISR tables; labelled "Musaruro calculation" in the app):

yield_vs_national_pct : (district yield / national yield - 1) * 100, per crop and season.
                        Computed only where the district harvested >= MIN_HARVESTED_HA of the crop.
shortfall_t           : max(0, national yield - district yield) * harvested_ha / 1000  [tonnes].
                        "Output if this district matched the national average." It is a comparison, NOT a forecast
                        or a potential-yield estimate (altitude, soils and rainfall legitimately differ).
yield_shortfall_idx   : area-weighted average of max(0, -yield_vs_national_pct) across the main crops.
seed_gap_idx          : 100 - % of farmers using improved seed (all crops combined; Table 20 / 18).
priority_score        : weighted mean of the percentile ranks of the indicators (weights set in the app).
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "data" / "processed"

MIN_HARVESTED_HA = 100
MAIN_CROPS = [
    "Maize", "Sorghum", "Paddy rice", "Wheat", "Cassava", "Sweet potato", "Irish potato",
    "Cooking banana", "Dessert banana", "Banana for beer", "Bush bean", "Climbing bean", "Pea",
    "Groundnut", "Soybean", "Vegetables",
]


def crop_indicators() -> pd.DataFrame:
    c = pd.read_csv(P / "crop_district_season.csv")
    nat = pd.read_csv(P / "national_reference.csv")[["season", "crop", "yield_kg_ha"]].rename(
        columns={"yield_kg_ha": "national_yield_kg_ha"})
    c = c[c.crop.isin(MAIN_CROPS)].merge(nat, on=["season", "crop"], how="left")
    ok = (c.harvested_ha >= MIN_HARVESTED_HA) & (c.yield_kg_ha > 0)
    c["yield_vs_national_pct"] = np.where(ok, (c.yield_kg_ha / c.national_yield_kg_ha - 1) * 100, np.nan)
    c["shortfall_t"] = np.where(ok, np.maximum(0, c.national_yield_kg_ha - c.yield_kg_ha) * c.harvested_ha / 1000, np.nan)
    return c


def district_indicators(crop_ind: pd.DataFrame | None = None) -> pd.DataFrame:
    ci = crop_ind if crop_ind is not None else crop_indicators()
    seed = pd.read_csv(P / "improved_seed_district.csv")
    seed = seed[seed.district != "National"][["season", "district", "farmers_improved_pct"]]
    rows = []
    for (season, district), g in ci.groupby(["season", "district"]):
        g = g.dropna(subset=["yield_vs_national_pct"])
        w = g.harvested_ha
        short = np.maximum(0, -g.yield_vs_national_pct)
        rows.append(dict(
            season=season, district=district,
            province=g.province.iloc[0] if len(g) else None,
            crops_assessed=len(g),
            yield_shortfall_idx=float((short * w).sum() / w.sum()) if w.sum() else np.nan,
            total_shortfall_t=float(g.shortfall_t.sum()),
        ))
    d = pd.DataFrame(rows).merge(seed, on=["season", "district"], how="left")
    d["seed_gap_idx"] = 100 - d.farmers_improved_pct
    return d


def add_priority(d: pd.DataFrame, w_yield: float = 0.5, w_seed: float = 0.5) -> pd.DataFrame:
    d = d.copy()
    for col in ("yield_shortfall_idx", "seed_gap_idx"):
        d[col + "_rank"] = d.groupby("season")[col].rank(pct=True)
    tot = w_yield + w_seed
    d["priority_score"] = 100 * (w_yield * d.yield_shortfall_idx_rank + w_seed * d.seed_gap_idx_rank) / tot
    return d


if __name__ == "__main__":
    ci = crop_indicators()
    di = add_priority(district_indicators(ci))
    ci.to_csv(P / "indicators_crop.csv", index=False)
    di.to_csv(P / "indicators_district.csv", index=False)
    print(f"crop indicators {len(ci)} rows | district indicators {len(di)} rows")
