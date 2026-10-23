"""Validate processed data against NISR's own published totals. Run: python -m pytest tests -q"""
from pathlib import Path

import pandas as pd
import pytest

P = Path(__file__).resolve().parents[1] / "data" / "processed"
crops = pd.read_csv(P / "crop_district_season.csv")
nat = pd.read_csv(P / "national_reference.csv")
seed = pd.read_csv(P / "improved_seed_district.csv")


def test_all_districts_both_seasons():
    for s in "AB":
        assert crops[crops.season == s].district.nunique() == 30


def test_no_duplicate_keys():
    assert not crops.duplicated(["season", "district", "crop"]).any()


def test_crop_names_canonical():
    names = set(crops.crop)
    assert "vegetables" not in names and "Cooking Banana" not in names and "Other Cereals" not in names


@pytest.mark.parametrize("measure", ["cultivated_ha", "harvested_ha", "production_mt"])
def test_district_sums_match_national(measure):
    """District values must add up to NISR's national row (tolerance 0.5%)."""
    d = crops.groupby(["season", "crop"])[measure].sum().rename("sum")
    n = nat.set_index(["season", "crop"])[measure].rename("nat")
    j = pd.concat([d, n], axis=1).dropna()
    j = j[j.nat > 100]
    rel = ((j["sum"] - j.nat).abs() / j.nat)
    bad = rel[rel >= 0.005]
    log = pd.read_csv(P / "data_quality_log.csv").issue.str.cat(sep=" | ")
    # Any gap must be a documented NISR source inconsistency, not a parsing error.
    for (season, crop) in bad.index:
        assert f"{crop} {measure}" in log, f"undocumented mismatch {season} {crop} {measure}: {bad[(season, crop)]:.2%}"
    # Known NISR inconsistencies (Season A cultivated area, minor crops only). Staples must reconcile.
    allowed = {("A", "Fodder crops"), ("A", "Fruits"), ("A", "Vegetables"), ("A", "Vegetables and Fruits")}
    assert set(bad.index) <= allowed


def test_reported_yield_matches_production_over_harvested():
    c = crops.dropna(subset=["yield_kg_ha", "production_mt", "harvested_ha"])
    c = c[(c.harvested_ha > 50) & (~c.is_group)]
    recomputed = c.production_mt * 1000 / c.harvested_ha
    rel = (recomputed - c.yield_kg_ha).abs() / c.yield_kg_ha
    assert rel.median() < 0.001
    assert (rel < 0.02).mean() > 0.98


def test_known_published_values():
    def v(season, district, crop, col):
        r = crops[(crops.season == season) & (crops.district == district) & (crops.crop == crop)]
        return float(r[col].iloc[0])

    assert abs(nat[(nat.season == "A") & (nat.crop == "Bean (all)")].cultivated_ha.iloc[0] - 327906.6) < 1
    assert abs(v("A", "Burera", "Bush bean", "yield_kg_ha") - 742.2) < 0.5      # NOT 1,215 (that is Season B all-bean)
    assert abs(v("A", "Kayonza", "Bush bean", "yield_kg_ha") - 626.7) < 0.5     # NOT 503
    s = seed[(seed.season == "A") & (seed.district == "Nyagatare")].farmers_improved_pct.iloc[0]
    assert abs(s - 58.81) < 0.01


def test_season_a_plots_overall_blanked():
    a = seed[(seed.season == "A")]
    assert a.plots_improved_pct.isna().all()
    assert seed[(seed.season == "B")].plots_improved_pct.notna().all()


def test_survey_segments_table4():
    seg = pd.read_csv(P / "survey_segments.csv")
    assert len(seg) == 30 and seg.survey_segments.sum() == 1200
    assert seg.survey_segments.min() == 20 and seg.survey_segments.max() == 68
