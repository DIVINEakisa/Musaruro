"""Sanity checks for derived indicators. Run: python -m pytest tests -q"""
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import indicators as ind  # noqa: E402

ci = ind.crop_indicators()
di = ind.add_priority(ind.district_indicators(ci))


def test_small_plots_not_scored():
    small = ci[ci.harvested_ha < ind.MIN_HARVESTED_HA]
    assert small.yield_vs_national_pct.isna().all()


def test_no_double_counting_beans():
    assert "Bean (all)" not in set(ci.crop)          # bush + climbing already included
    assert not set(ci.crop) & {"Cereals", "Tubers and Roots", "Legumes and Pulses"}   # no group totals


def test_shortfall_nonnegative_and_consistent():
    s = ci.dropna(subset=["shortfall_t"])
    assert (s.shortfall_t >= 0).all()
    below = s[s.yield_vs_national_pct < 0]
    expected = (-below.yield_vs_national_pct / 100) * below.national_yield_kg_ha * below.harvested_ha / 1000
    assert np.allclose(below.shortfall_t, expected, rtol=1e-6)


def test_priority_range_and_weights():
    assert di.priority_score.between(0, 100).all()
    seed_only = ind.add_priority(di, w_yield=0, w_seed=1)
    assert np.allclose(seed_only.priority_score, 100 * seed_only.seed_gap_idx_rank)
    assert di.groupby("season").district.nunique().eq(30).all()
