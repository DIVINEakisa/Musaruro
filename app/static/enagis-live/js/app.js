/* EnaGIS Live: interface. Search → gather (live) → analyze (engine.js) → respond (map, list, site card). */
(function () {
  "use strict";
  const C = window.EnaConfig, E = window.EnaEngine, SRC = window.EnaSources, W = window.ENA_WORLD;
  const OV = window.EnaOverture, IC = window.EnaIcons;
  const H = window.EnaHeroUI;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? "" : s).replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[c]));
  const fmt = E.fmt;
  const energyFmt = v => S.hero ? Math.round(v).toLocaleString("en") : fmt(v);
  const store = {
    get(k, d) { try { const v = localStorage.getItem("enagis-live:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("enagis-live:" + k, JSON.stringify(v)); } catch (e) { /* private mode */ } }
  };

  // Example districts on the start screen; "Save example districts" gathers them in advance.
  const HEROES = ["Musanze", "Nyabihu", "Rubavu", "Gicumbi", "Gatsibo", "Kirehe"];
  const S = {
    lens: "first", season: "dry", expert: store.get("expert", false), base: store.get("base2", "paper"),
    compare: false, compareBase: "satellite", model: store.get("model", "potato_storage"),
    phase: "idle", area: null, alternates: [], input: null, result: null, selected: null,
    steps: [], overrides: {}, perCap: {}, showAll: false, error: null, synthetic: false
  };

  // ------------------------------------------------------------------ basemaps
  const BASES = {
    paper: () => ({version: 8, name: "paper",
      sources: {world: {type: "geojson", data: W.countries, attribution: "Natural Earth (public domain)"}},
      layers: [{id: "bg", type: "background", paint: {"background-color": "#DCE6EA"}},
        {id: "land", type: "fill", source: "world", paint: {"fill-color": "#EFEBE2"}},
        {id: "borders", type: "line", source: "world", paint: {"line-color": "#B9B4A9", "line-width": 0.8}}]}),
    light: () => "https://tiles.openfreemap.org/styles/positron",
    streets: () => "https://tiles.openfreemap.org/styles/liberty",
    satellite: () => ({version: 8, name: "satellite",
      sources: {
        sat: {type: "raster", tileSize: 256, maxzoom: 19, attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"]},
        ref: {type: "raster", tileSize: 256, maxzoom: 19,
          tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"]}},
      layers: [{id: "sat", type: "raster", source: "sat"}, {id: "ref", type: "raster", source: "ref", paint: {"raster-opacity": 0.85}}]}),
    terrain: () => ({version: 8, name: "terrain",
      sources: {topo: {type: "raster", tileSize: 256, maxzoom: 17,
        attribution: "© OpenTopoMap (CC-BY-SA) · © OpenStreetMap contributors · SRTM",
        tiles: ["https://a.tile.opentopomap.org/{z}/{x}/{y}.png", "https://b.tile.opentopomap.org/{z}/{x}/{y}.png", "https://c.tile.opentopomap.org/{z}/{x}/{y}.png"]}},
      layers: [{id: "topo", type: "raster", source: "topo", paint: {"raster-saturation": -0.25}}]})
  };
  const BASE_NAMES = {paper: "Offline map", light: "Light", streets: "Streets", satellite: "Satellite", terrain: "Terrain"};

  // ------------------------------------------------------------------ map
  // Overture building footprints are drawn straight from the public PMTiles archive.
  let ovtProtocol = null;
  try { if (window.EnaTiles && OV) { ovtProtocol = new EnaTiles.Protocol(); maplibregl.addProtocol("pmtiles", ovtProtocol.tile); } } catch (e) { ovtProtocol = null; }
  if (navigator.onLine === false || new URLSearchParams(location.search).get("hero") === "offline") S.base = "paper";
  const map = new maplibregl.Map({container: "map", style: BASES[S.base](), center: [29.9, -1.95], zoom: 7.4,
    attributionControl: false, maxPitch: 0, dragRotate: false, pitchWithRotate: false});
  map.addControl(new maplibregl.AttributionControl({compact: true,
    customAttribution: "© OpenStreetMap contributors · Overture Maps · WorldPop · Open-Meteo (licences under Sources)"}), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({showCompass: false}), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({unit: "metric"}), "bottom-right");
  map.touchZoomRotate.disableRotation();
  let mapB = null, markers = [];
  let baseFailures = 0;
  map.on("error", (e) => {
    if (e && e.sourceId && /^ovt-/.test(e.sourceId)) return; // building footprints are optional
    // The basemap style itself could not be fetched (offline): fall back to the offline map at once.
    if (S.base !== "paper" && !map.getLayer("ena-sites") && e && e.error && /Failed to fetch|NetworkError|style|AJAXError/i.test(String(e.error.message || e.error))) {
      toast(`${BASE_NAMES[S.base]} map is not reachable (offline?). Using the offline map.`); setBase("paper"); return;
    }
    if (S.base !== "paper" && e && e.error && /tile|style|Failed to fetch|NetworkError/i.test(String(e.error.message || e.error))) {
      baseFailures++;
      if (baseFailures === 3) { toast(`${BASE_NAMES[S.base]} map tiles are not loading (offline?). Switched to the offline map.`); setBase("paper"); }
    }
  });
  map.on("style.load", () => { addOverlays(map, false); addOvt(map); applyLens(); });
  if (OV) OV.release().then(r => { S.ovtRelease = r; [map, mapB].forEach(m => { if (ready(m)) addOvt(m); }); applyLens(); });

  // Building footprints (OpenStreetMap + Google + Microsoft, merged by Overture) from zoom 14.
  function addOvt(m) {
    if (!S.ovtRelease || !ovtProtocol || !m || S.base === "paper" || S.hero) return;
    try {
      if (!m.getSource("ovt-buildings")) m.addSource("ovt-buildings", {type: "vector", url: `pmtiles://${OV.url(S.ovtRelease, "buildings")}`,
        attribution: "Buildings: Overture Maps (OpenStreetMap, Google Open Buildings, Microsoft)"});
      if (!m.getLayer("ovt-buildings")) m.addLayer({id: "ovt-buildings", type: "fill", source: "ovt-buildings", "source-layer": "building", minzoom: 14,
        paint: {"fill-color": "#8C6B4F", "fill-opacity": 0.35}}, m.getLayer("ena-harvest") ? "ena-harvest" : undefined);
    } catch (e) { /* style without our overlays yet */ }
  }
  const BSRC_COLORS = ["match", ["get", "@geometry_source"], "OpenStreetMap", "#3E5C76", "Google Open Buildings", "#1E8A5A", "Microsoft ML Buildings", "#7A4FA0", "#9A948A"];

  function hatchImage() {
    const c = document.createElement("canvas"); c.width = c.height = 10;
    const g = c.getContext("2d"); g.strokeStyle = "rgba(91,107,127,.55)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, 10); g.lineTo(10, 0); g.moveTo(-5, 5); g.lineTo(5, -5); g.moveTo(5, 15); g.lineTo(15, 5); g.stroke();
    return g.getImageData(0, 0, 10, 10);
  }
  const empty = {type: "FeatureCollection", features: []};
  function addOverlays(m, isB) {
    if (!m.hasImage("ena-hatch")) m.addImage("ena-hatch", hatchImage());
    if (IC) IC.register(m);
    const R = S.result, L = R ? R.layers : {};
    const src = (id, data) => { if (m.getSource(id)) m.getSource(id).setData(data || empty); else m.addSource(id, {type: "geojson", data: data || empty}); };
    src("ena-area", L.area ? {type: "FeatureCollection", features: [L.area]} : (S.area ? bboxFeature(S.area.bbox) : empty));
    src("ena-haze", L.haze); src("ena-harvest", L.harvest); src("ena-roads", L.roads); src("ena-power", L.power);
    src("ena-catch", catchmentData()); src("ena-sites", sitesData());
    src("ena-siting", R && R.siting && R.siting.layer);
    const add = (layer) => { if (!m.getLayer(layer.id)) m.addLayer(layer); };
    // Siting model (PREDICTED): top 20% of 1 km cells, darker = more likely; outlined cells hold a documented facility.
    add({id: "ena-siting", type: "fill", source: "ena-siting", paint: {"fill-color": ["interpolate", ["linear"], ["get", "p"],
      0.8, "#F6E7B0", 0.9, "#F0B45A", 0.97, "#C8611E", 1, "#8E3B12"], "fill-opacity": ["interpolate", ["linear"], ["zoom"], 11, 0.62, 15, 0.22],
      "fill-outline-color": "rgba(255,255,255,.5)"}});
    add({id: "ena-siting-doc", type: "line", source: "ena-siting", filter: ["==", ["get", "documented"], 1], paint: {"line-color": "#031D32", "line-width": 2}});
    const maxT = harvestMax();
    add({id: "ena-harvest", type: "fill", source: "ena-harvest", paint: {"fill-color": ["interpolate", ["linear"], ["get", "t"],
      0, "#F2EFD9", maxT * 0.25, "#C9E4B4", maxT * 0.5, "#7FC48F", maxT, "#1E8A5A"], "fill-opacity": 0.72, "fill-outline-color": "rgba(255,255,255,.4)"}});
    add({id: "ena-haze", type: "fill", source: "ena-haze", paint: {"fill-pattern": "ena-hatch", "fill-opacity": 0.9}});
    add({id: "ena-roads", type: "line", source: "ena-roads", layout: {"line-cap": "round", "line-join": "round"},
      paint: {"line-color": "#6B7686", "line-width": ["interpolate", ["linear"], ["zoom"], 8, ["case", ["==", ["get", "major"], 1], 1.2, 0.3], 14, ["case", ["==", ["get", "major"], 1], 4, 1.5]], "line-opacity": 0.55}});
    add({id: "ena-catch-fill", type: "fill", source: "ena-catch", filter: ["==", ["geometry-type"], "Polygon"], paint: {"fill-color": "#00B576", "fill-opacity": 0.1}});
    add({id: "ena-catch-line", type: "line", source: "ena-catch", filter: ["==", ["geometry-type"], "Polygon"], paint: {"line-color": "#007A52", "line-width": 1.5, "line-dasharray": [3, 2]}});
    add({id: "ena-catch-pts", type: "circle", source: "ena-catch", filter: ["==", ["geometry-type"], "Point"],
      paint: {"circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 0.8, 14, 2.5], "circle-color": "#007A52", "circle-opacity": 0.45}});
    add({id: "ena-power-line", type: "line", source: "ena-power", filter: ["==", ["geometry-type"], "LineString"],
      paint: {"line-color": "#0B6A8A", "line-width": ["case", ["==", ["get", "kind"], "line"], 3, 1.8], "line-opacity": 0.9}});
    add({id: "ena-power-pt", type: "symbol", source: "ena-power", filter: ["==", ["geometry-type"], "Point"],
      layout: {"icon-image": ["case", ["==", ["get", "source"], "solar"], "ico-solar", ["==", ["get", "kind"], "substation"], "ico-substation", "ico-generator"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 8, 0.7, 14, 1], "icon-allow-overlap": true, "icon-ignore-placement": true}});
    add({id: "ena-area", type: "line", source: "ena-area", paint: {"line-color": "#031D32", "line-width": 2, "line-dasharray": [4, 3], "line-opacity": 0.8}});

    // Demand glow under the top sites (size = estimated kWh per peak day).
    add({id: "ena-demand", type: "circle", source: "ena-sites", filter: ["==", ["get", "top"], true], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 7, ["+", 6, ["*", 18, ["get", "size"]]], 13, ["+", 18, ["*", 60, ["get", "size"]]]],
      "circle-color": DEMAND_COLOR[(C.MODELS[S.model] || {}).commodity] || "#00B576", "circle-opacity": 0.22, "circle-blur": 0.7}});
    // Every candidate site as a symbol of its kind; the top 10 are numbered pins on the main map.
    add({id: "ena-sites", type: "symbol", source: "ena-sites", filter: isB ? ["has", "id"] : ["!=", ["get", "top"], true],
      layout: {"icon-image": ["get", "icon"], "icon-allow-overlap": true, "icon-ignore-placement": true, "symbol-sort-key": ["get", "order"],
        "icon-size": ["interpolate", ["linear"], ["zoom"], 7, ["case", ["get", "eligible"], 0.55, 0.42], 12, ["case", ["get", "eligible"], 0.85, 0.65], 15, ["case", ["get", "eligible"], 1.05, 0.8]]}});
    if (!isB) {
      m.on("click", "ena-sites", (e) => { const f = e.features && e.features[0]; if (f && f.properties.eligible) select(f.properties.id, true); });
      m.on("mouseenter", "ena-sites", () => { m.getCanvas().style.cursor = "pointer"; });
      m.on("mouseleave", "ena-sites", () => { m.getCanvas().style.cursor = ""; });
    }
  }
  // A map is ready for overlay updates once our layers exist (isStyleLoaded() is false while GeoJSON updates).
  function ready(m) { try { return !!(m && m.getLayer("ena-sites") && m.getSource("ena-sites")); } catch (e) { return false; } }
  function bboxFeature(b) {
    return {type: "FeatureCollection", features: [{type: "Feature", properties: {}, geometry: {type: "Polygon",
      coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]}}]};
  }
  function harvestMax() {
    const f = S.result && S.result.layers.harvest.features;
    if (!f || !f.length) return 1;
    const v = f.map(x => x.properties.t).sort((a, b) => a - b);
    return Math.max(1, v[Math.floor(v.length * 0.95)]);
  }
  function seasonOf(s) { return s[S.season]; }
  function ranked() {
    if (!S.result) return [];
    return S.result.sites.filter(s => seasonOf(s).rank).sort((a, b) => seasonOf(a).rank - seasonOf(b).rank);
  }
  function topSites() { return ranked().filter(s => seasonOf(s).rank <= C.TOP_K); }
  function sitesData() {
    if (!S.result) return empty;
    const top = topSites(), maxK = top.length ? seasonOf(top[0]).kwh_day.central : 1;
    const feats = S.result.sites.map(s => {
      const r = seasonOf(s), isTop = !!(r.rank && r.rank <= C.TOP_K);
      return {type: "Feature", properties: {id: s.id, name: s.name, eligible: true, top: isTop, rank: r.rank || 0, icon: `ico-${s.type}`,
        order: isTop ? 1000 - r.rank : r.rank ? 500 - Math.min(r.rank, 499) : 0,
        size: isTop && r.kwh_day ? Math.sqrt(r.kwh_day.central / maxK) : 0}, geometry: {type: "Point", coordinates: [s.lon, s.lat]}};
    }).concat(S.result.context.map(s => ({type: "Feature", properties: {id: s.id, name: s.name, eligible: false, top: false, rank: 0, size: 0,
      icon: `ico-${s.type}-m`, order: -1}, geometry: {type: "Point", coordinates: [s.lon, s.lat]}})));
    return {type: "FeatureCollection", features: feats};
  }
  function hull(points) {
    if (points.length < 3) return null;
    const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
    const ring = lower.slice(0, -1).concat(upper.slice(0, -1)); ring.push(ring[0]);
    return ring;
  }
  function catchmentData() {
    const s = selectedSite();
    if (!s || !s.catchment_points.length || !["first", "access", "harvest"].includes(S.lens)) return empty;
    const feats = s.catchment_points.map(c => ({type: "Feature", properties: {}, geometry: {type: "Point", coordinates: c}}));
    const h = hull(s.catchment_points);
    if (h) feats.push({type: "Feature", properties: {}, geometry: {type: "Polygon", coordinates: [h]}});
    return {type: "FeatureCollection", features: feats};
  }
  function refreshSources() {
    [map, mapB].forEach((m, i) => {
      if (!ready(m)) return;
      const L = S.result ? S.result.layers : {};
      m.getSource("ena-area").setData(L.area ? {type: "FeatureCollection", features: [L.area]} : (S.area ? bboxFeature(S.area.bbox) : empty));
      m.getSource("ena-haze").setData(L.haze || empty); m.getSource("ena-harvest").setData(L.harvest || empty);
      m.getSource("ena-roads").setData(L.roads || empty); m.getSource("ena-power").setData(L.power || empty);
      m.getSource("ena-catch").setData(i === 0 ? catchmentData() : empty); m.getSource("ena-sites").setData(sitesData());
      m.getSource("ena-siting").setData(S.result && S.result.siting && S.result.siting.layer || empty);

      const maxT = harvestMax();
      m.setPaintProperty("ena-harvest", "fill-color", ["interpolate", ["linear"], ["get", "t"], 0, "#F2EFD9", maxT * 0.25, "#C9E4B4", maxT * 0.5, "#7FC48F", maxT, "#1E8A5A"]);
    });
  }

  // Lens → which overlay layers show, and how roads look.
  const LENS = {
    first: {show: ["ena-roads", "ena-area", "ena-demand", "ena-sites", "ena-power-pt", "ena-catch-fill", "ena-catch-line", "ena-catch-pts", "ovt-buildings"]},
    harvest: {show: ["ena-harvest", "ena-area", "ena-sites", "ena-catch-line"]},
    energy: {show: ["ena-roads", "ena-power-line", "ena-power-pt", "ena-area", "ena-demand", "ena-sites", "ovt-buildings"]},
    access: {show: ["ena-roads", "ena-area", "ena-sites", "ena-catch-fill", "ena-catch-line", "ena-catch-pts", "ovt-buildings"]},
    coverage: {show: ["ena-haze", "ena-roads", "ena-area", "ena-sites", "ovt-buildings"]},
    sure: {show: ["ena-roads", "ena-area", "ena-sites", "ovt-buildings"]},
    likely: {show: ["ena-siting", "ena-siting-doc", "ena-roads", "ena-area", "ena-sites", "ena-power-line", "ovt-buildings"]}
  };
  const ALL_LAYERS = ["ovt-buildings", "ena-siting", "ena-siting-doc", "ena-harvest", "ena-haze", "ena-roads", "ena-catch-fill", "ena-catch-line", "ena-catch-pts", "ena-power-line", "ena-power-pt",
    "ena-area", "ena-demand", "ena-sites"];
  const DEMAND_COLOR = {irish_potato: "#1F9BBF", milk: "#2F7FB8", maize: "#E0A21B"};
  function applyLens() {
    [map, mapB].forEach((m) => {
      if (!ready(m)) return;
      ALL_LAYERS.forEach(id => { if (m.getLayer(id)) m.setLayoutProperty(id, "visibility", LENS[S.lens].show.includes(id) ? "visible" : "none"); });
      if (m.getLayer("ovt-buildings")) {
        const sat = (m === mapB ? S.compareBase : S.base) === "satellite";
        m.setPaintProperty("ovt-buildings", "fill-color", S.lens === "coverage" ? BSRC_COLORS : sat ? "#FFE08A" : "#8C6B4F");
        m.setPaintProperty("ovt-buildings", "fill-opacity", S.lens === "coverage" ? 0.75 : sat ? 0.25 : 0.3);
      }
      if (m.getLayer("ena-demand")) m.setPaintProperty("ena-demand", "circle-color", DEMAND_COLOR[modelOf().commodity] || "#00B576");
      if (S.lens === "access") {
        m.setPaintProperty("ena-roads", "line-color", ["case", [">=", ["get", "rain"], 0.85], "#031D32", [">=", ["get", "rain"], 0.65], "#C08A2B", "#B4441E"]);
        m.setPaintProperty("ena-roads", "line-opacity", S.season === "rainy" ? 0.9 : 0.7);
      } else {
        m.setPaintProperty("ena-roads", "line-color", S.base === "satellite" ? "#FFFFFF" : "#6B7686");
        m.setPaintProperty("ena-roads", "line-opacity", S.lens === "coverage" ? 0.8 : S.base === "paper" ? 0.55 : 0.35);
      }
    });
    refreshSources();
    drawMarkers();
    renderLegend();
  }

  // Top sites as numbered HTML markers (keyboard focusable, style shows confidence).
  function drawMarkers() {
    markers.forEach(m => m.remove()); markers = [];
    if (!S.result) return;
    const sit = S.result.siting;
    if (S.lens === "likely" && sit && sit.status === "ok") {
      // Look-alike cells with no documented facility: numbered "?" markers to check.
      sit.candidates.forEach(c => {
        const el = document.createElement("button");
        el.className = "cand-pin" + (S.cand === c.rank ? " sel" : "");
        el.innerHTML = `<b>?${c.rank}</b>`;
        el.setAttribute("aria-label", `Look-alike ${c.rank}: likely processing or storage site with no documented facility, top ${Math.max(1, Math.round((1 - c.percentile) * 100))}% of cells`);
        el.addEventListener("click", (ev) => { ev.stopPropagation(); focusCandidate(c.rank); });
        markers.push(new maplibregl.Marker({element: el}).setLngLat([c.lon, c.lat]).addTo(map));
      });
    }
    const top = topSites();
    if (S.lens === "sure" && S.result.baseline && S.result.baseline.top) {
      // The simpler method's picks (straight-line headcount) as small tags above each site.
      const ours = new Set(top.map(s => s.id));
      S.result.baseline.top.forEach((id, i) => {
        const s = S.result.sites.find(x => x.id === id); if (!s) return;
        const el = document.createElement("span");
        el.className = "base-tag" + (ours.has(id) ? " both" : "");
        el.textContent = "H" + (i + 1);
        el.title = ours.has(id) ? "Also picked by the simple headcount" : "Picked only by the simple headcount";
        markers.push(new maplibregl.Marker({element: el, offset: [0, -30]}).setLngLat([s.lon, s.lat]).addTo(map));
      });
    }
    if (S.lens === "likely") return;
    if (!top.length) return;
    const maxK = seasonOf(top[0]).kwh_day.central;
    top.forEach(s => {
      const r = seasonOf(s), el = document.createElement("button");
      const size = Math.round(30 + 26 * Math.sqrt(r.kwh_day.central / maxK));
      el.className = "pin " + tierClass(r.tier) + (s.id === S.selected ? " sel" : "") + (S.lens === "energy" ? " " + s.supply.state : "");
      el.style.width = el.style.height = size + "px";
      el.innerHTML = `<b>${r.rank}</b>${IC ? `<span class="pin-ico">${IC.svg(s.type, 17)}</span>` : ""}`;
      el.setAttribute("aria-label", `Rank ${r.rank}: ${s.name}, about ${fmt(r.kwh_day.central)} kWh per peak day, ${r.tier || "unranked"}`);
      el.addEventListener("click", (ev) => { ev.stopPropagation(); select(s.id, false); });
      markers.push(new maplibregl.Marker({element: el}).setLngLat([s.lon, s.lat]).addTo(map));
    });
  }
  const tierClass = (t) => t === "Contested" ? "contested" : t === "Check first" ? "check" : "";

  // ------------------------------------------------------------------ compare (swipe)
  function setCompare(on) {
    S.compare = on;
    $("compare").setAttribute("aria-pressed", String(on));
    $("compare-base").hidden = !on;
    $("map-b").hidden = !on; $("swipe").hidden = !on;
    if (on && !mapB) {
      mapB = new maplibregl.Map({container: "map-b", style: BASES[S.compareBase](), center: map.getCenter(), zoom: map.getZoom(),
        attributionControl: false, interactive: false});
      mapB.on("style.load", () => { addOverlays(mapB, true); addOvt(mapB); applyLens(); });
      mapB.on("error", () => { /* missing tiles offline: the left map still works */ });
      map.on("move", syncB);
      setSwipe(0.5);
    }
    if (!on && mapB) { map.off("move", syncB); mapB.remove(); mapB = null; }
  }
  function syncB() { if (mapB) mapB.jumpTo({center: map.getCenter(), zoom: map.getZoom()}); }
  let swipeX = 0.5;
  function setSwipe(f) {
    swipeX = Math.min(0.95, Math.max(0.05, f));
    const w = $("map").clientWidth, x = Math.round(w * swipeX);
    $("swipe").style.left = x + "px";
    $("map-b").style.clipPath = `inset(0 0 0 ${x}px)`;
  }
  (function swipeDrag() {
    const h = $("swipe-handle"); let drag = false;
    h.addEventListener("pointerdown", (e) => { drag = true; h.setPointerCapture(e.pointerId); });
    h.addEventListener("pointermove", (e) => { if (!drag) return; const r = $("map").getBoundingClientRect(); setSwipe((e.clientX - r.left) / r.width); });
    h.addEventListener("pointerup", () => { drag = false; });
    h.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") setSwipe(swipeX - 0.05); if (e.key === "ArrowRight") setSwipe(swipeX + 0.05); });
    window.addEventListener("resize", () => { if (S.compare) setSwipe(swipeX); });
  })();

  function setBase(b) {
    S.base = b; store.set("base2", b); baseFailures = 0;
    document.querySelectorAll("[data-base]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.base === b)));
    map.setStyle(BASES[b](), {diff: false});
  }

  // ------------------------------------------------------------------ drawer rendering
  const STEP_LABELS = {
    g_area: "Finding the area", g_sites: "Looking for collection points and processors (OpenStreetMap)",
    g_places: "Looking for agricultural places (Overture Maps)", g_power: "Checking the power network",
    g_roads: "Reading roads and paths", g_buildings: "Counting buildings: OpenStreetMap + Google + Microsoft",
    g_pop: "Counting people (WorldPop)", g_climate: "Reading the local climate (2024)",
    analyze: "Analyzing"
  };
  function setStep(id, status, detail, label) {
    const i = S.steps.findIndex(s => s.id === id);
    const row = {id, status, detail, label: label || STEP_LABELS[id] || id};
    if (i >= 0) S.steps[i] = row; else S.steps.push(row);
    if (S.phase === "working") renderDrawer();
  }
  function stepsHTML(list) {
    return `<ol class="steps">${list.map(s => `<li class="${s.status}"><i class="ico" aria-hidden="true"></i><div><strong>${esc(s.label)}</strong><span>${esc(s.detail || (s.status === "running" ? "working…" : ""))}</span></div></li>`).join("")}</ol>`;
  }
  function modelOf() { return C.MODELS[S.model]; }

  function renderDrawer() {
    const d = $("drawer");
    if (S.phase === "idle") {
      d.innerHTML = `<div class="drawer-head"><p class="eyebrow">Agricultural energy screening · live</p>
        <h2>Where should we investigate first?</h2></div>
        <div class="drawer-body intro">
        ${H ? H.introHTML() : ""}
        <p>Search any place. EnaGIS gathers open data for that area right now, works out who can reach each collection point by road, estimates the electricity a value chain would need there, and tells you how sure it is.</p>
        <p class="eyebrow" style="margin-top:14px">Try a district in Rwanda</p>
        <div class="examples">${HEROES.map(n => `<button data-example="${n} District, Rwanda">${n}</button>`).join("")}</div>
        <ol class="how"><li>Find the area and its boundary</li><li>Gather facilities, every building (OpenStreetMap, Google and Microsoft footprints), population, roads, power lines and climate</li>
        <li>Draw road catchments for the dry and rainy season</li><li>Estimate energy need with ranges, simulated ${C.DRAWS} times</li>
        <li>Rank sites, show how sure, and say what to check first</li><li>Predict where unmapped processing or collection points are likely (siting model)</li></ol>
        <p class="meta" style="margin-top:14px">Open data, gathered live in your browser: OpenStreetMap, Overture Maps, WorldPop, Open-Meteo. Production figures are loaded for Rwanda; elsewhere you enter them.</p>
        </div>
        <div class="drawer-foot"><button id="prepare-demo" title="Gather the example districts now so they open instantly later, even offline">Save example districts</button><button id="open-saved">Open saved analysis</button><button id="demo-synth" title="A small synthetic area for trying the interface without internet">Synthetic sample</button></div>`;
      return;
    }
    if (S.phase === "working") {
      d.innerHTML = `<div class="drawer-head"><p class="eyebrow">${esc(modelOf().name)}</p><h2>${esc(S.area ? S.area.name : "Working")}</h2>
        <p class="meta">${esc(S.area ? S.area.display_name : "")}</p></div>
        <div class="drawer-body"><p class="muted">Gathering open data and analyzing. Each step shows what it found.</p>${stepsHTML(S.steps)}
        ${altHTML()}</div>`;
      return;
    }
    if (S.phase === "error") {
      d.innerHTML = `<div class="drawer-head"><p class="eyebrow">Could not analyze</p><h2>${esc(S.error.title)}</h2></div>
        <div class="drawer-body"><p>${esc(S.error.text)}</p>${S.steps.length ? stepsHTML(S.steps) : ""}${altHTML()}</div>
        <div class="drawer-foot"><button id="back-home">Start again</button><button id="analyze-view-2">Analyze this view</button></div>`;
      return;
    }
    if (S.phase === "results") return renderResults(d);
  }
  function altHTML() {
    if (!S.alternates || !S.alternates.length) return "";
    return `<details style="margin-top:10px"><summary class="meta">Not the place you meant? (${S.alternates.length} other matches)</summary>
      <ul class="choices">${S.alternates.map((a, i) => `<li><button data-alt="${i}">${esc(a.name)}<small>${esc(a.display_name)}</small></button></li>`).join("")}</ul></details>`;
  }

  function valueFor(s) {
    const r = seasonOf(s);
    if (S.lens === "harvest") return r.production_t !== null ? [`${fmt(r.production_t)}`, "t/yr grown"] : ["UNKNOWN", ""];
    if (S.lens === "energy") return s.solar ? [`${fmt(s.solar.kwp)}`, "kWp solar"] : [r.kwh_day ? fmt(r.kwh_day.central) : "UNKNOWN", "kWh/day"];
    if (S.lens === "access") return [`${fmt(r.people)}`, "people"];
    if (!r.kwh_day) return ["UNKNOWN", ""];
    return [energyFmt(r.kwh_day.central), S.expert ? `${energyFmt(r.kwh_day.p5)}–${energyFmt(r.kwh_day.p95)} kWh/day` : "kWh/day"];
  }
  const SUPPLY_SHORT = {grid_near: "Grid mapped < 500 m", grid_mid: "Grid mapped < 5 km", grid_not_mapped: "No grid mapped < 5 km", unknown: "Grid unknown"};
  function subFor(s) {
    const r = seasonOf(s);
    if (S.lens === "energy") return SUPPLY_SHORT[s.supply.state];
    if (S.lens === "access") return `Dry #${s.dry.rank || "–"} → Rainy #${s.rainy.rank || "–"} · ${fmt(s.rainy.people)} in rainy season`;
    if (S.lens === "sure") return r.p_top !== null ? `${r.tier || "Not top 10"} · rank ${r.rank_range ? r.rank_range.join("–") : "?"}` : "UNKNOWN";
    return s.type_label;
  }
  function rowHTML(s) {
    const r = seasonOf(s), [v, unit] = valueFor(s);
    const cls = r.rank && r.rank <= C.TOP_K ? tierClass(r.tier) : "none";
    return `<li><button class="site-row" data-site="${esc(s.id)}" aria-current="${s.id === S.selected}">
      <span class="rk ${cls}">${r.rank || "–"}</span>
      <span><strong>${IC ? IC.svg(s.type, 15) : ""}${esc(s.name)}</strong><small>${esc(subFor(s))}</small></span>
      <span class="val">${esc(v)}<small>${esc(unit)}</small></span></button></li>`;
  }

  function renderResults(d) {
    const R = S.result, m = R.meta, top = topSites(), all = ranked();
    const seasonName = S.season === "dry" ? "dry season" : "rainy season";
    const nar = E.narrate(R, S.season);
    if (S.hero && top[0]?.[S.season].kwh_day) {
      const lead = top[0], v = lead[S.season];
      nar.paragraphs[1] = `${lead.name}: ESTIMATED ${energyFmt(v.kwh_day.central)} kWh per peak day (range ${energyFmt(v.kwh_day.p5)}–${energyFmt(v.kwh_day.p95)}), using about ${fmt(v.people)} effective catchment people. Each number on its card links to the evidence and assumptions.`;
    }
    let body = "";
    const warn = m.warnings.map(w => `<p class="warn">${esc(w)}</p>`).join("");
    const listFor = (list, title, note) => `<div class="list-title"><h3>${title}</h3><span class="meta">${note || ""}</span></div><ul class="site-list">${list.map(rowHTML).join("")}</ul>`;
    if (S.lens === "first") {
      body = `<div class="findings"><p class="headline">${esc(nar.headline)}</p><p>${esc(nar.paragraphs[0])}</p>${nar.paragraphs[1] ? `<p>${esc(nar.paragraphs[1])}</p>` : ""}
        ${nar.paragraphs.length > 2 ? `<details><summary>More findings</summary>${nar.paragraphs.slice(2).map(p => `<p>${esc(p)}</p>`).join("")}</details>` : ""}</div>${warn}
        ${top.length ? listFor(S.showAll ? all : top, S.showAll ? `All ${all.length} sites` : "Check these first", seasonName) : `<p class="warn">No site could be ranked. ${esc(m.per_capita.evidence.note || "")}</p>`}
        ${all.length > top.length ? `<button id="show-all" style="width:100%;margin-top:8px">${S.showAll ? "Show top 10 only" : `Show all ${all.length} sites`}</button>` : ""}`;
    } else if (S.lens === "harvest") {
      const byProd = R.sites.slice().sort((a, b) => (seasonOf(b).production_t || 0) - (seasonOf(a).production_t || 0)).slice(0, 15);
      body = `<p class="headline">Where the ${esc(m.model.commodity.replace("_", " "))} comes from</p>
        <p class="muted">Green squares show estimated production from mapped rural homes (${fmt(m.per_capita.t ? m.per_capita.t * 1000 : null)} kg per person per year, ${m.per_capita.evidence.district ? esc(m.per_capita.evidence.district) + " District average" : "national average"}). Select a site to see who can reach it.</p>
        <div class="card"><div class="kv"><span>Production per person</span><strong>${m.per_capita.t ? fmt(m.per_capita.t * 1000) + " kg/yr" : "UNKNOWN"}</strong></div>
        <div class="kv"><span>Evidence</span><strong><span class="status-chip ${m.per_capita.evidence.label.toLowerCase()}">${m.per_capita.evidence.label}</span></strong></div>
        <p class="meta" style="margin-top:6px">${esc(m.per_capita.evidence.note)}</p></div>${warn}
        ${listFor(byProd, "Largest catchments", "estimated t/yr")}`;
    } else if (S.lens === "energy") {
      const c = R.climate;
      const states = ["grid_near", "grid_mid", "grid_not_mapped"].map(st => [st, top.filter(s => s.supply.state === st).length]);
      body = `<p class="headline">Is electricity nearby?</p>
        <p class="muted">Blue lines are power lines mapped in OpenStreetMap. A nearby line does not prove a connection; a missing line does not prove there is none.</p>
        <div class="card">${states.map(([st, n]) => `<div class="kv"><span>${SUPPLY_SHORT[st]}</span><strong>${n} of ${top.length}</strong></div>`).join("")}
        <div class="kv"><span>Sun in the darkest month</span><strong>${c && c.psh_min ? c.psh_min.toFixed(1) + " kWh/m²/day" : "UNKNOWN"}</strong></div></div>
        ${listFor(top, "Top sites: solar option", "kWp to cover one peak day")}`;
    } else if (S.lens === "access") {
      const moved = top.filter(s => s.dry.rank !== s.rainy.rank).length;
      const dryP = R.sites.reduce((a, s) => a + (s.dry.people || 0), 0), rainP = R.sites.reduce((a, s) => a + (s.rainy.people || 0), 0);
      body = `<p class="headline">Who can reach each site, dry vs rainy</p>
        <p class="muted">Roads are coloured by how much rain slows them: dark for paved, amber for gravel or unknown, red for earth tracks and paths. Switch season at the top.</p>
        <div class="card"><div class="kv"><span>People within reach, dry season</span><strong>${fmt(dryP)}</strong></div>
        <div class="kv"><span>People within reach, rainy season</span><strong>${fmt(rainP)} (${dryP ? Math.round((rainP / dryP - 1) * 100) : 0}%)</strong></div>
        <div class="kv"><span>Top sites whose rank changes</span><strong>${moved} of ${top.length}</strong></div></div>
        ${listFor(top, "Top sites", "dry → rainy rank")}`;
    } else if (S.lens === "coverage") {
      const cv = R.coverage;
      const bs = R.building_sources, pop = R.population;
      body = `<p class="headline">How well is this area mapped?</p>
        <p class="muted">EnaGIS can only see what is mapped. Buildings combine OpenStreetMap with Google and Microsoft footprints detected from satellite images, so homes missing from OpenStreetMap are still counted. Zoom in to see each footprint coloured by source. Hatched squares have no buildings and almost no roads: that means <em>not yet known</em>, not empty.</p>
        ${bs ? `<div class="card"><p class="eyebrow">Where the building footprints come from</p>${bs.map(x => `<div class="kv"><span><span class="sw" style="background:${({"OpenStreetMap": "#3E5C76", "Google Open Buildings": "#1E8A5A", "Microsoft": "#7A4FA0"})[x.name] || "#9A948A"}"></span> ${esc(x.name)}</span><strong>${Math.round(x.share * 100)}%</strong></div>`).join("")}</div>` : ""}
        ${pop ? `<div class="card"><div class="kv"><span>People in the boundary (WorldPop ${pop.year})</span><strong>${fmt(pop.total)}</strong></div>
          ${pop.per_building ? `<div class="kv"><span>People per building (calibrated)</span><strong>${pop.per_building}</strong></div>` : ""}</div>` : ""}
        <div class="card"><div class="kv"><span>Overall</span><strong>${esc(cv.text)}</strong></div>
        <div class="kv"><span>Buildings</span><strong>${fmt(cv.buildings)}</strong></div>
        <div class="kv"><span>Buildings per km²</span><strong>${fmt(cv.buildings_per_km2)}</strong></div>
        <div class="kv"><span>Road and path km per km²</span><strong>${cv.road_km_per_km2 === null ? "UNKNOWN" : cv.road_km_per_km2.toFixed(1)}</strong></div>
        <div class="kv"><span>Mapped facilities</span><strong>${cv.documented}</strong></div>
        <div class="kv"><span>Town/village centres used as stand-ins</span><strong>${cv.settlements}</strong></div>
        <div class="kv"><span>"Not yet known" squares</span><strong>${cv.haze_cells}</strong></div></div>
        <h3 style="margin-top:14px">What the tool did</h3>${stepsHTML(R.steps.concat(S.steps.filter(s => s.status === "failed")))}`;
    } else if (S.lens === "sure") {
      const tiers = ["Robust", "Contested", "Check first"].map(t => [t, top.filter(s => seasonOf(s).tier === t).length]);
      const b = R.baseline;
      body = `<p class="headline">How sure is this list?</p>
        <p class="muted">Every assumption was varied across its range ${m.draws} times. Sites that stay near the top in most runs are <strong>Robust</strong>; the rest need a phone check first.</p>
        <div class="card">${tiers.map(([t, n]) => `<div class="kv"><span><span class="sw ring ${t === "Contested" ? "dash" : t === "Check first" ? "dot" : ""}" style="display:inline-block;vertical-align:middle;margin-right:6px"></span>${t}</span><strong>${n}</strong></div>`).join("")}</div>
        ${b ? baselineCard(b, top) : ""}
        ${listFor(top, "Rank stability", "tier · rank range")}
        <div class="card"><p class="eyebrow">What is tested and what is not</p><ul class="meta tight">
          <li>Facility siting model: tested on Rwanda with whole districts held out (Likely sites lens).</li>
          <li>Canadian prairies pilot (Phase 4): registered test, result KILL, published.</li>
          <li>Production per person: ${m.per_capita.evidence.district ? esc(m.per_capita.evidence.district) + " District figure (NISR 2024, ESTIMATED)" : "national average"}; it still varies inside the district.</li>
          <li>Energy factors are screening ranges, not approved or metered. No field visits yet (n = 0): the top sites are the call list.</li></ul></div>`;
    } else if (S.lens === "likely") {
      body = likelyHTML(R, listFor);
    }
    d.innerHTML = `<div class="drawer-head"><p class="eyebrow">${esc(m.model.name)} · ${esc(seasonName)}</p><h2>${esc(m.area.name)}</h2>
      <p class="meta">${esc(m.area.display_name || "")} · ${fmt(m.area.area_km2)} km²</p></div>
      <div class="drawer-body">${body}${altHTML()}</div>
      <div class="drawer-foot"><button id="assumptions">Assumptions</button><button id="save">Save analysis</button>
      <button id="export-csv">CSV</button><button id="export-geo">GeoJSON</button><button id="sources">Sources</button></div>`;
    if (H) H.render();
  }

  // "So what": which sites the simple headcount would have sent you to instead.
  function baselineCard(b, top) {
    const name = id => { const s = S.result.sites.find(x => x.id === id); return s ? s.name : id; };
    const ours = top.map(s => s.id), onlyOurs = ours.filter(id => !b.top.includes(id)), onlyBase = b.top.filter(id => !ours.includes(id));
    return `<div class="card"><p class="eyebrow">Against a simpler method</p><p style="margin:6px 0">${esc(b.method)}</p>
      <div class="kv"><span>Same sites in both top ${b.k}</span><strong>${b.overlap} of ${b.k}</strong></div>
      ${onlyOurs.length ? `<p class="meta" style="margin-top:8px"><strong>EnaGIS adds</strong> (road reach, season, value chain): ${onlyOurs.map(id => esc(name(id))).join(" · ")}</p>` : ""}
      ${onlyBase.length ? `<p class="meta" style="margin-top:4px"><strong>Headcount would send you to</strong>: ${onlyBase.map(id => esc(name(id))).join(" · ")}</p>` : ""}
      <p class="meta" style="margin-top:6px">Grey tags H1–H${b.top.length} on the map mark the headcount's picks; green tags mark picks both methods share.</p></div>`;
  }

  // Siting model lens: predicted cells, how well it found documented facilities, and look-alikes to check.
  function evalLine(ev) {
    if (!ev) return "";
    const pct = v => v === null || v === undefined ? "?" : Math.round(v * 100) + "%";
    const arm = id => ev.arms.find(a => a.arm === id);
    const mdl = arm("model"), best = arm(ev.best_baseline[0]);
    const ci = r => r.ci ? ` (${pct(r.ci[0])}–${pct(r.ci[1])})` : "";
    return `<div class="kv"><span>Siting model</span><strong>${pct(mdl.recall[0].point)}${ci(mdl.recall[0])}</strong></div>
      <div class="kv"><span>Best simple rule: ${esc(best.label.toLowerCase())}</span><strong>${pct(best.recall[0].point)}${ci(best.recall[0])}</strong></div>
      <div class="kv"><span>Difference</span><strong>${ev.margin[0].point >= 0 ? "+" : ""}${Math.round(ev.margin[0].point * 100)} points (${Math.round(ev.margin[0].ci[0] * 100)} to ${Math.round(ev.margin[0].ci[1] * 100)})</strong></div>`;
  }
  // Phase 4X: gradient-boosted trees (XGBoost) against the registered logistic model, same table and test.
  function modelComparisonHTML() {
    const MC = window.EnaModelComparison;
    if (!MC) return "";
    const pct = v => Math.round(v * 100) + "%", pts = v => (v >= 0 ? "+" : "−") + Math.abs(Math.round(v * 100));
    const adopt = MC.verdict === "ADOPT", d = MC.difference;
    return `<div class="card model-comparison"><p class="eyebrow">Model comparison · districts held out <span class="status-chip ${adopt ? "predicted" : "inferred"}">${esc(MC.verdict)}</span></p>
      ${MC.rows.map(r => `<div class="kv"><span>${esc(r.label)}</span><strong>${pct(r.recall10)}</strong></div>`).join("")}
      <div class="kv"><span>XGBoost − logistic</span><strong>${pts(d.point)} points (${pts(d.ci[0])} to ${pts(d.ci[1])})</strong></div>
      <p class="meta" style="margin-top:6px">Share of documented points in the top 10% of their own hidden district; the difference has a paired 95% interval. Same table, features, split and metric; the comparison protocol was fixed before XGBoost was scored (SHA-256 ${esc(MC.protocol_sha256.slice(0, 8))}…). ${adopt ? "XGBoost met the adoption rule and is offered as an alternative layer; the registered model is unchanged." : "XGBoost did not meet the adoption rule, so this layer keeps the logistic model."}</p></div>`;
  }
  function likelyHTML(R, listFor) {
    const sit = R.siting, SM = window.EnaSitingModel;
    if (!SM || !SM.model) return `<p class="headline">Likely processing sites</p><p class="warn">The siting model is not loaded in this build.</p>`;
    if (!sit || sit.status !== "ok") return `<p class="headline">Likely processing sites</p><p class="warn">The siting model could not run here: missing ${esc(((sit && sit.missing) || ["inputs"]).join(", "))}. It needs Overture building footprints with their sizes, and roads.</p>`;
    const ev = SM.evaluation, v = SM.verdict;
    const share = sit.documented_cells ? Math.round(100 * sit.documented_in_top / sit.documented_cells) : null;
    const anyLabel = SM.label === "y_any";
    return `<p class="headline">Where ${anyLabel ? "collection and processing points" : "processing and storage"} are likely</p>
      <p class="muted">A model trained on documented ${anyLabel ? "markets, cooperatives, mills, stores and collection centres" : "mills, cold stores, milk collection centres, washing stations and agricultural stores"} across Rwanda scores every 1 km square from what satellite-derived footprints and maps show: big roofs, building density, roads and the grid. Darker squares are more likely. This is <strong>PREDICTED</strong>, not observed.</p>
      ${anyLabel && SM.v1_verdict === "FEASIBILITY" ? `<p class="meta">Mills, cold stores and collection centres alone are too rarely mapped in Rwanda to test a model (${SM.v1_positive_cells} squares nationally), so the registered test uses every documented collection or processing point.</p>` : ""}
      <div class="card"><p class="eyebrow">In ${esc(R.meta.area.name)}</p>
        <div class="kv"><span>1 km squares scored</span><strong>${fmt(sit.cells)}</strong></div>
        <div class="kv"><span>Squares with a documented ${anyLabel ? "collection or processing point" : "processing or storage site"}</span><strong>${sit.documented_cells}</strong></div>
        <div class="kv"><span>…of which in the model's top 10%</span><strong>${sit.documented_cells ? `${sit.documented_in_top} (${share}%)` : "none to compare"}</strong></div></div>
      ${ev && v === "FEASIBILITY" ? `<div class="card"><p class="eyebrow">Registered test on Rwanda <span class="status-chip unknown">NOT TESTABLE YET</span></p>
        <p class="meta" style="margin:4px 0 6px">Across all ${ev.districts} districts, open maps document only <strong>${ev.positive_cells}</strong> squares with a collection or processing point (${ev.positive_districts} districts), and only <strong>${SM.v1_positive_cells}</strong> with a mill, cold store, collection centre or washing station. The rule set before looking needs at least 60 squares in 6 districts, so no accuracy is claimed. This layer is <strong>experimental</strong>: a lead list for the phone checks that will create the missing ground truth.</p></div>` : ""}
      ${ev && v !== "FEASIBILITY" ? `<div class="card"><p class="eyebrow">Tested on Rwanda, whole districts held out <span class="status-chip ${v === "KEEP" ? "predicted" : "inferred"}">${esc(v || "")}</span></p>
        <p class="meta" style="margin:4px 0 6px">Share of documented points that land in the top 10% of their own district when that district was hidden during training (${ev.districts} districts, ${ev.positive_cells} squares; 95% interval):</p>
        ${evalLine(ev)}
        <p class="meta" style="margin-top:6px">${v === "KEEP" ? "The registered rule (lower bound above zero) is met: the model beats every single-signal rule." : "The registered rule is not met: the model is shown for exploration only and does not beat the best simple rule with confidence."} It learns where facilities are <em>documented</em>, which depends on who mapped what.</p>
        ${SM.audit ? `<p class="meta" style="margin-top:6px">Label check after the test: ${SM.audit.clear_cells} of ${ev.positive_cells} documented squares were not facilities at all (${esc(SM.audit.examples)}). Without them the difference is ${SM.audit.margin_point >= 0 ? "+" : ""}${Math.round(SM.audit.margin_point)} points (${Math.round(SM.audit.margin_ci[0])} to ${Math.round(SM.audit.margin_ci[1])}): ${SM.audit.margin_ci[0] > 0 ? "the result holds" : "the result no longer holds"}.</p>` : ""}</div>` : ""}
      ${modelComparisonHTML()}
      <div class="list-title"><h3>Look-alikes with no facility on record</h3><span class="meta">check these</span></div>
      <ul class="site-list">${sit.candidates.map(c => `<li><button class="site-row" data-cand="${c.rank}" aria-current="${S.cand === c.rank}">
        <span class="rk cand">?${c.rank}</span><span><strong>Largest roof ${fmt(c.amax)} m² · ${fmt(c.nb)} buildings</strong><small>${esc(c.why.join(" · ") || "general pattern")}</small></span>
        <span class="val">top ${Math.max(1, Math.round((1 - c.percentile) * 100))}%<small>of squares</small></span></button></li>`).join("")}</ul>`;
  }
  function focusCandidate(rank) {
    S.cand = rank; S.selected = null;
    const c = S.result.siting.candidates.find(x => x.rank === rank);
    renderSheet(); renderDrawer(); drawMarkers();
    if (c) map.easeTo({center: [c.lon, c.lat], zoom: Math.max(map.getZoom(), 15), duration: 700});
  }
  function candSheetHTML(c) {
    const km = v => v >= 1000 ? `${(v / 1000).toFixed(1)} km` : `${Math.round(v)} m`;
    return `<button class="sheet-close" id="close-sheet" aria-label="Close">×</button><div class="sheet-scroll">
      <div class="site-head"><p class="eyebrow">Look-alike ?${c.rank} · PREDICTED</p><h2>Possible unrecorded facility</h2>
        <p class="meta">${c.lat.toFixed(5)}, ${c.lon.toFixed(5)} · top ${Math.max(1, Math.round((1 - c.percentile) * 100))}% of 1 km squares here</p></div>
      <div class="block"><h3>What the model sees</h3>
        <div class="kv"><span>Buildings in the square</span><strong>${fmt(c.nb)}</strong></div>
        <div class="kv"><span>Roofs of 200 m² or more</span><strong>${c.n200}${c.n600 ? ` (${c.n600} over 600 m²)` : ""}</strong></div>
        <div class="kv"><span>Largest roof</span><strong>${fmt(c.amax)} m²</strong></div>
        <div class="kv"><span>Major road</span><strong>${km(c.d_maj)}</strong></div>
        <div class="kv"><span>Mapped grid</span><strong>${km(c.d_pow)}</strong></div>
        <p class="meta" style="margin-top:6px">Why it scores high: ${esc(c.why.join(", ") || "general pattern")}.</p></div>
      <div class="block"><h3>Check first</h3><div class="check-first"><p>Is there a mill, store, cooling or washing station in this square that is not on any map? Who runs it, and what powers it?</p>
        <ul><li>Look at the satellite view: large roofs, drying tables or yards.</li><li>Ask the sector agronomist or the cooperative federation.</li></ul></div></div>
      <div class="actions"><button id="cand-sat">Satellite view</button><a href="https://www.google.com/maps/@${c.lat},${c.lon},300m/data=!3m1!1e3" target="_blank" rel="noopener">Open in Google Maps</a>
        <button id="copy-cand">Copy coordinates</button></div>
      <p class="meta" style="margin-top:12px">Model score only. It says the square looks like places where facilities are documented, not that one exists.</p></div>`;
  }

  // ------------------------------------------------------------------ legend
  function iconRows(kinds, muted) {
    return kinds.map(k => `<div class="row">${IC ? IC.svg(k, 16, {muted}) : ""}${esc(IC ? IC.DEFS[k].label : k)}</div>`).join("");
  }
  function renderLegend() {
    const L = $("legend");
    if (!S.result) { L.innerHTML = ""; return; }
    const kinds = Array.from(new Set(S.result.sites.map(s => s.type)));
    const ctx = Array.from(new Set(S.result.context.map(s => s.type))).filter(k => !kinds.includes(k));
    const powerKinds = S.result.layers.power ? Array.from(new Set(S.result.layers.power.features.filter(f => f.geometry.type === "Point")
      .map(f => f.properties.source === "solar" ? "solar" : f.properties.kind === "substation" ? "substation" : "generator"))) : [];
    const symbols = `<details class="legend-more"><summary>Symbols</summary>${iconRows(kinds)}${ctx.length ? `<p class="meta">Grey: not used by this value chain</p>${iconRows(ctx, true)}` : ""}${iconRows(powerKinds)}</details>`;
    const rings = `<div class="row"><span class="sw ring"></span>Robust: holds its place</div>
      <div class="row"><span class="sw ring dash"></span>Contested: depends on assumptions</div>
      <div class="row"><span class="sw ring dot"></span>Check first: low confidence</div>
      <div class="row">${IC ? IC.svg("market", 16) : ""}Other candidate site (symbol shows its kind)</div>`;
    const html = {
      first: `<h4>Where first · marker size and glow = energy need</h4>${rings}<div class="row"><span class="sw" style="background:rgba(0,181,118,.15);border:1.5px dashed #007A52"></span>Catchment of the selected site</div>${symbols}`,
      harvest: `<h4>Estimated production per square</h4><div class="row"><span class="sw" style="background:#F2EFD9"></span>Low</div><div class="row"><span class="sw" style="background:#7FC48F"></span>Medium</div><div class="row"><span class="sw" style="background:#1E8A5A"></span>High</div><p class="meta">ESTIMATED from mapped homes × ${S.result.meta.per_capita.evidence.district ? esc(S.result.meta.per_capita.evidence.district) + " District" : "national"} average</p>`,
      energy: `<h4>Mapped electricity</h4><div class="row"><span class="sw line" style="background:#0B6A8A"></span>Power line (OpenStreetMap)</div>${iconRows(["substation", "generator", "solar"])}<div class="row"><span class="sw ring" style="box-shadow:0 0 0 3px rgba(11,106,138,.3)"></span>Site with grid mapped < 500 m</div>`,
      access: `<h4>Roads in the rain</h4><div class="row"><span class="sw line" style="background:#031D32"></span>Paved: little slowdown</div><div class="row"><span class="sw line" style="background:#C08A2B"></span>Gravel or surface unknown</div><div class="row"><span class="sw line" style="background:#B4441E"></span>Earth track or path: half speed</div>`,
      coverage: `<h4>Map data</h4><div class="row"><span class="sw hatch"></span>Not yet known (nothing mapped)</div><div class="row"><span class="sw line" style="background:#6B7686"></span>Mapped roads and paths</div><p class="meta">Building footprints (zoom in):</p><div class="row"><span class="sw" style="background:#3E5C76"></span>OpenStreetMap</div><div class="row"><span class="sw" style="background:#1E8A5A"></span>Google Open Buildings</div><div class="row"><span class="sw" style="background:#7A4FA0"></span>Microsoft</div>`,
      sure: `<h4>How sure</h4>${rings}<div class="row"><span class="base-tag">H1</span>&nbsp;Simple headcount's pick</div><div class="row"><span class="base-tag both">H2</span>&nbsp;Picked by both</div>${symbols}`,
      likely: `<h4>Likely processing or storage · PREDICTED</h4><div class="row"><span class="sw" style="background:#F6E7B0"></span>Top 20% of 1 km squares</div>
        <div class="row"><span class="sw" style="background:#F0B45A"></span>Top 10%</div><div class="row"><span class="sw" style="background:#8E3B12"></span>Top 3%</div>
        <div class="row"><span class="sw" style="background:transparent;border:2px solid #031D32"></span>Square with a documented facility</div>
        <div class="row"><span class="cand-pin mini"><b>?</b></span>&nbsp;Look-alike with no facility on record</div>${symbols}`
    };
    L.innerHTML = html[S.lens];
  }

  // ------------------------------------------------------------------ site card
  function selectedSite() { return S.result && S.selected ? S.result.sites.find(s => s.id === S.selected) : null; }
  function select(id, fromMap) {
    S.selected = id; S.cand = null;
    renderSheet(); renderDrawer(); drawMarkers(); refreshSources();
    const s = selectedSite();
    if (s && !fromMap) map.easeTo({center: [s.lon, s.lat], zoom: Math.max(map.getZoom(), 11), duration: 600});
  }
  const SUPPLY_TEXT = {
    grid_near: (s) => `A power line or substation is mapped ${fmt(Math.min(s.supply.line_m ?? Infinity, s.supply.substation_m ?? Infinity))} m away. Connection and capacity are not known.`,
    grid_mid: (s) => `The nearest mapped grid is about ${fmt(Math.min(s.supply.line_m ?? Infinity, s.supply.substation_m ?? Infinity) / 1000)} km away. Connection unknown.`,
    grid_not_mapped: () => "No power line is mapped within 5 km. The grid may still be there but unmapped.",
    unknown: () => "Power network data could not be loaded."
  };
  const TIER_TEXT = {Robust: "Robust", Contested: "Contested", "Check first": "Check first"};
  function renderSheet() {
    const s = selectedSite(), el = $("sheet");
    const cand = !s && S.cand && S.result && S.result.siting && S.result.siting.candidates ? S.result.siting.candidates.find(c => c.rank === S.cand) : null;
    document.body.classList.toggle("has-sheet", !!(s || cand));
    if (cand) { el.hidden = false; el.innerHTML = candSheetHTML(cand); if (H) H.decorate(); return; }
    if (!s) { el.hidden = true; return; }
    const r = seasonOf(s), m = S.result.meta, other = S.season === "dry" ? s.rainy : s.dry;
    const commodity = m.model.commodity.replace("_", " ");
    const chip = (k, e) => `<span class="status-chip ${e.label.toLowerCase()}" title="${esc(e.text)}">${k}: ${e.label}</span>`;
    const maxSwing = s.drivers.length ? s.drivers[0].swing : 1;
    el.hidden = false;
    el.innerHTML = `<button class="sheet-close" id="close-sheet" aria-label="Close site card">×</button><div class="sheet-scroll">
      <div class="site-head"><p class="eyebrow">${IC ? IC.svg(s.type, 16) : ""} ${r.rank ? `Rank ${r.rank} · ${S.season} season` : "Not ranked"} · ${esc(s.type_label)}</p>
        <h2>${esc(s.name)}</h2><p class="meta">${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}${s.tags.operator ? " · " + esc(s.tags.operator) : ""}</p></div>
      <div class="block"><h3>Why it is here</h3>
        <p>About <strong>${fmt(r.people)}</strong> people live within ${fmt(m.sites_travel || 90)} minutes by road or path in the ${S.season} season, growing roughly <strong>${fmt(r.production_t)}</strong> t of ${esc(commodity)} a year.</p>
        ${r.kwh_day ? `<div class="big">${energyFmt(r.kwh_day.central)} <small>kWh/day</small></div>
        <p class="meta">${S.hero ? "ESTIMATED" : "Likely"} ${energyFmt(r.kwh_day.p5)} to ${energyFmt(r.kwh_day.p95)} kWh on a peak day · about ${fmt(r.kw.central)} kW while running</p>
        <p class="meta expert-only">kW range ${fmt(r.kw.p5)}–${fmt(r.kw.p95)} · throughput ${fmt(r.throughput_t_day)} t/day${r.litres_day ? ` (${fmt(r.litres_day)} L/day)` : ""}${r.stored_t ? ` · ${fmt(r.stored_t)} t in store` : ""}</p>` :
        `<div class="big">UNKNOWN</div><p class="meta">${esc(s.evidence.need.text)}</p>`}
      </div>
      ${s.siting_pct !== null && s.siting_pct !== undefined ? `<div class="block"><h3>Siting model</h3><p class="meta">This site's 1 km square is in the top ${Math.max(1, Math.round((1 - s.siting_pct) * 100))}% of squares here for looking like a processing or storage site (PREDICTED, from roofs, roads and grid).</p></div>` : ""}
      <div class="block"><h3>How sure</h3>
        <p class="word">${r.tier ? TIER_TEXT[r.tier] : r.p_top === null ? "Unknown" : "Outside the top 10"}</p>
        <p class="meta">${r.p_top === null ? "Not simulated." : r.tier_basis === "top_k_share" ? `In the top ${C.TOP_K} in ${Math.round(r.p_top * 100)}% of ${m.draws} simulations; rank ${r.rank_range.join(" to ")}.` : `Rank moves between ${r.rank_range.join(" and ")} across ${m.draws} simulations.`}
        ${other.rank ? ` In the ${S.season === "dry" ? "rainy" : "dry"} season it ranks ${other.rank}.` : ""}</p>
        ${s.drivers.length ? `<div class="expert-only" style="margin-top:8px"><p class="meta">What moves this estimate most (kWh/day, low → high assumption)</p>
          ${s.drivers.map(dv => `<div class="driver"><span>${esc(dv.label)}</span><span><span class="bar"><i style="width:${Math.round(100 * dv.swing / maxSwing)}%"></i></span><small class="meta">${fmt(dv.low)}–${fmt(dv.high)}</small></span></div>`).join("")}</div>` : ""}
      </div>
      <div class="block"><h3>Check first</h3><div class="check-first"><p>${esc(s.question)}</p>
        ${s.followups.length ? `<ul>${s.followups.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</div></div>
      <div class="block"><h3>Energy options</h3><p>${esc(SUPPLY_TEXT[s.supply.state](s))}</p>
        ${s.solar ? `<p class="meta" style="margin-top:6px">Solar to cover one peak day: about <strong>${fmt(s.solar.kwp)} kWp</strong> (up to ${fmt(s.solar.kwp_p95)} kWp), sized for the darkest month (${s.solar.psh_min.toFixed(1)} kWh/m²/day). Storage for night-time cooling not included.</p>` : ""}
        ${s.supply.generator ? `<p class="meta">A ${esc(s.supply.generator.source || "")} generator is mapped ${fmt(s.supply.generator.d)} m away.</p>` : ""}</div>
      <div class="chips">${chip("Location", s.evidence.location)}${chip("People", s.evidence.people)}${chip("Need", s.evidence.need)}${chip("Supply", s.evidence.supply)}</div>
      <div class="actions"><button id="copy-coords">Copy coordinates</button><a href="${esc(s.osm_url)}" target="_blank" rel="noopener">${s.source === "overture" ? "Open in Overture Explorer" : "Open in OpenStreetMap"}</a>
        <a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}" target="_blank" rel="noopener">Directions</a><button id="print">Site brief (print)</button></div>
      <p class="meta" style="margin-top:12px">Screening estimate from open data and unapproved assumptions. Not a feasibility study.</p>
    </div>`;
    if (H) H.decorate();
  }

  // ------------------------------------------------------------------ side panels
  function openPanel(html) { const p = $("panel"); p.innerHTML = `<button class="sheet-close" data-close-panel aria-label="Close">×</button>${html}`; p.hidden = false; }
  function closePanel() { $("panel").hidden = true; }
  function assumptionsPanel() {
    const model = modelOf(), m = S.result ? S.result.meta : null;
    const rows = (obj, prefix) => Object.entries(obj).map(([k, v]) => {
      const r = S.overrides[k] || v.range;
      return `<div class="row3"><span>${esc(v.note)}<small>${esc(v.unit)} · ${esc(v.label)}</small></span>${[0, 1, 2].map(i => `<input type="number" step="any" data-param="${k}" data-i="${i}" value="${r[i]}" aria-label="${esc(k)} ${["low", "central", "high"][i]}">`).join("")}</div>`;
    }).join("");
    const com = model.commodity, def = m && m.per_capita.t ? (m.per_capita.t * 1000).toFixed(1) : "";
    openPanel(`<h2>Assumptions</h2><p class="meta">Change any value and press Apply: the analysis re-runs instantly on the data already gathered. Low · central · high.</p>
      <div class="card"><p class="eyebrow">Production per person</p>
      <div class="row3"><span>${esc(com.replace("_", " "))}, kg per person per year<small>${m ? esc(m.per_capita.evidence.label + " · " + (m.per_capita.evidence.source || "none")) : ""}</small></span>
      <input type="number" step="any" id="percap" value="${esc(S.perCap[com] ?? "")}" placeholder="${esc(def)}" aria-label="kg per person per year" style="grid-column:span 3"></div></div>
      <div class="card"><p class="eyebrow">${esc(model.name)}</p>${rows(model.params)}</div>
      <div class="card"><p class="eyebrow">Shared</p>${rows(C.SHARED)}</div>
      <div class="actions"><button class="primary" id="apply-assumptions">Apply</button><button id="reset-assumptions">Reset to defaults</button></div>
      <p class="meta" style="margin-top:10px">None of these values are human-approved. They are screening ranges; enter local evidence when you have it.</p>`);
  }
  function helpPanel() {
    openPanel(`<h2>How EnaGIS Live works</h2>
      <ol class="how"><li><strong>Find the area.</strong> OpenStreetMap's geocoder returns the boundary of the place you searched.</li>
      <li><strong>Gather.</strong> Your browser reads open data directly: OpenStreetMap for tagged markets, cooperatives, mills, stores, collection centres and towns; Overture Maps for every building footprint (OpenStreetMap, Google and Microsoft), roads, power lines and agricultural places; WorldPop for the population inside the boundary; Open-Meteo for 2024 weather. Each map tile is cached, so repeat searches are fast and work offline.</li>
      <li><strong>Catchments.</strong> Every building is linked to the site it can reach fastest by road or path. Rain slows earth roads, so dry and rainy catchments differ. People per building is calibrated so the buildings add up to WorldPop's population.</li>
      <li><strong>Need.</strong> People in reach × production per person × share handled by the site gives volume; physics turns volume into kWh per peak day for the chosen value chain.</li>
      <li><strong>How sure.</strong> Every assumption is varied ${C.DRAWS} times. Sites that stay near the top are Robust.</li>
      <li><strong>Supply.</strong> Distance to mapped power lines, and the solar array that would cover one peak day.</li>
      <li><strong>Respond.</strong> A ranked list, a site card with the one question to ask first, and downloads.</li></ol>
      <h3 style="margin-top:14px">Map views</h3><p class="muted">Basemaps (Paper, Light, Streets, Satellite, Terrain) change what the map looks like. Lenses on the left change the question. Compare puts two basemaps side by side with a slider.</p>
      <h3 style="margin-top:14px">Rules</h3><p class="muted">UNKNOWN is never shown as zero. Missing on the map means not yet known, not absent. Every number has a unit and a range.</p>`);
  }
  function limitsPanel() {
    openPanel(`<h2>Screening tool, not a feasibility study</h2><ul class="muted">
      <li>Only listed places are seen. Unlisted collection points or power lines are invisible. Buildings are near-complete (satellite-detected footprints from Google and Microsoft fill gaps in OpenStreetMap), but footprints are from 2020–2023 imagery.</li>
      <li>Production per person: in Rwanda, the district figure (NISR 2024 Season A shares scaled to national annual totals, ESTIMATED), spread evenly over the district's homes; elsewhere a national figure you enter. Production still varies inside a district.</li>
      <li>Energy factors (cooling, milling, drying) are literature-style screening ranges, not approved or metered.</li>
      <li>A mapped power line nearby does not mean the site is connected or that capacity is enough.</li>
      <li>Town and village centres stand in where no facility is mapped; they may not collect anything.</li>
      <li>No field verification yet (n = 0). What is tested: the siting model, on all 30 Rwandan districts with whole districts held out, against documented facilities in open maps (registered test, KEEP); the earlier Canadian prairies pilot (KILL, published). Documented facilities are themselves incomplete and sometimes mislabelled.</li>
      <li>Willingness to pay, tariffs and business viability are not assessed.</li></ul>`);
  }
  function sourcesPanel() {
    const R = S.result;
    openPanel(`<h2>Sources for this analysis</h2><p class="meta">Retrieved ${esc(R.meta.generated_at || "")} · seed ${R.meta.seed} · ${R.meta.draws} simulations · engine ${R.meta.elapsed_ms} ms</p>
      ${(R.meta.sources || []).map(s => `<div class="card"><strong>${esc(s.label)}</strong><p class="meta">${esc(s.licence || "")}</p>
        <p class="meta">${esc(s.endpoint || "")}${s.cached ? " · served from this browser's cache" : ""} · ${esc(s.retrieved_at || "")}</p>
        ${s.query ? `<details><summary class="meta">Query</summary><pre style="white-space:pre-wrap;font-size:11px">${esc(s.query)}</pre></details>` : ""}</div>`).join("")}
      <div class="card"><strong>Production statistics</strong><p class="meta">${esc(R.meta.per_capita.evidence.source || "None")}</p>
        ${R.meta.per_capita.evidence.url ? `<a href="${esc(R.meta.per_capita.evidence.url)}" target="_blank" rel="noopener">Source</a>` : ""}</div>`);
  }

  // ------------------------------------------------------------------ actions
  function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 4200); }
  function status(msg) { $("status").textContent = msg; }
  function download(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], {type}));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  function exportCSV() {
    const R = S.result, head = ["season", "rank", "tier", "p_top", "name", "type", "lat", "lon", "people", "production_t_yr", "kwh_day_central", "kwh_day_p5", "kwh_day_p95", "kw_central", "supply_state", "nearest_line_m", "solar_kwp", "question", "osm_url"];
    const rows = [head.join(",")];
    ["dry", "rainy"].forEach(se => R.sites.forEach(s => {
      const r = s[se], k = r.kwh_day || {}, q = (v) => `"${String(v ?? "").replace(/"/g, "\"\"")}"`;
      rows.push([se, r.rank ?? "", r.tier ?? "", r.p_top ?? "", q(s.name), s.type, s.lat, s.lon, Math.round(r.people || 0), r.production_t ?? "",
        k.central ?? "", k.p5 ?? "", k.p95 ?? "", r.kw ? r.kw.central : "", s.supply.state, s.supply.line_m ? Math.round(s.supply.line_m) : "", s.solar ? s.solar.kwp : "", q(s.question), s.osm_url].join(","));
    }));
    download(`enagis-${slug(R.meta.area.name)}-${R.meta.model.id}.csv`, rows.join("\n"), "text/csv");
  }
  function exportGeo() {
    const R = S.result;
    const fc = {type: "FeatureCollection", properties: {area: R.meta.area, model: R.meta.model, generated_at: R.meta.generated_at, licence: "Derived from OpenStreetMap and Overture Maps (ODbL 1.0; Overture places CDLA-Permissive-2.0); WorldPop and Open-Meteo CC BY 4.0"},
      features: R.sites.map(s => ({type: "Feature", geometry: {type: "Point", coordinates: [s.lon, s.lat]},
        properties: {id: s.id, name: s.name, type: s.type, rank_dry: s.dry.rank, rank_rainy: s.rainy.rank, tier_dry: s.dry.tier,
          kwh_day: s.dry.kwh_day ? s.dry.kwh_day.central : null, kwh_day_p5: s.dry.kwh_day ? s.dry.kwh_day.p5 : null,
          kwh_day_p95: s.dry.kwh_day ? s.dry.kwh_day.p95 : null, supply: s.supply.state, question: s.question}}))};
    download(`enagis-${slug(R.meta.area.name)}-${R.meta.model.id}.geojson`, JSON.stringify(fc), "application/geo+json");
  }
  function savePackage() {
    const inp = S.input, b = inp.osm.buildings;
    const compactB = b && !b.compact ? {compact: "lonlat", elements: b.elements.map(el => {
      const c = el.type === "node" ? [el.lon, el.lat] : el.center ? [el.center.lon, el.center.lat] : null;
      return c ? [+c[0].toFixed(6), +c[1].toFixed(6)] : null; }).filter(Boolean)} : b;
    const pkg = {format: "enagis-live-package-v1", saved_at: new Date().toISOString(), options: engineOptions(), synthetic: S.synthetic,
      input: {...inp, osm: {...inp.osm, buildings: compactB}}};
    download(`enagis-${slug(S.input.area.name)}-data.json`, JSON.stringify(pkg), "application/json");
    toast("Saved. Open this file later to replay the analysis offline.");
  }
  function printBrief() {
    const s = selectedSite(); if (!s) return;
    const r = seasonOf(s), m = S.result.meta;
    $("print-brief").innerHTML = `<img class="print-logo" src="assets/brand/enagis-wordmark.png" alt="EnaGIS" height="40"><p class="eyebrow">EnaGIS site brief · ${esc(m.model.name)} · ${esc(m.area.name)}</p><h1>${esc(s.name)}</h1>
      <div class="kv"><span>Rank (${S.season} season)</span><strong>${r.rank || "–"} · ${esc(r.tier || "")}</strong></div>
      <div class="kv"><span>Coordinates</span><strong>${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}</strong></div>
      <div class="kv"><span>Estimated need</span><strong>${r.kwh_day ? `${fmt(r.kwh_day.central)} kWh/day (${fmt(r.kwh_day.p5)}–${fmt(r.kwh_day.p95)})` : "UNKNOWN"}</strong></div>
      <div class="kv"><span>People within reach</span><strong>${fmt(r.people)}</strong></div>
      <div class="kv"><span>Electricity</span><strong>${esc(SUPPLY_TEXT[s.supply.state](s))}</strong></div>
      <h2 style="margin-top:8mm">Check first</h2><p><em>${esc(s.question)}</em></p><ul>${s.followups.map(f => `<li>${esc(f)}</li>`).join("")}</ul>
      <p style="margin-top:8mm;font-size:9pt">Screening estimate from open data (OpenStreetMap and Overture Maps ODbL, WorldPop and Open-Meteo CC BY 4.0) and unapproved assumptions. Not a feasibility study. Generated ${esc(m.generated_at || "")}.</p>`;
    window.print();
  }

  // ------------------------------------------------------------------ the pipeline
  function engineOptions() {
    return {model: S.model, overrides: S.overrides, per_capita_kg: S.perCap, seed: 20261026, draws: C.DRAWS};
  }
  // Analysis runs in a background worker built from the same engine code, so the page never freezes.
  // If workers are unavailable (some browsers block them for file:// pages) it runs on the page instead.
  let worker = null, workerOK = true, inputId = 0, sentId = -1, job = 0;
  function getWorker() {
    if (worker || !workerOK) return worker;
    try {
      const sit = window.enaSitingFactory ? `self.EnaSiting=(${window.enaSitingFactory.toString()})(self);self.EnaSitingModel=${JSON.stringify(window.EnaSitingModel || null)};` : "";
      const src = `self.EnaConfig=(${window.enaConfigFactory.toString()})();${sit}self.EnaEngine=(${window.enaEngineFactory.toString()})(self);
let input=null;self.onmessage=function(e){var d=e.data;if(d.input)input=d.input;try{self.postMessage({job:d.job,ok:true,result:self.EnaEngine.analyze(input,d.options)});}
catch(err){self.postMessage({job:d.job,ok:false,error:String(err&&err.message||err)});}};`;
      worker = new Worker(URL.createObjectURL(new Blob([src], {type: "text/javascript"})));
      worker.onerror = () => { workerOK = false; worker = null; };
    } catch (e) { workerOK = false; worker = null; }
    return worker;
  }
  function runEngine() {
    const w = getWorker(), my = ++job, options = engineOptions();
    if (!w) return new Promise((res, rej) => setTimeout(() => { try { res(E.analyze(S.input, options)); } catch (e) { rej(e); } }, 20));
    return new Promise((res, rej) => {
      const input = S.input;
      const cleanup = () => {w.removeEventListener("message", onMsg);w.removeEventListener("error", onError);};
      const onMsg = (e) => { if (e.data.job !== my) return; cleanup(); e.data.ok ? res(e.data.result) : rej(new Error(e.data.error)); };
      const onError = () => {cleanup();w.terminate();workerOK=false;worker=null;sentId=-1;
        try {res(E.analyze(input,options));} catch(e) {rej(e);}};
      w.addEventListener("message", onMsg);
      w.addEventListener("error", onError);
      const msg = {job: my, options};
      if (sentId !== inputId) { msg.input = S.input; sentId = inputId; }
      try { w.postMessage(msg); } catch (err) { cleanup(); w.terminate(); workerOK = false; worker = null; sentId = -1;
        try { res(E.analyze(S.input, options)); } catch (e2) { rej(e2); } }
    });
  }
  function setInput(input) { S.input = input; inputId++; }
  async function analyzeNow(keepSelection) {
    if (!S.input) return;
    const t = performance.now(), myJob = job + 1;
    if (S.phase === "results") status("Re-analyzing…");
    try {
      const r = await runEngine();
      if (myJob !== job) return; // a newer request superseded this one
      S.result = r;
    } catch (e) {
      S.phase = "error"; S.error = {title: "Analysis failed", text: String(e.message || e)}; renderDrawer(); return;
    }
    S.result.meta.sites_travel = (S.overrides.max_travel_min || C.SHARED.max_travel_min.range)[1];
    S.phase = "results";
    if (!keepSelection || !selectedSite()) { const t1 = topSites()[0]; S.selected = t1 ? t1.id : null; }
    status(`${S.result.meta.area.name}: ${S.result.sites.length} candidate sites · analysis ${Math.round(performance.now() - t)} ms · data ${S.input.retrieved_at ? new Date(S.input.retrieved_at).toLocaleString() : ""}`);
    renderDrawer(); renderSheet(); applyLens();
  }
  function fitArea(a) {
    const b = a.bbox;
    const padL = window.innerWidth > 900 ? 380 : 20, padR = window.innerWidth > 900 ? 380 : 20;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], {padding: {left: padL, right: padR, top: 60, bottom: 60}, duration: 900, maxZoom: 13});
  }
  async function runArea(area, alternates) {
    S.hero = null; if (H) H.render();
    S.area = area; S.alternates = alternates || []; S.result = null; S.selected = null; setInput(null); S.steps = [];
    renderSheet(); drawMarkers(); refreshSources(); fitArea(area);
    const km2 = E.areaOf(area);
    if (km2 > C.MAX_AREA_KM2) {
      S.phase = "error";
      S.error = {title: "That area is too large to analyze at once", text: `${area.name} covers about ${fmt(km2)} km² (limit ${C.MAX_AREA_KM2.toLocaleString("en")} km²). Search a district or sector, or zoom in and press "Analyze this view".`};
      renderDrawer(); return;
    }
    S.phase = "working";
    setStep("g_area", "done", `${area.kind ? area.kind + " · " : ""}${fmt(km2)} km²${area.polygon ? " inside the official boundary" : " (no boundary found; using the box)"}`);
    status(`Gathering open data for ${area.name}…`);
    try {
      const input = await SRC.gather(area, ({id, status: st, detail}) => setStep(id, st, detail));
      setInput(input);
      S.synthetic = false; $("synthetic-ribbon").hidden = true;
      setStep("analyze", "running", "Building road catchments, estimating need, running simulations…");
      await analyzeNow(false);
      history.replaceState(null, "", `?q=${encodeURIComponent(area.display_name || area.name)}&model=${S.model}`);
    } catch (e) {
      S.phase = "error"; S.error = {title: "Could not gather data", text: String(e.message || e)}; renderDrawer();
    }
  }
  async function search(q) {
    q = q.trim(); if (!q) return;
    closePanel();
    const coord = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    S.phase = "working"; S.steps = []; S.area = {name: q, display_name: "Searching…", bbox: map.getBounds().toArray().flat()}; S.alternates = [];
    setStep("g_area", "running", coord ? "Looking up the administrative area at these coordinates" : "OpenStreetMap geocoder (Nominatim)");
    renderDrawer();
    try {
      if (coord) {
        const lat = +coord[1], lon = +coord[2];
        let a = null;
        try { a = await SRC.reverse(lat, lon, 10); } catch (e) { /* fall back to a box */ }
        if (!a || E.areaOf(a) > C.MAX_AREA_KM2) {
          const d = 0.09; a = SRC.areaFromView([lon - d, lat - d, lon + d, lat + d], `Around ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
        }
        return runArea(a, []);
      }
      const res = await SRC.geocode(q);
      if (!res.length) {
        S.phase = "error"; S.error = {title: `No place called “${q}” found`, text: "Try a district, sector or town name, add the country, or type coordinates as lat, lon."};
        renderDrawer(); return;
      }
      // Prefer administrative areas with a boundary and a sensible size.
      const ok = res.filter(a => E.areaOf(a) <= C.MAX_AREA_KM2);
      const best = ok.find(a => a.polygon) || ok[0] || res[0];
      runArea(best, res.filter(a => a !== best).slice(0, 5));
    } catch (e) {
      S.phase = "error"; S.error = {title: "Search failed", text: `${e.message || e}. Check the internet connection, or open a saved analysis.`};
      renderDrawer();
    }
  }
  // Example districts: one click gathers them in advance so they open instantly (and offline) later.
  let preparing = false;
  async function prepareDemo() {
    if (preparing) return; preparing = true;
    const done = [];
    for (let i = 0; i < HEROES.length; i++) {
      const n = HEROES[i], q = `${n} District, Rwanda`;
      status(`Saving example districts: ${i + 1} of ${HEROES.length}, ${n}…`);
      try {
        const res = await SRC.geocode(q);
        const ok = res.filter(a => E.areaOf(a) <= C.MAX_AREA_KM2), best = ok.find(a => a.polygon) || ok[0];
        if (!best) throw new Error("not found");
        const failed = [];
        await SRC.gather(best, (st) => {
          if (st.status === "running") status(`Preparing ${n} (${i + 1} of ${HEROES.length}): ${st.detail || ""}`);
          if (st.status === "failed") failed.push(STEP_LABELS[st.id] || st.id);
        });
        done.push(failed.length ? `${n} ⚠ (${failed.length} source busy)` : `${n} ✓`);
      } catch (e) { done.push(n + " ✗"); }
    }
    preparing = false;
    const incomplete = done.filter(d => !/✓$/.test(d)).length;
    status(`Example districts saved in this browser: ${done.join(" · ")}`);
    toast(incomplete ? `${incomplete} district(s) incomplete because a data server was busy. Press "Save example districts" again: finished parts are kept.` :
      "Example districts are ready: they now open in seconds, even without internet.");
  }
  function analyzeView() {
    const b = map.getBounds(), bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const c = map.getCenter();
    runArea(SRC.areaFromView(bbox, `View around ${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}`), []);
  }
  async function openPackage(file) {
    try {
      const pkg = JSON.parse(await file.text());
      if (pkg.format !== "enagis-live-package-v1" || !pkg.input || !pkg.input.area) throw new Error("Not an EnaGIS Live analysis file");
      S.hero = null; if (H) H.render(); setCompare(false); setBase("paper");
      setInput(pkg.input); S.area = pkg.input.area; S.alternates = [];
      if (pkg.options && pkg.options.model) { S.model = pkg.options.model; $("model").value = S.model; }
      S.overrides = (pkg.options && pkg.options.overrides) || {}; S.perCap = (pkg.options && pkg.options.per_capita_kg) || {};
      S.synthetic = !!pkg.synthetic; $("synthetic-ribbon").hidden = !S.synthetic;
      S.steps = []; fitArea(S.area); analyzeNow(false);
      toast(`Opened saved analysis of ${S.area.name} (data from ${pkg.input.retrieved_at || "unknown date"}).`);
    } catch (e) { toast("Could not open: " + (e.message || e)); }
  }
  function synthDemo() {
    S.hero = null; if (H) H.render();
    // Small built-in synthetic area so the interface can be explored with no internet. Clearly labelled.
    const pkg = window.ENA_SYNTH && window.ENA_SYNTH();
    if (!pkg) { toast("No synthetic sample bundled."); return; }
    setInput(pkg); S.area = pkg.area; S.alternates = []; S.synthetic = true; $("synthetic-ribbon").hidden = false;
    S.steps = []; fitArea(S.area); analyzeNow(false);
  }

  // ------------------------------------------------------------------ events
  $("search-form").addEventListener("submit", (e) => { e.preventDefault(); search($("q").value); });
  $("model").value = S.model;
  $("model").addEventListener("change", () => {
    S.hero = null; if (H) H.render();
    S.model = $("model").value; store.set("model", S.model);
    if (S.input) { S.selected = null; analyzeNow(false); toast(`Re-analyzed for ${modelOf().name} using the data already gathered.`); }
  });
  document.querySelectorAll("[data-season]").forEach(b => b.addEventListener("click", () => {
    S.season = b.dataset.season;
    document.querySelectorAll("[data-season]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderDrawer(); renderSheet(); applyLens();
  }));
  document.querySelectorAll("[data-lens]").forEach(b => b.addEventListener("click", () => {
    S.lens = b.dataset.lens; if (S.lens !== "likely") S.cand = null;
    document.querySelectorAll("[data-lens]").forEach(x => x.toggleAttribute("aria-current", x === b));
    document.querySelectorAll("[data-lens]").forEach(x => { if (x === b) x.setAttribute("aria-current", "page"); });
    renderDrawer(); renderSheet(); applyLens();
  }));
  document.querySelectorAll("[data-base]").forEach(b => b.addEventListener("click", () => setBase(b.dataset.base)));
  $("compare").addEventListener("click", () => setCompare(!S.compare));
  $("compare-base").addEventListener("change", () => { S.compareBase = $("compare-base").value; if (mapB) mapB.setStyle(BASES[S.compareBase](), {diff: false}); });
  $("analyze-view").addEventListener("click", analyzeView);
  $("expert").addEventListener("click", () => {
    S.expert = !S.expert; store.set("expert", S.expert);
    document.body.classList.toggle("expert", S.expert); document.body.classList.toggle("simple", !S.expert);
    $("expert").setAttribute("aria-pressed", String(S.expert)); renderDrawer();
  });
  $("help").addEventListener("click", helpPanel);
  $("open-limits").addEventListener("click", (e) => { e.preventDefault(); limitsPanel(); });
  $("open-file").addEventListener("change", (e) => { if (e.target.files[0]) openPackage(e.target.files[0]); e.target.value = ""; });
  document.addEventListener("click", (e) => {
    const t = e.target.closest("button, a"); if (!t) return;
    if (t.dataset.example) { $("q").value = t.dataset.example; search(t.dataset.example); }
    else if (t.dataset.site) select(t.dataset.site, false);
    else if (t.dataset.cand) focusCandidate(+t.dataset.cand);
    else if (t.dataset.lensGo) { const b = document.querySelector(`[data-lens="${t.dataset.lensGo}"]`); if (b) b.click(); }
    else if (t.id === "cand-sat") setBase("satellite");
    else if (t.id === "copy-cand") {
      const c = S.result.siting.candidates.find(x => x.rank === S.cand); const txt = `${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copied " + txt), () => toast(txt));
    }
    else if (t.dataset.alt !== undefined) { const a = S.alternates[+t.dataset.alt]; runArea(a, S.alternates.filter(x => x !== a).concat(S.area ? [S.area] : [])); }
    else if (t.hasAttribute("data-close-panel")) closePanel();
    else if (t.id === "close-sheet") { S.selected = null; S.cand = null; renderSheet(); renderDrawer(); drawMarkers(); refreshSources(); }
    else if (t.id === "show-all") { S.showAll = !S.showAll; renderDrawer(); }
    else if (t.id === "assumptions") { if (S.hero && H) H.assumptions(); else assumptionsPanel(); }
    else if (t.id === "sources") sourcesPanel();
    else if (t.id === "save") savePackage();
    else if (t.id === "export-csv") exportCSV();
    else if (t.id === "export-geo") exportGeo();
    else if (t.id === "open-saved") $("open-file").click();
    else if (t.id === "demo-synth") synthDemo();
    else if (t.id === "prepare-demo") prepareDemo();
    else if (t.id === "back-home") { S.phase = "idle"; renderDrawer(); }
    else if (t.id === "analyze-view-2") analyzeView();
    else if (t.id === "print") printBrief();
    else if (t.id === "copy-coords") {
      const s = selectedSite(); const txt = `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}`;
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast("Copied " + txt), () => toast(txt));
    } else if (t.id === "apply-assumptions" || t.id === "reset-assumptions") {
      S.hero = null; if (H) H.render();
      if (t.id === "reset-assumptions") { S.overrides = {}; S.perCap = {}; }
      else {
        const ov = {};
        document.querySelectorAll("#panel [data-param]").forEach(inp => {
          const k = inp.dataset.param, i = +inp.dataset.i, v = parseFloat(inp.value);
          const base = (C.MODELS[S.model].params[k] || C.SHARED[k]).range;
          ov[k] = ov[k] || base.slice(); if (isFinite(v)) ov[k][i] = v;
        });
        Object.keys(ov).forEach(k => { const r = ov[k]; const def = (C.MODELS[S.model].params[k] || C.SHARED[k]).range;
          if (!(r[0] <= r[1] && r[1] <= r[2])) { toast(`Range for ${k} must be low ≤ central ≤ high.`); delete ov[k]; }
          else if (r.every((v, i) => v === def[i])) delete ov[k]; });
        S.overrides = ov;
        const pc = $("percap").value.trim(); const com = modelOf().commodity;
        if (pc === "") delete S.perCap[com]; else S.perCap[com] = +pc;
      }
      if (S.input) analyzeNow(true);
      assumptionsPanel(); toast("Assumptions applied. Results updated.");
    }
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closePanel(); } });

  // Initial state
  if (H) H.init({state: () => S, openPanel, closePanel, editAssumptions: assumptionsPanel,
    refresh: () => {renderDrawer(); renderSheet();},
    replay: async bundle => {
      S.hero = bundle.manifest; S.phase = "working"; S.model = "potato_storage"; $("model").value = S.model;
      S.overrides = {}; S.perCap = {}; S.season = "dry"; S.lens = "first"; S.cand = null; S.showAll = false;
      S.synthetic = false; $("synthetic-ribbon").hidden = true; S.alternates = []; S.steps = [];
      setCompare(false); setBase("paper"); setInput(bundle.pkg.input); S.area = bundle.pkg.input.area;
      await analyzeNow(false); fitArea(S.area);
    },
    navigate: ({lens, season, card, candidate}) => {
      S.lens = lens; S.season = season; S.cand = null;
      S.selected = card ? S.result.sites.find(s => s.dry.rank === 1)?.id : null;
      if (candidate && S.result.siting?.candidates.length) {S.selected = null; S.cand = S.result.siting.candidates[0].rank;}
      document.querySelectorAll("[data-lens]").forEach(x => {if (x.dataset.lens === lens) x.setAttribute("aria-current", "page");else x.removeAttribute("aria-current");});
      document.querySelectorAll("[data-season]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.season === season)));
      renderDrawer(); renderSheet(); applyLens();
      const chosen = S.cand ? S.result.siting.candidates[0] : selectedSite();
      if (chosen && (candidate || lens === "first")) map.easeTo({center:[chosen.lon,chosen.lat],zoom:candidate?14:12,duration:0});else fitArea(S.area);
    }});
  document.body.classList.toggle("expert", S.expert); document.body.classList.toggle("simple", !S.expert);
  $("expert").setAttribute("aria-pressed", String(S.expert));
  document.querySelectorAll("[data-base]").forEach(x => x.setAttribute("aria-pressed", String(x.dataset.base === S.base)));
  renderDrawer(); renderLegend();
  const params = new URLSearchParams(location.search);
  if (params.get("model") && C.MODELS[params.get("model")]) { S.model = params.get("model"); $("model").value = S.model; }
  // Run once the map is ready, or after a few seconds even if basemap tiles never arrive.
  const onMapReady = (fn) => { let done = false; const go = () => { if (!done) { done = true; fn(); } }; map.once("load", go); setTimeout(go, 5000); };
  if (params.get("q")) { $("q").value = params.get("q"); onMapReady(() => search(params.get("q"))); }
  if (params.get("demo") === "synthetic") onMapReady(synthDemo);
  window.EnaApp = {state: () => S, search, runArea, openPackage, analyzeNow, prepareDemo, map: () => map, engine: () => ({worker: !!worker, workerOK})};
})();
