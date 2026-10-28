"""Musaruro - Know your yield, act in time.  Run: streamlit run app/musaruro_app.py

Reads only data/processed/*.csv and data/raw/boundaries/rwa_adm2.geojson (built by src/).
"""
from __future__ import annotations

import json
import sys
from contextlib import contextmanager
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import actions  # noqa: E402
import advisor  # noqa: E402
import enagis_bridge as eb  # noqa: E402
import alerts  # noqa: E402
import crop_view as cv  # noqa: E402
import irrigation as irg  # noqa: E402
import sms_service  # noqa: E402
import rainfall_watch as rw  # noqa: E402
from indicators import add_priority  # noqa: E402

P = ROOT / "data" / "processed"
BLUE = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"]   # sequential, dataviz palette
DIVERGING = [[0, "#e34948"], [0.25, "#f0a6a5"], [0.5, "#d9d8d2"], [0.75, "#86b6ef"], [1, "#2a78d6"]]  # dry red <-> wet blue
C_DISTRICT, C_NATIONAL = "#2a78d6", "#898781"
YEAR = 2026
st.set_page_config(page_title="Musaruro", page_icon="🌾", layout="wide")

st.markdown("""<style>
.block-container{padding-top:1.6rem;max-width:1200px}
.badge{display:inline-block;padding:.15rem .6rem;border-radius:99px;border:1px solid rgba(128,128,128,.45);font-size:.85rem}
.big{font-size:1.15rem;line-height:1.55}
</style>""", unsafe_allow_html=True)


@st.cache_data
def load():
    r = lambda n: pd.read_csv(P / n)
    geo = json.load(open(ROOT / "data" / "raw" / "boundaries" / "rwa_adm2.geojson"))
    rain = r("rainfall_district_month.csv")
    return dict(crop=r("indicators_crop.csv"), dist=r("indicators_district.csv"), seg=r("survey_segments.csv"),
                seed=r("improved_seed_district.csv"), rain=rain, geo=geo, dq=r("data_quality_log.csv"),
                nat=r("national_reference.csv"), prac=r("practices_district.csv"), cds=r("crop_district_season.csv"),
                seedcrop=r("improved_seed_crop_national.csv"), sow=r("sowing_month_district.csv"),
                irr=r("irrigation_district.csv"), ahsw=r("ahs_water_province.csv"), ahss=r("ahs_soil_province.csv"),
                land=r("land_use_district.csv"),
                eg_dist=r("enagis_district.csv"), eg_chain=r("enagis_district_chain.csv"),
                eg_prod=pd.read_csv(ROOT / "data" / "enagis" / "district_production_2024.csv"))


D = load()
DISTRICTS = sorted(D["dist"].district.unique())
SEG = D["seg"].set_index("district").survey_segments
SEASON_LABEL = {"A": "Season A 2026 (Sep–Jan)", "B": "Season B 2026 (Feb–Jun)"}
fmt = lambda x, n=0: "–" if pd.isna(x) else f"{x:,.{n}f}"


def reliability(d: str) -> str:
    n = int(SEG[d])
    return f"Small survey sample ({n} segments): read with care" if n < 30 else f"Survey sample: {n} segments"


def choropleth(df, col, title, colorscale, zmid=None, fmt_hover="%{z:.0f}", zmin=None, zmax=None):
    fig = go.Figure(go.Choroplethmap(
        geojson=D["geo"], locations=df.district, z=df[col], featureidkey="properties.shapeName",
        colorscale=colorscale, zmid=zmid, zmin=zmin, zmax=zmax, marker_line_width=0.8,
        marker_line_color="rgba(128,128,128,.8)", marker_opacity=0.92,
        hovertemplate="<b>%{location}</b><br>" + title + ": " + fmt_hover + "<extra></extra>",
        colorbar=dict(title=dict(text=title, side="right"), thickness=12, len=0.8)))
    # "white-bg" needs no tile server, so the map also works offline and behind firewalls
    fig.update_layout(map=dict(style="white-bg", center=dict(lat=-1.95, lon=29.87), zoom=7.2),
                      margin=dict(l=0, r=0, t=0, b=0), height=470, paper_bgcolor="rgba(0,0,0,0)")
    return fig


st.title("🌾 Musaruro")
st.caption("Know your yield, act in time · District decision tool built on NISR Seasonal Agricultural Survey 2026 and CHIRPS rainfall")
# ------------------------------------------------------------------ season selector (whole app)
FIRST_YEAR = 2018
SURVEY_SEASONS = {("A", 2026), ("B", 2026)}      # NISR SAS tables loaded; add new (season, year) here when files are added


def season_options(rain_df):
    have = set(zip(rain_df.year, rain_df.month))
    last = max(rain_df.year)
    out = []
    for y in range(last + 1, FIRST_YEAR - 1, -1):
        for k in ("B", "A"):
            if rw.season_year_months(k, y)[0] in have:          # season has started: first month observed
                out.append((k, y))
    return out


def season_name(k, y):
    first, last_ = rw.season_year_months(k, y)[0], rw.season_year_months(k, y)[-1]
    mon = lambda ym: pd.Timestamp(year=ym[0], month=ym[1], day=1).strftime("%b %Y")
    return f"Season {k} {y} ({mon(first)}–{mon(last_)})"


class _Skip(Exception):
    pass


@contextmanager
def tabx(t):
    with t:
        try:
            yield
        except _Skip:
            pass


def need_survey():
    """Stop a survey-based tab early when NISR tables for the chosen season are not loaded."""
    if (SEL_S, SEL_Y) not in SURVEY_SEASONS:
        have = ", ".join(f"{k} {y}" for k, y in sorted(SURVEY_SEASONS, key=lambda t: (t[1], t[0])))
        st.info(f"NISR survey tables for **{season_name(SEL_S, SEL_Y)}** are not loaded in this app (loaded: Season {have}). "
                "This tab needs them. Rainfall tabs (Alerts, My next action, Rainfall watch) work for any season shown in the list. "
                "To add a season, see README, 'Adding another survey season'.")
        raise _Skip


_opts = season_options(D["rain"])
_default = _opts.index(("B", 2026)) if ("B", 2026) in _opts else 0
_sel = st.selectbox("Season (all tabs)", _opts, index=_default, format_func=lambda t: season_name(*t),
                    key="global_season", help="Pick any season since 2018. Rainfall is available for all of them; NISR survey "
                    "tables are loaded for Seasons A and B 2026 only.")
SEL_S, SEL_Y = _sel
if (SEL_S, SEL_Y) in SURVEY_SEASONS:
    st.caption("NISR survey data and satellite rainfall are both available for this season.")
else:
    st.caption("Satellite rainfall is available for this season. NISR survey tabs need tables that are not loaded for it.")

tab1, tab6, tab7, tab9, tab2, tab10, tab5, tab8, tab3, tab4 = st.tabs(
    ["My district", "Alerts", "My next action", "Crops nationwide", "Priority districts", "Irrigation & soil", "Action plan",
     "Infrastructure (EnaGIS)", "Rainfall watch", "About the data"])

