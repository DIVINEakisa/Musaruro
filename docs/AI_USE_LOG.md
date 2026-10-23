# AI use log

Hackathon rules allow AI tools as assistants if use is disclosed and participants stay responsible for the work.
This log records what AI (Claude, Anthropic, model Claude Sonnet 5.5) did, and what the team did.

| Date | What AI did | What the team did / must verify |
|---|---|---|
| 2026-10-21 | Compared the team's FarmPulse concept with an alternative idea; proposed combining them, a multi-crop multi-season scope, and the name options (Musaruro chosen by the team). | Chose the concept and the name. **To do:** confirm the Kinyarwanda name with a native speaker and check for name clashes. |
| 2026-10-21 | Read the NISR workbooks, cross-checked the FarmPulse figures, found two district yield figures that were from the wrong season/crop and a duplicated column in SAS Season A Table 20. | Review `docs/DATA_NOTES.md`; open the source tables and confirm the corrected figures. |
| 2026-10-22 | Wrote `src/build_dataset.py` (parser), `src/indicators.py` (indicators and priority score), `tests/` (13 checks against NISR totals), `README.md`, `docs/DATA_NOTES.md`. | Review the code and definitions; decide the final indicator weights; confirm the method suits the team's goals. |
| 2026-10-22 | Wrote `src/climate.py` (CHIRPS to district rainfall), `src/download_chirps.py` (downloader with a pure-Python LZW reader so it runs on locked-down Windows PCs; the download step itself is untested; the reader was verified against GDAL on the team's real files), `tests/test_climate.py`; fetched district boundaries from the geoBoundaries GitHub repository. | Provided the CHIRPS files. **To do:** run the downloader locally for the remaining months; verify the boundary licence. |
| 2026-10-23 | Validated the team's CHIRPS download (11 months), loaded it, wrote `src/rainfall_yield_check.py`, and documented that rainfall totals show no consistent link with district yields. | Ran the downloader and supplied the files. Review the finding and the season-window assumption (Sep–Jan, Feb–Jun). |
| 2026-10-23 | Wrote the Streamlit app (`app/musaruro_app.py`: district view, priority map, rainfall watch, about page), `src/rainfall_watch.py` (rainfall vs normal, with synthetic-data tests), the survey-segments table, and split the requirements files. Tested headless and by screenshot. | Review the wording shown to farmers and officers, the status thresholds (60/85/115/140% of normal), and the colour choices. Supply the baseline rainfall files. |
| 2026-10-23 | Validated the team's full CHIRPS download (129 months, 2016-01 to 2026-09), rebuilt district rainfall, computed anomalies and documented the results and limits. | Ran the downloader and supplied the files. Review the thresholds and the Season B finding before presenting it. |
| 2026-10-23 | Added the Action plan tab and `src/actions.py` (action brief per district: gaps, peer districts, practice shares, seed reality check, rainfall), national improved-seed-by-crop table, tests. The wording of the "consider" suggestions is AI-drafted. | **Must review:** have an agronomist or extension officer check the suggestions before presenting them as advice. |

Rule for this project: anything AI produced is reviewed by a team member before submission, and numbers shown in the app must
trace to an NISR table (see `docs/DATA_NOTES.md`). Add a row for every future AI-assisted change.
