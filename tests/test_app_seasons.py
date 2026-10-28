"""Headless run of the app for several seasons: no tab may raise, and survey tabs must say when tables are missing."""
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parents[1] / "app" / "musaruro_app.py")


def run(sel=None):
    at = AppTest.from_file(APP, default_timeout=180).run()
    if sel is not None:
        at.selectbox(key="global_season").select(sel).run()
    return at


def test_default_season_has_no_exception():
    at = run()
    assert not at.exception
    opts = at.selectbox(key="global_season").options
    assert any("2018" in o for o in opts) and any("2026" in o for o in opts)


@pytest.mark.parametrize("sel", [("A", 2018), ("B", 2022), ("A", 2026), ("A", 2027)])
def test_other_seasons_do_not_crash(sel):
    at = run(sel)
    assert not at.exception, [e.message for e in at.exception]


def test_season_without_survey_tables_shows_notice():
    at = run(("B", 2020))
    assert any("not loaded" in i.value for i in at.info)
