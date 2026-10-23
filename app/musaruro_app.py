"""Musaruro - Know your yield, act in time.  Run: streamlit run app/musaruro_app.py

Reads only data/processed/*.csv and data/raw/boundaries/rwa_adm2.geojson (built by src/).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
import actions  # noqa: E402
import alerts  # noqa: E402
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
                seedcrop=r("improved_seed_crop_national.csv"), sow=r("sowing_month_district.csv"))


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
tab1, tab6, tab2, tab5, tab3, tab4 = st.tabs(
    ["My district", "Alerts", "Priority districts", "Action plan", "Rainfall watch", "About the data"])

# ------------------------------------------------------------------ 1. My district (farmer view)
with tab1:
    c1, c2, c3 = st.columns(3)
    district = c1.selectbox("District", DISTRICTS, index=DISTRICTS.index("Musanze"))
    season = c2.radio("Season", ["A", "B"], format_func=lambda s: SEASON_LABEL[s], horizontal=True)
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
        PERIODS = {"Season A 2027 so far": ("A", 2027), "Season B 2026 (last season)": ("B", 2026),
                   "Season A 2026": ("A", 2026)}
        c1, c2 = st.columns(2)
        per = c1.radio("Period", list(PERIODS), horizontal=True, key="al_per")
        basis = c2.radio("Compare", ["Whole season", "Sowing window"], horizontal=True, key="al_basis")
        a_s, a_y = PERIODS[per]
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
                if crops_d:
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

# ------------------------------------------------------------------ 2. Priority districts (officer view)
with tab2:
    st.markdown("Which districts to look at first? The score ranks districts on **how far yields fall below the national "
                "average** and **how rarely farmers use improved seed**. Rainfall is not in the score (see About).")
    c1, c2 = st.columns([1, 2])
    pick = c1.radio("Season", ["A", "B", "Both (average)"], horizontal=True, key="p_season")
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
with tab5:
    st.markdown("From analysis to action: for a district and season, Musaruro lists **where the gap is, who does better, which "
                "practices differ, and what to check or try**. Findings come from the data. The *consider* lines are options to "
                "test with local agronomists, not proven causes.")
    c1, c2 = st.columns(2)
    a_season = c1.radio("Season", ["A", "B"], format_func=lambda s: SEASON_LABEL[s], horizontal=True, key="a_season")
    top_d = D["dist"][D["dist"].season == a_season].sort_values("priority_score", ascending=False).district.tolist()
    a_dist = c2.selectbox("District (ordered by priority)", top_d, key="a_dist")
    shares = actions.practice_shares(D["cds"], D["prac"])
    seed_nat = D["seedcrop"].query("season == @a_season").set_index("crop").improved_seed_pct.to_dict()
    sa5 = rw.season_anomaly(D["rain"], a_season, YEAR).set_index("district")
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
    s3 = c1.radio("Season", ["A", "B"], format_func=lambda s: SEASON_LABEL[s], horizontal=True, key="r_season")
    d3 = c2.selectbox("District", DISTRICTS, index=DISTRICTS.index("Musanze"), key="r_dist")
    sa = rw.season_anomaly(rain, s3, YEAR)
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
    pairs = rw.season_year_months(s3, YEAR)
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
with tab4:
    st.markdown("""
### Where the numbers come from
- **NISR Seasonal Agricultural Survey 2026**, Season A and B: area, harvested area, yield, production, improved-seed use, by district and crop.
- **CHIRPS v3** monthly rainfall (Climate Hazards Center, UC Santa Barbara) and **geoBoundaries** district boundaries.
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
""")
    st.subheader("Data quality issues found in the NISR tables")
    st.dataframe(D["dq"], hide_index=True, width="stretch")
    st.caption("Season windows used for rainfall (assumption): A = Sep–Jan, B = Feb–Jun. Boundaries: geoBoundaries gbOpen (attribution required). "
               "Built with AI assistance (Claude, Anthropic); see `docs/AI_USE_LOG.md`.")