# ------------------------------------------------------------------ 1. My district (farmer view)
with tabx(tab1):
    need_survey()
    c1, c2, c3 = st.columns(3)
    district = c1.selectbox("District", DISTRICTS, index=DISTRICTS.index("Musanze"))
    season = SEL_S
    c2.markdown(f"**{SEASON_LABEL[season]}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
    crops = D["crop"]
    avail = sorted(crops[(crops.district == district) & crops.yield_vs_national_pct.notna()].crop.unique())
    crop = c3.selectbox("Crop", avail, index=avail.index("Maize") if "Maize" in avail else 0)
    st.markdown(f'<span class="badge">{reliability(district)}</span>', unsafe_allow_html=True)

    cs = crops[(crops.district == district) & (crops.crop == crop)].set_index("season")
    if season in cs.index and pd.notna(cs.loc[season, "yield_vs_national_pct"]):
        row = cs.loc[season]
        pct = row.yield_vs_national_pct
        word = "above" if pct >= 0 else "below"
        st.markdown(f'<p class="big"><b>{crop}</b> in <b>{district}</b>, {SEASON_LABEL[season]}: about '
                    f'<b>{fmt(row.yield_kg_ha)} kg per hectare</b>, <b>{abs(pct):.0f}% {word}</b> the national average '
                    f'({fmt(row.national_yield_kg_ha)} kg/ha). Harvested area: {fmt(row.harvested_ha)} ha.</p>',
                    unsafe_allow_html=True)
        if pct < 0:
            st.markdown(f"If {district} reached the national average on this crop, output would be about "
                        f"**{fmt(row.shortfall_t)} tonnes higher** (a comparison, not a forecast).")
    else:
        st.info("Not enough harvested area of this crop in this district and season to compare (needs 100 ha or more).")

    # district vs national, both seasons
    seas = [s for s in ("A", "B") if s in cs.index and pd.notna(cs.loc[s, "yield_kg_ha"])]
    if seas:
        fig = go.Figure()
        fig.add_bar(name=district, x=[f"Season {s}" for s in seas], y=[cs.loc[s, "yield_kg_ha"] for s in seas],
                    marker_color=C_DISTRICT, width=0.28, hovertemplate="%{x}: %{y:,.0f} kg/ha<extra>" + district + "</extra>")
        fig.add_bar(name="National", x=[f"Season {s}" for s in seas], y=[cs.loc[s, "national_yield_kg_ha"] for s in seas],
                    marker_color=C_NATIONAL, width=0.28, hovertemplate="%{x}: %{y:,.0f} kg/ha<extra>National</extra>")
        fig.update_layout(barmode="group", height=300, yaxis_title="Yield (kg/ha)", margin=dict(l=0, r=0, t=10, b=0),
                          legend=dict(orientation="h", y=1.12), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        fig.update_yaxes(rangemode="tozero")
        st.plotly_chart(fig, width="stretch")

    st.subheader(f"All main crops in {district}, {SEASON_LABEL[season]}")
    t = crops[(crops.district == district) & (crops.season == season)].copy()
    t["Compared?"] = t.yield_vs_national_pct.notna()
    t = t.sort_values("harvested_ha", ascending=False)[
        ["crop", "harvested_ha", "yield_kg_ha", "national_yield_kg_ha", "yield_vs_national_pct", "production_mt"]]
    t.columns = ["Crop", "Harvested (ha)", "Yield (kg/ha)", "National (kg/ha)", "vs national (%)", "Production (t)"]
    st.dataframe(t.round(0), hide_index=True, width="stretch")
    seed = D["seed"].query("district == @district and season == @season")
    if len(seed):
        st.caption(f"Farmers using improved seed (all crops combined): {seed.farmers_improved_pct.iloc[0]:.1f}%. "
                   "This depends on which crops are grown, so it is context, not a verdict.")

# ------------------------------------------------------------------ 1b. Smart alerts
with tab6:
    st.markdown("**Smart rainfall alerts.** Musaruro compares satellite rainfall with the 2016–2024 normal, either over the whole "
                "season or over each district's **own sowing window** (the peak sowing month and the next one, from NISR's "
                "sowing-date tables). Each alert says what changed, how rare it is, and what to check next.")
    if not rw.baseline_ready(D["rain"]):
        st.info("The rainfall baseline is not loaded, so alerts are unavailable.")
    else:
        c1, c2 = st.columns(2)
        c1.markdown(f"**{season_name(SEL_S, SEL_Y)}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
        basis = c2.radio("Compare", ["Whole season", "Sowing window"], horizontal=True, key="al_basis")
        a_s, a_y = SEL_S, SEL_Y
        al = alerts.build(D["rain"], D["sow"], a_s, a_y, "season" if basis == "Whole season" else "sowing")
        if al.empty:
            st.info("The months of this window have not been observed yet. CHIRPS publishes monthly data about two weeks "
                    "after the month ends. Try the whole-season view or an earlier period.")
        else:
            mt = int(al.months_used.max())
            if mt < int(al.months_total.max()):
                st.warning(f"Early view: {mt} of {int(al.months_total.max())} months of this window observed so far. "
                           "Alerts can change as more months arrive.")
            if len(al) < 30:
                st.caption(f"{30 - len(al)} district(s) are not listed because their sowing window has no observed month yet.")
            counts = al.label.value_counts()
            cc = st.columns(4)
            for col, (k, (lab, ic)) in zip(cc, alerts.LEVELS.items()):
                col.metric(f"{ic} {lab}", int(counts.get(lab, 0)))
            code = {"none": 0, "watch": 1, "warning": 2, "wet": 3, "unknown": 0}
            fig = go.Figure(go.Choroplethmap(
                geojson=D["geo"], locations=al.district, z=al.level.map(code), featureidkey="properties.shapeName",
                zmin=-0.5, zmax=3.5, showscale=False, marker_line_width=0.8, marker_line_color="rgba(128,128,128,.8)",
                marker_opacity=0.92, colorscale=[[0, "#d9d8d2"], [.25, "#d9d8d2"], [.25, "#fab219"], [.5, "#fab219"],
                                                 [.5, "#d03b3b"], [.75, "#d03b3b"], [.75, "#2a78d6"], [1, "#2a78d6"]],
                customdata=al[["icon", "label", "pct_of_normal"]],
                hovertemplate="<b>%{location}</b><br>%{customdata[0]} %{customdata[1]} (%{customdata[2]:.0f}% of normal)<extra></extra>"))
            fig.update_layout(map=dict(style="white-bg", center=dict(lat=-1.95, lon=29.87), zoom=7.2), height=440,
                              margin=dict(l=0, r=0, t=0, b=0), paper_bgcolor="rgba(0,0,0,0)")
            m, b = st.columns([3, 2])
            m.plotly_chart(fig, width="stretch")
            m.caption("Grey = normal · yellow = watch (below normal) · red = warning (far below) · blue = wet watch. "
                      "The district list gives the same information in words.")
            flagged = al[al.level.isin(["watch", "warning", "wet"])].sort_values("pct_of_normal")
            pick_pool = flagged.district.tolist() or al.district.tolist()
            b.markdown(f"**{len(flagged)} district(s) flagged**" if len(flagged) else "**No district flagged.** Showing any district.")
            ad = b.selectbox("District", pick_pool, key="al_dist")
            r = al[al.district == ad].iloc[0]
            with b.container(border=True):
                st.markdown(f"### {r.icon} {r.label}: {ad}")
                st.write(alerts.explain(r))
                crops_d = D["crop"][(D["crop"].district == ad) & (D["crop"].season == a_s) & D["crop"].yield_vs_national_pct.notna()] \
                    .sort_values("harvested_ha", ascending=False).head(3).crop.tolist()
                if crops_d and (a_s, a_y) in SURVEY_SEASONS:
                    st.write("Main crops here (by harvested area, 2026 survey): " + ", ".join(crops_d) + ".")
                st.markdown("**What to check next:** " + alerts.SAFE_STEPS)
                msg = alerts.sms(r)
                if msg:
                    st.markdown("**SMS preview (English)**")
                    st.code(msg, language=None)
                    st.caption(f"{len(msg)} characters. Kinyarwanda text must be added and reviewed by a native speaker "
                               "(see `src/alerts.py`).")
            st.dataframe(al[["district", "icon", "label", "rain_mm", "normal_mm", "pct_of_normal", "k_dry"]].rename(columns={
                "district": "District", "icon": "", "label": "Level", "rain_mm": "Rain (mm)", "normal_mm": "Normal (mm)",
                "pct_of_normal": "% of normal", "k_dry": "Baseline years as dry"}).sort_values("% of normal").round(0),
                hide_index=True, width="stretch")
        st.caption("Rules (team-set, to be reviewed with agronomists): below 85% of normal = watch, below 60% = warning, "
                   "140% or more = wet watch. In 2017–2024 about one in five district-seasons would have been a watch and none "
                   "a warning at whole-season scale. Monitoring of past rainfall, not a forecast; low rainfall is not shown as a "
                   "cause of low yields (see About).")

# ------------------------------------------------------------------ 1c. My next action
with tab7:
    st.markdown("**From warning to next step.** Pick a district, your crop and planting stage. Musaruro explains the rainfall signal, "
                "lists **checks to discuss with an agronomist**, shows **evidence about crops** already grown in the district (not "
                "a recommendation to switch), and previews an SMS. Every suggestion is labelled for what it is.")
    if not rw.baseline_ready(D["rain"]):
        st.info("The rainfall baseline is not loaded, so this page is unavailable.")
    else:
        c1, c2, c3, c4 = st.columns(4)
        n_dist = c1.selectbox("District", DISTRICTS, index=DISTRICTS.index("Huye"), key="na_dist")
        c2.markdown(f"**{season_name(SEL_S, SEL_Y)}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
        main_crops = ["Maize", "Bush bean", "Climbing bean", "Soybean", "Sorghum", "Irish potato", "Sweet potato", "Cassava",
                      "Paddy rice", "Wheat", "Vegetables"]
        n_crop = c3.selectbox("Crop you plan or grow", main_crops, key="na_crop")
        n_stage = c4.selectbox("Planting stage", advisor.STAGES, key="na_stage")
        n_s, n_y = SEL_S, SEL_Y
        nal = alerts.build(D["rain"], D["sow"], n_s, n_y, "season")
        nrow = nal[nal.district == n_dist]
        if nrow.empty:
            st.info("No rainfall observed yet for this period.")
        else:
            r = nrow.iloc[0]
            lastm = D["rain"].sort_values(["year", "month"]).iloc[-1]
            # 1. what is happening
            st.subheader("1. What is happening")
            if r.level == "none":
                st.success(f"{r.icon} {r.label}: {alerts.explain(r)}")
            elif r.level in ("watch", "warning", "wet"):
                st.warning(f"{r.icon} {r.label}: {alerts.explain(r)}")
            else:
                st.info(alerts.explain(r))
            st.caption("This is district-level past rainfall, not a forecast and not a measure of damage to your field.")
            r2 = r.copy(); r2["window_text"] = alerts.window_text(r.window_months)
            src = advisor.explain_source(r2, f"{int(lastm.year)}-{int(lastm.month):02d}")
            src["Months observed in this window"] = f"{int(r.months_used)} of {int(r.months_total)}"
            with st.expander("Source, period and limits of this indicator"):
                st.table(pd.Series(src, name="").to_frame())
            # 2. checks
            st.subheader(f"2. What to check ({n_stage.lower()})")
            ch = advisor.checks(r.level, n_stage)
            if not ch:
                st.write("No rainfall alert for this period, so no rainfall-specific action. Keep following normal local guidance.")
            for i, c in enumerate(ch, 1):
                with st.container(border=True):
                    st.markdown(f"**{i}. {c['action']}**")
                    st.caption(f"Why: {c['why']}")
            if ch:
                st.caption(advisor.PRELIM + ". Not verified guidance.")
            # 3. crop evidence
            st.subheader("3. Crops in this district: evidence, not a recommendation")
            ev = advisor.crop_evidence(D["crop"], D["sow"], n_dist, n_s, n_crop)
            ev = ev[ev.enough_area].head(8)
            st.write(f"Usual sowing months in {n_dist}, Season {n_s}: **{advisor.usual_sowing(D['sow'], n_dist, n_s)}**.")
            show = ev.rename(columns={"crop": "Crop", "harvested_ha": "Harvested (ha)", "share_pct": "Share of area (%)",
                                      "yield_kg_ha": "Yield (kg/ha)", "yield_vs_national_pct": "vs its national yield (%)",
                                      "verdict": "Verdict", "planned": "Your crop"})[
                ["Crop", "Your crop", "Harvested (ha)", "Share of area (%)", "Yield (kg/ha)", "vs its national yield (%)", "Verdict"]]
            st.dataframe(show.round(0), hide_index=True, width="stretch")
            st.caption("Shows what farmers here already grow and how each crop does against its own national average (2026 survey). "
                       "Yields in kg/ha cannot be compared between crops. It does not say which crop to plant: soil, altitude, "
                       "remaining planting time, seed availability and prices are not in our data, so every row needs local agronomist review.")
            # 4. SMS
            st.subheader("4. SMS preview and simulation")
            lang = st.radio("Language", ["en", "rw"], format_func=lambda x: "English" if x == "en" else "Kinyarwanda (needs review)",
                            horizontal=True, key="na_lang")
            default = alerts.sms(r, lang) or ""
            if lang == "rw" and not default:
                st.info("There is no reviewed Kinyarwanda template yet. Write one below and confirm a native speaker reviewed it.")
            if not default and lang == "en":
                st.info("No alert for this period, so no message is generated.")
            text = st.text_area("Message (editable)", default, key=f"na_text_{lang}_{n_dist}_{SEL_S}{SEL_Y}", height=90)
            li = sms_service.length_info(text)
            st.caption(f"{li['chars']} characters · {li['note']}")
            grp = st.selectbox("Recipient group", ["(choose)"] + sms_service.GROUPS, key="na_group")
            consent = st.checkbox("I confirm recipients in this group agreed to receive these messages", key="na_consent")
            reviewed = True
            if lang == "rw":
                reviewed = st.checkbox("A native Kinyarwanda speaker reviewed this text", key="na_rw_ok")
            if "sms_hist" not in st.session_state:
                st.session_state.sms_hist = []
            if st.button("Simulate sending", key="na_send"):
                errs = sms_service.validate(text, grp, consent, reviewed, lang)
                if errs:
                    for e in errs:
                        st.error(e)
                else:
                    res = sms_service.get_provider().send(text, grp)
                    sms_service.record(st.session_state.sms_hist, n_dist, grp, r.level, text, res, lang)
                    st.warning(f"{res.status}. {res.detail}")
            st.caption("Simulation mode: no SMS gateway is connected and no phone numbers are collected. Nothing is delivered.")
            if st.session_state.sms_hist:
                hd = pd.DataFrame(st.session_state.sms_hist)
                st.dataframe(hd, hide_index=True, width="stretch")
            # 5. follow-up
            st.subheader("5. Follow-up record (demo)")
            with st.form("na_follow"):
                f1, f2 = st.columns(2)
                got = f1.selectbox("Warning received and understood?", ["Yes", "Partly", "No", "Not known"])
                did = f2.selectbox("Action taken?", ["Yes", "Partly", "No", "Not known"])
                adv = f1.selectbox("Asked an agronomist?", ["Yes", "No", "Not known"])
                note = f2.text_input("Observation or feedback (optional)")
                ok = st.form_submit_button("Save demo record")
            if "follow" not in st.session_state:
                st.session_state.follow = []
            if ok:
                st.session_state.follow.append(dict(district=n_dist, period=season_name(SEL_S, SEL_Y), level=r.level, received=got, action_taken=did,
                                                    asked_agronomist=adv, note=note, record_type="DEMO (not real feedback)"))
            if st.session_state.follow:
                fd = pd.DataFrame(st.session_state.follow)
                st.dataframe(fd, hide_index=True, width="stretch")
                st.download_button("Download records (CSV)", fd.to_csv(index=False), "musaruro_followup_demo.csv", "text/csv")
            st.caption("Demo mode: records exist only in this browser session and are not stored on a server. They show how follow-up "
                       "would work; they are not evidence that alerts help farmers.")

# ------------------------------------------------------------------ 2. Priority districts (officer view)
with tabx(tab2):
    need_survey()
    st.markdown("Which districts to look at first? The score ranks districts on **how far yields fall below the national "
                "average** and **how rarely farmers use improved seed**. Rainfall is not in the score (see About).")
    c1, c2 = st.columns([1, 2])
    pick = c1.radio("Season", ["A", "B", "Both (average)"], index=["A", "B"].index(SEL_S), horizontal=True, key=f"p_season_{SEL_S}")
    wy = c2.slider("Weight on yield gap (the rest goes to improved seed)", 0, 100, 50, 10, format="%d%%")
    di = add_priority(D["dist"], w_yield=wy, w_seed=100 - wy)
    if pick == "Both (average)":
        agg = di.groupby(["district", "province"], as_index=False).agg(
            priority_score=("priority_score", "mean"), total_shortfall_t=("total_shortfall_t", "sum"),
            yield_shortfall_idx=("yield_shortfall_idx", "mean"), farmers_improved_pct=("farmers_improved_pct", "mean"))
    else:
        agg = di[di.season == pick][["district", "province", "priority_score", "total_shortfall_t",
                                     "yield_shortfall_idx", "farmers_improved_pct"]].copy()
    agg["rank"] = agg.priority_score.rank(ascending=False, method="min").astype(int)
    agg["segments"] = agg.district.map(SEG)
    agg = agg.sort_values("rank")

    m, b = st.columns([3, 2])
    m.plotly_chart(choropleth(agg, "priority_score", "Priority score", BLUE, zmin=0, zmax=100), width="stretch")
    top = agg.head(10).iloc[::-1]
    fig = go.Figure(go.Bar(x=top.priority_score, y=top.district, orientation="h", marker_color=C_DISTRICT, width=0.6,
                           hovertemplate="%{y}: %{x:.0f}<extra></extra>"))
    fig.update_layout(height=470, title="Top 10 by priority score", margin=dict(l=0, r=0, t=40, b=0),
                      xaxis=dict(range=[0, 100], title="Score (0–100)"), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
    b.plotly_chart(fig, width="stretch")

    st.subheader("Ranking table")
    show = agg[["rank", "district", "province", "priority_score", "yield_shortfall_idx", "farmers_improved_pct",
                "total_shortfall_t", "segments"]].copy()
    show.columns = ["Rank", "District", "Province", "Priority score", "Yield gap index", "Improved seed (% farmers)",
                    "Output at stake (t)", "Survey segments"]
    st.dataframe(show.round(1), hide_index=True, width="stretch")
    st.caption("Output at stake = tonnes gained if every crop matched the national yield (crops where the district is below "
               "average, 100 ha or more harvested). A comparison, not a forecast. Districts with fewer than 30 survey segments "
               "have noisier estimates.")

    st.subheader("Drill into a district")
    dd = st.selectbox("District", agg.district.tolist(), key="drill")
    dsea = "A" if pick == "Both (average)" else pick
    cd = D["crop"][(D["crop"].district == dd) & (D["crop"].season == dsea) & (D["crop"].shortfall_t > 0)] \
        .sort_values("shortfall_t", ascending=False).head(6)
    if len(cd):
        fig = go.Figure(go.Bar(x=cd.shortfall_t, y=cd.crop, orientation="h", marker_color=C_DISTRICT, width=0.6,
                               customdata=cd.yield_vs_national_pct,
                               hovertemplate="%{y}: %{x:,.0f} t (yield %{customdata:.0f}% vs national)<extra></extra>"))
        fig.update_layout(height=280, title=f"{dd}: where the output gap is largest ({SEASON_LABEL[dsea]})",
                          xaxis_title="Tonnes if national average were reached", yaxis=dict(autorange="reversed"),
                          margin=dict(l=0, r=0, t=40, b=0), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
        st.plotly_chart(fig, width="stretch")
    else:
        st.info("No crop with a comparable yield below the national average in this district and season.")

# ------------------------------------------------------------------ 2b. Action plan
with tabx(tab5):
    need_survey()
    st.markdown("From analysis to action: for a district and season, Musaruro lists **where the gap is, who does better, which "
                "practices differ, and what to check or try**. Findings come from the data. The *consider* lines are options to "
                "test with local agronomists, not proven causes.")
    c1, c2 = st.columns(2)
    a_season = SEL_S
    c1.markdown(f"**{SEASON_LABEL[a_season]}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
    top_d = D["dist"][D["dist"].season == a_season].sort_values("priority_score", ascending=False).district.tolist()
    a_dist = c2.selectbox("District (ordered by priority)", top_d, key="a_dist")
    shares = actions.practice_shares(D["cds"], D["prac"])
    seed_nat = D["seedcrop"].query("season == @a_season").set_index("crop").improved_seed_pct.to_dict()
    sa5 = rw.season_anomaly(D["rain"], a_season, SEL_Y).set_index("district")
    rs = sa5.loc[a_dist] if (rw.baseline_ready(D["rain"]) and sa5.loc[a_dist].months_available == sa5.loc[a_dist].months_in_window) else None
    fi = D["dist"].query("district == @a_dist and season == @a_season").farmers_improved_pct.iloc[0]
    items = actions.brief(a_dist, a_season, D["crop"], shares, seed_nat,
                          None if rs is None else rs.status, None if rs is None else rs.pct_of_normal,
                          int(SEG[a_dist]), None if pd.isna(fi) else fi)
    if not items:
        st.success("No yield gap against the national average on the main crops in this district and season.")
    for i, it in enumerate(items, 1):
        with st.container(border=True):
            st.markdown(f"**{i}. {it['topic']}**")
            st.markdown(f"**What the data shows:** {it['finding']}")
            st.markdown(f"**Consider:** {it['consider']}")
    st.download_button("Download this brief (Markdown)", actions.to_markdown(a_dist, a_season, items),
                       file_name=f"musaruro_{a_dist}_season{a_season}.md", mime="text/markdown")
    st.caption("Peer districts differ in altitude, soils and climate, so treat them as sources of questions, not targets. "
               "Practice shares are % of developed cropland (NISR Tables 9–10 / 7–8), approximate.")

# ------------------------------------------------------------------ 2c. Infrastructure (EnaGIS)
with tab8:
    st.markdown("**Agriculture, climate and infrastructure in one district view.** Musaruro (yield gaps from NISR SAS 2026, rainfall "
                "from CHIRPS) is shown next to **EnaGIS** (Team Dynamis): candidate storage, cooling, milling and drying sites, and "
                "estimated electricity needs. Each side keeps its own method and evidence label. **No combined score**, and neither "
                "side is claimed to explain the other.")
    st.caption("This tab is not season-specific: infrastructure candidates come from EnaGIS (data gathered Oct 2026), and the agriculture and "
               "climate cards use the 2026 surveys and Season B 2026 rainfall whatever season is selected above.")
    egd, egc = D["eg_dist"], D["eg_chain"]
    prod = eb.production_2026(D["crop"], D["eg_prod"]).set_index("district")
    di8 = add_priority(D["dist"])
    i_dist = st.selectbox("District", DISTRICTS, index=DISTRICTS.index("Nyabihu"), key="in_dist")
    ov = eb.overview(i_dist, egc, egd)
    pa = di8[(di8.district == i_dist)].set_index("season")
    rk = {k: int(di8[di8.season == k].priority_score.rank(ascending=False, method="min")[di8[di8.season == k].district == i_dist].iloc[0])
          for k in ("A", "B")}
    top_gap = D["crop"][(D["crop"].district == i_dist) & (D["crop"].season == "A") & (D["crop"].shortfall_t > 0)] \
        .sort_values("shortfall_t", ascending=False).head(2)
    gap_txt = "; ".join(f"{r.crop} {abs(r.yield_vs_national_pct):.0f}% below national (about {r.shortfall_t:,.0f} t)"
                        for r in top_gap.itertuples()) or "none among the main crops"
    al8 = alerts.build(D["rain"], D["sow"], "B", 2026, "season")
    r8 = al8[al8.district == i_dist]
    clim = alerts.explain(r8.iloc[0]) if len(r8) else None
    clim_lab = f"{r8.iloc[0].icon} {r8.iloc[0].label}" if len(r8) else "n/a"

    c1, c2, c3 = st.columns(3)
    with c1.container(border=True):
        st.markdown("#### Agriculture (Musaruro)")
        st.metric("Priority rank, Season A / B (1 = highest)", f"{rk['A']} / {rk['B']}")
        st.caption(f"Largest yield gaps, Season A: {gap_txt}.")
        st.caption("Source: NISR SAS 2026. Observed survey estimate; small samples are noisy.")
    with c2.container(border=True):
        st.markdown("#### Climate (CHIRPS)")
        st.metric("Season B 2026 rainfall", clim_lab)
        st.caption(clim or "")
        st.caption("Past rainfall monitoring, not a forecast, and not evidence of road or field conditions.")
    with c3.container(border=True):
        st.markdown("#### Setting (EnaGIS)")
        d8 = ov["district"]
        st.metric("Documented facilities", int(d8["documented_sites"]))
        st.caption(f"Population {int(d8['population']):,} (WorldPop, OBSERVED) · buildings {int(d8['buildings']):,} · "
                   f"town and village points {int(d8['settlement_points'])}.")
        st.caption("Source: OpenStreetMap, Overture Maps, WorldPop; gathered 10 Oct 2026.")

    st.subheader("Infrastructure screening by value chain (EnaGIS)")
    t8 = egc[egc.district == i_dist][["chain", "ranked", "robust", "top_kwh_day", "site_1", "coverage", "siting_candidates"]].copy()
    t8.columns = ["Value chain", "Sites ranked", "Robust (of 10)", "Top site kWh/day [ESTIMATED]", "First site to check",
                  "Data coverage", "Look-alike sites to check [PREDICTED]"]
    st.dataframe(t8.round(0), hide_index=True, width="stretch")
    st.caption("These are candidate locations to investigate by phone or site visit, not confirmed facilities or investments. kWh/day is "
               "an estimate from stated assumptions, not measured use. Field verification count: 0.")

    st.subheader("Production, by survey year (shown separately)")
    if i_dist in prod.index:
        pr = prod.loc[i_dist]
        pc1, pc2 = st.columns(2)
        pc1.metric("Potato, SAS 2026 (A+B, Musaruro)", f"{pr.potato_t_2026:,.0f} t" if pd.notna(pr.potato_t_2026) else "unknown",
                   help="Observed NISR survey estimate")
        pc1.metric("Maize, SAS 2026 (A+B, Musaruro)", f"{pr.maize_t_2026:,.0f} t" if pd.notna(pr.maize_t_2026) else "unknown")
        pc2.metric("Potato, 2024 estimate (EnaGIS input)", f"{pr.potato_t_2024:,.0f} t", help="ESTIMATED: SAS 2024 Season A shares scaled to national totals")
        pc2.metric("Maize, 2024 estimate (EnaGIS input)", f"{pr.maize_t_2024:,.0f} t")
        if bool(pr.yields_imputed):
            st.warning("EnaGIS imputed this district's yields because the survey table lacked them. Treat its production inputs with care.")
        st.caption("EnaGIS ranks sites using the 2024-based estimate. We show Musaruro's 2026 survey figures beside it for context; "
                   "re-running EnaGIS with 2026 inputs needs its own data pipeline and an internet connection.")
    brief_md = eb.to_markdown(
        i_dist, ov,
        {"Priority rank (1 = highest), Season A / B": f"{rk['A']} / {rk['B']}", "Largest yield gaps, Season A": gap_txt},
        (f"{clim_lab}: {clim}" if clim else None), prod.loc[i_dist] if i_dist in prod.index else None)
    st.download_button("Download district brief (Markdown)", brief_md, file_name=f"musaruro_enagis_{i_dist}.md", mime="text/markdown")

    st.subheader("All districts side by side")
    sb = di8[di8.season == "A"][["district", "province", "priority_score"]].rename(columns={"priority_score": "Priority A"}).merge(
        di8[di8.season == "B"][["district", "priority_score"]].rename(columns={"priority_score": "Priority B"}), on="district")
    sb = sb.merge(al8[["district", "label", "pct_of_normal"]].rename(columns={"label": "Rainfall B 2026", "pct_of_normal": "% of normal"}),
                  on="district", how="left")
    sb = sb.merge(egd[["district", "documented_sites", "population"]], on="district")
    pc = egc[egc.chain == "Potato cold storage"][["district", "robust", "top_kwh_day"]].rename(
        columns={"robust": "Potato storage robust", "top_kwh_day": "Potato storage kWh/day"})
    mm = egc[egc.chain == "Maize milling"][["district", "top_kwh_day"]].rename(columns={"top_kwh_day": "Maize milling kWh/day"})
    sb = sb.merge(pc, on="district").merge(mm, on="district")
    f1, f2 = st.columns(2)
    lv = f1.multiselect("Rainfall status (B 2026)", sorted(sb["Rainfall B 2026"].dropna().unique()), key="in_lv")
    top_only = f2.checkbox("Only districts in the top 10 on Musaruro priority (Season A)", key="in_top")
    if lv:
        sb = sb[sb["Rainfall B 2026"].isin(lv)]
    if top_only:
        sb = sb[sb["Priority A"].rank(ascending=False, method="min") <= 10]
    sb = sb.rename(columns={"district": "District", "province": "Province", "documented_sites": "Documented facilities",
                            "population": "Population"})
    st.dataframe(sb.round(0).sort_values("Priority A", ascending=False), hide_index=True, width="stretch")
    st.caption("Click a column heading to sort. Use the filters to find districts that appear on several lists, then investigate; "
               "the table does not rank districts overall. Priority scores are Musaruro's (yield gap and improved-seed use). kWh/day are "
               "EnaGIS estimates for the top-ranked site only.")

    st.subheader("EnaGIS Live, embedded")
    st.markdown("Search a district (for example \"Musanze District, Rwanda\") to gather open data and rank sites. Searching needs an "
                "internet connection and takes about a minute. The **Nyabihu · Irish potato cold storage** featured analysis opens offline.")
    st.components.v1.iframe("app/static/enagis-live/index.html", height=820)
    st.markdown("[Open EnaGIS Live in its own tab](app/static/enagis-live/index.html) · "
                "[EnaGIS on GitHub](https://github.com/Elie1Z/EnaGIS)")
    st.caption("EnaGIS by Team Dynamis, MIT licence. Data: © OpenStreetMap contributors (ODbL), Overture Maps Foundation, WorldPop (CC BY 4.0), "
               "Open-Meteo (CC BY 4.0), NISR. EnaGIS was submitted to OSEAS 2026 (Assessment and Mapping of Productive Uses of Energy); "
               "it is reused here by its authors, who are part of this team.")

# ------------------------------------------------------------------ 3. Rainfall watch
with tab3:
    rain = D["rain"]
    ready = rw.baseline_ready(rain)
    last = rain.sort_values(["year", "month"]).iloc[-1]
    st.markdown(f"Satellite rainfall (CHIRPS v3, ~5 km) averaged over each district. Latest month: "
                f"**{int(last.year)}-{int(last.month):02d}**. This is monitoring, not a forecast, and monthly totals "
                "cannot show dry spells inside a month.")
    if not ready:
        st.info("Normal rainfall (2016–2024 baseline) is not loaded yet, so this page shows rainfall in millimetres only. "
                "Add the baseline files and re-run `src/climate.py` to see % of normal.")
    c1, c2 = st.columns(2)
    s3 = SEL_S
    c1.markdown(f"**{season_name(SEL_S, SEL_Y)}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
    d3 = c2.selectbox("District", DISTRICTS, index=DISTRICTS.index("Musanze"), key="r_dist")
    sa = rw.season_anomaly(rain, s3, SEL_Y)
    mo = int(sa.months_available.iloc[0])
    full = mo == int(sa.months_in_window.iloc[0])
    if not full:
        st.warning(f"Only {mo} of {int(sa.months_in_window.iloc[0])} months of this season are loaded; totals are partial.")

    m, b = st.columns([3, 2])
    if ready and full:
        m.plotly_chart(choropleth(sa, "pct_of_normal", "% of normal", DIVERGING, zmid=100, zmin=40, zmax=160,
                                  fmt_hover="%{z:.0f}%"), width="stretch")
    else:
        m.plotly_chart(choropleth(sa, "rain_mm", "Season rain (mm)", BLUE, fmt_hover="%{z:,.0f} mm"), width="stretch")

    mrow = rain[rain.district == d3].copy()
    pairs = rw.season_year_months(s3, SEL_Y)
    mrow = mrow[[(y, mm) in pairs for y, mm in zip(mrow.year, mrow.month)]]
    mrow["lab"] = [pd.Timestamp(year=y, month=mm, day=1).strftime("%b %Y") for y, mm in zip(mrow.year, mrow.month)]
    fig = go.Figure(go.Bar(x=mrow.lab, y=mrow.rain_mm, name=d3, marker_color=C_DISTRICT, width=0.4,
                           hovertemplate="%{x}: %{y:,.0f} mm<extra>" + d3 + "</extra>"))
    if ready:
        nm = rw.baseline_normals(rain).query("district == @d3").set_index("month").normal_mm
        fig.add_scatter(x=mrow.lab, y=[nm.get(mm) for mm in mrow.month], name="Normal 2016–2024", mode="lines+markers",
                        line=dict(color=C_NATIONAL, width=2), marker=dict(size=8),
                        hovertemplate="%{x}: normal %{y:,.0f} mm<extra></extra>")
    fig.update_layout(height=470, title=f"{d3}: monthly rainfall", yaxis_title="mm per month", margin=dict(l=0, r=0, t=40, b=0),
                      legend=dict(orientation="h", y=-0.12), paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)")
    b.plotly_chart(fig, width="stretch")

    if ready:
        st.caption(f"Normal = average of the same months in {int(sa.baseline_years.iloc[0])} baseline years (2016–2024; Season A "
                   "needs September of the year before, so 2016 is missing there). % of normal is unstable in very dry months "
                   "(June–August), which is why the seasons are shown as whole windows.")
    st.subheader("District table")
    t = sa[["district", "rain_mm", "normal_mm", "pct_of_normal", "status", "icon"]].copy()
    t["Status"] = t.icon + " " + t.status
    t = t.drop(columns=["status", "icon"]).sort_values("pct_of_normal" if ready else "rain_mm")
    t.columns = ["District", "Season rain (mm)", "Normal (mm)", "% of normal", "Status"]
    st.dataframe(t.round(0), hide_index=True, width="stretch")

# ------------------------------------------------------------------ 4. About

# ------------------------------------------------------------------ 9. Crops nationwide
@st.cache_data
def _dry_exposure():
    return pd.concat([irg.dry_exposure(D["rain"], k) for k in ("A", "B")])


def full_map_df(df, col):
    base = pd.DataFrame({"district": DISTRICTS})
    return base.merge(df[["district", col]], on="district", how="left")


with tabx(tab9):
    need_survey()
    st.markdown("**One crop, every district.** Pick a crop to see where it is grown, how much, and how its yield compares with the "
                "national yield (NISR Seasonal Agricultural Survey 2026).")
    c1, c2, c3 = st.columns([1, 1.4, 1.4])
    cw_season = SEL_S
    c1.markdown(f"**{SEASON_LABEL[cw_season]}**<br><small>change it in the season list at the top</small>", unsafe_allow_html=True)
    cw_groups = c2.checkbox("Include crop groups (all beans, cereals, tubers…)", value=False, key="cw_groups")
    crops_avail = cv.crop_list(D["cds"], cw_season, cw_groups)
    cw_crop = c3.selectbox("Crop", crops_avail, index=crops_avail.index("Bush bean") if "Bush bean" in crops_avail else 0,
                           key="cw_crop")
    cw_metric = st.radio("Show on the map", ["Harvested area (ha)", "Yield (kg/ha)", "Yield vs national (%)", "Share of national production (%)"],
                         horizontal=True, key="cw_metric")
    nt = cv.national_table(D["cds"], cw_season, cw_crop, D["nat"])
    col = {"Harvested area (ha)": "harvested_ha", "Yield (kg/ha)": "yield_kg_ha", "Yield vs national (%)": "yield_vs_national_pct",
           "Share of national production (%)": "production_share_pct"}[cw_metric]
    nat_row = D["nat"][(D["nat"].season == cw_season) & (D["nat"].crop == cw_crop)]
    k1, k2, k3, k4 = st.columns(4)
    k1.metric("Districts growing it", f"{len(nt)} of 30")
    k2.metric("Harvested nationally", f"{nt.harvested_ha.sum():,.0f} ha")
    k3.metric("National yield", f"{nat_row.yield_kg_ha.iloc[0]:,.0f} kg/ha" if len(nat_row) and pd.notna(nat_row.yield_kg_ha.iloc[0]) else "n/a")
    k4.metric("Top 5 districts hold", f"{cv.concentration(nt):.0f}% of the area" if len(nt) else "n/a")
    if col == "yield_vs_national_pct":
        mp = choropleth(full_map_df(nt, col), col, "Yield vs national (%)", DIVERGING, zmid=100, zmin=50, zmax=150, fmt_hover="%{z:.0f}%")
    else:
        mp = choropleth(full_map_df(nt, col), col, cw_metric, BLUE, fmt_hover="%{z:,.0f}")
    st.plotly_chart(mp, width="stretch")
    st.caption("Grey = the crop is not reported in that district. Yields on very small areas (under "
               f"{cv.MIN_AREA_HA} ha) are marked in the table and are not reliable.")
    top = nt.head(10)
    fig = go.Figure(go.Bar(x=top.harvested_ha[::-1], y=top.district[::-1], orientation="h", marker_color=C_DISTRICT,
                           hovertemplate="%{y}: %{x:,.0f} ha<extra></extra>"))
    fig.update_layout(title=f"{cw_crop}: 10 largest districts by harvested area, Season {cw_season} 2026", height=360,
                      margin=dict(l=0, r=10, t=40, b=0), xaxis_title="Harvested area (ha)", paper_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fig, width="stretch")
    tbl = nt[["district", "province", "harvested_ha", "area_share_pct", "yield_kg_ha", "yield_vs_national_pct", "production_mt", "thin"]].copy()
    tbl["thin"] = tbl.thin.map({True: "very small area", False: ""})
    st.dataframe(tbl.rename(columns={"harvested_ha": "Harvested ha", "area_share_pct": "% of national area", "yield_kg_ha": "Yield kg/ha",
                                     "yield_vs_national_pct": "Yield vs national %", "production_mt": "Production (t)", "thin": "Note"}),
                 hide_index=True, width="stretch",
                 column_config={"Harvested ha": st.column_config.NumberColumn(format="%.0f"),
                                "% of national area": st.column_config.NumberColumn(format="%.1f"),
                                "Yield kg/ha": st.column_config.NumberColumn(format="%.0f"),
                                "Yield vs national %": st.column_config.NumberColumn(format="%.0f"),
                                "Production (t)": st.column_config.NumberColumn(format="%.0f")})
    st.download_button("Download this table (CSV)", tbl.to_csv(index=False).encode(), f"musaruro_{cw_crop.replace(' ', '_')}_{cw_season}.csv",
                       "text/csv", key="cw_dl")
    with st.expander("Looking for coffee, tea or other export crops?"):
        st.markdown("**Coffee and tea are not in the NISR files this app uses.** The Seasonal Agricultural Survey covers seasonal crops; "
                    "coffee and tea are permanent crops, and the tables we have report them only inside one combined "
                    "*permanent crops* area per district. We do not guess at district coffee figures. The map below shows that "
                    "combined area (it includes banana, coffee, tea and others), so it points to where permanent-crop land is, "
                    "**not** where coffee is. District coffee data would need a source such as the National Agriculture Export "
                    "Development Board (NAEB) or a NISR permanent-crops table.")
        lu = D["land"][(D["land"].season == "A") & (D["land"].district != "National")]
        st.plotly_chart(choropleth(full_map_df(lu, "permanent_crops_kha"), "permanent_crops_kha",
                                   "Permanent crops (000 ha)", BLUE, fmt_hover="%{z:.1f}"), width="stretch")

# ------------------------------------------------------------------ 10. Irrigation & soil
with tabx(tab10):
    need_survey()
    st.markdown("**Small-scale irrigation and soil care, district by district.** Built from NISR SAS 2026 (who irrigates, how, and "
                "from what water source), CHIRPS rainfall (how often seasons were clearly dry) and AHS 2024 (why plots are not irrigated). "
                "This is a **screening aid**: it shows where irrigation is rare and dry seasons are common, so a field visit or "
                "water-source survey is a sensible next step. It does not say irrigation will raise yields.")
    ir_season = SEL_S
    st.markdown(f"**{SEASON_LABEL[ir_season]}**")
    shares = actions.practice_shares(D["cds"], D["prac"])
    scr = irg.screen(D["irr"], shares, _dry_exposure(), ir_season)
    cA, cB = st.columns([1.15, 1])
    with cA:
        st.plotly_chart(choropleth(scr, "farmers_irrigating_pct", "Farmers who irrigate (%)", BLUE, fmt_hover="%{z:.0f}%"),
                        width="stretch")
    with cB:
        flagged = scr[scr.check_first]
        st.markdown(f"##### Check first ({len(flagged)} district{'' if len(flagged) == 1 else 's'})")
        st.caption(f"Fewer than {irg.LOW_USE_PCT:.0f}% of farmers irrigate **and** at least {irg.DRY_YEARS_FLAG} of the seasons "
                   f"2016–2024 had rainfall below {irg.DRY_PCT}% of normal (CHIRPS satellite estimate).")
        if len(flagged):
            st.dataframe(flagged[["district", "farmers_irrigating_pct", "dry_seasons", "seasons_checked", "driest_pct"]].rename(
                columns={"farmers_irrigating_pct": "Farmers irrigating %", "dry_seasons": "Clearly dry seasons",
                         "seasons_checked": "Seasons checked", "driest_pct": "Driest season, % of normal"}),
                hide_index=True, width="stretch",
                column_config={"Farmers irrigating %": st.column_config.NumberColumn(format="%.1f"),
                               "Driest season, % of normal": st.column_config.NumberColumn(format="%.0f")})
        else:
            st.info("No district meets both conditions in this season.")
    with st.expander("All 30 districts"):
        st.dataframe(scr.drop(columns=["low_use", "often_dry"]).rename(columns={
            "farmers_irrigating_pct": "Farmers irrigating %", "farmers_irrigating_pct_ssf": "…small-scale farmers %",
            "irrigated_pct": "Cropland irrigated %", "dry_seasons": "Clearly dry seasons", "seasons_checked": "Seasons checked",
            "driest_pct": "Driest season % of normal", "check_first": "Check first"}), hide_index=True, width="stretch")

    st.markdown("##### One district: how farmers irrigate and where the water comes from")
    ir_d = st.selectbox("District", DISTRICTS, index=DISTRICTS.index("Ngoma"), key="ir_d")
    row = D["irr"][(D["irr"].season == ir_season) & (D["irr"].district == ir_d)].iloc[0]
    sr = scr[scr.district == ir_d].iloc[0]
    m1, m2, m3 = st.columns(3)
    m1.metric("Farmers who irrigate", f"{row.farmers_irrigating_pct:.1f}%")
    m2.metric("Cropland irrigated", f"{sr.irrigated_pct:.1f}%" if pd.notna(sr.irrigated_pct) else "n/a")
    m3.metric("Clearly dry seasons since 2016", f"{int(sr.dry_seasons)} of {int(sr.seasons_checked)}")
    t_lab = {"surface": "Surface", "flood": "Flood", "drip": "Drip", "sprinkler": "Sprinkler", "pivot": "Pivot", "traditional": "Traditional"}
    s_lab = {"rainwater": "Rainwater", "treatment_plant": "Treatment plant", "underground": "Underground", "lake_stream": "Lake / stream",
             "catchment": "Water catchment", "other_source": "Other"}
    g1, g2 = st.columns(2)
    for g, pre, lab, ttl in ((g1, "tech_", t_lab, "Irrigation technique (% of irrigated plots)"),
                             (g2, "src_", s_lab, "Water source (% of irrigated plots)")):
        vals = [row[pre + k] for k in lab]
        f = go.Figure(go.Bar(x=list(lab.values()), y=vals, marker_color=C_DISTRICT, hovertemplate="%{x}: %{y:.0f}%<extra></extra>"))
        f.update_layout(title=ttl, height=300, margin=dict(l=0, r=0, t=40, b=0), yaxis_title="%", paper_bgcolor="rgba(0,0,0,0)")
        g.plotly_chart(f, width="stretch")
    st.caption(irg.SMALL_SAMPLE_NOTE + " Treat shares as indications.")

    st.markdown("##### Why plots are not irrigated (AHS 2024, by province)")
    aw = D["ahsw"].copy()
    fw = go.Figure()
    for k, lab, colr in (("not_irrigated_not_needed_pct", "Not needed", "#9ec5f4"), ("not_irrigated_cannot_afford_pct", "Cannot afford", "#256abf"),
                         ("not_irrigated_no_water_pct", "No water available", "#e34948"), ("plots_irrigated_pct", "Irrigated", "#0d366b")):
        fw.add_bar(x=aw.province, y=aw[k], name=lab, marker_color=colr, hovertemplate="%{x}: %{y:.1f}%<extra>" + lab + "</extra>")
    fw.update_layout(barmode="stack", height=340, margin=dict(l=0, r=0, t=10, b=0), yaxis_title="% of plots",
                     legend=dict(orientation="h", y=-0.15), paper_bgcolor="rgba(0,0,0,0)")
    st.plotly_chart(fw, width="stretch")
    east = aw[aw.province == "East"].iloc[0]
    st.caption(f"In the Eastern Province {east.not_irrigated_no_water_pct:.0f}% of plots are not irrigated because no water is available, "
               f"against {aw[aw.province == 'Rwanda'].iloc[0].not_irrigated_no_water_pct:.0f}% nationally. That points to water supply, "
               "not only cost, as the limit where dry seasons are most frequent.")

    st.markdown("##### Pump and solar sizing sketch")
    st.caption("A back-of-envelope estimate (ESTIMATED), using the same solar sizing rule as EnaGIS: kWh per day ÷ (peak sun hours × "
               "performance ratio). It ignores pipe losses, storage and water-use rights. Change every input to match the site; "
               "EnaGIS Live (Infrastructure tab) shows mapped power lines for site-level supply.")
    p1, p2, p3, p4, p5 = st.columns(5)
    a_ha = p1.number_input("Area to irrigate (ha)", 0.05, 50.0, 1.0, 0.05, key="pm_area")
    dmm = p2.number_input("Water per day (mm)", 1.0, 12.0, 5.0, 0.5, key="pm_mm", help="Crop water need is crop- and season-specific; ask an agronomist.")
    hd = p3.number_input("Lift height (m)", 1.0, 150.0, 20.0, 1.0, key="pm_head")
    ef = p4.number_input("Pump efficiency", 0.2, 0.8, 0.5, 0.05, key="pm_eff")
    sun = p5.number_input("Peak sun hours/day", 2.0, 7.0, 4.5, 0.1, key="pm_sun", help="Use the darkest-month value for dry-season reliability.")
    ps = irg.pump_sketch(a_ha, dmm, hd, ef, sun)
    q1, q2, q3 = st.columns(3)
    q1.metric("Water per day", f"{ps['m3_day']:,.0f} m³")
    q2.metric("Pump energy", f"{ps['kwh_day']:.1f} kWh/day")
    q3.metric("Solar array (central)", f"{ps['kwp']:.1f} kWp",
              help=f"Performance ratio {irg.PV_PERFORMANCE_RATIO['central']} (EnaGIS range {irg.PV_PERFORMANCE_RATIO['low']}–{irg.PV_PERFORMANCE_RATIO['high']}).")

    st.divider()
    st.markdown("#### Soil care and fertility")
    st.caption("Share of cropland receiving inorganic or organic fertilizer (NISR SAS 2026, area under fertilizer ÷ developed cropland) and "
               "the soil threats households report (AHS 2024). Shown side by side; neither is claimed to explain yields.")
    sf_kind = st.radio("Map", ["Inorganic fertilizer (% of cropland)", "Organic fertilizer (% of cropland)"], horizontal=True, key="sf_kind")
    sf_col = "inorganic_fert_pct" if sf_kind.startswith("Inorganic") else "organic_fert_pct"
    sh_s = shares[(shares.season == ir_season) & (shares.district != "National")]
    st.plotly_chart(choropleth(full_map_df(sh_s, sf_col), sf_col, sf_kind, BLUE, fmt_hover="%{z:.0f}%"), width="stretch")
    ss = D["ahss"]
    pivot = ss.pivot_table(index="threat", columns="province", values="pct_households")[["Kigali", "South", "West", "North", "East", "Rwanda"]]
    st.dataframe(pivot.round(1), width="stretch")
    st.caption("% of agricultural households reporting each soil threat, AHS 2024. Households could report more than one threat.")

with tab4:
    st.subheader("How Musaruro covers the Track 1 hints")
    st.dataframe(pd.DataFrame([
        ("Agricultural productivity", "Covered", "Yield gaps, priority districts, crop-by-district view, action plan", "Benchmark is the national average, not potential yield"),
        ("Small-scale irrigation", "Covered (screening)", "Irrigation tab: who irrigates, techniques, water sources, dry-season frequency, pump and solar sizing sketch", "No slope, soil or water-source map, so it cannot say where irrigation is feasible"),
        ("Soil conservation and fertility", "Partly", "Fertilizer share of cropland, soil threats reported by households, action plan", "No soil tests; erosion data only as hectares and province shares"),
        ("Post-harvest collection and storage", "Partly", "EnaGIS candidate storage, cooling and drying sites with energy estimates", "No post-harvest loss data; sites are candidates to check"),
        ("Processing and value addition", "Partly", "EnaGIS milling and drying candidates and energy needs", "No price or market data"),
        ("Export market opportunities", "Not covered", "Gap stated in the Crops tab (coffee, tea)", "The NISR files used have no export or permanent-crop district data"),
    ], columns=["Hint", "Status", "Where in Musaruro", "Limit"]), hide_index=True, width="stretch")
    st.markdown("""
### Where the numbers come from
- **NISR Seasonal Agricultural Survey 2026**, Season A and B: area, harvested area, yield, production, improved-seed use, by district and crop.
- **CHIRPS v3** monthly rainfall (Climate Hazards Center, UC Santa Barbara) and **geoBoundaries** district boundaries.
- **NISR Agricultural Household Survey 2024**: why plots are not irrigated, irrigation water sources and soil threats, by province.
- **EnaGIS** (Team Dynamis, MIT licence): candidate storage, cooling, milling and drying sites and estimated energy needs for all 30 districts, built on OpenStreetMap and Overture Maps (ODbL), WorldPop and Open-Meteo (CC BY 4.0). Shown in the Infrastructure tab with its own evidence labels; Musaruro does not recompute it.
- Every figure traces to an NISR table; nothing is imputed. See `docs/DATA_NOTES.md`.

### How the priority score works
Districts are ranked (percentile) on a **yield gap index** (area-weighted shortfall against the national yield, crops with 100 ha or
more harvested) and on a **seed gap** (100 minus % of farmers using improved seed). The score is the weighted average of the two ranks;
you can change the weights.

### What Musaruro does **not** claim
- It does not claim improved seed, or any single input, *causes* higher yields. Beans show about 0.5% improved-seed use nationally, so seed cannot explain bean yield differences.
- The national average is a benchmark, not potential yield. Altitude, soils and rainfall legitimately differ between districts.
- District estimates come from small samples (20–68 survey segments per district): signals, not exact values.
- Rainfall is **not** in the priority score. We tested district rainfall against district yields and found no consistent link.
- Output at stake is a comparison with the national average, not a forecast.
- EnaGIS sites are candidates to check, not confirmed facilities; its kWh/day figures are estimates, and its production inputs are 2024-based estimates. Yields, rainfall and infrastructure are shown side by side, never combined into one score or used to explain each other.
""")
    st.subheader("Data quality issues found in the NISR tables")
    st.dataframe(D["dq"], hide_index=True, width="stretch")
    st.caption("Season windows used for rainfall (assumption): A = Sep–Jan, B = Feb–Jun. Boundaries: geoBoundaries gbOpen (attribution required). "
               "Built with AI assistance (Claude, Anthropic); see `docs/AI_USE_LOG.md`.")
