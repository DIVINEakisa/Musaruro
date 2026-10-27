/* EnaGIS live data gatherers. Runs in the browser and talks directly to open, keyless services:
 *  - Nominatim (OpenStreetMap geocoder): find the area and its boundary
 *  - Overpass API (OpenStreetMap): facilities and settlements (fallback for roads, buildings and power)
 *  - Overture Maps (overture.js): buildings, roads, power and places, read tile by tile
 *  - WorldPop: population inside the boundary
 *  - Open-Meteo archive (ERA5-based): one year of daily climate at the area centre
 * Responses are cached in the browser (IndexedDB) so a searched area works again offline.
 */
(function (root) {
  "use strict";
  const C = root.EnaConfig;
  const CACHE_DAYS = 14;

  // ------------------------------------------------------------ small IndexedDB cache
  const db = (() => {
    let p = null;
    function open() {
      if (p) return p;
      p = new Promise((resolve) => {
        try {
          const req = indexedDB.open("enagis-live", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("cache");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch (e) { resolve(null); }
      });
      return p;
    }
    return {
      async get(key) {
        const d = await open(); if (!d) return null;
        return new Promise(res => {
          try {
            const r = d.transaction("cache").objectStore("cache").get(key);
            r.onsuccess = () => { const v = r.result; res(v && Date.now() - v.t < CACHE_DAYS * 864e5 ? v : null); };
            r.onerror = () => res(null);
          } catch (e) { res(null); }
        });
      },
      async set(key, value) {
        const d = await open(); if (!d) return;
        try { d.transaction("cache", "readwrite").objectStore("cache").put({t: Date.now(), v: value}, key); } catch (e) { /* quota or private mode */ }
      }
    };
  })();

  async function fetchJSON(url, init, timeoutMs, cacheKey) {
    if (cacheKey) {
      const hit = await db.get(cacheKey);
      if (hit) return {data: hit.v, cached: true, retrieved_at: new Date(hit.t).toISOString()};
    }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeoutMs || 60000);
    try {
      const res = await fetch(url, {...(init || {}), signal: ctl.signal});
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const data = await res.json();
      if (cacheKey) db.set(cacheKey, data);
      return {data, cached: false, retrieved_at: new Date().toISOString()};
    } finally { clearTimeout(timer); }
  }

  // ------------------------------------------------------------ geocoding
  function toArea(r) {
    const bb = r.boundingbox.map(Number); // [south, north, west, east]
    const g = r.geojson && (r.geojson.type === "Polygon" || r.geojson.type === "MultiPolygon") ? r.geojson : null;
    const name = r.name || (r.display_name || "").split(",")[0];
    return {name, display_name: r.display_name, bbox: [bb[2], bb[0], bb[3], bb[1]], polygon: g,
      country_code: r.address && r.address.country_code ? r.address.country_code : null,
      kind: r.addresstype || r.type, lat: +r.lat, lon: +r.lon, osm: r.osm_type ? `${r.osm_type}/${r.osm_id}` : null};
  }
  async function geocode(q) {
    const url = `${C.NOMINATIM}/search?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0005&limit=6&accept-language=en&q=${encodeURIComponent(q)}`;
    const r = await fetchJSON(url, {headers: {"Accept": "application/json"}}, 20000, "geo:" + q.toLowerCase());
    return (r.data || []).map(toArea);
  }
  async function reverse(lat, lon, zoom) {
    const url = `${C.NOMINATIM}/reverse?format=jsonv2&addressdetails=1&polygon_geojson=1&polygon_threshold=0.0005&accept-language=en&zoom=${zoom || 10}&lat=${lat}&lon=${lon}`;
    const r = await fetchJSON(url, {}, 20000, `rev:${zoom}:${lat.toFixed(3)},${lon.toFixed(3)}`);
    return r.data && r.data.boundingbox ? toArea(r.data) : null;
  }
  function areaFromView(bounds, label) {
    return {name: label || "Selected view", display_name: label || "Map view", bbox: bounds, polygon: null, country_code: null, kind: "view"};
  }

  // ------------------------------------------------------------ Overpass
  const ob = (b) => `${b[1].toFixed(5)},${b[0].toFixed(5)},${b[3].toFixed(5)},${b[2].toFixed(5)}`;
  // Overpass "poly" filter from the area boundary (outer ring of the largest part, at most ~180 points),
  // so a non-rectangular district does not pull in data from its neighbours.
  function polyFilter(area) {
    const g = area && area.polygon;
    if (!g) return null;
    const parts = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
    if (!parts.length) return null;
    const ringLen = r => r.reduce((a, p, i) => i ? a + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0, 0);
    let ring = parts.map(p => p[0]).sort((a, b) => ringLen(b) - ringLen(a))[0];
    if (!ring || ring.length < 4) return null;
    const step = Math.ceil(ring.length / 180);
    ring = ring.filter((_, i) => i % step === 0);
    return `poly:"${ring.map(([lon, lat]) => `${lat.toFixed(5)} ${lon.toFixed(5)}`).join(" ")}"`;
  }
  const QUERIES = {
    sites: (b) => `[out:json][timeout:90];(
nwr["amenity"="marketplace"](${ob(b)});
nwr["shop"~"^(agrarian|farm|wholesale|dairy)$"](${ob(b)});
nwr["industrial"](${ob(b)});
nwr["man_made"~"^(works|watermill|windmill|silo)$"](${ob(b)});
nwr["craft"~"^(miller|agricultural_engines)$"](${ob(b)});
nwr["building"~"^(warehouse|cold_storage|silo)$"](${ob(b)});
nwr["office"="cooperative"](${ob(b)});
nwr["cooperative"](${ob(b)});
nwr["product"](${ob(b)});
nwr["name"~"cooperative|coop|koperative|milk|amata|dairy|laiterie|collection cent|washing station|coffee|cold room|cold store|frigo|mill|minoterie|moulin|warehouse|entrep|ububiko|isoko|market|march",i](${ob(b)});
node["place"~"^(town|city|village)$"](${ob(b)});
);out center tags;`,
    roads: (b) => `[out:json][timeout:120];way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track|path|footway|bridleway|road|steps|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"](${ob(b)});out body geom qt;`,
    buildings: (b) => `[out:json][timeout:180][maxsize:1073741824];(way["building"](${ob(b)});node["building"](${ob(b)}););out ids center qt;`,
    power: (b) => `[out:json][timeout:90];(way["power"~"^(line|minor_line|cable)$"](${ob(b)});nwr["power"~"^(substation|generator|plant)$"](${ob(b)}););out body geom qt;`
  };
  async function overpass(kind, area) {
    // Roads use the bounding box (routes just outside the boundary still matter); the rest follow the boundary.
    const pf = kind === "roads" ? null : polyFilter(area);
    let q = QUERIES[kind](area.bbox);
    if (pf) q = q.split(`(${ob(area.bbox)})`).join(`(${pf})`);
    const key = `op:${kind}:${pf ? "poly" + pf.length + ":" : ""}${ob(area.bbox)}`;
    // Public Overpass servers refuse bursts (429) and time out under load (504): retry with a growing pause.
    // A failure here would silently drop mapped facilities and settlements, so it is worth the wait.
    let lastErr;
    for (let round = 0; round < 3; round++) {
      for (const ep of C.OVERPASS) {
        try {
          const r = await fetchJSON(ep, {method: "POST", body: "data=" + encodeURIComponent(q),
            headers: {"Content-Type": "application/x-www-form-urlencoded"}}, kind === "buildings" ? 200000 : 130000, key);
          if (r.data && r.data.remark && /runtime error|timed out|out of memory/i.test(r.data.remark)) throw new Error(r.data.remark);
          return {...r, endpoint: ep, query: q, attempts: round + 1};
        } catch (e) { lastErr = e; }
      }
      if (round < 2) await new Promise(res => setTimeout(res, (round + 1) * (C.OVERPASS_RETRY_MS ?? 6000)));
    }
    throw lastErr || new Error("Overpass unavailable");
  }

  // ------------------------------------------------------------ climate
  async function climate(lat, lon) {
    const url = `${C.OPEN_METEO_ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&start_date=2024-01-01&end_date=2024-12-31` +
      "&daily=temperature_2m_max,temperature_2m_mean,precipitation_sum,shortwave_radiation_sum&timezone=auto";
    const r = await fetchJSON(url, {}, 30000, `clim:${lat.toFixed(2)},${lon.toFixed(2)}`);
    return {...r, endpoint: url};
  }

  // ------------------------------------------------------------ population (WorldPop)
  // Ring simplification so the boundary fits in a URL (WorldPop's stats service takes GeoJSON as a query parameter).
  function simplifiedGeometry(area, maxPts) {
    const g = area.polygon;
    const thin = (ring) => { const step = Math.max(1, Math.ceil(ring.length / maxPts)); const r = ring.filter((_, i) => i % step === 0);
      r.push(ring[ring.length - 1]); return r.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]); };
    if (!g) { const b = area.bbox; return {type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]}; }
    if (g.type === "Polygon") return {type: "Polygon", coordinates: [thin(g.coordinates[0])]};
    return {type: "MultiPolygon", coordinates: g.coordinates.map(p => [thin(p[0])])};
  }
  async function worldpop(area) {
    const W = C.WORLDPOP;
    let pts = 300, u;
    do {
      const fc = {type: "FeatureCollection", features: [{type: "Feature", properties: {}, geometry: simplifiedGeometry(area, pts)}]};
      u = `${W.api}?dataset=${W.dataset}&year=${W.year}&runasync=false&geojson=${encodeURIComponent(JSON.stringify(fc))}`;
      pts = Math.floor(pts * 0.6);
    } while (u.length > 7800 && pts > 20);
    const key = `wp:${W.dataset}:${W.year}:${area.osm || area.bbox.map(v => v.toFixed(3)).join(",")}`;
    let r = await fetchJSON(u, {}, 60000, null);
    let d = r.data;
    // Large areas run as a background task on WorldPop's side: poll it.
    for (let i = 0; i < 20 && d && d.status !== "finished" && d.taskid && !d.error; i++) {
      await new Promise(res => setTimeout(res, 2500));
      d = (await fetchJSON(`https://api.worldpop.org/v1/tasks/${d.taskid}`, {}, 20000, null)).data;
    }
    if (!d || d.error || !d.data || !(d.data.total_population > 0)) throw new Error((d && d.error_message) || "no population returned");
    const out = {total: d.data.total_population, year: W.year, dataset: W.dataset, endpoint: W.api};
    db.set(key, out);
    return {data: out, retrieved_at: r.retrieved_at, endpoint: W.api, query: `dataset=${W.dataset}&year=${W.year}&geojson=<boundary>`};
  }
  async function worldpopCached(area) {
    const W = C.WORLDPOP, key = `wp:${W.dataset}:${W.year}:${area.osm || area.bbox.map(v => v.toFixed(3)).join(",")}`;
    const hit = await db.get(key);
    if (hit) return {data: hit.v, cached: true, retrieved_at: new Date(hit.t).toISOString(), endpoint: W.api};
    return worldpop(area);
  }

  // ------------------------------------------------------------ gather everything for one area
  const LICENCE_OSM = "ODbL 1.0 · © OpenStreetMap contributors";
  async function gather(area, onStep) {
    const say = (id, status, detail) => onStep && onStep({id, status, detail});
    const OV = root.EnaOverture;
    const out = {area, osm: {sites: null, roads: null, buildings: null, power: null}, climate: null, population: null, sources: [],
      retrieved_at: new Date().toISOString()};
    const cLat = (area.bbox[1] + area.bbox[3]) / 2, cLon = (area.bbox[0] + area.bbox[2]) / 2;
    const record = (id, label, r, licence) => out.sources.push({id, label, endpoint: r.endpoint, retrieved_at: r.retrieved_at || new Date().toISOString(),
      cached: r.cached, licence, query: r.query || null});
    const n = (d) => (d && d.elements ? d.elements.length : 0).toLocaleString("en");

    const climateP = (async () => {
      say("g_climate", "running", "Open-Meteo archive, 2024 daily weather");
      try {
        const r = await climate(cLat, cLon); out.climate = r.data;
        record("open-meteo", "Open-Meteo historical weather (ERA5 reanalysis), 2024", r, "CC BY 4.0 · Open-Meteo.com");
        say("g_climate", "done", r.cached ? "from this browser's cache" : "received");
      } catch (e) { say("g_climate", "failed", String(e.message || e)); }
    })();
    const popP = (async () => {
      say("g_pop", "running", "WorldPop 2020 population inside the boundary");
      try {
        const r = await worldpopCached(area); out.population = r.data;
        record("worldpop", `WorldPop ${r.data.year} population (${r.data.dataset}), summed over the boundary`, r, "CC BY 4.0 · WorldPop, University of Southampton");
        say("g_pop", "done", `${Math.round(r.data.total).toLocaleString("en")} people${r.cached ? " · cached" : ""}`);
      } catch (e) { say("g_pop", "failed", "Could not load: " + String(e.message || e)); }
    })();

    // OpenStreetMap via Overpass: tagged facilities and settlements (a small query that public servers answer).
    const osmSitesP = (async () => {
      say("g_sites", "running", "OpenStreetMap via Overpass");
      try {
        const r = await overpass("sites", area);
        record("osm-sites", "OpenStreetMap facilities and settlements", r, LICENCE_OSM);
        say("g_sites", "done", `${n(r.data)} tagged places to inspect${r.cached ? " · cached" : ""}`);
        return r.data;
      } catch (e) { say("g_sites", "failed", "Could not load: " + String(e.message || e)); return null; }
    })();

    // Overture Maps tiles, with Overpass as the fallback for each layer.
    const tileStep = (id, what) => (done, total, results) => {
      let extra = "";
      if (id === "g_buildings") { let c = 0; results.forEach(r => { if (r) c += r.flat.length / 2; }); extra = ` · ${Math.round(c).toLocaleString("en")} buildings so far`; }
      say(id, "running", `Overture Maps ${what}: ${done} of ${total} map tiles${extra}`);
    };
    async function viaOverture(id, themeName, z, what, toJSON, kind, label, describe) {
      if (OV && root.EnaTiles) {
        try {
          say(id, "running", `Overture Maps ${what}`);
          const t = await OV.theme(area, themeName, z, tileStep(id, what));
          const json = toJSON(t.results);
          out.osm[kind] = json;
          out.sources.push({id: "overture-" + themeName, label: `Overture Maps ${label}, release ${t.release} (${t.tiles} tiles${t.failed ? `, ${t.failed} failed` : ""})`,
            endpoint: t.url, retrieved_at: new Date().toISOString(), cached: t.cached, licence: OV.LICENCE[themeName], query: null});
          say(id, "done", describe(json) + ` · Overture ${t.release}` + (t.failed ? ` · ${t.failed} tiles missing` : "") + (t.cached ? " · cached" : ""));
          return json;
        } catch (e) {
          say(id, "running", `Overture unavailable (${String(e.message || e)}); trying OpenStreetMap…`);
        }
      }
      if (!kind || kind === "places") return null;
      try {
        const r = await overpass(kind, area); out.osm[kind] = r.data;
        record("osm-" + kind, `OpenStreetMap ${kind}`, r, LICENCE_OSM);
        say(id, "done", n(r.data) + " features from OpenStreetMap" + (r.cached ? " · cached" : ""));
        return r.data;
      } catch (e) { say(id, "failed", "Could not load: " + String(e.message || e)); return null; }
    }
    const placesP = viaOverture("g_places", "places", C.OVERTURE.zoom, "places", OV ? OV.placesJSON : null, "places", "places (Meta, Microsoft)",
      j => `${n(j)} agricultural places listed`);
    const buildingsP = viaOverture("g_buildings", "buildings", C.OVERTURE.zoom, "buildings", OV ? OV.buildingsJSON : null, "buildings",
      "buildings (OpenStreetMap + Google + Microsoft)", j => `${Math.round(j.flat ? j.flat.length / 2 : j.elements.length).toLocaleString("en")} buildings`);
    const netP = (async () => {
      await viaOverture("g_power", "base", C.OVERTURE.base_zoom, "power network", OV ? OV.powerJSON : null, "power", "power infrastructure (from OpenStreetMap)",
        j => `${n(j)} power features`);
      await viaOverture("g_roads", "transportation", C.OVERTURE.zoom, "roads", OV ? OV.roadsJSON : null, "roads", "roads and paths (from OpenStreetMap)",
        j => `${(j.elements.length - (j.links || 0)).toLocaleString("en")} road and path segments`);
    })();

    const [osmSites, places] = await Promise.all([osmSitesP, placesP, buildingsP, netP, climateP, popP]);
    delete out.osm.places;
    if (osmSites || places) out.osm.sites = {elements: [].concat(osmSites ? osmSites.elements : [], places ? places.elements : [])};
    out.retrieved_at = new Date().toISOString();
    return out;
  }

  root.EnaSources = {geocode, reverse, areaFromView, gather, QUERIES, polyFilter, db, worldpop, simplifiedGeometry};
})(typeof window !== "undefined" ? window : globalThis);
