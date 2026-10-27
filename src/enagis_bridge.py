"""Bridge between Musaruro and EnaGIS: puts both sets of district evidence side by side. It never recomputes either.

Rules (tested): no combined score; every EnaGIS item keeps an evidence label; production figures from different survey years are
shown separately and never merged; missing values stay missing.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "data" / "processed"

# Evidence labels follow EnaGIS's own ledger (docs/evidence-ledger.md in the EnaGIS repository).
LABEL = {
    "population": "OBSERVED", "buildings": "OBSERVED", "documented_sites": "OBSERVED", "settlement_points": "OBSERVED",
    "ranking": "ESTIMATED", "robust": "ESTIMATED", "top_kwh_day": "ESTIMATED", "production_2024": "ESTIMATED",
    "siting_candidates": "PREDICTED", "field_verification": "UNKNOWN",
}
LIMITS = [
    "EnaGIS results are a screening shortlist to check by phone or site visit, not confirmed facilities or investments. Field verification count: 0.",
    "kWh/day is an estimate from stated assumptions, not measured consumption.",
    "EnaGIS production inputs come from NISR SAS 2024 Season A shares scaled to 2024 national totals (ESTIMATED); Bugesera, Kirehe and Ngoma are imputed. Musaruro uses SAS 2026. The two are shown separately.",
    "Low yields are not evidence of poor infrastructure, and rainfall anomalies are not evidence of road conditions. The two sides are shown together to decide where to investigate, not to explain each other.",
]
CHAINS = ["Potato cold storage", "Milk cooling", "Maize milling", "Maize drying"]


def load() -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    d = pd.read_csv(P / "enagis_district.csv")
    c = pd.read_csv(P / "enagis_district_chain.csv")
    prod = pd.read_csv(ROOT / "data" / "enagis" / "district_production_2024.csv")
    return d, c, prod


def production_2026(crops: pd.DataFrame, prod24: pd.DataFrame) -> pd.DataFrame:
    """Musaruro's SAS 2026 production (Seasons A + B) for Irish potato and maize, per district, next to EnaGIS's 2024-based estimate.
    kg per person uses the 2022 census population in EnaGIS's file. If a season is missing for a district, the sum is NaN (never 0)."""
    rows = []
    for district, g in crops.groupby("district"):
        row = {"district": district}
        for crop, key in (("Irish potato", "potato"), ("Maize", "maize")):
            c = g[g.crop == crop].set_index("season").production_mt
            row[f"{key}_t_2026"] = c.get("A") + c.get("B") if ("A" in c.index and "B" in c.index and c.notna().all()) else float("nan")
        rows.append(row)
    out = pd.DataFrame(rows).merge(prod24[["district", "population_2022", "potato_t_2024", "maize_t_2024", "yields_imputed"]],
                                   on="district", how="left")
    for key in ("potato", "maize"):
        out[f"{key}_kg_person_2026"] = 1000 * out[f"{key}_t_2026"] / out.population_2022
        out[f"{key}_kg_person_2024"] = 1000 * out[f"{key}_t_2024"] / out.population_2022
    return out


def overview(district: str, chain: pd.DataFrame, dist: pd.DataFrame) -> dict:
    d = dist[dist.district == district]
    c = chain[chain.district == district].set_index("chain")
    if d.empty or c.empty:
        raise KeyError(district)
    return {"district": d.iloc[0].to_dict(), "chains": c.reset_index().to_dict("records")}


def to_markdown(district: str, ov: dict, musaruro: dict, climate: str | None, prod: pd.Series | None) -> str:
    """Action brief covering both systems, with evidence labels and limits."""
    d = ov["district"]
    L = [f"# Musaruro + EnaGIS district brief: {district}", "",
         "Agricultural evidence (Musaruro, NISR SAS 2026 and CHIRPS) and infrastructure evidence (EnaGIS) side by side. "
         "No combined score is computed.", "", "## Agriculture (Musaruro)", ""]
    for k, v in musaruro.items():
        L.append(f"- **{k}:** {v}")
    if climate:
        L.append(f"- **Rainfall monitoring:** {climate}")
    if prod is not None:
        L += ["", "Production, shown separately by survey year:", "",
              f"- SAS 2026 (Musaruro), Seasons A+B: potato {prod.potato_t_2026:,.0f} t, maize {prod.maize_t_2026:,.0f} t",
              f"- SAS 2024 estimate (EnaGIS input, ESTIMATED): potato {prod.potato_t_2024:,.0f} t, maize {prod.maize_t_2024:,.0f} t"]
    L += ["", "## Infrastructure screening (EnaGIS)", "",
          f"- Population (WorldPop 2020) {d['population']:,} [{LABEL['population']}]; buildings {d['buildings']:,} [{LABEL['buildings']}]; "
          f"documented facilities {d['documented_sites']} [{LABEL['documented_sites']}]; town and village points {d['settlement_points']}", "",
          "| Value chain | Ranked | Robust | Top site kWh/day [ESTIMATED] | First site to check | Data coverage |", "| --- | ---: | ---: | ---: | --- | --- |"]
    for r in ov["chains"]:
        L.append(f"| {r['chain']} | {r['ranked']} | {r['robust']} | {r['top_kwh_day']:.0f} | {r['site_1']} | {r['coverage']} |")
    L += ["", "## What to do next", "",
          "1. Phone or visit the first-listed sites to confirm they exist and what they handle.",
          "2. Ask the sector agronomist about the main yield gaps listed above.",
          "3. Check the rainfall status and local forecast before field planning.", "", "## Limits", ""]
    L += [f"- {x}" for x in LIMITS]
    L += ["", "Sources: NISR SAS 2026 and 2024, CHIRPS v3, EnaGIS (Team Dynamis), © OpenStreetMap contributors, Overture Maps, WorldPop, Open-Meteo."]
    return "\n".join(L)
