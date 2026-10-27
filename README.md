# Musaruro

**Know your yield, act in time.** *(Musaruro = "harvest" in Kinyarwanda)*

Musaruro turns NISR agricultural statistics into a district-level decision tool for farmers and agricultural officers.
For every district, crop and season it shows where yields lag the national average, where improved seed is rarely used,
and which districts to look at first.

> Built for the NISR Big Data Hackathon 2026, Track 1: Agricultural Productivity.
> Status: **work in progress** — data pipeline, indicators, rainfall pipeline and the Streamlit app are built.
> Still to do: baseline rainfall (2016–2024) for "% of normal", deployment, final documentation.

## What it answers

| User | Question | Musaruro shows |
|---|---|---|
| Farmer / cooperative | "How does my district do on my crop this season?" | District yield vs national average, area, production, Season A vs B |
| Agricultural officer | "Where should we focus extension support first?" | District priority ranking built from yield shortfall and improved-seed use, with adjustable weights |
| Officer | "What should we do in this district?" | An **action brief**: biggest crop gaps, best-yielding peer districts to learn from, practice differences (fertilizer, irrigation), improved-seed reality check, rainfall context, downloadable |
| Planner | "How much output is at stake?" | Tonnes of output if a district matched the national average yield (a comparison, not a forecast) |

## Data

All numbers come from NISR publications (<https://statistics.gov.rw/statistical-publications/agriculture-environment>):

- Seasonal Agricultural Survey (SAS) 2026, Season A and Season B — area, harvested area, production, yield, seed use, practices, by district
- Agricultural Household Survey (AHS) 2024 — household inputs, extension, irrigation (context)
- CHIRPS v3 monthly rainfall (Climate Hazards Center, UCSB) and geoBoundaries district boundaries — see [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md)

Raw workbooks are in `data/raw/`. Nothing is imputed; blank source cells stay blank.
Known inconsistencies inside the NISR tables are logged in `data/processed/data_quality_log.csv` and explained in
[`docs/DATA_NOTES.md`](docs/DATA_NOTES.md).

## Method (short)

1. `src/build_dataset.py` parses the NISR workbooks into tidy tables (district × crop × season) and runs consistency checks.
2. `src/indicators.py` computes, for the main crops:
   - **Yield vs national** = district yield ÷ national yield − 1 (only where the district harvested ≥ 100 ha of the crop)
   - **Output shortfall (t)** = max(0, national yield − district yield) × harvested area
   - **Yield shortfall index** = area-weighted average shortfall across crops
   - **Seed gap** = 100 − % of farmers using improved seed
   - **Priority score** = weighted percentile rank of the yield and seed indicators (weights adjustable)
3. `src/climate.py` and `src/rainfall_watch.py` aggregate CHIRPS rainfall to districts for a **rainfall watch** (rainfall vs normal). Rainfall is deliberately *not* in the
   priority score: we tested it against district yields and found no consistent link (see `docs/DATA_NOTES.md`).
4. `src/actions.py` turns the indicators into an action brief per district and season. Findings are computed from data; "consider" lines are options to test locally, never claimed causes.
5. `src/advisor.py` and `src/sms_service.py` power the **My next action** tab: generic checks by planting stage (labelled preliminary), crop *evidence* (never a switch recommendation), and an SMS preview with a **simulated** send (no gateway connected, no phone numbers stored, consent required).
6. `src/enagis_bridge.py` and the **Infrastructure (EnaGIS)** tab show EnaGIS's district results (candidate sites, estimated energy needs) next to Musaruro's indicators, with EnaGIS Live embedded (`app/static/enagis-live/`). Nothing from EnaGIS is recomputed, there is no combined score, and credits are in `data/enagis/NOTICE.md`.
7. Tests in `tests/` check the data against NISR's own totals and published values.

## What Musaruro does **not** claim

- It does not claim improved seed (or any single input) *causes* higher yields. Beans, for example, show ~0.5% improved-seed use
  nationally and in every province (SAS 2026 Table 21, AHS 2024 Table 20), so seed cannot explain bean yield differences between districts.
- The national average is a benchmark, not potential yield. Altitude, soils and rainfall legitimately differ.
- District estimates come from small samples (20–68 survey segments per district) and are noisy; read them as signals, not exact values.
- The seed indicator reflects crop mix as much as behaviour (maize and vegetables are the main crops using improved seed).

## Run it

```bash
pip install -r requirements.txt            # app only
streamlit run app/musaruro_app.py          # the app (reads data/processed/ and the boundaries file)
```

To rebuild the data from the raw files and run the tests:

```bash
pip install -r requirements-pipeline.txt
python src/build_dataset.py     # raw NISR xlsx -> data/processed/*.csv
python src/indicators.py        # indicators + priority score
python src/climate.py           # CHIRPS rasters -> district rainfall
python src/rainfall_yield_check.py  # rainfall vs yield test
python -m pytest tests -q       # validation
```

## AI use disclosure

AI assistance (Claude, Anthropic) was used in this project, as permitted by the hackathon rules. Every use is recorded in
[`docs/AI_USE_LOG.md`](docs/AI_USE_LOG.md). The team reviews and is responsible for all submitted work.

## Team

_Add team member names, universities and student IDs here._
