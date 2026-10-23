"""Smart rainfall alerts tied to each district's own sowing window (NISR sowing-date tables + CHIRPS).

Level rules (team-set, to be reviewed with agronomists; not official thresholds):
  % of normal >= 85 -> none | 60-85 -> watch | < 60 -> warning | >= 140 -> wet watch
Each alert reports how often the same window was this dry in the 2016-2024 baseline (k of N years), so the reader sees
whether it is rare or common. Rainfall is monitored, not forecast, and is not shown as a cause of yield loss.
"""
from __future__ import annotations

import pandas as pd

import rainfall_watch as rw

LEVELS = {"none": ("Normal", "●"), "watch": ("Watch", "▼"), "warning": ("Warning", "▼▼"), "wet": ("Wet watch", "▲")}
SAFE_STEPS = ("Check your fields before deciding anything. Ask your sector agronomist or extension officer what suits your "
              "crop and its growth stage, and check the latest Meteo Rwanda forecast.")


def level(pct: float) -> str:
    if pd.isna(pct):
        return "unknown"
    return "warning" if pct < 60 else "watch" if pct < 85 else "wet" if pct >= 140 else "none"


def sowing_window(sowing: pd.DataFrame, season: str, district: str) -> list[int]:
    """Peak sowing month and the month after it (establishment window), inside the season window."""
    s = sowing[(sowing.season == season) & (sowing.district == district)].sort_values("month")
    peak = int(s.loc[s.pct.idxmax(), "month"])
    allowed = [m for m in rw.WINDOWS[season] if m in set(s.month)]
    nxt = peak + 1 if peak + 1 in allowed else peak
    return sorted({peak, nxt})


def build(rain: pd.DataFrame, sowing: pd.DataFrame, season: str, year: int, mode: str = "season") -> pd.DataFrame:
    """mode 'season' = months of the season observed so far; 'sowing' = the district's own sowing/establishment window."""
    pairs_all = rw.season_year_months(season, year)
    rows = []
    for d in sorted(rain.district.unique()):
        months = rw.WINDOWS[season] if mode == "season" else sowing_window(sowing, season, d)
        pairs = [pm for pm in pairs_all if pm[1] in months]
        w = rw.window_anomaly(rain[rain.district == d], pairs, months)
        if w.empty:
            continue
        r = w.iloc[0].to_dict()
        r.update(season=season, year=year, mode=mode, window_months=months,
                 months_total=len(pairs), level=level(r["pct_of_normal"]))
        rows.append(r)
    out = pd.DataFrame(rows)
    out["label"] = out.level.map(lambda k: LEVELS.get(k, ("No baseline", "–"))[0])
    out["icon"] = out.level.map(lambda k: LEVELS.get(k, ("No baseline", "–"))[1])
    return out


MONTH = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def window_text(months: list[int]) -> str:
    return f"{MONTH[months[0]]}–{MONTH[months[-1]]}" if len(months) > 1 else MONTH[months[0]]


def explain(r: pd.Series) -> str:
    if r.level in ("unknown",):
        return "Not enough baseline data to compare."
    diff = r.pct_of_normal - 100
    k, n = int(r.k_dry), int(r.baseline_years)
    base = ((f" None of the {n} baseline years was this dry for the same window." if k == 0 else
             f" In {k} of the {n} baseline years the same window was this dry or drier.")
            if r.level in ("watch", "warning") else "")
    return (f"Rain in {r.district} over {window_text(r.window_months)} was {r.rain_mm:,.0f} mm, {abs(diff):.0f}% "
            f"{'below' if diff < 0 else 'above'} the 2016–2024 average of {r.normal_mm:,.0f} mm.{base}")


def sms(r: pd.Series, lang: str = "en", templates: dict | None = None) -> str | None:
    """Short text (<= 160 characters when possible). Kinyarwanda templates must come from the team (native speaker)."""
    t = (templates or TEMPLATES).get(lang)
    if not t or r.level in ("none", "unknown"):
        return None
    return t[r.level].format(d=r.district, w=window_text(r.window_months), p=round(r.pct_of_normal))


TEMPLATES = {
    "en": {
        "watch": "Musaruro: {d} rain {w} is {p}% of normal (below). Check fields; ask your agronomist. Satellite data, not a forecast.",
        "warning": "Musaruro: {d} rain {w} is only {p}% of normal. Check fields now; ask your agronomist. Satellite data, not a forecast.",
        "wet": "Musaruro: {d} rain {w} is {p}% of normal (above). Check drainage and fields; ask your agronomist.",
    },
    "rw": None,   # TODO(team): add Kinyarwanda messages, reviewed by a native speaker
}
