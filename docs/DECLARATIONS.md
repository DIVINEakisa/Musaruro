# Declarations: Musaruro (NISR Big Data Hackathon 2026, Track 1)

_Fill in the bracketed fields before submitting._

## Declaration of originality

We, the team [TEAM NAME], declare that the code, analysis and documentation in this repository are our own work, except where
credited below. The team members are: [NAME, UNIVERSITY, STUDENT ID] and [NAME, UNIVERSITY, STUDENT ID].

**Prior and reused work (disclosed).** The Infrastructure tab reuses **EnaGIS** (<https://github.com/Elie1Z/EnaGIS>, MIT licence), a
project by Team Dynamis, whose members are part of this team. EnaGIS was previously submitted to OSEAS 2026 (*Assessment and Mapping of
Productive Uses of Energy (Agriculture)*). In this repository it appears as: a copy of its browser tool in `app/static/enagis-live/`,
its district results in `data/enagis/` (copied unchanged), and a small bridge (`src/enagis_bridge.py`, `scripts/export_enagis.py`). All
other code, indicators, rainfall alerts, the app and the documentation were written for this hackathon.

## Declaration of AI use

We used Claude (Anthropic) as an assistant, as the hackathon rules allow. It helped with planning, parsing the NISR workbooks,
indicators, rainfall alerts, the Streamlit app, automated tests and documentation. Every AI-assisted change is recorded in
[`docs/AI_USE_LOG.md`](AI_USE_LOG.md). The wording of agronomic suggestions and SMS text was drafted by AI and is marked as preliminary
until reviewed by an agronomist and a native Kinyarwanda speaker. We reviewed the work and take responsibility for all of it.

## Data sources and licences

| Source | Use | Licence or terms |
|---|---|---|
| NISR Seasonal Agricultural Survey 2026 (Seasons A and B), 2024; Agricultural Household Survey 2024 | Yields, area, production, seed use, sowing dates | Public statistics, attributed to NISR |
| CHIRPS v3 (Climate Hazards Center, UC Santa Barbara) | Monthly rainfall | Open data, credit CHC |
| geoBoundaries gbOpen ADM2 | District boundaries | Check the licence and credit geoBoundaries |
| EnaGIS data: OpenStreetMap, Overture Maps, WorldPop, Open-Meteo | Infrastructure screening | ODbL 1.0, CDLA-Permissive-2.0, CC BY 4.0; see `data/enagis/NOTICE.md` |

## What this project does not claim

See the README and the About tab: no causal claims about yields, no forecasts, SMS is simulated only, and EnaGIS sites are candidates to check,
not confirmed facilities.
