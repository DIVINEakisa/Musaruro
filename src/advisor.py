"""Risk-to-action advisor: turns an alert level and a planting stage into checks, and shows crop evidence.

Design rules (tested):
- Every suggestion carries a status label. Nothing here is "verified guidance": the steps are generic checks to discuss with an
  agronomist, not crop-specific agronomy.
- Crop comparison shows evidence only (area grown, yield against each crop's own national yield, usual sowing months).
  It never tells a farmer to switch crops. kg/ha is NOT comparable across crops.
- Rainfall here is past monitoring from CHIRPS, never a forecast, and never shown as proof of crop damage.
"""
from __future__ import annotations

import pandas as pd

STAGES = ["Not planted yet", "Recently planted", "Growing", "Approaching harvest"]
PRELIM = "Preliminary suggestion (generic check, not crop-specific; confirm with an agronomist)"
NO_ALERT = "No rainfall alert for this period."
REVIEW = "Needs local agronomist review"
MIN_AREA_HA = 100
SOWING_MONTHS = {8: "Aug", 9: "Sep", 10: "Oct", 11: "Nov", 2: "Feb", 3: "Mar", 4: "Apr"}

_DRY = {
    "Not planted yet": [
        ("Check soil moisture in your field before sowing.", "Rainfall in this period is below normal for the district."),
        ("Ask your sector agronomist whether the current planting window still suits your crop.", "Planting-window advice depends on the crop and local conditions, which this tool does not know."),
        ("Check the latest Meteo Rwanda forecast before buying seed or inputs.", "This tool shows past rainfall only, not a forecast.")],
    "Recently planted": [
        ("Check whether seedlings have emerged evenly and whether the soil is dry.", "Dry soil after sowing can affect emergence."),
        ("Ask your agronomist before replanting, and only replant if emergence is poor.", "Replanting costs seed and labour; the need depends on your field.")],
    "Growing": [
        ("Walk the field and look for signs of moisture stress.", "District rainfall is an average; your field may differ."),
        ("Ask your agronomist about water-saving practices suited to your crop and soil.", "Suitable practices depend on the crop and growth stage.")],
    "Approaching harvest": [
        ("Check crop condition before harvest and plan harvest and drying around the latest forecast.", "Weather at harvest affects drying and storage.")],
}
_WET = {
    "Not planted yet": [("Check drainage and standing water before sowing.", "Rainfall in this period is above normal for the district."),
                        ("Ask your agronomist whether sowing now or later suits your crop.", "Timing depends on crop and site.")],
    "Recently planted": [("Check for waterlogging or washed-out seed.", "Heavy rain can affect young plants."),
                         ("Ask your agronomist before replanting.", "The need depends on your field.")],
    "Growing": [("Check drainage and look for signs of disease or waterlogging.", "Wet conditions can favour crop disease."),
                ("Ask your agronomist what to watch for in your crop.", "Risks depend on the crop.")],
    "Approaching harvest": [("Plan harvest and drying around the latest forecast, and check storage conditions.", "Wet weather affects drying and storage.")],
}


def checks(level: str, stage: str) -> list[dict]:
    """Ordered checks for an alert level ('watch','warning','wet','none','unknown') and a planting stage."""
    if stage not in STAGES:
        raise ValueError(f"unknown planting stage: {stage}")
    if level in ("watch", "warning"):
        base = _DRY[stage]
    elif level == "wet":
        base = _WET[stage]
    else:
        return []
    return [dict(action=a, why=w, status=PRELIM) for a, w in base]


def explain_source(row: pd.Series, last_obs: str) -> dict:
    """What the farmer sees about the indicator: source, period, freshness, limits."""
    return {
        "Indicator": "Rainfall as % of the 2016–2024 average for the same months",
        "Source": "CHIRPS v3 monthly satellite rainfall, averaged over the district",
        "Period": f"{row.window_text}" if "window_text" in row else "",
        "Latest data": last_obs,
        "Level rule": "Team-defined (not official): below 85% watch, below 60% warning, 140% or more wet watch",
        "Is it a forecast?": "No. It is past rainfall. Check Meteo Rwanda for forecasts.",
        "What it does not show": "Damage to your farm, yield loss, or the cause of any yield difference.",
    }


def crop_evidence(crops: pd.DataFrame, sowing: pd.DataFrame, district: str, season: str, planned: str | None = None) -> pd.DataFrame:
    """Crops already grown at scale in the district this season, with yield against each crop's OWN national yield."""
    c = crops[(crops.district == district) & (crops.season == season) & (~crops.is_group)].copy()
    tot = c.harvested_ha.sum()
    c["share_pct"] = 100 * c.harvested_ha / tot if tot else float("nan")
    c["enough_area"] = c.harvested_ha >= MIN_AREA_HA
    c["verdict"] = REVIEW
    c["note"] = ["Grown at scale here; yield compared with its own national average."
                 if ok else "Too little area here to judge." for ok in c.enough_area]
    if planned:
        c["planned"] = c.crop == planned
    return c.sort_values("harvested_ha", ascending=False)[
        ["crop", "harvested_ha", "share_pct", "yield_kg_ha", "yield_vs_national_pct", "enough_area", "verdict", "note"]
        + (["planned"] if planned else [])]


def usual_sowing(sowing: pd.DataFrame, district: str, season: str) -> str:
    s = sowing[(sowing.district == district) & (sowing.season == season)].sort_values("pct", ascending=False)
    if s.empty:
        return "unknown"
    top = s.head(2).sort_values("month")
    return " and ".join(SOWING_MONTHS.get(int(m), str(m)) for m in top.month) + f" ({top.pct.sum():.0f}% of sowing)"
