# Data notes

## Sources and table map

| Content | Season A file / table | Season B file / table |
|---|---|---|
| Cultivated area (ha) by crop and district | `Tables_2026_Season_A.xlsx` Table 11 | `Tables_2026_Season_B.xlsx` Table 9 |
| Harvested area (ha) | A Table 12 | B Table 10 |
| Yield (kg/ha) | A Table 13 | B Table 11 |
| Production (t) | A Table 15 | B Table 13 |
| Improved-seed use by district | A Table 20 | B Table 18 |
| Practices (irrigation, erosion control, fertilizer) | A Table 10 | B Table 8 |
| Land use | A Table 9 | B Table 7 |
| Improved seed by crop (national) | A Table 21 | B Table 19 |
| Sources of improved seed | A Tables 22–23 | B Tables 20–21 |

AHS 2024 (`AHS_2024_Tables.xlsx`) is used for household-level context only.
Citation: National Institute of Statistics of Rwanda (NISR), Seasonal Agricultural Survey 2026; Agricultural Household Survey 2024 report, August 2025.

Not available in the NISR files: Season C, improved seed by crop *and* district.

## Climate data (external)

| Item | Detail |
|---|---|
| Rainfall | CHIRPS v3.0 monthly, 0.05° (~5 km), mm/month, Climate Hazards Center, UC Santa Barbara. Downloaded by the team. |
| Months | January 2016 – September 2026 (129 months), as small Rwanda-only files in `data/raw/chirps/` made by `src/download_chirps.py`. Normal rainfall = mean of 2016–2024 (9 years; 8 for Season A, which needs the previous September). |
| District boundaries | geoBoundaries gbOpen ADM2, Rwanda (30 districts; `data/raw/boundaries/`). Attribution required; confirm the licence terms at geoboundaries.org before submission. |
| Aggregation | `src/climate.py`: area-weighted mean of pixels per district, output `data/processed/rainfall_district_month.csv` |

Result for 2026: Season A (Sep 2025–Jan 2026) about normal (median 104% of normal; 23 of 30 districts near normal); Season B (Feb–Jun 2026) drier than normal (median 85%; 15 of 30 districts drier). Monthly totals only; not a drought declaration.

Limits that affect what the alert can claim:

- Season windows used: Season A = Sep–Jan, Season B = Feb–Jun (assumption from the NISR sowing-date tables A-18 / B-16: most Season A
  sowing is Sep–Oct, most Season B sowing is Feb–Mar). Anomalies are % of the 2016–2024 mean for the same window (`src/rainfall_watch.py`; classes: <60 very dry, 60–85 drier, 85–115 near normal, 115–140 wetter, >140 much wetter — team-chosen thresholds). % of normal is unstable in the very dry months (Jun–Aug), so seasons are judged as whole windows.
- Monthly totals can show a rainfall deficit against normal, but **cannot detect dry spells inside a month**.
- At ~5 km resolution, small districts (Nyarugenge, Kicukiro) cover only a handful of pixels.

### Rainfall vs yields: tested, no consistent link

`src/rainfall_yield_check.py` correlates district seasonal rainfall with district yield-vs-national (Spearman, ~30 districts, 7 crops
plus an all-crop index, both seasons; results in `data/processed/rainfall_yield_link.csv`). Of 15 tests, only 2 reach p<0.05 (Season B
Irish potato ρ≈0.45 and sweet potato ρ≈0.49), about what chance alone produces (~0.8 expected), and neither repeats in Season A. Maize,
beans, cassava and the all-crop index show no relationship (|ρ| ≤ 0.31, p>0.1).
Consequences for the app: (1) rainfall is **not** part of the priority score; (2) it is shown as a separate *rainfall watch*
(rainfall against normal, for monitoring and early warning); (3) we make no claim that low rainfall explains low district yields.
Limits: one year, between-district comparison only. District yields for earlier years are not in the NISR tables we have, so
a year-to-year rainfall-anomaly vs yield test is not possible with this data.

## Figures verified against the NISR tables

| Figure | Value | Source |
|---|---|---|
| Bean cultivated area, Season A 2026 | 327,907 ha (bush 203,760; climbing 124,147) | SAS A Table 6 |
| Improved seed, bush beans / climbing beans, Season A | 0.50% / 0.19% | SAS A Table 21 |
| Improved seed, beans, AHS 2024 | 0.47% of crop-growing households | AHS Table 20 |
| National bean yield, Season A | bush 610 kg/ha, climbing 847 kg/ha | SAS A Table 13 |
| National bean yield, Season B | bush 634 kg/ha, climbing 894 kg/ha | SAS B Table 11 |
| Burera bush bean yield, Season A | 742 kg/ha | SAS A Table 13 |
| Kayonza bush bean yield, Season A | 627 kg/ha | SAS A Table 13 |

### Corrections to the early FarmPulse draft

The draft listed Burera bush beans at 1,215 kg/ha and Kayonza at 503 kg/ha, and national yields of 600 and 800 kg/ha.
The 1,215 and 503 figures are the **Season B, all-beans** values for those districts (SAS B Table 11), not Season A bush beans.
Use the table above. (`tests/test_dataset.py` pins the correct values.)

## Known inconsistencies inside the NISR tables

Logged automatically in `data/processed/data_quality_log.csv`.

1. **Season A Table 20, "plots overall" column** duplicates the "land overall" column in every district, and for several districts
   exceeds both the small-farm and large-farm values (impossible for a weighted average). We blank it for Season A and use the
   *% of farmers using improved seed* column as the primary adoption measure.
2. **Season A cultivated area, minor crops:** district values do not add up to the national row for Fruits (13,620 vs 8,183 ha),
   Fodder crops (9,485 vs 8,495), Vegetables (19,635 vs 19,244) and the Vegetables-and-Fruits group. NISR's own sampling-error table
   gives a Fruits confidence interval (9,050–17,975 ha) that excludes the published national estimate. Harvested area and production
   reconcile exactly. Main staples reconcile within 0.5%. We use district values.
3. **AHS 2024 extension tables (27–29):** the denominators are ambiguous. For weather and climate information, Table 27 gives 8.6%
   but Table 29 implies about 14% of all agricultural households. We do not cite this figure.

## Interpretation limits

- District yields come from small samples (20–68 segments per district; Season A Table 4). The same districts tend to be high or low in
  both seasons (correlation of yield-vs-national between seasons ≈ 0.5 pooled; 0.8 for Irish potato), so signals are real but noisy.
- Improved-seed use by district is across all crops, so it moves with crop mix. Example: Rusizi is 46.7% in Season A (maize-heavy) and 7.0%
  in Season B. Musaruro shows both seasons and treats seed as context, not proof of cause.
- Yield = production ÷ harvested area (checked in tests). For perennial crops such as banana, cultivated area includes immature stands.
