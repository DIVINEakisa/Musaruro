"""Rainfall watch logic on synthetic data. Run: python -m pytest tests -q"""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import rainfall_watch as rw  # noqa: E402


def synth(cur_factor=0.5):
    rows = []
    for y in range(2016, 2027):
        for m in range(1, 13):
            f = cur_factor if y >= 2025 else 1.0
            rows.append(dict(district="X", year=y, month=m, rain_mm=100 * f))
    return pd.DataFrame(rows)


def test_classify_edges():
    assert rw.classify(59.9)[0] == "Very dry" and rw.classify(60)[0] == "Drier than normal"
    assert rw.classify(100)[0] == "Near normal" and rw.classify(150)[0] == "Much wetter than normal"
    assert rw.classify(float("nan"))[0] == "No baseline"


def test_monthly_anomaly_halved_rain():
    a = rw.monthly_anomaly(synth(0.5))
    assert set(a.year) == {2025, 2026}
    assert (a.pct_of_normal.round(6) == 50).all() and (a.status == "Very dry").all()
    assert (a.wetter_than_years == 0).all()


def test_baseline_excluded_from_current_and_min_years():
    r = synth(1.0)
    assert not rw.monthly_anomaly(r).year.isin(rw.BASELINE_YEARS).any()
    few = r[(r.year >= 2022)]
    assert rw.monthly_anomaly(few).pct_of_normal.isna().all()
    assert not rw.baseline_ready(few) and rw.baseline_ready(r)


def test_season_windows_and_season_anomaly():
    assert rw.season_year_months("A", 2026) == [(2025, 9), (2025, 10), (2025, 11), (2025, 12), (2026, 1)]
    assert rw.season_year_months("B", 2026)[0] == (2026, 2)
    s = rw.season_anomaly(synth(0.8), "A", 2026).iloc[0]
    assert s.rain_mm == 400 and s.normal_mm == 500 and round(s.pct_of_normal) == 80
    assert s.status == "Drier than normal" and s.months_available == 5


def test_incomplete_season_reports_months():
    r = synth(1.0)
    r = r[~((r.year == 2026) & (r.month > 7))]
    assert rw.season_anomaly(r, "B", 2026).iloc[0].months_available == 5
