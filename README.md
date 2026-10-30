# Musaruro

**Know your yield, act in time.** *(Musaruro = "harvest" in Kinyarwanda)*

Musaruro turns NISR agricultural statistics and satellite rainfall into a district-level decision tool for farmers,
extension officers and planners in Rwanda. For every district, crop and season it shows where yields lag the national
average, where irrigation is rare while dry seasons are common, when rainfall is unusually low or high, and what to
check next.

> Built for the **NISR Big Data Hackathon 2026, Track 1: Agricultural Productivity**.
> Live app: <https://musaruro-app.streamlit.app/> · Code: <https://github.com/DIVINEakisa/Musaruro>

**Contents:** [Problem and solution](#problem-and-solution) · 
[Tab-by-tab guide](#tab-by-tab-guide) · [The season list: 2018 to 2027](#the-season-list-2018-to-2027-and-why-some-tabs-say-not-loaded) ·
[Data sources](#data-sources-and-licences) · [Definitions and method](#definitions-and-method) ·
[What Musaruro does not claim](#what-musaruro-does-not-claim)  ·
[Run it on your computer](#run-it-on-your-computer) · [Rebuild the data](#rebuild-the-data-from-the-raw-files) ·
[Tests](#tests) · [Troubleshooting](#troubleshooting) ·
[Repository map](#repository-map) ·

---

## Problem and solution

**Problem.** NISR's survey tables hold a great deal of information, but a district officer or cooperative cannot easily
see, for their own district and crop, how they compare with the rest of the country, which districts deserve attention
first, or whether a dry or wet spell is unusual enough to act on. Warnings also tend to stop at "here is a number"
without saying how rare it is or what to do next.

**Solution.** Musaruro joins three open sources (NISR surveys, CHIRPS satellite rainfall, geoBoundaries district
boundaries) into one app that answers:

| User | Question | Where in the app |
|---|---|---|
| Farmer or cooperative | "How does my district do on my crop this season?" | My district |
| Anyone | "Where is a given crop grown, and how well, across all districts?" | Crops nationwide |
| Officer | "Has rainfall been unusual, and how rare is that?" | Alerts, Rainfall watch |
| Officer | "What should we check or do next?" | My next action, Action plan |
| Planner | "Which districts should we look at first?" | Priority districts |
| Planner | "Where is irrigation rare while dry seasons are common?" | Irrigation & soil |

Everything is a **comparison or a screening signal, not a forecast and not a claim of cause**. Every suggestion is
labelled as something to check with a local agronomist.

---

## Quick start for everyone who wants to use Musaruro

1. **Open the live app:** <https://musaruro-app.streamlit.app/> (the first load can take a few seconds while the free
   server wakes up).
2. Leave the **Season** list at the top on its default (*Season B 2026*). That is the latest season for which both NISR
   survey tables and rainfall are available.
3. Visit the tabs in order, using the [tab-by-tab guide](#tab-by-tab-guide) below.
4. If something shows a notice such as "NISR survey tables for this season are not loaded", read
   [the season section](#the-season-list-2018-to-2027-and-why-some-tabs-say-not-loaded). It is expected, not a fault.
5. To run it yourself: [Run it on your computer](#run-it-on-your-computer) (three commands).

---

## Tab-by-tab guide

The app has eight tabs. A **Season** list at the top of the page applies to all of them.

### 1. My district
Pick a district and a crop. It states the district's yield in kg per hectare, how far above or below the **national
average** it is, the harvested area, and the tonnes of output that would be gained if the district reached the national
average on that crop ("a comparison, not a forecast"). A chart compares the district with the national yield in
Seasons A and B, and a table lists all main crops in the district. Crops with under 100 hectares harvested are not
compared, because the yield is too uncertain.

### 2. Alerts
Compares satellite rainfall with each district's **own normal** (the 2016–2024 average), either over the whole season so
far or over the district's **sowing window** (the peak sowing month and the next one, taken from NISR's sowing-date
tables). Each district gets a level:

| Level | Rule (team-set, to be reviewed with agronomists; not official) |
|---|---|
| Normal | 85% to 140% of normal |
| Watch | below 85% of normal |
| Warning | below 60% of normal |
| Wet watch | 140% of normal or more |

"N districts flagged" means N districts are at Watch, Warning or Wet watch for the chosen season and comparison. Choosing a
district shows how often the same window was this dry in the baseline years ("none of the N baseline years was this dry"),
and a "what to check next" note. A flag is a signal to check fields, **not** a statement that crops failed.

### 3. My next action
From warning to next step, for one district, crop and planting stage:
1. **What is happening:** the rainfall signal in plain words.
2. **Checks to discuss with an agronomist** for that planting stage, all labelled *preliminary* / *needs local agronomist
   review*. Musaruro never recommends switching crops and never claims damage.
3. **Evidence about crops already grown in the district:** the district's own yields against the national yield. Yields of
   different crops are not compared with each other.
4. **SMS preview and send.** By default the send is a **simulation**. See [SMS](#sms-simulation-by-default-optional-sandbox-test).
5. **Follow-up record (demo):** a form showing how feedback could be collected. Entries are stored only in the browser
   session and are labelled "DEMO (not real feedback)".

### 4. Crops nationwide
Choose a season, optionally include crop groups (for example all beans), and pick a crop. A map shows every district
(harvested area, yield, yield versus national, or share of national production), with a top-10 chart, a full table and a
CSV download. **Coffee and tea are not available**: the NISR files used do not report them by district. The only related
figure is one combined *permanent crops* area per district (banana, coffee, tea and others), shown on a clearly labelled
map that does not claim to show coffee.

### 5. Priority districts
Ranks districts on two measures: the **yield gap** (how far yields fall below the national average, weighted by area) and
the **improved-seed gap** (100 minus the % of farmers using improved seed). The slider sets how much weight each measure
gets (default 50/50). A darker district means a stronger case to look there first, not that the district is failing.
Rainfall is deliberately left out of the score (see [definitions](#definitions-and-method)).

### 6. Irrigation & soil
- **Who irrigates:** a map of the % of farmers who irrigate (NISR SAS 2026).
- **Check first:** districts where **fewer than 10% of farmers irrigate and at least 3 of the 2016–2024 seasons had rainfall
  below 85% of normal**. This is a screening aid. It does not say irrigation would raise yields, and the thresholds are
  team-set.
- **One district:** irrigation techniques and water sources (shares of *irrigated plots*, a small sample in many
  districts, so indications only), and why plots are not irrigated by province (AHS 2024).
- **Pump and solar sizing sketch:** a back-of-envelope calculator with inputs you can change (area, water per day, lift
  height, pump efficiency, peak sun hours). It ignores pipe losses, storage and water-use rights.
- **Soil care and fertility:** the share of cropland receiving inorganic or organic fertilizer, and the soil threats households
  report by province (AHS 2024). Shown side by side; neither is claimed to explain yields.

### 7. Action plan
For a district and season, a brief of **where the gap is, who does better, which practices differ, and what to check or try**.
Findings come from the data. The *consider* lines are options to test with local agronomists on demonstration plots, not
proven causes. A Markdown version can be downloaded.

### 8. Rainfall watch
A map and a monthly chart of satellite rainfall against the 2016–2024 normal for any district and the chosen season.
This is monitoring, not a forecast, and monthly totals cannot show dry spells inside a month.

---

## The season list: 2018 to 2027, and why some tabs say "not loaded"

The **Season** list at the top covers every season from **Season A 2018** to the newest season that has started
(**Season A 2027**, which is still in progress with only September 2026 observed). Seasons are defined as:

- **Season A** of year *Y*: September of *Y−1* to January of *Y*.
- **Season B** of year *Y*: February to June of *Y*.

The data we hold does not cover all of them equally:

| Data | Seasons available | Used by |
|---|---|---|
| **CHIRPS satellite rainfall** | **All seasons** from 2018 (monthly data from January 2016 to September 2026, 129 months) | Alerts, My next action (rainfall part), Rainfall watch |
| **NISR Seasonal Agricultural Survey tables** | **Season A 2026 and Season B 2026 only** (the only SAS workbooks provided to us) | My district, Crops nationwide, Priority districts, Irrigation & soil, Action plan |

So if you pick, for example, *Season A 2019*:
- the rainfall tabs show that season's rainfall against normal;
- the survey tabs show a notice: *"NISR survey tables for Season A 2019 are not loaded in this app (loaded: Season A 2026, B 2026)."*

This is deliberate. **We do not estimate, back-fill or invent survey figures for years we have no data for.**

Two further notes:
- For seasons up to 2024, the rainfall "normal" is the 2016–2024 average, which includes that season itself. That is fine
  for a quick look, but it is not a strict out-of-sample comparison.
- The newest CHIRPS months are *preliminary* and may be revised. Season A 2027 shows only the months observed so far, and
  the app says "Early view: N of 5 months observed".

**Adding another survey season** (for example if earlier NISR tables are obtained): place the NISR SAS workbook in
`data/raw/`; add its table numbers to `SEASONS` in `src/build_dataset.py` (table numbers differ between years, and the
processed tables would need a `year` column); re-run the build scripts; then add `("A", year)` to `SURVEY_SEASONS` in
`app/musaruro_app.py`. The season list itself grows automatically as new CHIRPS months are added.

---

## Data sources and licences

| Source | What it provides | Terms |
|---|---|---|
| NISR **Seasonal Agricultural Survey 2026**, Season A and B | Area, harvested area, yield, production, improved seed, practices, irrigation, sowing dates, by district | Public NISR statistics, attributed to NISR |
| NISR **Agricultural Household Survey 2024** | Reasons plots are not irrigated, irrigation water sources, soil threats, by province | Public NISR statistics, attributed to NISR |
| **CHIRPS v3** monthly rainfall, Climate Hazards Center, UC Santa Barbara | Satellite rainfall, 0.05° resolution | Open data; credit the Climate Hazards Center |
| **geoBoundaries** gbOpen ADM2 | District boundaries (30 districts) | Open licence; attribution required (please check the licence on the geoBoundaries page) |

NISR publications: <https://statistics.gov.rw/statistical-publications/agriculture-environment>. Raw workbooks are in
`data/raw/`; the exact tables used and every judgement call are in [`docs/DATA_NOTES.md`](docs/DATA_NOTES.md).
Nothing is imputed: blank source cells stay blank.

### Data quality issues found in the NISR tables
These are logged in `data/processed/data_quality_log.csv` and handled as described:
- **Season A, Table 20:** the "plots overall" column equals the "land overall" column in every district and exceeds both
  small-scale and large-scale values in some (impossible for a weighted average). We set it to missing and use the share of
  *farmers* using improved seed as the adoption measure.
- **District totals versus NISR national rows** disagree for some crop groups' cultivated area (fodder crops 11.7%, fruits 66.4%,
  vegetables 2.0%, vegetables and fruits 21.2%). We use the district values and flag the gap.
- Season B Table 30 spells *Nyarugenge* as "Nyarugenege"; matched by name similarity.

---

## Definitions and method

1. **Yield vs national** = district yield ÷ national yield − 1, per crop and season, only where the district harvested
   **100 ha or more** of the crop.
2. **Output at stake (tonnes)** = max(0, national yield − district yield) × harvested area. A comparison, not a forecast
   or a potential-yield estimate.
3. **Yield gap index** = area-weighted average shortfall across the main crops. **Seed gap** = 100 − % of farmers using
   improved seed. **Priority score** = weighted percentile rank of these two (weights adjustable in the app).
4. **Rainfall normal** = the average of the same calendar months in 2016–2024 (at least 5 complete baseline years
   needed). **% of normal** = observed ÷ normal. Satellite estimates, aggregated to districts by area-weighted mean of the
   pixels.
5. **Rainfall is not in the priority score.** We tested district rainfall against district yields (Spearman rank
   correlation, 15 crop-season tests): **2 of 15 were significant at p < 0.05, about what chance alone gives**, so we
   found no consistent link.
6. **Alert levels:** see the [Alerts](#2-alerts) table. Seasons with all months observed are compared in full; partial
   seasons show an early-view warning.
7. **Irrigation "check first":** fewer than 10% of farmers irrigate **and** at least 3 of the baseline seasons below 85%
   of normal. Season A has 8 complete baseline seasons, Season B has 9.
8. **Pump sketch:** water (m³/day) = area × depth; energy (kWh/day) = m³ × 1000 × 9.81 × head ÷ 3.6 million ÷ pump
   efficiency; solar array (kWp) = kWh/day ÷ (peak sun hours × performance ratio). The performance ratio (default 0.75,
   range 0.65–0.80) is taken from the EnaGIS project's configuration. ESTIMATED, not a design.
9. **Labels:** all agronomic wording is marked *preliminary* and *needs local agronomist review*; calculated sketches such as the pump estimate are marked ESTIMATED.

---

## What Musaruro does **not** claim

- It does not claim improved seed, irrigation, rainfall or any single input **causes** higher or lower yields. Beans show
  about 0.5% improved-seed use nationally, so seed cannot explain bean yield differences between districts.
- The national average is a **benchmark, not potential yield**. Altitude, soils and rainfall legitimately differ.
- District estimates come from small samples (**20 to 68 survey segments per district**). They are signals, not exact
  values, and the app shows a "small survey sample" badge where a district has fewer than 30 segments.
- Rainfall figures are a **satellite estimate and monitoring, not a forecast**. Monthly totals cannot show dry spells
  inside a month, and the newest months are preliminary. A comparison with Meteo Rwanda is still to be done.
- Alert thresholds, the irrigation screening rule, and all agronomic wording are **team-set and need review** by a local
  agronomist.
- The SMS step is a **simulation** unless a gateway is configured, and no phone numbers are collected or stored.
- Survey figures exist only for 2026 (see the season section). Nothing is back-filled.
- Coffee, tea and export data are not covered (no such district data in the files used).
  
---

## Run it on your computer

**You need:** Python 3.11 or newer (tested on 3.13) and internet access once, to install packages. The app reads only
files already in the repository (`data/processed/*.csv` and `data/raw/boundaries/rwa_adm2.geojson`), so **no data download
is needed to run it.**

```bash
# 1. get the code
git clone https://github.com/DIVINEakisa/Musaruro.git
cd Musaruro

# 2. (recommended) a clean environment
python -m venv .venv
#   Windows:       .venv\Scripts\activate
#   macOS/Linux:   source .venv/bin/activate

# 3. install and run
pip install -r requirements.txt
streamlit run app/musaruro_app.py
```

Streamlit prints a local address (normally <http://localhost:8501>); open it in a browser. On Windows you may need `py -3.13`
in place of `python`. The map uses a blank background, so it needs no map-tile server and works offline.

Tested with: Streamlit 1.66.1 (pinned in `requirements.txt`), pandas 3.0, plotly 7.1, numpy 2.5, Python 3.13.

---

## Rebuild the data from the raw files

You only need this to reproduce the processed tables from scratch. Run from the repository root:

```bash
pip install -r requirements-pipeline.txt      # adds openpyxl, rasterio, scipy, tifffile, pytest

python src/build_dataset.py        # NISR xlsx  -> crop/district tables, seed, practices, land use, sowing months, segments
python src/indicators.py           # yield gap, shortfall, seed gap, priority score
python -m src.build_water          # irrigation, techniques, water sources, AHS province tables, soil threats
python src/download_chirps.py --start 2016-01 --end 2026-09   # OPTIONAL: needs internet; skips files already present
python src/climate.py              # CHIRPS files -> district monthly rainfall (needs rasterio)
python src/rainfall_yield_check.py # rainfall-versus-yield test (needs scipy)
```

Notes:
- `data/raw/chirps/` already contains the monthly files (about 1.4 MB) clipped to Rwanda, so the download step can be skipped.
- `python -m src.build_water` is run as a module (with `-m`) from the repository root.
- `src/climate.py` needs **rasterio**. On locked-down Windows computers rasterio may be blocked; `download_chirps.py` needs only
  `numpy` and `tifffile`, and the processed rainfall file is already included, so you can usually skip this step.
- `download_chirps.py` has a `BASE_URL` that was written from the Climate Hazards Center folder layout; if a download returns
  404, copy the folder URL from the CHC page into `BASE_URL`. The file names must look like `chirps-v3.0.YYYY.MM.tif`.

---

## Tests

```bash
pip install -r requirements-pipeline.txt
python -m pytest tests -q          # 65 tests, about 30 seconds
```

What the tests check:
- **Data:** the parsed tables against NISR's own published totals and values; every district present; ranges valid.
- **Indicators:** shortfall and priority-score arithmetic; irrigation screening needs both conditions; pump formula against a hand
  calculation; crop shares add up to 100%.
- **Rainfall and alerts:** baseline and anomaly maths, level thresholds, sowing windows, the CHIRPS downloader's decoder.
- **Advice and SMS:** every checklist is labelled preliminary; no text tells a farmer to switch crops or claims damage; SMS length
  and consent rules; the gateway is mocked (no network); history stores no phone numbers.
- **App:** the app runs headless for several seasons (2018, 2022, 2026, 2027) without errors, and survey tabs show the "not
  loaded" notice for seasons without tables.
  
---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| A tab says "NISR survey tables for Season … are not loaded" | Expected. Survey tables exist only for 2026. Choose *Season A 2026* or *Season B 2026* in the list at the top. |
| The first page load is slow on the live app | Free hosting sleeps when idle. Wait a few seconds and reload. |
| `AttributeError` or an odd error right after a new version was pushed to the live app | The server kept old modules in memory. Use Manage app, Reboot app. |
| The map is blank | The map needs `data/raw/boundaries/rwa_adm2.geojson` (included). Make sure you ran the app from the repository (so the path resolves) and have `plotly>=6`. |
| `pip install` fails halfway on an unstable connection | Re-run it; downloads resume. For running the app you only need `requirements.txt`. For tests you need `pytest openpyxl pandas scipy`. |
| `rasterio` will not install or is blocked | You do not need it to run the app or the tests that ship with the data. It is only used by `src/climate.py`. |
| Port 8501 is already in use | `streamlit run app/musaruro_app.py --server.port 8600` |
| "Send a real test SMS" does not appear | No secrets are set (this is the safe default), or the app was not restarted after adding them. |
| Git shows every file as modified on Windows | Only line endings differ; it is harmless. |

---

## Repository map

```
app/musaruro_app.py        the Streamlit app (8 tabs, season list)
src/
  build_dataset.py         NISR workbooks -> tidy tables, consistency checks, data-quality log
  indicators.py            yield gap, output at stake, seed gap, priority score
  build_water.py           irrigation, techniques, water sources, AHS province tables
  climate.py               CHIRPS rasters -> district monthly rainfall
  download_chirps.py       download and clip CHIRPS months (own computer, needs internet)
  rainfall_watch.py        normals, anomalies, season windows
  alerts.py                alert levels, sowing windows, plain-language explanations
  actions.py               action brief per district and season
  advisor.py               planting-stage checks (preliminary), crop evidence
  sms_service.py           SMS simulation, consent rules, gated sandbox sender, masked history
  irrigation.py            irrigation screening and pump sketch
  crop_view.py             one-crop national view
  rainfall_yield_check.py  rainfall versus yield test
data/
  raw/                     NISR workbooks, CHIRPS months clipped to Rwanda, district boundaries
  processed/               tables the app reads
tests/                     65 automated tests
docs/                      DATA_NOTES.md, AI_USE_LOG.md, DECLARATIONS.md
.streamlit/                config.toml, secrets.toml.example
```

---

## Team and declarations

**Declaration of originality:** [`docs/DECLARATIONS.md`](docs/DECLARATIONS.md).

**Team.** 

| Name | University | Role |
|---|---|---|
| Ange UWIZERA| RP-Kigali College | Team Leader & Researcher |
| Divine AKISA | RP-Kigali College | Developer |

- **Musaruro Deployed Link:** https://musaruro-app.streamlit.app/
- **Musaruro Video:** https://drive.google.com/file/d/1t9QpnV6FyuexHXg0rzHLjyolK0iQnXJD/view
