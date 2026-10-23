"""Checks for the CHIRPS district aggregation. Run: python -m pytest tests -q"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import climate  # noqa: E402

rain = pd.read_csv(ROOT / "data" / "processed" / "rainfall_district_month.csv")
dist = pd.read_csv(ROOT / "data" / "processed" / "crop_district_season.csv").district.unique()


def test_boundary_names_match_survey_districts():
    assert {n for n, _ in climate.load_boundaries()} == set(dist)


def test_every_district_every_month():
    per = rain.groupby(["year", "month"]).district.nunique()
    assert (per == 30).all()
    assert rain.rain_mm.notna().all() and rain.rain_mm.between(0, 600).all()


def test_zonal_mean_inside_raster_range():
    f = next((ROOT / "data" / "raw" / "chirps").glob("chirps-v3.0.*.tif"))
    arr, tr = climate.read_rwanda(f)
    z = climate.zonal_mean(arr, tr, climate.load_boundaries())
    assert all(np.nanmin(arr) <= v <= np.nanmax(arr) for v in z.values())


def test_dry_east_wetter_west_in_june():
    j = rain[(rain.year == 2026) & (rain.month == 6)].set_index("district").rain_mm
    assert j[["Kirehe", "Kayonza", "Nyagatare"]].mean() < j[["Rusizi", "Nyamasheke", "Rubavu"]].mean()


def test_season_windows_complete_and_plausible():
    sr = pd.read_csv(ROOT / "data" / "processed" / "rainfall_season_district.csv")
    assert set(sr.season) == {"A", "B"} and sr.groupby("season").district.nunique().eq(30).all()
    assert sr.season_rain_mm.between(200, 1500).all()
