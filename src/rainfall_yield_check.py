"""Does district rainfall (CHIRPS) line up with district yields (NISR SAS 2026)? Cross-sectional check.

Season windows (assumption, from NISR sowing-date tables A-18 / B-16): Season A = Sep-Jan rainfall, Season B = Feb-Jun rainfall.
For each season and main rainfed crop: Spearman rank correlation across districts between window rainfall (mm)
and yield-vs-national (%). Output: data/processed/rainfall_yield_link.csv and data/processed/rainfall_season_district.csv

Reading the result: ~15 correlations are tested, so about one "significant" (p<0.05) result is expected by chance.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd
from scipy.stats import spearmanr

ROOT = Path(__file__).resolve().parents[1]
P = ROOT / "data" / "processed"
WINDOWS = {"A": [(2025, 9), (2025, 10), (2025, 11), (2025, 12), (2026, 1)],
           "B": [(2026, 2), (2026, 3), (2026, 4), (2026, 5), (2026, 6)]}
CROPS = ["Maize", "Bush bean", "Climbing bean", "Irish potato", "Cassava", "Sorghum", "Sweet potato"]


def season_rain() -> pd.DataFrame:
    r = pd.read_csv(P / "rainfall_district_month.csv")
    out = []
    for s, w in WINDOWS.items():
        m = r[[(y, mo) in w for y, mo in zip(r.year, r.month)]]
        n = m.groupby("district").month.nunique()
        assert (n == len(w)).all(), f"Season {s}: missing months in rainfall data"
        out.append(m.groupby("district").rain_mm.sum().rename("season_rain_mm").reset_index().assign(season=s))
    return pd.concat(out, ignore_index=True)


def main() -> pd.DataFrame:
    sr = season_rain()
    sr.to_csv(P / "rainfall_season_district.csv", index=False)
    ci = pd.read_csv(P / "indicators_crop.csv")
    di = pd.read_csv(P / "indicators_district.csv")
    rows = []
    for s in WINDOWS:
        rain = sr[sr.season == s].set_index("district").season_rain_mm
        for crop in CROPS:
            q = ci[(ci.season == s) & (ci.crop == crop)].dropna(subset=["yield_vs_national_pct"]).set_index("district")
            if len(q) >= 15:
                rho, p = spearmanr(rain.reindex(q.index), q.yield_vs_national_pct)
                rows.append(dict(season=s, measure=crop, n_districts=len(q), spearman_rho=rho, p_value=p))
        q = di[di.season == s].set_index("district")
        rho, p = spearmanr(rain.reindex(q.index), q.yield_shortfall_idx)
        rows.append(dict(season=s, measure="All crops: yield shortfall index", n_districts=len(q), spearman_rho=rho, p_value=p))
    out = pd.DataFrame(rows).round(3)
    out.to_csv(P / "rainfall_yield_link.csv", index=False)
    return out


if __name__ == "__main__":
    o = main()
    print(o.to_string(index=False))
    print(f"\n{len(o)} tests; {(o.p_value < 0.05).sum()} with p<0.05 (about {0.05 * len(o):.1f} expected by chance)")
