import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import actions  # noqa: E402

P = ROOT / "data" / "processed"
ci = pd.read_csv(P / "indicators_crop.csv")
cds = pd.read_csv(P / "crop_district_season.csv")
prac = pd.read_csv(P / "practices_district.csv")


def test_practice_shares_sane():
    s = actions.practice_shares(cds, prac)
    assert s.district.eq("National").sum() == 2
    for k in ("irrigated_pct", "inorganic_fert_pct", "organic_fert_pct"):
        assert s[k].dropna().between(0, 100).all()


def test_peers_are_better_and_exclude_self():
    pe = actions.peers(ci, "A", "Maize", "Bugesera")
    assert len(pe) == 3 and "Bugesera" not in set(pe.district)
    assert pe.yield_kg_ha.is_monotonic_decreasing and (pe.harvested_ha >= actions.MIN_PEER_HA).all()


def test_brief_has_gap_items_and_markdown():
    s = actions.practice_shares(cds, prac)
    items = actions.brief("Bugesera", "A", ci, s, {"Bush bean": 0.5}, "Drier than normal", 80.0, 20, 43.0)
    topics = [i["topic"] for i in items]
    assert any(t.startswith("Yield gap") for t in topics) and "Rainfall" in topics and "Data reliability" in topics
    assert "Bugesera" in actions.to_markdown("Bugesera", "A", items)
