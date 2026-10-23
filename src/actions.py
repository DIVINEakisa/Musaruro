"""Action brief: turns the indicators into concrete, checkable next steps for one district and season.

Every finding is computed from NISR / CHIRPS data. Every "consider" is an option to verify with local agronomists
and extension staff; none of them is claimed to cause the gap (see README, "What Musaruro does not claim").
"""
from __future__ import annotations

import pandas as pd

SHARE_FLAG = 0.8          # flag a practice if the district share is < 80% of the national share
MIN_PEER_HA = 500         # a peer district must harvest at least this much of the crop
SMALL_SAMPLE = 30         # survey segments below this -> verify before acting
SEED_CROPS_LOW = 2.0      # national improved-seed use (%) below which seed is not the lever for a crop
DRY_STATUS = {"Very dry", "Drier than normal"}


def practice_shares(crop_ds: pd.DataFrame, prac: pd.DataFrame) -> pd.DataFrame:
    """Share (% of developed cropland) under irrigation, inorganic and organic fertilizer, per district-season.
    Erosion control is left out: its ratio exceeds 100% for some districts, so the denominator does not match."""
    land = crop_ds[crop_ds.crop.str.startswith("All crops")][["season", "district", "cultivated_ha"]]
    m = prac.merge(land, on=["season", "district"], how="left")
    nat_land = crop_ds[crop_ds.crop.str.startswith("All crops")].groupby("season").cultivated_ha.sum()
    m.loc[m.district == "National", "cultivated_ha"] = m.loc[m.district == "National", "season"].map(nat_land)
    for k in ("irrigated", "inorganic_fert", "organic_fert"):
        m[k + "_pct"] = 100 * m[k + "_ha"] / m.cultivated_ha
    return m[["season", "district", "irrigated_pct", "inorganic_fert_pct", "organic_fert_pct"]]


def peers(crops: pd.DataFrame, season: str, crop: str, district: str, n: int = 3) -> pd.DataFrame:
    """Best-yielding districts for the crop (excluding this one) with enough area to be credible."""
    c = crops[(crops.season == season) & (crops.crop == crop) & (crops.district != district)
              & (crops.harvested_ha >= MIN_PEER_HA) & crops.yield_kg_ha.notna()]
    return c.sort_values("yield_kg_ha", ascending=False).head(n)[["district", "yield_kg_ha", "harvested_ha"]]


def brief(district: str, season: str, crops: pd.DataFrame, shares: pd.DataFrame, seed_nat_pct: dict,
          rain_status: str | None, rain_pct: float | None, segments: int, farmers_improved_pct: float | None) -> list[dict]:
    """Ordered list of {topic, finding, consider}."""
    out: list[dict] = []
    cd = crops[(crops.district == district) & (crops.season == season) & (crops.shortfall_t > 0)] \
        .sort_values("shortfall_t", ascending=False).head(3)

    for _, r in cd.iterrows():
        pe = peers(crops, season, r.crop, district)
        pe_txt = ", ".join(f"{p.district} ({p.yield_kg_ha:,.0f} kg/ha)" for p in pe.itertuples()) or "no peer with enough area"
        out.append(dict(
            topic=f"Yield gap: {r.crop}",
            finding=f"{r.crop} yields {r.yield_kg_ha:,.0f} kg/ha, {abs(r.yield_vs_national_pct):.0f}% below the national "
                    f"{r.national_yield_kg_ha:,.0f}. Reaching the national average is worth about {r.shortfall_t:,.0f} t.",
            consider=f"Visit or interview extension staff and cooperatives in the best-yielding districts: {pe_txt}. "
                     f"Ask what differs in variety, planting date, spacing, fertilizer and pest control, then test one or two "
                     f"changes on demonstration plots in {district}."))

    p = shares[(shares.district == district) & (shares.season == season)]
    n = shares[(shares.district == "National") & (shares.season == season)]
    if len(p) and len(n):
        p, n = p.iloc[0], n.iloc[0]
        for k, label, act in (
                ("inorganic_fert_pct", "inorganic fertilizer",
                 "Check whether supply, price or credit limits fertilizer use, and whether soil tests support more."),
                ("irrigated_pct", "irrigation",
                 "Check where small-scale irrigation or water harvesting could be added, starting with marshland and valley-bottom sites."),
                ("organic_fert_pct", "organic fertilizer",
                 "Check access to manure and compost (livestock numbers, composting training).")):
            if pd.notna(p[k]) and pd.notna(n[k]) and n[k] > 0 and p[k] < SHARE_FLAG * n[k]:
                out.append(dict(topic=f"Practice: {label}",
                                finding=f"About {p[k]:.1f}% of developed land uses {label}, against {n[k]:.1f}% nationally.",
                                consider=act))

    if farmers_improved_pct is not None and farmers_improved_pct < 30:
        low = [c for c in cd.crop if seed_nat_pct.get(c, 100) < SEED_CROPS_LOW]
        txt = (f"Only {farmers_improved_pct:.0f}% of farmers use improved seed (all crops combined). ")
        if low:
            txt += (f"For {', '.join(low)}, improved-seed use is below {SEED_CROPS_LOW:.0f}% nationally, so seed is not "
                    "what separates districts for those crops.")
        out.append(dict(topic="Improved seed", finding=txt,
                        consider="Focus seed promotion on crops where improved varieties are actually in use (for example maize "
                                 "and vegetables), and check seed-dealer reach and price. Do not expect it to close the gap for beans."))

    if rain_status in DRY_STATUS:
        out.append(dict(topic="Rainfall",
                        finding=f"Rainfall this season was {rain_status.lower()} ({rain_pct:.0f}% of the 2016–2024 normal).",
                        consider="Warn cooperatives early next season, promote water-saving practices such as mulching and "
                                 "terraces, and check crop-loss reports before attributing any yield drop to rainfall."))
    elif rain_status:
        out.append(dict(topic="Rainfall", finding=f"Rainfall this season was {rain_status.lower()} ({rain_pct:.0f}% of normal).",
                        consider="Rainfall is unlikely to explain this district's gap this season; look at practices and inputs first."))

    if segments < SMALL_SAMPLE:
        out.append(dict(topic="Data reliability",
                        finding=f"Only {segments} survey segments were sampled here, so district estimates are noisy.",
                        consider="Confirm the main gaps with local data (cooperative records, sector agronomists) before committing resources."))
    return out


def to_markdown(district: str, season: str, items: list[dict]) -> str:
    lines = [f"# Musaruro action brief: {district}, Season {season} 2026", "",
             "Findings come from NISR SAS 2026 and CHIRPS. 'Consider' items are options to verify locally, not proven causes.", ""]
    for i, it in enumerate(items, 1):
        lines += [f"## {i}. {it['topic']}", f"**Finding:** {it['finding']}", "", f"**Consider:** {it['consider']}", ""]
    return "\n".join(lines)
