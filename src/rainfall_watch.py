"""Rainfall watch: district rainfall compared with a baseline "normal" (pure pandas).

Input : data/processed/rainfall_district_month.csv  (district, year, month, rain_mm)
Method: normal = mean of the same calendar month over the baseline years; a month is
        compared with it as % of normal and as a rank among the baseline years.
        Monthly totals cannot show dry spells inside a month. Not a forecast, not a yield claim.
"""
from __future__ import annotations

import pandas as pd

BASELINE_YEARS = tuple(range(2016, 2025))   # 2016-2024, excludes the monitored period
MIN_BASELINE_YEARS = 5
# Season windows: (calendar months, whether the Sep-Dec part belongs to the previous year)
WINDOWS = {"A": (9, 10, 11, 12, 1), "B": (2, 3, 4, 5, 6)}
# (upper bound of % of normal, label, icon)
STATUS = [(60, "Very dry", "▼▼"), (85, "Drier than normal", "▼"), (115, "Near normal", "●"),
          (140, "Wetter than normal", "▲"), (float("inf"), "Much wetter than normal", "▲▲")]


def classify(pct: float) -> tuple[str, str]:
    if pd.isna(pct):
        return "No baseline", "–"
    for ub, label, icon in STATUS:
        if pct < ub:
            return label, icon
    return STATUS[-1][1:]


def season_year_months(season: str, year: int) -> list[tuple[int, int]]:
    """(year, month) pairs of Season A or B of `year` (A = Sep of year-1 .. Jan of year)."""
    return [(year - 1 if m >= 9 else year, m) for m in WINDOWS[season]]


def baseline_normals(rain: pd.DataFrame, years=BASELINE_YEARS) -> pd.DataFrame:
    """Per district and month: normal_mm, n_years, and the sorted baseline values for ranking."""
    b = rain[rain.year.isin(years)]
    g = b.groupby(["district", "month"]).rain_mm
    out = g.agg(normal_mm="mean", n_years="count").reset_index()
    return out


def monthly_anomaly(rain: pd.DataFrame, years=BASELINE_YEARS, min_years=MIN_BASELINE_YEARS) -> pd.DataFrame:
    """Every district-month outside the baseline, with % of normal and rank among baseline years."""
    norm = baseline_normals(rain, years)
    norm.loc[norm.n_years < min_years, "normal_mm"] = float("nan")
    cur = rain[~rain.year.isin(years)].merge(norm, on=["district", "month"], how="left")
    cur["pct_of_normal"] = 100 * cur.rain_mm / cur.normal_mm
    base = rain[rain.year.isin(years)]
    ref = {k: v.rain_mm.to_numpy() for k, v in base.groupby(["district", "month"])}
    cur["wetter_than_years"] = [
        float("nan") if pd.isna(n) else int((ref[(d, m)] < v).sum())
        for d, m, v, n in zip(cur.district, cur.month, cur.rain_mm, cur.normal_mm)]
    lab = cur.pct_of_normal.map(classify)
    cur["status"] = [x[0] for x in lab]
    cur["icon"] = [x[1] for x in lab]
    return cur.sort_values(["district", "year", "month"]).reset_index(drop=True)


def season_anomaly(rain: pd.DataFrame, season: str, year: int, years=BASELINE_YEARS,
                   min_years=MIN_BASELINE_YEARS) -> pd.DataFrame:
    """Season total vs the same window summed over baseline years. Needs every month of the window."""
    pairs = season_year_months(season, year)
    have = rain.set_index(["year", "month"]).index
    months_have = sum(p in have for p in pairs)
    rows = []
    for d, g in rain.groupby("district"):
        s = g.set_index(["year", "month"]).rain_mm
        tot = sum(s.get(p, float("nan")) for p in pairs)
        base = []
        for by in years:
            bp = season_year_months(season, by)
            if all(p in s.index for p in bp):
                base.append(sum(s[p] for p in bp))
        normal = sum(base) / len(base) if len(base) >= min_years else float("nan")
        pct = 100 * tot / normal if normal == normal else float("nan")
        lab = classify(pct)
        rows.append(dict(district=d, season=season, year=year, months_available=months_have,
                         months_in_window=len(pairs), rain_mm=tot, normal_mm=normal,
                         pct_of_normal=pct, baseline_years=len(base), status=lab[0], icon=lab[1]))
    return pd.DataFrame(rows)


def baseline_ready(rain: pd.DataFrame, years=BASELINE_YEARS, min_years=MIN_BASELINE_YEARS) -> bool:
    return rain[rain.year.isin(years)].year.nunique() >= min_years


def window_anomaly(rain: pd.DataFrame, pairs: list[tuple[int, int]], baseline_months: list[int],
                   years=BASELINE_YEARS, min_years=MIN_BASELINE_YEARS) -> pd.DataFrame:
    """Rain over specific (year, month) pairs vs the mean of the same calendar months over baseline years.
    Also returns k_dry: in how many baseline years the same window was as dry or drier (calibration).
    `pairs` and `baseline_months` must list the same months; only months with data are used."""
    idx = rain.set_index(["district", "year", "month"]).rain_mm
    rows = []
    for d in rain.district.unique():
        have = [(y, m) for y, m in pairs if (d, y, m) in idx.index]
        if not have:
            continue
        cur = sum(idx[(d, y, m)] for y, m in have)
        months = [m for _, m in have]
        base = []
        for by in years:
            vals = [idx.get((d, by if m < 9 or not any(mm < 9 for mm in months) else by - 1, m)) for m in months]
            # months >= 9 in a window that also holds months < 9 belong to the previous calendar year
            if all(v is not None and v == v for v in vals):
                base.append(sum(vals))
        if len(base) < min_years:
            rows.append(dict(district=d, months_used=len(have), rain_mm=cur, normal_mm=float("nan"), pct_of_normal=float("nan"),
                             baseline_years=len(base), k_dry=float("nan")))
            continue
        normal = sum(base) / len(base)
        rows.append(dict(district=d, months_used=len(have), rain_mm=cur, normal_mm=normal, pct_of_normal=100 * cur / normal,
                         baseline_years=len(base), k_dry=sum(b <= cur for b in base)))
    return pd.DataFrame(rows)
