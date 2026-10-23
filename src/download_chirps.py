"""Download CHIRPS v3 monthly rasters and keep only the Rwanda window (about 10 KB per month).

RUN THIS ON YOUR OWN COMPUTER (needs internet). Each global file is ~23 MB; it is deleted after clipping.
Needs only:  python -m pip install numpy tifffile      (no rasterio/GDAL, so it also works on locked-down Windows PCs)

    python src/download_chirps.py --start 2025-09 --end 2026-07            # the 2026 seasons
    python src/download_chirps.py --start 2016-01 --end 2025-12            # baseline years for "normal rainfall"

Output: data/raw/chirps/chirps-v3.0.<YYYY>.<MM>_rwanda.npz  (skips files that already exist)

How it works: CHIRPS tifs are LZW-compressed with one image row per strip. Rwanda is only ~43 of the 2400 rows, so we
decode just those rows with a small pure-Python LZW decoder (tested against GDAL/rasterio on a real CHIRPS file).

NOTE: BASE_URL was written from memory of the CHC data layout and NOT tested (the build sandbox cannot reach the
server). If a download fails with 404, open the page you originally downloaded your files from, copy the folder URL
into BASE_URL, and re-run. The file names must look like chirps-v3.0.YYYY.MM.tif.
"""
from __future__ import annotations

import argparse
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import tifffile

ROOT = Path(__file__).resolve().parents[1]
CHIRPS_DIR = ROOT / "data" / "raw" / "chirps"
BASE_URL = "https://data.chc.ucsb.edu/products/CHIRPS/v3.0/monthly/global/tifs/"
RWANDA_BBOX = (28.68, -3.02, 31.02, -0.88)   # lon_min, lat_min, lon_max, lat_max; edges deliberately off the 0.05-degree pixel grid


def lzw_decode(data: bytes) -> bytes:
    """Decode one TIFF-flavour LZW strip (MSB-first codes, 'early change')."""
    padded = data + b"\x00\x00\x00\x00"
    nbits = len(data) * 8
    table: list[bytes] = []
    out = bytearray()
    width, bitpos, prev = 9, 0, None
    while bitpos + width <= nbits:
        i = bitpos >> 3
        chunk = int.from_bytes(padded[i:i + 4], "big")
        code = (chunk >> (32 - (bitpos & 7) - width)) & ((1 << width) - 1)
        bitpos += width
        if code == 256:                                   # clear table
            table = [bytes([k]) for k in range(256)] + [b"", b""]
            width, prev = 9, None
            continue
        if code == 257:                                   # end of information
            break
        if prev is None:
            entry = table[code]
        else:
            entry = table[code] if code < len(table) else prev + prev[:1]
            table.append(prev + entry[:1])
        out += entry
        prev = entry
        n = len(table)
        width = 12 if n >= 2047 else 11 if n >= 1023 else 10 if n >= 511 else 9
    return bytes(out)


def read_rwanda_rows(path: Path) -> tuple[np.ndarray, float, float, float]:
    """Return (array mm/month with NaN for missing, lon_west, lat_north, resolution_deg) for the Rwanda window."""
    with tifffile.TiffFile(path) as t:
        page = t.pages[0]
        height, width = page.shape
        scale = page.tags["ModelPixelScaleTag"].value
        tie = page.tags["ModelTiepointTag"].value
        res = float(scale[0])
        lon0, lat0 = float(tie[3]), float(tie[4])
        if page.compression != 5 or page.dtype != np.float32 or page.predictor != 1 or page.rowsperstrip != 1:
            raise ValueError(f"unexpected CHIRPS layout: compression={page.compression} predictor={page.predictor} "
                             f"rowsperstrip={page.rowsperstrip} dtype={page.dtype}")
        west, south, east, north = RWANDA_BBOX
        col0, col1 = max(int(np.floor((west - lon0) / res)), 0), min(int(np.ceil((east - lon0) / res)), width)
        row0, row1 = max(int(np.floor((lat0 - north) / res)), 0), min(int(np.ceil((lat0 - south) / res)), height)
        dtype = np.dtype(t.byteorder + "f4")
        offsets, counts = page.dataoffsets, page.databytecounts
        rows = []
        fh = t.filehandle
        for r in range(row0, row1):
            fh.seek(offsets[r])
            raw = lzw_decode(fh.read(counts[r]))
            if len(raw) != width * 4:
                raise ValueError(f"row {r}: decoded {len(raw)} bytes, expected {width * 4}")
            rows.append(np.frombuffer(raw, dtype=dtype)[col0:col1])
    arr = np.vstack(rows).astype("float32")
    arr[arr < -9000] = np.nan
    return arr, lon0 + col0 * res, lat0 - row0 * res, res


def clip_to_file(src: Path, dst: Path) -> None:
    arr, lon_w, lat_n, res = read_rwanda_rows(src)
    np.savez_compressed(dst, rain=arr, lon0=lon_w, lat0=lat_n, res=res)


def months(start: str, end: str, only: set[int] | None):
    y, m = map(int, start.split("-"))
    y2, m2 = map(int, end.split("-"))
    while (y, m) <= (y2, m2):
        if not only or m in only:
            yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="YYYY-MM")
    ap.add_argument("--end", required=True, help="YYYY-MM")
    ap.add_argument("--months", help="optional comma list of calendar months to keep, e.g. 9,10,11,12,1,2,3,4,5,6,7")
    a = ap.parse_args()
    only = {int(x) for x in a.months.split(",")} if a.months else None
    CHIRPS_DIR.mkdir(parents=True, exist_ok=True)
    for y, m in months(a.start, a.end, only):
        dst = CHIRPS_DIR / f"chirps-v3.0.{y}.{m:02d}_rwanda.npz"
        if dst.exists():
            continue
        name = f"chirps-v3.0.{y}.{m:02d}.tif"
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td) / name
            try:
                urllib.request.urlretrieve(BASE_URL + name, tmp)
                clip_to_file(tmp, dst)
            except Exception as e:  # noqa: BLE001
                print(f"FAILED {name}: {e}")
                continue
        print("saved", dst.name)


if __name__ == "__main__":
    main()
