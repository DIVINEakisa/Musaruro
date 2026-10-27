# EnaGIS data and code in Musaruro

Source: EnaGIS by Team Dynamis (<https://github.com/Elie1Z/EnaGIS>), MIT licence for code (`LICENSE-EnaGIS-MIT.txt`).
Data keeps its own licences (`LICENSE-DATA-EnaGIS.md`). Credit when using or showing these results:

- © OpenStreetMap contributors (ODbL 1.0); Overture Maps Foundation, release 2026-09-23.1 (ODbL; places CDLA-Permissive-2.0)
- WorldPop 2020 population (CC BY 4.0), University of Southampton
- Open-Meteo.com historical weather (CC BY 4.0)
- NISR Seasonal Agricultural Survey 2024 and 5th Population and Housing Census 2022

Files here, copied unchanged from EnaGIS `data/rwanda/`: `district_summaries.json` (results of the EnaGIS Live engine for all
30 districts, gathered 10 October 2026), `district_production_2024.csv` (EnaGIS's production input: ESTIMATED, SAS 2024 Season A
shares scaled to 2024 national totals; Bugesera, Kirehe and Ngoma imputed).
`app/static/enagis-live/` is a copy of EnaGIS's `live/` folder (the browser tool), embedded in the app.
Musaruro does not recompute any EnaGIS result.
