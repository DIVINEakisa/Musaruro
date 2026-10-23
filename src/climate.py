"""Aggregate CHIRPS monthly rainfall rasters to district level.

Inputs : data/raw/chirps/chirps-v3.0.<YYYY>.<MM>*.tif   (global or Rwanda-clipped, mm/month, 0.05 deg)
         data/raw/boundaries/rwa_adm2.geojson            (geoBoundaries gbOpen ADM2, 30 districts)
Output : data/processed/rainfall_district_month.csv      (district, year, month, rain_mm)

District value = area-weighted mean of CHIRPS pixels (each 0.05-degree pixel is split 10x10 so small
districts such as Kicukiro are not reduced to one or two pixels). CHIRPS missing value is -9999.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from rasterio.features import rasterize
from rasterio.transform import Affine
from rasterio.windows import Window

ROOT = Path(__file__).resolve().parents[1]
CHIRPS_DIR = ROOT / "data" / "raw" / "chirps"
BOUNDARIES = ROOT / "data" / "raw" / "boundaries" / "rwa_adm2.geojson"
OUT = ROOT / "data" / "processed" / "rainfall_district_month.csv"

RWANDA_BBOX = (28.68, -3.02, 31.02, -0.88)   # lon_min, lat_min, lon_max, lat_max; edges deliberately off the 0.05-degree pixel grid
SUBDIV = 10
FILE_RE = re.compile(r"chirps-v3\.0\.(\d{4})\.(\d{2})")


def read_rwanda(path: Path) -> tuple[np.ndarray, Affine]:
    """Read the Rwanda window of a CHIRPS file: global/clipped .tif, or the small .npz made by download_chirps.py."""
    if Path(path).suffix == ".npz":
        z = np.load(path)
        res = float(z["res"])
        return z["rain"].astype("float64"), Affine(res, 0, float(z["lon0"]), 0, -res, float(z["lat0"]))
    with rasterio.open(path) as r:
        l, b, rt, t = RWANDA_BBOX
        inv = ~r.transform
        c0, r0 = inv @ (l, t)
        c1, r1 = inv @ (rt, b)
        col0, row0 = max(int(np.floor(c0)), 0), max(int(np.floor(r0)), 0)
        col1, row1 = min(int(np.ceil(c1)), r.width), min(int(np.ceil(r1)), r.height)
        win = Window(col0, row0, col1 - col0, row1 - row0)
        arr = r.read(1, window=win).astype("float64")
        tr = r.window_transform(win)
    arr[arr < -9000] = np.nan
    return arr, tr


def load_boundaries(path: Path = BOUNDARIES) -> list[tuple[str, dict]]:
    g = json.loads(Path(path).read_text())
    return [(f["properties"]["shapeName"].strip(), f["geometry"]) for f in g["features"]]


def zonal_mean(arr: np.ndarray, tr: Affine, geoms: list[tuple[str, dict]], subdiv: int = SUBDIV) -> dict[str, float]:
    fine = np.kron(arr, np.ones((subdiv, subdiv)))
    ftr = tr @ Affine.scale(1 / subdiv, 1 / subdiv)
    out = {}
    for name, geom in geoms:
        mask = rasterize([(geom, 1)], out_shape=fine.shape, transform=ftr, fill=0, dtype="uint8").astype(bool)
        vals = fine[mask]
        vals = vals[~np.isnan(vals)]
        out[name] = float(vals.mean()) if vals.size else float("nan")
    return out


def build() -> pd.DataFrame:
    geoms = load_boundaries()
    rows, seen = [], set()
    files = sorted(CHIRPS_DIR.glob("chirps-v3.0.*.tif")) + sorted(CHIRPS_DIR.glob("chirps-v3.0.*.npz"))
    for f in files:
        m = FILE_RE.search(f.name)
        if not m:
            continue
        year, month = int(m.group(1)), int(m.group(2))
        if (year, month) in seen:          # same month supplied twice: keep the first
            continue
        seen.add((year, month))
        arr, tr = read_rwanda(f)
        for district, mm in zonal_mean(arr, tr, geoms).items():
            rows.append(dict(district=district, year=year, month=month, rain_mm=round(mm, 2)))
    df = pd.DataFrame(rows).sort_values(["year", "month", "district"]).reset_index(drop=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT, index=False)
    return df


if __name__ == "__main__":
    d = build()
    print(f"{len(d)} rows | months: {sorted(set(zip(d.year, d.month)))} | districts: {d.district.nunique()}")
