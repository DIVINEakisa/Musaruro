"""Irrigation screening: where is irrigation use low while seasons are often dry?

This is a screening aid, not a plan. It joins three separately sourced facts per district and shows them side by side:
  1. how many farmers irrigate (NISR SAS 2026) and how much cropland is irrigated (NISR SAS 2026),
  2. how often the season's rainfall was clearly below its usual level in 2016-2024 (CHIRPS satellite estimate),
  3. national context from the AHS 2024 on why plots are not irrigated.
No score is computed and nothing here says irrigation would raise yields; yields were not found to follow rainfall
(see README). It marks where a field visit or water-source survey would be a reasonable next step.
"""
from __future__ import annotations

import pandas as pd

import rainfall_watch as rw

DRY_PCT = 85            # a baseline season below 85% of its normal counts as clearly dry (same cut as the Watch alert)
DRY_YEARS_FLAG = 3      # flag when at least this many of the 9 baseline seasons were clearly dry
LOW_USE_PCT = 10.0      # "low irrigation use": under 10% of farmers irrigate
SMALL_SAMPLE_NOTE = "Technique and source shares are % of irrigated plots; in many districts that is only a few dozen plots."

# Assumptions for the pump sizing sketch; all are inputs the user can change. PR values are EnaGIS's (config.js).
PV_PERFORMANCE_RATIO = dict(low=0.65, central=0.75, high=0.80)
G = 9.81


def dry_exposure(rain: pd.DataFrame, season: str, years=rw.BASELINE_YEARS) -> pd.DataFrame:
    """Per district: number of baseline seasons below DRY_PCT of normal, out of the seasons with complete data."""
    rows = []
    for y in years:
        a = rw.season_anomaly(rain, season, y, years=years)
        a = a[a.pct_of_normal.notna()]
        rows.append(a[["district", "year", "pct_of_normal"]])
    allv = pd.concat(rows)
    g = allv.groupby("district").pct_of_normal
    out = pd.DataFrame({"dry_seasons": g.apply(lambda s: int((s < DRY_PCT).sum())), "seasons_checked": g.count(),
                        "driest_pct": g.min()}).reset_index()
    out["season"] = season
    return out


def screen(irr: pd.DataFrame, prac_shares: pd.DataFrame, exposure: pd.DataFrame, season: str) -> pd.DataFrame:
    """One row per district. `prac_shares` comes from actions.practice_shares (irrigated_pct = % of cropland)."""
    i = irr[irr.season == season][["district", "farmers_irrigating_pct", "farmers_irrigating_pct_ssf"]]
    p = prac_shares[(prac_shares.season == season) & (prac_shares.district != "National")][["district", "irrigated_pct"]]
    e = exposure[exposure.season == season][["district", "dry_seasons", "seasons_checked", "driest_pct"]]
    t = i.merge(p, on="district", how="left").merge(e, on="district", how="left")
    t["low_use"] = t.farmers_irrigating_pct < LOW_USE_PCT
    t["often_dry"] = t.dry_seasons >= DRY_YEARS_FLAG
    t["check_first"] = t.low_use & t.often_dry
    return t.sort_values(["check_first", "dry_seasons"], ascending=[False, False]).reset_index(drop=True)


def pump_sketch(area_ha: float, depth_mm_per_day: float, head_m: float, pump_eff: float, sun_hours: float,
                pr: float = PV_PERFORMANCE_RATIO["central"]) -> dict:
    """Back-of-envelope pumping energy and solar size for lifting water to a field.
    Water m3/day = area x depth; energy = m3 x g x head / pump efficiency; solar kWp = kWh/day / (sun hours x PR).
    Excludes pipe friction, storage and the farm's water source rights. Same PV sizing rule EnaGIS uses
    (kWh/day / (peak sun hours x performance ratio)), here with user-chosen inputs."""
    m3 = area_ha * 10_000 * depth_mm_per_day / 1000
    kwh = m3 * 1000 * G * head_m / (3.6e6 * pump_eff)
    return dict(m3_day=m3, kwh_day=kwh, kwp=kwh / (sun_hours * pr) if sun_hours * pr else float("nan"))
