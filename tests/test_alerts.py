import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import alerts  # noqa: E402

P = ROOT / "data" / "processed"
sow = pd.read_csv(P / "sowing_month_district.csv")
rain = pd.read_csv(P / "rainfall_district_month.csv")


def test_sowing_table_complete_and_plausible():
    assert sow.district.nunique() == 30 and set(sow.season) == {"A", "B"}
    assert sow.groupby(["season", "district"]).pct.sum().between(30, 100.5).all()


def test_level_thresholds():
    assert [alerts.level(x) for x in (50, 59.9, 60, 84.9, 85, 100, 140)] == \
        ["warning", "warning", "watch", "watch", "none", "none", "wet"]
    assert alerts.level(float("nan")) == "unknown"


def test_sowing_window_is_inside_season_and_two_months():
    for s in "AB":
        for d in sow.district.unique():
            w = alerts.sowing_window(sow, s, d)
            assert 1 <= len(w) <= 2 and set(w) <= {9, 10, 11} | {2, 3, 4}


def test_build_complete_season_matches_season_anomaly():
    import rainfall_watch as rw
    a = alerts.build(rain, sow, "B", 2026, "season").set_index("district")
    b = rw.season_anomaly(rain, "B", 2026).set_index("district")
    assert (a.pct_of_normal - b.pct_of_normal).abs().max() < 1e-6
    assert a.k_dry.between(0, 9).all()


def test_season_to_date_for_next_season_uses_available_months_only():
    a = alerts.build(rain, sow, "A", 2027, "season")
    assert (a.months_used == 1).all() and a.pct_of_normal.between(30, 300).all()


def test_sms_short_and_silent_when_normal():
    a = alerts.build(rain, sow, "B", 2026, "season")
    alert = a[a.level.isin(["watch", "warning"])].iloc[0]
    m = alerts.sms(alert)
    assert m and len(m) <= 160 and alert.district in m
    assert alerts.sms(alert, "rw") is None
    assert alerts.sms(pd.Series(dict(level="none", district="X", window_months=[2], pct_of_normal=100))) is None
