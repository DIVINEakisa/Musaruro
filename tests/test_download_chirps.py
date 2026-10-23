"""Test the pure-Python CHIRPS reader against GDAL on a synthetic global LZW raster, and the .npz path."""
import sys
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import climate  # noqa: E402
import download_chirps as dl  # noqa: E402


def _synthetic_global(path: Path) -> None:
    rng = np.random.default_rng(0)
    a = rng.gamma(2.0, 40.0, size=(2400, 7200)).astype("float32")      # noisy => many LZW table resets
    a[:, :500] = -9999                                                 # missing values
    a[1200:1300, 3000:3100] = 0
    with rasterio.open(path, "w", driver="GTiff", height=2400, width=7200, count=1, dtype="float32",
                       crs="EPSG:4326", transform=from_origin(-180, 60, 0.05, 0.05), compress="lzw",
                       tiled=False, blockysize=1) as o:
        o.write(a, 1)


def test_pure_python_reader_matches_gdal(tmp_path):
    f = tmp_path / "chirps-v3.0.2026.01.tif"
    _synthetic_global(f)
    ours, lon, lat, res = dl.read_rwanda_rows(f)
    ref, tr = climate.read_rwanda(f)
    assert ours.shape == ref.shape
    assert np.allclose(np.nan_to_num(ours, nan=-1), np.nan_to_num(ref, nan=-1))
    assert (abs(lon - tr.c) < 1e-9) and (abs(lat - tr.f) < 1e-9) and abs(res - 0.05) < 1e-9


def test_npz_roundtrip_gives_same_district_rainfall(tmp_path):
    f = tmp_path / "chirps-v3.0.2026.01.tif"
    _synthetic_global(f)
    out = tmp_path / "chirps-v3.0.2026.01_rwanda.npz"
    dl.clip_to_file(f, out)
    geoms = climate.load_boundaries()
    z_tif = climate.zonal_mean(*climate.read_rwanda(f), geoms)
    z_npz = climate.zonal_mean(*climate.read_rwanda(out), geoms)
    assert z_tif.keys() == z_npz.keys()
    assert all(np.isclose(z_tif[k], z_npz[k], equal_nan=True) for k in z_tif)


def test_month_range():
    assert list(dl.months("2025-11", "2026-02", None)) == [(2025, 11), (2025, 12), (2026, 1), (2026, 2)]
    assert list(dl.months("2025-01", "2025-12", {3, 4})) == [(2025, 3), (2025, 4)]


def test_bbox_constants_identical_and_off_grid():
    assert dl.RWANDA_BBOX == climate.RWANDA_BBOX
    for v in dl.RWANDA_BBOX:
        assert abs(v / 0.05 - round(v / 0.05)) > 0.1        # not on a pixel edge
