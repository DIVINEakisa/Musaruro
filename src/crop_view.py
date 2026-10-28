"""National view of one crop: how it is grown in every district (NISR SAS 2026, Seasons A and B)."""
from __future__ import annotations

import pandas as pd

MIN_AREA_HA = 100        # below this harvested area, a district yield is shown but greyed as thin


def crop_list(crops: pd.DataFrame, season: str, groups: bool) -> list[str]:
    c = crops[(crops.season == season) & crops.harvested_ha.notna() & (crops.harvested_ha > 0)]
    if not groups:
        c = c[~c.is_group]
    return sorted(c.crop.unique())


def national_table(crops: pd.DataFrame, season: str, crop: str, nat: pd.DataFrame | None = None) -> pd.DataFrame:
    """District rows for one crop and season with area share, production share, rank by area and, when the NISR
    national row is given, yield as % of the national yield."""
    c = crops[(crops.season == season) & (crops.crop == crop)].copy()
    c = c[c.cultivated_ha.fillna(0).add(c.harvested_ha.fillna(0)) > 0]
    tot_a, tot_p = c.harvested_ha.sum(), c.production_mt.sum()
    c["area_share_pct"] = 100 * c.harvested_ha / tot_a if tot_a else float("nan")
    c["production_share_pct"] = 100 * c.production_mt / tot_p if tot_p else float("nan")
    c["thin"] = c.harvested_ha < MIN_AREA_HA
    c["national_yield_kg_ha"] = float("nan")
    if nat is not None:
        r = nat[(nat.season == season) & (nat.crop == crop)]
        if len(r):
            c["national_yield_kg_ha"] = float(r.yield_kg_ha.iloc[0])
    c["yield_vs_national_pct"] = 100 * c.yield_kg_ha / c.national_yield_kg_ha
    c["area_rank"] = c.harvested_ha.rank(ascending=False, method="min")
    return c.sort_values("harvested_ha", ascending=False).reset_index(drop=True)


def concentration(t: pd.DataFrame, n: int = 5) -> float:
    """Share of the crop's harvested area in its n largest districts."""
    return float(t.harvested_ha.nlargest(n).sum() / t.harvested_ha.sum() * 100) if t.harvested_ha.sum() else float("nan")


def where_grown(crops: pd.DataFrame, crop: str) -> pd.DataFrame:
    """Both seasons side by side for one crop, harvested area (ha) and yield, one row per district."""
    out = None
    for s in ("A", "B"):
        t = crops[(crops.season == s) & (crops.crop == crop)][["district", "province", "harvested_ha", "yield_kg_ha", "production_mt"]]
        t = t.rename(columns={"harvested_ha": f"area_{s}", "yield_kg_ha": f"yield_{s}", "production_mt": f"prod_{s}"})
        out = t if out is None else out.merge(t.drop(columns="province"), on="district", how="outer")
    return out.fillna({"area_A": 0, "area_B": 0})
