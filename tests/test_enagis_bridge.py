import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import enagis_bridge as eb  # noqa: E402

P = ROOT / "data" / "processed"
dist, chain, prod = eb.load()
crops = pd.read_csv(P / "crop_district_season.csv")
musa = set(pd.read_csv(P / "indicators_district.csv").district)


def test_districts_match_musaruro_exactly():
    assert set(dist.district) == musa == set(chain.district) == set(prod.district)
    assert len(dist) == 30 and len(chain) == 120 and set(chain.chain) == set(eb.CHAINS)


def test_export_matches_enagis_source_numbers():
    c = chain.set_index(["district", "chain"])
    assert c.loc[("Nyabihu", "Potato cold storage"), "robust"] == 8
    assert round(c.loc[("Nyabihu", "Potato cold storage"), "top_kwh_day"]) == 292
    assert c.loc[("Nyabihu", "Potato cold storage"), "site_1"].startswith("Kora Market")
    assert dist.set_index("district").loc["Nyabihu", "documented_sites"] == 6


def test_production_years_kept_separate_and_missing_not_zero():
    p = eb.production_2026(crops, prod)
    assert len(p) == 30
    assert {"potato_t_2026", "potato_t_2024", "maize_t_2026", "maize_t_2024"} <= set(p.columns)
    assert (p.dropna(subset=["maize_t_2026"]).maize_t_2026 > 0).all()
    # a district missing a season gives NaN, not a sum with zero
    fake = crops[~((crops.district == "Huye") & (crops.season == "B") & (crops.crop == "Maize"))]
    assert eb.production_2026(fake, prod).set_index("district").loc["Huye", "maize_t_2026"] != eb.production_2026(fake, prod).set_index("district").loc["Huye", "maize_t_2026"]


def test_overview_and_brief_have_labels_limits_and_no_composite_score():
    ov = eb.overview("Musanze", chain, dist)
    md = eb.to_markdown("Musanze", ov, {"Priority": "x"}, "Watch", eb.production_2026(crops, prod).set_index("district").loc["Musanze"])
    assert "[ESTIMATED]" in md and "[OBSERVED]" in md and "Limits" in md and "Field verification count: 0" in md
    assert "combined score" in md and "priority score of" not in md.lower()
    assert "SAS 2026" in md and "SAS 2024" in md
    assert "not evidence of poor infrastructure" in md
