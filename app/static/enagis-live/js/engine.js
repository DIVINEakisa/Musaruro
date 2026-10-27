/* EnaGIS live analysis engine.
 * Pure and deterministic: same inputs + seed => same outputs. No network, no DOM.
 * Input: open data gathered for one area (OSM sites, roads, buildings, power; climate).
 * Output: candidate sites, road catchments (dry and rainy), estimated requirement with ranges,
 * rank stability, supply context, data coverage, a simpler baseline, and plain-language findings.
 */
function enaEngineFactory(root) {
  "use strict";
  const C = root.EnaConfig || (typeof require !== "undefined" ? require("./config.js") : null);

  // ---------------------------------------------------------------- numbers and randomness
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function triangular(rnd, [a, c, b]) {
    if (b <= a) return c;
    const u = rnd(), f = (c - a) / (b - a);
    return u < f ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c));
  }
  function normal(rnd) {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function quantile(sorted, q) {
    if (!sorted.length) return null;
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function round2sig(x) {
    if (x === null || x === undefined || !isFinite(x)) return null;
    if (x === 0) return 0;
    return Number(x.toPrecision(2));
  }

  // ---------------------------------------------------------------- geometry
  function projector(bbox) {
    const lon0 = (bbox[0] + bbox[2]) / 2, lat0 = (bbox[1] + bbox[3]) / 2;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    return {
      x: (lon) => (lon - lon0) * kx,
      y: (lat) => (lat - lat0) * ky,
      lon: (x) => x / kx + lon0,
      lat: (y) => y / ky + lat0
    };
  }
  function inRing(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeometry(geom, lon, lat) {
    if (!geom) return true;
    const polys = geom.type === "MultiPolygon" ? geom.coordinates : geom.type === "Polygon" ? [geom.coordinates] : null;
    if (!polys) return true;
    return polys.some(rings => inRing(rings[0], lon, lat) && !rings.slice(1).some(r => inRing(r, lon, lat)));
  }
  function ringAreaM2(ring, P) {
    let s = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
      s += P.x(ring[j][0]) * P.y(ring[i][1]) - P.x(ring[i][0]) * P.y(ring[j][1]);
    return Math.abs(s) / 2;
  }
  function areaKm2(area, P) {
    const g = area.polygon;
    if (g && (g.type === "Polygon" || g.type === "MultiPolygon")) {
      const polys = g.type === "MultiPolygon" ? g.coordinates : [g.coordinates];
      let a = 0;
      polys.forEach(rings => { a += ringAreaM2(rings[0], P); rings.slice(1).forEach(r => { a -= ringAreaM2(r, P); }); });
      return a / 1e6;
    }
    const b = area.bbox;
    return Math.abs((P.x(b[2]) - P.x(b[0])) * (P.y(b[3]) - P.y(b[1]))) / 1e6;
  }
  function bboxAreaKm2(b) {
    const P = projector(b);
    return Math.abs((P.x(b[2]) - P.x(b[0])) * (P.y(b[3]) - P.y(b[1]))) / 1e6;
  }

  /* Uniform grid index over projected points for nearest-neighbour search. */
  class GridIndex {
    constructor(cell) { this.cell = cell; this.map = new Map(); }
    key(cx, cy) { return cx * 1000003 + cy; }
    add(id, x, y) {
      const k = this.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
      let arr = this.map.get(k);
      if (!arr) { arr = []; this.map.set(k, arr); }
      arr.push(id, x, y);
    }
    nearest(x, y, maxDist) {
      const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
      const maxRing = Math.ceil(maxDist / this.cell);
      let best = -1, bestD2 = maxDist * maxDist;
      for (let r = 0; r <= maxRing; r++) {
        for (let i = cx - r; i <= cx + r; i++) {
          for (let j = cy - r; j <= cy + r; j++) {
            if (r > 0 && i > cx - r && i < cx + r && j > cy - r && j < cy + r) continue;
            const arr = this.map.get(this.key(i, j));
            if (!arr) continue;
            for (let k = 0; k < arr.length; k += 3) {
              const dx = arr[k + 1] - x, dy = arr[k + 2] - y, d2 = dx * dx + dy * dy;
              if (d2 < bestD2) { bestD2 = d2; best = arr[k]; }
            }
          }
        }
        // Points in ring r+1 are at least r*cell away; stop once nothing closer can exist.
        if (best >= 0 && Math.sqrt(bestD2) <= r * this.cell) break;
      }
      return best < 0 ? null : {id: best, d: Math.sqrt(bestD2)};
    }
    within(x, y, radius) {
      const out = [], cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell), rr = Math.ceil(radius / this.cell);
      for (let i = cx - rr; i <= cx + rr; i++) for (let j = cy - rr; j <= cy + rr; j++) {
        const arr = this.map.get(this.key(i, j));
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 3) {
          const dx = arr[k + 1] - x, dy = arr[k + 2] - y, d = Math.sqrt(dx * dx + dy * dy);
          if (d <= radius) out.push({id: arr[k], d});
        }
      }
      return out;
    }
  }

  /* Binary min-heap keyed by float. */
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) {
      const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
      while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; }
      k[i] = key; v[i] = val;
    }
    pop() {
      const k = this.k, v = this.v, topK = k[0], topV = v[0], lastK = k.pop(), lastV = v.pop();
      if (k.length) {
        let i = 0; const n = k.length;
        while (true) {
          let c = 2 * i + 1; if (c >= n) break;
          if (c + 1 < n && k[c + 1] < k[c]) c++;
          if (k[c] >= lastK) break;
          k[i] = k[c]; v[i] = v[c]; i = c;
        }
        k[i] = lastK; v[i] = lastV;
      }
      return [topK, topV];
    }
  }

  // ---------------------------------------------------------------- OSM parsing
  function centerOf(el) {
    if (el.type === "node" || (el.lon !== undefined && el.lat !== undefined)) return [el.lon, el.lat];
    if (el.center) return [el.center.lon, el.center.lat];
    if (el.geometry && el.geometry.length) {
      let x = 0, y = 0; el.geometry.forEach(g => { x += g.lon; y += g.lat; });
      return [x / el.geometry.length, y / el.geometry.length];
    }
    if (el.bounds) return [(el.bounds.minlon + el.bounds.maxlon) / 2, (el.bounds.minlat + el.bounds.maxlat) / 2];
    return null;
  }

  const EXCLUDE = /(super ?market|minimarket|mini.?market|marketing|restaurant|h[oô]tel|lodge|bank|sawmill|saw mill|pharmacy|school|[eé]cole|church|eglise|église|mosque|parish|paroisse|chapel|temple|hospital|clinic|bar\b|caf[eé]\b|club|campus|universit|college|institute|tourism|toilet|ubwiherero|latrine|parking|coffee ?shop)/i;
  function classifySite(tags) {
    if (!tags) return null;
    if (tags["enagis:type"]) return C.SITE_TYPES[tags["enagis:type"]] ? tags["enagis:type"] : null;
    // Streets are never facilities, whatever their name says ("Rue du Marché", "Mill Road").
    if (tags.highway) return null;
    const name = tags.name || tags["name:en"] || tags["name:rw"] || tags["name:fr"] || "";
    const N = C.NAME_PATTERNS;
    if (/^(cafe|restaurant|bar|fast_food|bank|school|place_of_worship|hospital|clinic|fuel|toilets|parking|bus_station|police|townhall|post_office)$/.test(tags.amenity || "")) return null;
    if (/^(supermarket|coffee|convenience|butcher|bakery)$/.test(tags.shop || "")) return null;
    if (tags.industrial === "sawmill" || tags.craft === "sawmill") return null;
    // Offices are not collection points (a tax office called "One Stop Collection Centre", a company HQ), unless a cooperative.
    if (tags.office && tags.office !== "cooperative" && !N.cooperative.test(name)) return null;
    // A church named "Isoko …" (isoko: market, but also "source") or a campus research club is not a collection point.
    if (EXCLUDE.test(name) && tags.amenity !== "marketplace" && !tags.industrial && !tags.place) return null;
    if (tags.place) {
      if (/^(town|city)$/.test(tags.place)) return "town";
      if (tags.place === "village") return "village";
      return null;
    }
    const ind = tags.industrial || "", prod = tags.product || "";
    // Tea factories and green-leaf collection centres: real agro-processing loads, but not potato, milk or maize
    // collection points ("Gatare Tea Collection Centers" is not a milk centre). Checked before milk for that reason.
    if (/^tea$/.test(ind) || /\btea\b/.test(prod) || /\btea\b.{0,20}\b(factory|company|estate|processing|collection|leaf)/i.test(name)) return "tea_factory";
    if (/^(dairy|milk)$/.test(ind) || /milk/.test(prod) || N.milk_centre.test(name)) return "milk_centre";
    if (/coffee/.test(ind) || /coffee/.test(prod) || (N.coffee_station.test(name) && !tags.shop)) return "coffee_station";
    if (/cold/.test(ind) || tags.building === "cold_storage" || N.cold_store.test(name)) return "cold_store";
    if (/^(watermill|windmill)$/.test(tags.man_made || "") || tags.craft === "miller" ||
      /(mill|grain)/.test(ind) || /(flour|maize)/.test(prod) || N.mill.test(name)) return "mill";
    if (tags.office === "cooperative" || tags.cooperative || N.cooperative.test(name)) return "cooperative";
    if (tags.amenity === "marketplace" || (N.market.test(name) && !tags.shop)) return "market";
    if (tags.building === "warehouse" || ind === "warehouse" || tags.building === "silo" || tags.man_made === "silo" ||
      N.warehouse.test(name)) return "warehouse";
    if ((tags.man_made === "works" && (N.agri.test(name) || N.agri.test(prod))) || /^(food_industry|food|agriculture|agricultural)$/.test(ind) ||
      /(tea|potato|vegetable|fruit|grain|beans)/.test(prod)) return "agro_factory";
    if (/^(agrarian|farm)$/.test(tags.shop || "")) return "agro_shop";
    return null;
  }

  function parseSites(json, area, P) {
    const out = [], seen = [];
    if (!json || !json.elements) return out;
    const grid = new GridIndex(200);
    json.elements.forEach(el => {
      const type = classifySite(el.tags);
      if (!type) return;
      const c = centerOf(el);
      if (!c || !inGeometry(area.polygon, c[0], c[1])) return;
      const x = P.x(c[0]), y = P.y(c[1]);
      const name = (el.tags.name || el.tags["name:en"] || el.tags["name:rw"] || "").trim();
      // Merge duplicates (node + building way for the same place).
      const near = grid.within(x, y, type === "town" || type === "village" ? 400 : 80);
      const dup = near.find(n => { const s = out[n.id]; return s.type === type || (name && s.name === name); });
      if (dup) return;
      const id = `${el.type}/${el.id}`;
      const idx = out.length;
      out.push({idx, id, osm_type: el.type, osm_id: el.id, name: name || null, type, lon: c[0], lat: c[1], x, y,
        tags: pickTags(el.tags), source: el.tags["enagis:source"] || "osm",
        confidence: el.tags["enagis:confidence"] !== undefined ? +el.tags["enagis:confidence"] : null,
        category: el.tags["enagis:category"] || null});
      grid.add(idx, x, y);
      seen.push(id);
    });
    // Documented facilities first; settlements only add where no documented facility is close.
    const docs = out.filter(s => C.SITE_TYPES[s.type].documented);
    const docGrid = new GridIndex(1000);
    docs.forEach((s, i) => docGrid.add(i, s.x, s.y));
    const kept = out.filter(s => C.SITE_TYPES[s.type].documented || !docGrid.nearest(s.x, s.y, 1500));
    kept.forEach((s, i) => { s.idx = i; });
    return kept;
  }
  // Raw settlement points (town, city, village) for the siting model; independent of facility mapping.
  function parseSettlements(json, P) {
    const out = [];
    if (!json || !json.elements) return out;
    json.elements.forEach(el => {
      const t = el.tags || {};
      if (!/^(town|city|village)$/.test(t.place || "")) return;
      const c = centerOf(el); if (!c) return;
      out.push({x: P.x(c[0]), y: P.y(c[1]), place: t.place});
    });
    return out;
  }

  function pickTags(t) {
    const keep = ["name", "name:en", "name:rw", "name:fr", "operator", "amenity", "shop", "industrial", "product", "office", "enagis:category",
      "cooperative", "building", "man_made", "craft", "place", "population", "opening_hours", "power_supply", "generator:source"];
    const o = {}; keep.forEach(k => { if (t[k] !== undefined) o[k] = t[k]; }); return o;
  }

  function parseRoads(json, P) {
    const ids = new Map(), vx = [], vy = [], vlon = [], vlat = [];
    const eFrom = [], eTo = [], eDry = [], eRain = [], ways = [];
    let lengthM = 0;
    if (!json || !json.elements) return null;
    const vertex = (nid, lon, lat) => {
      let i = ids.get(nid);
      if (i === undefined) { i = vx.length; ids.set(nid, i); vx.push(P.x(lon)); vy.push(P.y(lat)); vlon.push(lon); vlat.push(lat); }
      return i;
    };
    json.elements.forEach(el => {
      if (el.type !== "way" || !el.geometry || !el.tags || !el.tags.highway) return;
      const hw = el.tags.highway, speed = C.SPEEDS[hw];
      if (!speed) return;
      const rf = C.rainFactor(hw, el.tags.surface);
      const nodes = el.nodes && el.nodes.length === el.geometry.length ? el.nodes : null;
      let prev = -1, wayLen = 0;
      const coords = [];
      el.geometry.forEach((g, k) => {
        if (!g) return;
        const vid = vertex(nodes ? nodes[k] : `${el.id}:${k}`, g.lon, g.lat);
        coords.push([+g.lon.toFixed(5), +g.lat.toFixed(5)]);
        if (prev >= 0 && prev !== vid) {
          const dx = vx[vid] - vx[prev], dy = vy[vid] - vy[prev], d = Math.sqrt(dx * dx + dy * dy);
          const tDry = d / (speed * 1000 / 60), tRain = d / (speed * rf * 1000 / 60);
          eFrom.push(prev, vid); eTo.push(vid, prev); eDry.push(tDry, tDry); eRain.push(tRain, tRain);
          wayLen += d;
        }
        prev = vid;
      });
      lengthM += el.link ? 0 : wayLen;
      if (!el.link) ways.push({id: el.id, highway: hw, surface: el.tags.surface || null, rain: rf, coords});
    });
    // Compressed adjacency.
    const n = vx.length, deg = new Int32Array(n + 1);
    for (let i = 0; i < eFrom.length; i++) deg[eFrom[i] + 1]++;
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const adj = new Int32Array(eFrom.length), wDry = new Float32Array(eFrom.length), wRain = new Float32Array(eFrom.length);
    const fill = deg.slice(0, n);
    for (let i = 0; i < eFrom.length; i++) { const p = fill[eFrom[i]]++; adj[p] = eTo[i]; wDry[p] = eDry[i]; wRain[p] = eRain[i]; }
    const index = new GridIndex(300);
    for (let i = 0; i < n; i++) index.add(i, vx[i], vy[i]);
    return {n, vx, vy, vlon, vlat, start: deg, adj, wDry, wRain, index, ways, lengthM, provider: json.provider || "osm"};
  }

  function parseBuildings(json, P) {
    if (!json) return null;
    const xs = [], ys = [], lons = [], lats = [];
    if (json.compact === "flat") {
      const f = json.flat || [];
      for (let i = 0; i + 1 < f.length; i += 2) { lons.push(f[i]); lats.push(f[i + 1]); xs.push(P.x(f[i])); ys.push(P.y(f[i + 1])); }
      const areas = json.areas && json.areas.length === xs.length ? json.areas : null;
      return {n: xs.length, xs, ys, lons, lats, areas, sources: json.sources || null, provider: json.provider || "osm"};
    }
    if (!json.elements) return null;
    const compact = json.compact === "lonlat";
    json.elements.forEach(el => {
      const c = compact ? el : centerOf(el);
      if (!c) return;
      lons.push(c[0]); lats.push(c[1]); xs.push(P.x(c[0])); ys.push(P.y(c[1]));
    });
    return {n: xs.length, xs, ys, lons, lats, sources: json.sources || null, provider: json.provider || "osm"};
  }

  function parsePower(json, P) {
    if (!json || !json.elements) return null;
    const lines = [], points = [], index = new GridIndex(500);
    let pid = 0, towers = 0;
    json.elements.forEach(el => {
      const t = el.tags || {};
      if (el.type === "way" && el.geometry && /^(line|minor_line|cable)$/.test(t.power || "")) {
        const coords = el.geometry.map(g => [+g.lon.toFixed(5), +g.lat.toFixed(5)]);
        lines.push({id: el.id, kind: t.power, voltage: t.voltage || null, coords});
        // Densify every ~100 m for nearest-distance queries.
        for (let i = 1; i < el.geometry.length; i++) {
          const a = el.geometry[i - 1], b = el.geometry[i];
          const ax = P.x(a.lon), ay = P.y(a.lat), bx = P.x(b.lon), by = P.y(b.lat);
          const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 100));
          for (let s = 0; s <= steps; s++) index.add(pid++, ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps);
        }
      } else if (/^(tower|pole|portal)$/.test(t.power || "") && el.lon !== undefined) {
        // A pylon or pole is evidence of a line even where the line itself is not drawn.
        index.add(pid++, P.x(el.lon), P.y(el.lat)); towers++;
      } else if (/^(substation|transformer|generator|plant)$/.test(t.power || "")) {
        const c = centerOf(el);
        if (c) points.push({id: `${el.type}/${el.id}`, kind: t.power, source: t["generator:source"] || t["plant:source"] || null,
          name: t.name || null, lon: c[0], lat: c[1], x: P.x(c[0]), y: P.y(c[1])});
      }
    });
    const pIndex = new GridIndex(1000);
    points.forEach((p, i) => pIndex.add(i, p.x, p.y));
    return {lines, points, index, pIndex, towers, provider: json.provider || "osm"};
  }

  function parseClimate(json) {
    const d = json && json.daily;
    if (!d || !d.time || !d.time.length) return null;
    const months = Array.from({length: 12}, () => ({tmax: [], tmean: [], rain: 0, sw: []}));
    d.time.forEach((t, i) => {
      const m = +t.slice(5, 7) - 1;
      if (d.temperature_2m_max && d.temperature_2m_max[i] != null) months[m].tmax.push(d.temperature_2m_max[i]);
      if (d.temperature_2m_mean && d.temperature_2m_mean[i] != null) months[m].tmean.push(d.temperature_2m_mean[i]);
      if (d.precipitation_sum && d.precipitation_sum[i] != null) months[m].rain += d.precipitation_sum[i];
      if (d.shortwave_radiation_sum && d.shortwave_radiation_sum[i] != null) months[m].sw.push(d.shortwave_radiation_sum[i]);
    });
    const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const rows = months.map((m, i) => ({month: names[i], tmax: mean(m.tmax), tmean: mean(m.tmean), rain_mm: m.rain,
      psh: m.sw.length ? mean(m.sw) / 3.6 : null}));
    const valid = rows.filter(r => r.tmax !== null);
    if (!valid.length) return null;
    const pshRows = rows.filter(r => r.psh !== null);
    return {
      year: d.time[0].slice(0, 4),
      months: rows,
      t_hot: Math.max(...valid.map(r => r.tmax)),
      t_mean: mean(valid.map(r => r.tmean).filter(v => v !== null)),
      rainy_months: rows.filter(r => r.rain_mm >= 100).map(r => r.month),
      annual_rain_mm: rows.reduce((s, r) => s + r.rain_mm, 0),
      psh_min: pshRows.length ? Math.min(...pshRows.map(r => r.psh)) : null,
      psh_mean: pshRows.length ? mean(pshRows.map(r => r.psh)) : null,
      latitude: json.latitude, longitude: json.longitude, elevation: json.elevation
    };
  }

  // ---------------------------------------------------------------- catchments
  function dijkstra(G, sources, weights, cutoff) {
    const dist = new Float64Array(G.n).fill(Infinity), owner = new Int32Array(G.n).fill(-1), heap = new Heap();
    sources.forEach(s => {
      if (s.t < dist[s.v]) { dist[s.v] = s.t; owner[s.v] = s.site; heap.push(s.t, s.v); }
    });
    while (heap.size) {
      const [d, u] = heap.pop();
      if (d > dist[u]) continue;
      if (d > cutoff) break;
      const o = owner[u];
      for (let e = G.start[u]; e < G.start[u + 1]; e++) {
        const v = G.adj[e], nd = d + weights[e];
        if (nd < dist[v]) { dist[v] = nd; owner[v] = o; heap.push(nd, v); }
      }
    }
    return {dist, owner};
  }

  const WALK_M_PER_MIN = 4000 / 60, CIRCUITY = 1.3, SNAP_M = 3000, DIRECT_M = 4000, RAIN_WALK = 0.8;
  function catchments(sites, G, B, maxCut, season) {
    // Walking off the mapped network is also slower in the rain (assumption: 20% slower).
    const walk = WALK_M_PER_MIN * (season === "rainy" ? RAIN_WALK : 1);
    const per = sites.map(() => ({rural: [], urban: []}));
    const assign = new Int32Array(B ? B.n : 0).fill(-1), times = new Float32Array(B ? B.n : 0).fill(Infinity);
    if (!B || !sites.length) return {per, assign, times, snapped: 0};
    let net = null, snapped = 0;
    if (G && G.n) {
      const sources = [];
      sites.forEach((s, i) => {
        const nv = G.index.nearest(s.x, s.y, SNAP_M);
        if (nv) { sources.push({v: nv.id, site: i, t: nv.d * CIRCUITY / walk}); snapped++; }
      });
      net = dijkstra(G, sources, season === "rainy" ? G.wRain : G.wDry, maxCut);
    }
    const siteIndex = new GridIndex(1000);
    sites.forEach((s, i) => siteIndex.add(i, s.x, s.y));
    for (let b = 0; b < B.n; b++) {
      const x = B.xs[b], y = B.ys[b];
      let best = Infinity, owner = -1;
      if (net) {
        const nv = G.index.nearest(x, y, SNAP_M);
        if (nv && net.owner[nv.id] >= 0) {
          const t = net.dist[nv.id] + nv.d * CIRCUITY / walk;
          if (t < best) { best = t; owner = net.owner[nv.id]; }
        }
      }
      // Walking straight to a nearby site (also covers sites far from any mapped road).
      siteIndex.within(x, y, DIRECT_M).forEach(c => {
        const t = c.d * CIRCUITY / walk;
        if (t < best) { best = t; owner = c.id; }
      });
      if (owner >= 0 && best <= maxCut) { assign[b] = owner; times[b] = best; }
    }
    return {per, assign, times, snapped};
  }

  // Dense built-up cells (people there produce little of the commodity).
  const URBAN_CELL = 250, URBAN_MIN_BUILDINGS = 100;
  function urbanMask(B) {
    const counts = new Map(), key = (x, y) => Math.floor(x / URBAN_CELL) * 1000003 + Math.floor(y / URBAN_CELL);
    for (let b = 0; b < B.n; b++) { const k = key(B.xs[b], B.ys[b]); counts.set(k, (counts.get(k) || 0) + 1); }
    const urban = new Uint8Array(B.n);
    for (let b = 0; b < B.n; b++) urban[b] = counts.get(key(B.xs[b], B.ys[b])) >= URBAN_MIN_BUILDINGS ? 1 : 0;
    return urban;
  }

  function cumulative(arr) { arr.sort((a, b) => a - b); return arr; }
  function countWithin(sortedTimes, maxT) {
    let lo = 0, hi = sortedTimes.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sortedTimes[m] <= maxT) lo = m + 1; else hi = m; }
    return lo;
  }

  // ---------------------------------------------------------------- the analysis
  function sampleParams(model, rnd, overrides) {
    const q = {};
    Object.entries(model.params).forEach(([k, v]) => { q[k] = triangular(rnd, (overrides && overrides[k]) || v.range); });
    return q;
  }
  function centralParams(model, overrides) {
    const q = {};
    Object.entries(model.params).forEach(([k, v]) => { q[k] = ((overrides && overrides[k]) || v.range)[1]; });
    return q;
  }

  function analyze(input, options) {
    const t0 = Date.now();
    options = options || {};
    const model = C.MODELS[options.model || "potato_storage"];
    if (!model) throw new Error("Unknown value chain model");
    const seed = options.seed || 20261026, draws = options.draws || C.DRAWS, K = C.TOP_K;
    const overrides = options.overrides || {};
    const area = input.area;
    const P = projector(area.bbox);
    const warnings = [];
    const country = (area.country_code && C.COUNTRIES[area.country_code.toUpperCase()]) || C.GENERIC_COUNTRY;
    const steps = [];
    const step = (id, label, detail, status) => steps.push({id, label, detail, status: status || "done"});

    // 1. Sites
    const allSites = parseSites(input.osm.sites, area, P);
    const eligible = allSites.filter(s => model.types[s.type]);
    const docCount = allSites.filter(s => C.SITE_TYPES[s.type].documented).length;
    step("sites", "Found candidate sites", input.osm.sites ?
      `${docCount} documented facilities and ${allSites.length - docCount} town or village centres; ${eligible.length} fit ${model.short.toLowerCase()}` :
      "Site data unavailable", input.osm.sites ? "done" : "failed");

    // 2. Roads
    const G = parseRoads(input.osm.roads, P);
    step("roads", "Read the road network", G ? `${Math.round(G.lengthM / 1000).toLocaleString("en")} km of mapped roads and paths${G.provider === "overture" ? " (OpenStreetMap via Overture Maps)" : ""}` :
      "Road data unavailable; catchments use straight-line walking", G ? "done" : "failed");

    // 3. Buildings
    const B = parseBuildings(input.osm.buildings, P);
    let inside = null;
    if (B && area.polygon) {
      // Clip by polygon using a coarse cell lookup (fast, ~125 m edge tolerance).
      const cache = new Map();
      inside = new Uint8Array(B.n);
      for (let b = 0; b < B.n; b++) {
        const k = Math.floor(B.xs[b] / 250) * 1000003 + Math.floor(B.ys[b] / 250);
        let v = cache.get(k);
        if (v === undefined) {
          const cx = (Math.floor(B.xs[b] / 250) + 0.5) * 250, cy = (Math.floor(B.ys[b] / 250) + 0.5) * 250;
          v = inGeometry(area.polygon, P.lon(cx), P.lat(cy)) ? 1 : 0; cache.set(k, v);
        }
        inside[b] = v;
      }
    }
    const nInside = B ? (inside ? inside.reduce((s, v) => s + v, 0) : B.n) : 0;
    const SRC_NAMES = {"OpenStreetMap": "OpenStreetMap", "Google Open Buildings": "Google Open Buildings", "Microsoft ML Buildings": "Microsoft"};
    let bSources = null;
    if (B && B.sources) {
      const tot = Object.values(B.sources).reduce((a, v) => a + v, 0) || 1;
      bSources = Object.entries(B.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({name: SRC_NAMES[k] || k, share: v / tot}));
    }
    step("buildings", "Counted homes and buildings", B ? `${nInside.toLocaleString("en")} buildings in the area` +
      (bSources ? ` (${bSources.filter(x => x.share >= 0.005).map(x => `${x.name} ${Math.round(x.share * 100)}%`).join(", ")}; merged by Overture Maps)` : " (OpenStreetMap)") :
      "Building data unavailable; people and production are UNKNOWN", B ? "done" : "failed");

    // People per building: calibrated to WorldPop's population for the same boundary when available.
    const pop = input.population && input.population.total > 0 ? input.population : null;
    let ppbInfo = {range: country.persons_per_building.range, label: country.persons_per_building.label,
      note: country.persons_per_building.note, calibrated: false};
    if (pop && B && nInside > 0) {
      const c = Math.min(12, Math.max(0.5, pop.total / nInside));
      ppbInfo = {range: [round2sig(c * 0.8), round2sig(c), round2sig(c * 1.2)], label: "ESTIMATED", calibrated: true,
        note: `People per building: WorldPop ${pop.year} population ${Math.round(pop.total).toLocaleString("en")} ÷ ${nInside.toLocaleString("en")} buildings = ${c.toFixed(2)} (range ±20%)`};
    }
    step("population", "Calibrated people per building", pop ? (B && nInside ? `WorldPop ${pop.year}: ${Math.round(pop.total).toLocaleString("en")} people in the boundary, about ${ppbInfo.range[1]} per building` :
      `WorldPop ${pop.year}: ${Math.round(pop.total).toLocaleString("en")} people in the boundary`) :
      `No WorldPop figure; assuming ${country.persons_per_building.range.join(" / ")} people per building`, "done");

    // 4. Power
    const PW = parsePower(input.osm.power, P);
    step("power", "Checked the mapped power network", PW ? `Power lines: ${PW.lines.length} · pylons/poles: ${PW.towers} · substations: ${PW.points.filter(p => p.kind === "substation").length} · generators: ${PW.points.filter(p => p.kind === "generator" || p.kind === "plant").length}` :
      "Power data unavailable", PW ? "done" : "failed");

    // 5. Climate
    const climate = parseClimate(input.climate);
    step("climate", "Read the local climate", climate ? `Hottest month averages ${climate.t_hot.toFixed(1)} °C by day; ${climate.rainy_months.length ? "rainy months " + climate.rainy_months.join(", ") : "no month above 100 mm"}; sun ${climate.psh_min ? climate.psh_min.toFixed(1) : "?"} kWh/m²/day in the darkest month` :
      "Climate unavailable; cooling uses an assumed 25 °C", climate ? "done" : "failed");
    const ambient = climate ? climate.t_hot : 25;
    if (!climate && model.id === "potato_storage") warnings.push("Climate data missing: ambient temperature assumed 25 °C (INFERRED).");

    // 6. Production per person
    const com = country.commodities[model.commodity];
    const userPerCap = options.per_capita_kg && options.per_capita_kg[model.commodity];
    let perCapT = null, perCapEvidence;
    if (userPerCap !== undefined && userPerCap !== null && userPerCap !== "") {
      perCapT = +userPerCap / 1000;
      perCapEvidence = {label: "OBSERVED", source: "Entered by user", note: `${userPerCap} kg per person per year`};
    } else if (com && country.districts && districtOf(area, country) && country.districts[districtOf(area, country)][model.commodity]) {
      const dn = districtOf(area, country), d = country.districts[dn], ds = country.district_source;
      perCapT = d[model.commodity] / d.population;
      perCapEvidence = {label: ds.label, source: ds.source, url: ds.url, district: dn,
        national_kg: com.annual_t / country.population.value * 1000,
        note: `${dn} District: about ${Math.round(d[model.commodity]).toLocaleString("en")} t of ${model.commodity.replace("_", " ")} a year (2024${d.imputed ? ", yield imputed from neighbouring districts" : ""}) ÷ ${d.population.toLocaleString("en")} people = ${(perCapT * 1000).toFixed(0)} kg per person per year (national average ${(com.annual_t / country.population.value * 1000).toFixed(0)} kg).`};
    } else if (com && country.population) {
      perCapT = com.annual_t / country.population.value;
      perCapEvidence = {label: "ESTIMATED", source: `${com.source}; ${country.population.source}`, url: com.url,
        note: `National ${model.commodity.replace("_", " ")} ${com.annual_t.toLocaleString("en")} t (${com.year}) ÷ population ${country.population.value.toLocaleString("en")} = ${(perCapT * 1000).toFixed(1)} kg per person per year, applied evenly (local production differs).`};
    } else {
      perCapEvidence = {label: "UNKNOWN", source: null, note: `No production data for ${country.name}. Enter kg per person per year to estimate demand.`};
      warnings.push(`No ${model.commodity.replace("_", " ")} production figure for this country. Requirements stay UNKNOWN until you enter one.`);
    }

    // 7. Catchments for both seasons
    const shared = {};
    Object.entries(C.SHARED).forEach(([k, v]) => { shared[k] = (overrides[k] || v.range); });
    const maxCut = shared.max_travel_min[2];
    const urban = B ? urbanMask(B) : null;
    const seasons = {};
    ["dry", "rainy"].forEach(season => {
      const cat = catchments(eligible, G, B, maxCut, season);
      const per = eligible.map(() => ({rural: [], urban: [], pts: []}));
      if (B) for (let b = 0; b < B.n; b++) {
        if (inside && !inside[b]) continue;
        const o = cat.assign[b];
        if (o < 0) continue;
        (urban[b] ? per[o].urban : per[o].rural).push(cat.times[b]);
        if (per[o].pts.length < 4000 || (b % 7 === 0 && per[o].pts.length < 12000)) per[o].pts.push(b);
      }
      per.forEach(p => { cumulative(p.rural); cumulative(p.urban); });
      seasons[season] = {per, snapped: cat.snapped};
    });
    step("catchments", "Drew road catchments", eligible.length ? `${eligible.length} sites; dry and rainy season travel times up to ${maxCut} min` : "No eligible sites", eligible.length ? "done" : "failed");

    // 8. Demand, simulation and ranking per season
    const ppb = overrides.persons_per_building || ppbInfo.range;
    function demandFor(siteIdx, season, q, sh, typeMult, local, ppbV) {
      const pc = seasons[season].per[siteIdx];
      const people = (countWithin(pc.rural, sh.max_travel_min) + sh.urban_producer_weight * countWithin(pc.urban, sh.max_travel_min)) * ppbV;
      if (perCapT === null || !B) return {people, production: null, out: null};
      const production = people * perCapT * local;
      const a = production * q.capture_share * typeMult;
      return {people, production, out: model.compute(a, q, ambient)};
    }
    const centralShared = {}; Object.entries(shared).forEach(([k, r]) => { centralShared[k] = r[1]; });
    const q0 = centralParams(model, overrides);
    const types = {}; Object.entries(model.types).forEach(([t, r]) => { types[t] = (overrides["type_" + t] || r); });

    const results = {};
    // Optional reporting only: retain the EXISTING draws without taking another random sample.
    const simulationTrace = options.trace ? {} : null;
    ["dry", "rainy"].forEach(season => {
      const central = eligible.map((s, i) => demandFor(i, season, q0, centralShared, types[s.type][1], 1, ppb[1]));
      const rnd = mulberry32(seed + (season === "rainy" ? 7919 : 0));
      const kwhDraws = eligible.map(() => []), kwDraws = eligible.map(() => []), rankDraws = eligible.map(() => []);
      const topCount = new Int32Array(eligible.length);
      const canSim = perCapT !== null && B && eligible.length;
      if (simulationTrace) simulationTrace[season] = [];
      if (canSim) for (let d = 0; d < draws; d++) {
        const q = sampleParams(model, rnd, overrides);
        const sh = {}; Object.entries(shared).forEach(([k, r]) => { sh[k] = triangular(rnd, r); });
        const tm = {}; Object.entries(types).forEach(([t, r]) => { tm[t] = triangular(rnd, r); });
        const ppbV = triangular(rnd, ppb);
        const sd = sh.local_variation_sd;
        const locals = simulationTrace ? [] : null;
        const vals = eligible.map((s, i) => {
          const local = Math.exp(sd * normal(rnd) - sd * sd / 2);
          if (locals) locals.push(local);
          const r = demandFor(i, season, q, sh, tm[s.type], local, ppbV);
          kwhDraws[i].push(r.out.kwh_day); kwDraws[i].push(r.out.kw);
          return r.out.kwh_day;
        });
        const order = vals.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
        if (simulationTrace) simulationTrace[season].push({q, shared: sh, types: tm, persons_per_building: ppbV,
          local: locals, kwh: vals, order: order.map(v => eligible[v[1]].id)});
        order.forEach(([, i], r) => { rankDraws[i].push(r + 1); if (r < K) topCount[i]++; });
      }
      const order = eligible.map((s, i) => [central[i].out ? central[i].out.kwh_day : -1, i])
        .sort((a, b) => b[0] - a[0] || (eligible[a[1]].id < eligible[b[1]].id ? -1 : 1));
      const rankOf = new Int32Array(eligible.length);
      order.forEach(([v, i], r) => { rankOf[i] = v >= 0 ? r + 1 : 0; });
      results[season] = eligible.map((s, i) => {
        const kwhS = kwhDraws[i].slice().sort((a, b) => a - b), kwS = kwDraws[i].slice().sort((a, b) => a - b),
          rS = rankDraws[i].slice().sort((a, b) => a - b);
        const pTop = canSim ? topCount[i] / draws : null;
        const rank = rankOf[i] || null;
        // Tier: with more than K sites, how often the site stays in the top K across simulations.
        // With K or fewer sites everyone is trivially "top K", so use how far its rank moves instead.
        const spread = rS.length ? quantile(rS, 0.95) - quantile(rS, 0.05) : null;
        let tier = null;
        if (rank && rank <= K && pTop !== null) {
          tier = eligible.length > K ? (pTop >= 0.8 ? "Robust" : pTop >= 0.4 ? "Contested" : "Check first")
            : (spread <= 1 ? "Robust" : spread <= 3 ? "Contested" : "Check first");
        }
        const c = central[i];
        return {
          rank, tier, p_top: pTop, tier_basis: eligible.length > K ? "top_k_share" : "rank_spread",
          rank_range: rS.length ? [Math.round(quantile(rS, 0.05)), Math.round(quantile(rS, 0.95))] : null,
          people: c.people, production_t: c.production,
          kwh_day: c.out ? {central: c.out.kwh_day, p5: quantile(kwhS, 0.05), p50: quantile(kwhS, 0.5), p95: quantile(kwhS, 0.95)} : null,
          kw: c.out ? {central: c.out.kw, p5: quantile(kwS, 0.05), p50: quantile(kwS, 0.5), p95: quantile(kwS, 0.95)} : null,
          throughput_t_day: c.out ? c.out.throughput_t_day : null,
          litres_day: c.out && c.out.litres_day !== undefined ? c.out.litres_day : null,
          stored_t: c.out && c.out.stored_t !== undefined ? c.out.stored_t : null
        };
      });
    });
    step("demand", "Estimated energy requirement", perCapT === null ? "UNKNOWN: no production figure" :
      `${model.name}; ${draws} simulations of every assumption`, perCapT === null ? "failed" : "done");

    // 9. Supply context and solar sizing
    const supply = eligible.map(s => {
      let lineM = null, subM = null, gen = null;
      if (PW) {
        const nl = PW.index.nearest(s.x, s.y, 20000); lineM = nl ? nl.d : null;
        const subs = PW.points.map((p, i) => ({p, d: Math.hypot(p.x - s.x, p.y - s.y)}));
        const sub = subs.filter(o => o.p.kind === "substation").sort((a, b) => a.d - b.d)[0];
        subM = sub ? sub.d : null;
        const g = subs.filter(o => (o.p.kind === "generator" || o.p.kind === "plant") && o.d < 2000).sort((a, b) => a.d - b.d)[0];
        gen = g ? {d: g.d, source: g.p.source} : null;
      }
      const near = Math.min(lineM === null ? Infinity : lineM, subM === null ? Infinity : subM);
      const state = !PW ? "unknown" : near <= 500 ? "grid_near" : near <= 5000 ? "grid_mid" : "grid_not_mapped";
      return {state, line_m: lineM, substation_m: subM, generator: gen};
    });
    step("supply", "Compared with mapped electricity", PW ? `${supply.filter(s => s.state === "grid_near").length} sites have a mapped line or substation within 500 m` :
      "UNKNOWN", PW ? "done" : "failed");

    // 9b. Siting model (PREDICTED): where processing or storage facilities are likely, from footprints, roads and grid.
    let siting = null;
    const SIT = root.EnaSiting, SM = root.EnaSitingModel;
    if (SIT && SM && SM.model && B) {
      const cellSet = SIT.cells({P, area, inGeometry, GridIndex, B, urban, G, PW, settlements: parseSettlements(input.osm.sites, P), sites: allSites});
      const ap = SIT.apply(SM.model, cellSet, eligible.map(s => ({x: s.x, y: s.y})));
      if (ap && ap.status === "ok") {
        eligible.forEach((s, i) => { s.siting_pct = ap.point_pct[i]; });
        const ring = (i, j) => [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1], [i, j]].map(([a, b]) => [+P.lon(a * cellSet.cell_m).toFixed(5), +P.lat(b * cellSet.cell_m).toFixed(5)]);
        siting = {status: "ok", cells: ap.cells, cell_m: ap.cell_m, documented_cells: ap.documented_cells, documented_in_top: ap.documented_in_top,
          candidates: ap.candidates, evaluation: SM.evaluation || null, verdict: SM.verdict || null, version: SM.version || null,
          layer: {type: "FeatureCollection", features: ap.grid.filter(g => g.p >= 0.8).map(g => ({type: "Feature",
            properties: {p: Math.round(g.p * 1000) / 1000, documented: g.y}, geometry: {type: "Polygon", coordinates: [ring(g.i, g.j)]}}))}};
      } else siting = {status: ap ? ap.status : "no_cells", missing: ap && ap.missing};
    } else if (SIT && SM && SM.model) siting = {status: "missing_inputs", missing: ["building footprints"]};
    if (siting) step("siting", "Predicted likely processing sites", siting.status === "ok" ?
      `${siting.cells.toLocaleString("en")} cells of 1 km scored; ${siting.documented_in_top} of ${siting.documented_cells} cells with a documented facility fall in the top 10%; ${siting.candidates.length} unmapped look-alikes to check` :
      `Not run: missing ${(siting.missing || ["inputs"]).join(", ")}`, siting.status === "ok" ? "done" : "failed");

    // 10. Sensitivity (what drives each top site), central season = dry
    function tornado(i, season) {
      const s = eligible[i], base = demandFor(i, season, q0, centralShared, types[s.type][1], 1, ppb[1]);
      if (!base.out) return [];
      const out = [];
      const sw = (label, key, lo, hi, kind) => {
        const d = hi.out.kwh_day - lo.out.kwh_day;
        out.push({key, label, kind, low: lo.out.kwh_day, high: hi.out.kwh_day, swing: Math.abs(d)});
      };
      Object.entries(model.params).forEach(([k, v]) => {
        const r = overrides[k] || v.range, qa = {...q0, [k]: r[0]}, qb = {...q0, [k]: r[2]};
        sw(v.note, k, demandFor(i, season, qa, centralShared, types[s.type][1], 1, ppb[1]),
          demandFor(i, season, qb, centralShared, types[s.type][1], 1, ppb[1]), "model");
      });
      ["max_travel_min", "urban_producer_weight"].forEach(k => {
        sw(C.SHARED[k].note, k, demandFor(i, season, q0, {...centralShared, [k]: shared[k][0]}, types[s.type][1], 1, ppb[1]),
          demandFor(i, season, q0, {...centralShared, [k]: shared[k][2]}, types[s.type][1], 1, ppb[1]), "shared");
      });
      const sdC = shared.local_variation_sd[1];
      sw(perCapEvidence.district ? `Local production differs from the ${perCapEvidence.district} District average` : "Local production differs from the national average", "local_variation",
        demandFor(i, season, q0, centralShared, types[s.type][1], Math.exp(-1.645 * sdC), ppb[1]),
        demandFor(i, season, q0, centralShared, types[s.type][1], Math.exp(1.645 * sdC), ppb[1]), "local");
      sw("Share of volume this kind of site handles", "type_mult",
        demandFor(i, season, q0, centralShared, types[s.type][0], 1, ppb[1]),
        demandFor(i, season, q0, centralShared, types[s.type][2], 1, ppb[1]), "type");
      sw(ppbInfo.calibrated ? "People per building (WorldPop calibration ±20%)" : country.persons_per_building.note, "persons_per_building",
        demandFor(i, season, q0, centralShared, types[s.type][1], 1, ppb[0]),
        demandFor(i, season, q0, centralShared, types[s.type][1], 1, ppb[2]), "people");
      return out.sort((a, b) => b.swing - a.swing).slice(0, 6);
    }

    // 11. Data coverage
    const aKm2 = areaKm2(area, P);
    const bpk = B ? nInside / aKm2 : null, rkm = G ? (G.lengthM / 1000) / bboxAreaKm2(area.bbox) : null;
    const coverageClass = bpk === null || rkm === null ? "unknown" :
      bpk >= 100 && rkm >= 2 ? "well" : (bpk >= 20 || rkm >= 0.8) ? "partly" : "thin";
    const COVER_TEXT = {well: "well mapped", partly: "partly mapped", thin: "thinly mapped", unknown: "of unknown mapping quality"};
    const haze = [], harvest = [];
    const CELL = aKm2 > 800 ? 2000 : 1000;
    if (B || G) {
      const bc = new Map(), rc = new Map(), key = (x, y) => Math.floor(x / CELL) + "," + Math.floor(y / CELL);
      if (B) for (let b = 0; b < B.n; b++) {
        const k = key(B.xs[b], B.ys[b]);
        let o = bc.get(k); if (!o) { o = {all: 0, rural: 0}; bc.set(k, o); }
        o.all++; if (!urban[b]) o.rural++;
      }
      if (G) for (let v = 0; v < G.n; v++) { const k = key(G.vx[v], G.vy[v]); rc.set(k, (rc.get(k) || 0) + 1); }
      const x0 = Math.floor(P.x(area.bbox[0]) / CELL), x1 = Math.floor(P.x(area.bbox[2]) / CELL);
      const y0 = Math.floor(P.y(area.bbox[1]) / CELL), y1 = Math.floor(P.y(area.bbox[3]) / CELL);
      for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) {
        const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL;
        if (!inGeometry(area.polygon, P.lon(cx), P.lat(cy))) continue;
        const ring = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1], [i, j]].map(([a, b]) => [+P.lon(a * CELL).toFixed(5), +P.lat(b * CELL).toFixed(5)]);
        const b = bc.get(i + "," + j), r = rc.get(i + "," + j) || 0;
        if ((!b || b.all === 0) && r < 3) haze.push({type: "Feature", properties: {}, geometry: {type: "Polygon", coordinates: [ring]}});
        if (b && perCapT !== null) {
          const t = (b.rural + centralShared.urban_producer_weight * (b.all - b.rural)) * ppb[1] * perCapT;
          if (t > 0) harvest.push({type: "Feature", properties: {t: Math.round(t), buildings: b.all}, geometry: {type: "Polygon", coordinates: [ring]}});
        }
      }
    }
    step("coverage", "Checked how well the area is mapped", `${COVER_TEXT[coverageClass]}: ${bpk === null ? "?" : Math.round(bpk)} buildings/km², ${rkm === null ? "?" : rkm.toFixed(1)} km of road per km²; ${haze.length} empty-looking cells marked as "not yet known"`);

    // 12. Simpler baseline: everyone counts, straight-line nearest site, no roads, no assumptions.
    let baseline = null;
    if (B && eligible.length) {
      const idx = new GridIndex(1000); eligible.forEach((s, i) => idx.add(i, s.x, s.y));
      const cnt = new Float64Array(eligible.length);
      for (let b = 0; b < B.n; b++) {
        if (inside && !inside[b]) continue;
        const n = idx.nearest(B.xs[b], B.ys[b], 15000); if (n) cnt[n.id]++;
      }
      const bTop = Array.from(cnt).map((v, i) => [v, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, K).map(([, i]) => eligible[i].id);
      const fullTop = results.dry.map((r, i) => [r.rank, i]).filter(([r]) => r && r <= K).map(([, i]) => eligible[i].id);
      baseline = {method: "Every mapped building counts equally and goes to the nearest site in a straight line (no roads, no travel limit, no value-chain assumptions).",
        top: bTop, overlap: fullTop.filter(id => bTop.includes(id)).length, k: Math.min(K, fullTop.length)};
    }
    step("baseline", "Compared with a simpler method", baseline ? `Straight-line headcount agrees on ${baseline.overlap} of ${baseline.k} sites` : "Not possible without buildings", baseline ? "done" : "failed");

    // 13. Assemble sites with questions and evidence
    const ctype = (t) => C.SITE_TYPES[t];
    const sites = eligible.map((s, i) => {
      const dry = results.dry[i], rainy = results.rainy[i], sup = supply[i];
      const drivers = dry.rank && dry.rank <= K * 2 ? tornado(i, "dry") : [];
      const pts = seasons.dry.per[i].pts.map(b => [+B.lons[b].toFixed(5), +B.lats[b].toFixed(5)]);
      const solar = climate && climate.psh_min && dry.kwh_day ? {
        kwp: dry.kwh_day.central / (climate.psh_min * centralShared.pv_performance_ratio),
        kwp_p95: dry.kwh_day.p95 / (climate.psh_min * shared.pv_performance_ratio[0]),
        psh_min: climate.psh_min} : null;
      const name = s.name || `${ctype(s.type).short} near ${nearestPlaceName(s, allSites) || coord(s)}`;
      const q = questionFor(model, s, sup, drivers, ctype(s.type).documented, coverageClass, perCapEvidence.district);
      return {
        id: s.id, source: s.source, confidence: s.confidence, category: s.category,
        osm_url: s.source === "overture" ? `https://explore.overturemaps.org/#17/${s.lat.toFixed(5)}/${s.lon.toFixed(5)}` : `https://www.openstreetmap.org/${s.osm_type}/${s.osm_id}`,
        name, named: !!s.name,
        type: s.type, type_label: ctype(s.type).label, documented: ctype(s.type).documented,
        lon: s.lon, lat: s.lat, tags: s.tags,
        dry, rainy, supply: sup, solar, drivers, question: q.main, followups: q.more,
        siting_pct: s.siting_pct === undefined ? null : s.siting_pct,
        catchment_points: pts,
        evidence: {
          location: {label: ctype(s.type).documented ? "OBSERVED" : "INFERRED",
            text: !ctype(s.type).documented ? "Settlement centre used as a possible collection point; no facility is mapped here" :
              s.source === "overture" ? `Listed in Overture Maps places (category ${s.category || "?"}, confidence ${s.confidence ?? "?"}); not field verified` :
              "Mapped in OpenStreetMap; not field verified"},
          people: {label: B ? "ESTIMATED" : "UNKNOWN", text: B ? (B.provider === "overture" ? "Building footprints (OpenStreetMap, Google, Microsoft via Overture) within travel time" : "Mapped buildings within travel time") +
            (ppbInfo.calibrated ? " × people per building calibrated to WorldPop" : " × persons per building (assumption)") : "No building data"},
          need: {label: dry.kwh_day ? "ESTIMATED" : "UNKNOWN", text: dry.kwh_day ? "Screening model with unapproved assumptions; range from simulation" : perCapEvidence.note},
          supply: {label: sup.state === "unknown" ? "UNKNOWN" : "INFERRED",
            text: sup.state === "grid_near" ? "A mapped line or substation is close; connection and capacity unknown" :
              sup.state === "grid_mid" ? "Mapped grid within 5 km; connection unknown" :
              sup.state === "grid_not_mapped" ? "No grid mapped within 5 km; it may exist but be unmapped" : "No power data"}
        }
      };
    });
    // Two villages called "Cyamabuye" must not read as one place: tell same-named sites apart by direction.
    const byName = new Map();
    sites.forEach(s => { if (!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push(s); });
    byName.forEach(group => {
      if (group.length < 2) return;
      const lons = group.map(s => s.lon), lats = group.map(s => s.lat);
      const ew = Math.max(...lons) - Math.min(...lons) >= (Math.max(...lats) - Math.min(...lats));
      group.sort((a, b) => ew ? a.lon - b.lon : b.lat - a.lat);
      group.forEach((s, k) => {
        // Unnamed stand-ins ("Village near Kora Market") are told apart by where they are; named places by direction.
        s.name += !s.named ? ` (${s.lat.toFixed(3)}, ${s.lon.toFixed(3)})` :
          group.length === 2 ? (ew ? [" (west)", " (east)"] : [" (north)", " (south)"])[k] :
          ` (${k + 1} of ${group.length}, ${ew ? "west to east" : "north to south"})`;
      });
    });
    const context = allSites.filter(s => !model.types[s.type]).map(s => ({id: s.id, name: s.name || ctype(s.type).short, type: s.type,
      type_label: ctype(s.type).label, lon: s.lon, lat: s.lat}));

    const layers = {
      roads: G ? {type: "FeatureCollection", features: G.ways.map(w => ({type: "Feature",
        properties: {highway: w.highway, surface: w.surface, rain: w.rain, major: /^(motorway|trunk|primary|secondary|tertiary)/.test(w.highway) ? 1 : 0},
        geometry: {type: "LineString", coordinates: w.coords}}))} : null,
      power: PW ? {type: "FeatureCollection", features: PW.lines.map(l => ({type: "Feature", properties: {kind: l.kind, voltage: l.voltage},
        geometry: {type: "LineString", coordinates: l.coords}})).concat(PW.points.map(p => ({type: "Feature",
        properties: {kind: p.kind, source: p.source, name: p.name}, geometry: {type: "Point", coordinates: [p.lon, p.lat]}})))} : null,
      haze: {type: "FeatureCollection", features: haze},
      harvest: {type: "FeatureCollection", features: harvest},
      area: area.polygon ? {type: "Feature", properties: {}, geometry: area.polygon} : null
    };

    const out = {
      meta: {schema: "enagis-live-v1", area: {name: area.name, display_name: area.display_name, bbox: area.bbox, country_code: area.country_code,
        area_km2: aKm2}, model: {id: model.id, name: model.name, short: model.short, service: model.service, commodity: model.commodity},
        country: {id: country.id, name: country.name}, per_capita: {t: perCapT, evidence: perCapEvidence},
        seed, draws, top_k: K, generated_at: input.retrieved_at || null, elapsed_ms: 0, warnings,
        ambient_c: ambient, sources: input.sources || []},
      steps, climate,
      coverage: {class: coverageClass, text: COVER_TEXT[coverageClass], buildings_per_km2: bpk, road_km_per_km2: rkm,
        documented: docCount, settlements: allSites.length - docCount, haze_cells: haze.length, cell_m: CELL,
        snapped_dry: seasons.dry.snapped, buildings: nInside},
      sites, context, baseline, layers, siting,
      population: pop ? {total: pop.total, year: pop.year, dataset: pop.dataset, per_building: ppbInfo.calibrated ? ppbInfo.range[1] : null} : null,
      building_sources: bSources, providers: {buildings: B ? B.provider : null, roads: G ? G.provider : null, power: PW ? PW.provider : null},
      assumptions: {model: model.params, shared: C.SHARED, types: model.types, persons_per_building: ppbInfo,
        overrides}
    };
    if (simulationTrace) {
      out.simulation_trace = {site_ids: eligible.map(s => s.id), seasons: simulationTrace};
      // Reporting counterfactuals only, using the same demand function and shipped endpoints.
      // Common scalars may move magnitudes without moving ranks. Never assert a flip if none occurs.
      const targets = eligible.map((s, i) => ({s, i})).filter(x => results.dry[x.i].rank && results.dry[x.i].rank <= 3);
      const checks = [];
      const variants = [
        ...Object.entries(model.params).map(([key, v]) => ({key, range:overrides[key] || v.range, kind:'model'})),
        ...['max_travel_min','urban_producer_weight'].map(key => ({key, range:shared[key], kind:'shared'})),
        ...Object.entries(types).map(([type, range]) => ({key:'type_' + type, type, range, kind:'type'})),
        {key:'persons_per_building', range:ppb, kind:'people'}];
      for (const variant of (targets.length ? variants : [])) for (const side of [0, 2]) {
        const value = variant.range[side];
        const order = eligible.map((s, i) => {
          const r = demandFor(i, 'dry', variant.kind === 'model' ? {...q0, [variant.key]:value} : q0,
            variant.kind === 'shared' ? {...centralShared, [variant.key]:value} : centralShared,
            variant.kind === 'type' && s.type === variant.type ? value : types[s.type][1], 1,
            variant.kind === 'people' ? value : ppb[1]);
          return {id:s.id, value:r.out ? r.out.kwh_day : -1};
        }).sort((a,b) => b.value - a.value || (a.id < b.id ? -1 : 1));
        for (const {s} of targets) checks.push({site_id:s.id, key:variant.key, value, rank:order.findIndex(r => r.id === s.id) + 1});
      }
      for (const {s, i} of targets) for (const side of [-1, 1]) {
        const value = Math.exp(side * 1.645 * shared.local_variation_sd[1]);
        const r = demandFor(i, 'dry', q0, centralShared, types[s.type][1], value, ppb[1]);
        const order = eligible.map((other, j) => ({id:other.id, value:j === i ? r.out.kwh_day : results.dry[j].kwh_day.central}))
          .sort((a,b) => b.value - a.value || (a.id < b.id ? -1 : 1));
        checks.push({site_id:s.id, key:'local_variation', value, rank:order.findIndex(r => r.id === s.id) + 1});
      }
      out.ranking_sensitivity = {label:'ESTIMATED', method:'One-at-a-time shipped endpoints; local factor uses existing tornado exp(±1.645 × central log-SD). All other sites/parameters central.', checks};
    }
    out.narrative = narrate(out, "dry");
    out.meta.elapsed_ms = Date.now() - t0;
    return out;
  }

  // The district an area belongs to, when it lies inside one (a district, or a sector/cell whose address names it).
  // Areas spanning several districts (a province, a drawn map view) return null and use the national figure.
  function districtOf(area, country) {
    if (!country.districts || !area) return null;
    const names = Object.keys(country.districts);
    const clean = s => String(s || "").replace(/\s+district$/i, "").trim().toLowerCase();
    const own = clean(area.name);
    const hit = names.find(n => n.toLowerCase() === own);
    if (hit && /district|county|state_district/i.test((area.kind || "") + " " + (area.display_name || "").split(",")[0] + " " + area.name)) return hit;
    if (hit && !area.kind) return hit;
    const parts = String(area.display_name || "").split(",").map(clean).slice(1);
    for (const p of parts) { const m = names.find(n => n.toLowerCase() === p); if (m) return m; }
    return hit || null;
  }

  function coord(s) { return `${s.lat.toFixed(3)}, ${s.lon.toFixed(3)}`; }
  function nearestPlaceName(s, all) {
    let best = null, bd = Infinity;
    all.forEach(o => {
      if (o === s || !o.name) return;
      const d = Math.hypot(o.x - s.x, o.y - s.y);
      if (d < bd && d < 5000) { bd = d; best = o.name; }
    });
    return best;
  }

  function questionFor(model, s, sup, drivers, documented, coverage, district) {
    const more = [];
    let main;
    const top = drivers[0] ? drivers[0].key : "capture_share";
    if (!documented) {
      main = `Is there a place in ${s.name || "this centre"} where farmers bring ${model.commodity.replace("_", " ")} today? Who runs it?`;
      more.push(model.question_volume);
    } else if (/capture_share|peak|type_mult|storage_days|operating_days|harvest_window/.test(top)) {
      main = model.question_volume;
    } else if (top === "local_variation") {
      main = `Ask the sector agronomist: is ${model.commodity.replace("_", " ")} production around here above or below the ${district ? district + " District" : "national"} average?`;
      more.push(model.question_volume);
    } else if (top === "max_travel_min") {
      main = "How far do farmers travel to deliver here? Name the furthest villages that supply it.";
      more.push(model.question_volume);
    } else if (top === "persons_per_building") {
      main = "Are most mapped buildings around here homes of farming households?";
      more.push(model.question_volume);
    } else {
      main = model.question_volume;
    }
    if (sup.state === "grid_near") more.push("Is the site connected to the grid? What is the connection size, and how often is power cut?");
    else if (sup.state === "grid_mid") more.push("How far is the nearest grid connection really, and is an extension planned?");
    else if (sup.state === "grid_not_mapped") more.push("What powers the site today (grid, diesel, solar, none)? The map shows no grid within 5 km.");
    if (coverage === "thin") more.push("This area is thinly mapped: check whether other collection points exist nearby.");
    return {main, more: more.slice(0, 3)};
  }

  function fmt(x) {
    const r = round2sig(x);
    if (r === null) return "UNKNOWN";
    return r >= 100 ? Math.round(r).toLocaleString("en") : String(r);
  }

  function narrate(res, season) {
    const m = res.meta, sites = res.sites, K = m.top_k;
    const ranked = sites.filter(s => s[season].rank && s[season].rank <= K).sort((a, b) => a[season].rank - b[season].rank);
    const paras = [];
    const docs = sites.filter(s => s.documented).length;
    const headline = ranked.length ?
      `${ranked.length} places to check first in ${m.area.name} for ${m.model.short.toLowerCase()}` :
      `No ranking for ${m.area.name} yet`;
    paras.push(`EnaGIS searched ${m.area.name} (${fmt(m.area.area_km2)} km²) and found ${res.coverage.documented} mapped facilities and ${res.coverage.settlements} town or village centres. ${sites.length} of them could handle ${m.model.commodity.replace("_", " ")} (${docs} facilities, ${sites.length - docs} centres). The map here is ${res.coverage.text}.`);
    if (ranked.length && ranked[0][season].kwh_day) {
      const tot = ranked.reduce((s, r) => s + r[season].kwh_day.central, 0);
      const robust = ranked.filter(r => r[season].tier === "Robust").length;
      const lead = ranked[0];
      paras.push(`The first site to check is ${lead.name}: about ${fmt(lead[season].kwh_day.central)} kWh per peak day (range ${fmt(lead[season].kwh_day.p5)} to ${fmt(lead[season].kwh_day.p95)}), from roughly ${fmt(lead[season].people)} people within reach. Together the top ${ranked.length} need about ${fmt(tot)} kWh per peak day.`);
      paras.push(ranked[0][season].tier_basis === "top_k_share" ?
        `${robust} of the ${ranked.length} stay in the top ${K} in at least 80% of ${m.draws} simulations; the others depend on assumptions to check by phone first.` :
        `${robust} of the ${ranked.length} keep almost the same rank across ${m.draws} simulations; the others move when assumptions change.`);
      const near = ranked.filter(r => r.supply.state === "grid_near").length, far = ranked.filter(r => r.supply.state === "grid_not_mapped").length;
      paras.push(`${near} of them have a mapped power line within 500 m and ${far} have none mapped within 5 km. Mapped lines do not prove a connection.`);
    } else if (m.per_capita.t === null) {
      paras.push(`Energy requirements are UNKNOWN because there is no production figure for ${m.country.name}. Enter one under Assumptions to run the estimate.`);
    }
    if (res.baseline && sites.length > K) paras.push(`A simpler straight-line headcount agrees on ${res.baseline.overlap} of ${res.baseline.k} sites, so road catchments and value-chain assumptions change ${res.baseline.k - res.baseline.overlap} of the choices.`);
    else if (res.baseline) paras.push(`Only ${sites.length} candidate sites fit this value chain here, so every one is on the list. Check whether other collection points exist but are not mapped.`);
    return {headline, paragraphs: paras};
  }

  function areaOf(area) { return areaKm2(area, projector(area.bbox)); }

  // Training rows for the siting model from one gathered area (used by the harvest, never by the app's ranking).
  function sitingRows(input, label) {
    const SIT = root.EnaSiting;
    if (!SIT) throw new Error("siting module not loaded");
    const area = input.area, P = projector(area.bbox);
    const B = parseBuildings(input.osm.buildings, P), G = parseRoads(input.osm.roads, P), PW = parsePower(input.osm.power, P);
    const sites = parseSites(input.osm.sites, area, P);
    const cs = SIT.cells({P, area, inGeometry, GridIndex, B, urban: B ? urbanMask(B) : null, G, PW,
      settlements: parseSettlements(input.osm.sites, P), sites});
    return {label, cells: cs.cells.length, roofs: cs.roofs, roads: cs.roads, power: cs.power, settlements: cs.settlements,
      buildings: B ? B.n : 0, documented: sites.filter(s => SIT.LABEL_TYPES[s.type]).length,
      positives: cs.cells.filter(c => c.y).length, rows: cs.cells.map(c => SIT.row(c, label)),
      facilities: sites.filter(s => SIT.LABEL_TYPES[s.type] || SIT.ANY_TYPES[s.type]).map(s => ({type: s.type, name: s.name, lon: +s.lon.toFixed(5), lat: +s.lat.toFixed(5), source: s.source}))};
  }
  return {analyze, narrate, areaOf, classifySite, sitingRows, parseSettlements, parseClimate, parseRoads, parseBuildings, parsePower, mulberry32, triangular, quantile, round2sig, fmt, bboxAreaKm2,
    projector, inGeometry, GridIndex, Heap, dijkstra};
}
(function (root) {
  // The factory is also serialised into a Web Worker by app.js, so it must stay self-contained.
  root.enaEngineFactory = enaEngineFactory;
  root.EnaEngine = enaEngineFactory(root);
  if (typeof module !== "undefined") module.exports = root.EnaEngine;
})(typeof window !== "undefined" ? window : globalThis);
