import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT))
import actions  # noqa: E402
import crop_view as cv  # noqa: E402
import irrigation as irg  # noqa: E402

P = ROOT / "data" / "processed"


def test_irrigation_table_complete_and_in_range():
    i = pd.read_csv(P / "irrigation_district.csv")
    assert len(i) == 60 and i.district.nunique() == 30
    assert i.farmers_irrigating_pct.between(0, 100).all()
    t = i[[c for c in i if c.startswith("tech_")]].sum(axis=1)
    assert t.between(99, 101).mean() > 0.95


def test_misspelled_district_in_source_is_matched():
    from src import build_water as bw
    assert bw.match_district("Nyarugenege") == "Nyarugenge"


def test_screen_needs_both_conditions():
    irr = pd.read_csv(P / "irrigation_district.csv")
    sh = actions.practice_shares(pd.read_csv(P / "crop_district_season.csv"), pd.read_csv(P / "practices_district.csv"))
    ex = pd.concat([irg.dry_exposure(pd.read_csv(P / "rainfall_district_month.csv"), s) for s in "AB"])
    for s in "AB":
        t = irg.screen(irr, sh, ex, s)
        assert len(t) == 30
        flagged = t[t.check_first]
        assert (flagged.farmers_irrigating_pct < irg.LOW_USE_PCT).all() and (flagged.dry_seasons >= irg.DRY_YEARS_FLAG).all()
        rest = t[~t.check_first]
        assert not (rest.low_use & rest.often_dry).any()


def test_pump_sketch_matches_hand_calculation():
    r = irg.pump_sketch(1, 5, 20, 0.5, 4.5, pr=0.75)
    assert abs(r["m3_day"] - 50) < 1e-9
    assert abs(r["kwh_day"] - 50 * 1000 * 9.81 * 20 / 3.6e6 / 0.5) < 1e-9
    assert abs(r["kwp"] - r["kwh_day"] / (4.5 * 0.75)) < 1e-9


def test_crop_table_shares_add_up():
    c = pd.read_csv(P / "crop_district_season.csv")
    n = pd.read_csv(P / "national_reference.csv")
    t = cv.national_table(c, "A", "Bush bean", n)
    assert abs(t.area_share_pct.sum() - 100) < 1e-6
    assert t.harvested_ha.is_monotonic_decreasing
    assert 0 < cv.concentration(t) <= 100
    assert t.yield_vs_national_pct.notna().any()
