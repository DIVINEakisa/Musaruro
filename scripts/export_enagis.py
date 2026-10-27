"""Flatten EnaGIS district results into two CSVs for the app. Read-only on EnaGIS data; nothing is recomputed.

Run: python scripts/export_enagis.py   (reads data/enagis/district_summaries.json)
"""
import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "enagis" / "district_summaries.json"
OUT = ROOT / "data" / "processed"
CHAINS = {"potato_storage": "Potato cold storage", "milk_cooling": "Milk cooling",
          "maize_milling": "Maize milling", "maize_drying": "Maize drying"}


def main() -> None:
    d = json.load(open(SRC))
    dist, chain = [], []
    for name, v in d.items():
        dist.append(dict(district=name, population=v["population"], buildings=v["buildings"], area_km2=v["area_km2"],
                         documented_sites=v["documented_sites"], settlement_points=v["settlement_points"],
                         gather_failed=bool(v["gather_failed"]), engine=v["engine"]))
        for key, label in CHAINS.items():
            m = v["models"][key]
            s = m.get("siting", {})
            top = (m.get("top3") or []) + [None, None, None]
            chain.append(dict(district=name, chain=label, eligible=m["eligible"], documented=m["documented"], ranked=m["ranked"],
                              robust=m["robust"], coverage=m["coverage"], top_kwh_day=m["top_kwh"], site_1=top[0], site_2=top[1],
                              site_3=top[2], siting_status=s.get("status"), siting_documented_cells=s.get("documented_cells"),
                              siting_documented_in_top=s.get("documented_in_top"), siting_candidates=s.get("candidates")))
    pd.DataFrame(dist).to_csv(OUT / "enagis_district.csv", index=False)
    pd.DataFrame(chain).to_csv(OUT / "enagis_district_chain.csv", index=False)
    print(f"enagis districts {len(dist)} | district-chain rows {len(chain)}")


if __name__ == "__main__":
    main()
