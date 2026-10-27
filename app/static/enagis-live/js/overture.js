/* EnaGIS Live: Overture Maps reader.
 * Reads the public Overture PMTiles archives tile by tile (HTTP range requests straight from the browser)
 * and converts what the engine needs into the same shapes the OpenStreetMap gatherer produces:
 *  - buildings  -> one point per footprint (Google Open Buildings + Microsoft ML + OpenStreetMap, merged by Overture)
 *  - roads      -> ways with an OSM-style highway class and surface, joined across tile edges
 *  - power      -> lines, towers, substations, generators (Overture base theme, from OpenStreetMap)
 *  - places     -> agricultural places from Overture's places theme (Meta and Microsoft listings)
 * Each tile's converted result is cached in the browser, so a second search nearby is fast and works offline.
 */
(function (root) {
  "use strict";
  const C = root.EnaConfig, O = C.OVERTURE;
  const PLACE_RULES_VERSION = 2; // bump whenever PLACE_RULES or NAME_PATTERNS change

  // ------------------------------------------------------------ release discovery
  let releaseP = null, pinnedBad = false;
  function release() {
    if (O.pinned_release && !pinnedBad) return Promise.resolve(O.pinned_release);
    if (releaseP) return releaseP;
    releaseP = (async () => {
      try {
        const cached = JSON.parse(localStorage.getItem("enagis-live:overture-release") || "null");
        if (cached && Date.now() - cached.t < 864e5) return cached.v;
      } catch (e) { /* storage blocked */ }
      try {
        const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 10000);
        const cat = await fetch(O.catalog, {signal: ctl.signal, cache: "no-store"}).then(r => r.json());
        clearTimeout(timer);
        const v = cat.latest || O.fallback_release;
        try { localStorage.setItem("enagis-live:overture-release", JSON.stringify({t: Date.now(), v})); } catch (e) { /* ignore */ }
        return v;
      } catch (e) { return O.fallback_release; }
    })();
    return releaseP;
  }
  const archives = new Map();
  function archive(rel, theme, i) {
    const hosts = O.mirrors && O.mirrors.length ? O.mirrors : [O.tiles], h = hosts[(i || 0) % hosts.length];
    const k = h + rel + "/" + theme;
    if (!archives.has(k)) archives.set(k, new root.EnaTiles.PMTiles(`${h}${rel}/${theme}.pmtiles`));
    return archives.get(k);
  }
  function url(rel, theme) { return `${O.tiles}${rel}/${theme}.pmtiles`; }

  // ------------------------------------------------------------ tile maths
  const lon2x = (lon, z) => (lon + 180) / 360 * 2 ** z;
  const lat2y = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z; };
  const x2lon = (x, z) => x / 2 ** z * 360 - 180;
  const y2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(Math.sinh(n)); };

  // Tiles at zoom z that touch the area (its boundary when known, else its box).
  function tilesFor(area, z) {
    const b = area.bbox, E = root.EnaEngine;
    const x0 = Math.floor(lon2x(b[0], z)), x1 = Math.floor(lon2x(b[2], z));
    const y0 = Math.floor(lat2y(b[3], z)), y1 = Math.floor(lat2y(b[1], z));
    const g = area.polygon, out = [];
    const verts = [];
    if (g) (g.type === "MultiPolygon" ? g.coordinates : [g.coordinates]).forEach(p => p[0].forEach(c => verts.push(c)));
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      if (!g) { out.push([z, x, y]); continue; }
      const w = x2lon(x, z), e = x2lon(x + 1, z), n = y2lat(y, z), s = y2lat(y + 1, z);
      let hit = false;
      for (let i = 0; i <= 4 && !hit; i++) for (let j = 0; j <= 4 && !hit; j++) {
        if (E.inGeometry(g, w + (e - w) * i / 4, s + (n - s) * j / 4)) hit = true;
      }
      if (!hit) hit = verts.some(([lo, la]) => lo >= w && lo <= e && la >= s && la <= n);
      if (hit) out.push([z, x, y]);
    }
    return out;
  }

  async function pool(items, n, fn) {
    let i = 0;
    const workers = Array.from({length: Math.min(n, items.length)}, async () => {
      while (i < items.length) { const k = i++; await fn(items[k], k); }
    });
    await Promise.all(workers);
  }

  // ------------------------------------------------------------ per-tile converters
  const r6 = v => Math.round(v * 1e6) / 1e6;
  function project(z, x, y, extent) {
    return (p) => [r6(x2lon(x + p.x / extent, z)), r6(y2lat(y + p.y / extent, z))];
  }
  function jsonish(s) { if (!s || typeof s !== "string") return s || null; try { return JSON.parse(s); } catch (e) { return null; } }

  function convBuildings(vt, z, x, y) {
    const L = vt.layers.building, flat = [], area = [], src = {};
    if (!L) return {flat, area, src};
    const P = project(z, x, y, L.extent);
    // Web Mercator is conformal: one tile unit is the same length in x and y, scaled by cos(latitude).
    const latC = y2lat(y + 0.5, z), unitM = 40075016.686 * Math.cos(latC * Math.PI / 180) / 2 ** z / L.extent, unit2 = unitM * unitM;
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), p = f.properties;
      if (p.is_underground === true || p.is_underground === "true") continue;
      const ring = f.loadGeometry()[0];
      if (!ring || !ring.length) continue;
      let sx = 0, sy = 0, a2 = 0; const n = ring.length > 1 ? ring.length - 1 : 1;
      for (let k = 0; k < n; k++) { sx += ring[k].x; sy += ring[k].y; }
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) a2 += ring[j].x * ring[k].y - ring[k].x * ring[j].y;
      const cx = sx / n, cy = sy / n;
      // Keep a building only in the tile that holds its centre (tiles overlap at the edges).
      if (cx < 0 || cy < 0 || cx >= L.extent || cy >= L.extent) continue;
      const c = P({x: cx, y: cy});
      flat.push(c[0], c[1]);
      area.push(Math.round(Math.abs(a2) / 2 * unit2));
      const s = p["@geometry_source"] || "other";
      src[s] = (src[s] || 0) + 1;
    }
    return {flat, area, src};
  }

  function convRoads(vt, z, x, y) {
    const L = vt.layers.segment, out = [];
    if (!L) return out;
    const P = project(z, x, y, L.extent);
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), p = f.properties;
      if (p.subtype !== "road") continue;
      const hw = O.road_class[p.class] || "road";
      const rs = jsonish(p.road_surface);
      const surface = Array.isArray(rs) && rs[0] && rs[0].value ? rs[0].value : null;
      f.loadGeometry().forEach(line => {
        if (line.length < 2) return;
        const onEdge = (q) => q.x <= 0 || q.y <= 0 || q.x >= L.extent || q.y >= L.extent;
        out.push({id: p.id, hw, surface, name: p["@name"] || null, coords: line.map(P),
          cut: [onEdge(line[0]), onEdge(line[line.length - 1])]});
      });
    }
    return out;
  }

  function convPower(vt, z, x, y) {
    const L = vt.layers.infrastructure, out = [];
    if (!L) return out;
    const P = project(z, x, y, L.extent);
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), p = f.properties;
      if (p.subtype !== "power") continue;
      const tags = jsonish(p.source_tags) || {};
      const cls = p.class;
      const geom = f.loadGeometry();
      if (/^(power_line|minor_line|cable)$/.test(cls)) {
        geom.forEach(line => { if (line.length > 1) out.push({k: "line", power: cls === "power_line" ? "line" : cls, voltage: tags.voltage || null, coords: line.map(P)}); });
      } else if (/^(power_tower|power_pole|portal)$/.test(cls)) {
        out.push({k: "tower", coords: [P(geom[0][0])]});
      } else if (/^(substation|plant|generator|transformer)$/.test(cls)) {
        const ring = geom[0]; let sx = 0, sy = 0; ring.forEach(q => { sx += q.x; sy += q.y; });
        out.push({k: "point", power: cls, name: p["@name"] || tags.name || null,
          source: tags["generator:source"] || tags["plant:source"] || null, operator: tags.operator || null,
          voltage: tags.voltage || null, coords: [P({x: sx / ring.length, y: sy / ring.length})]});
      }
    }
    return out;
  }

  function classifyPlace(p) {
    const R = C.PLACE_RULES, N = C.NAME_PATTERNS;
    const conf = +p.confidence || 0;
    if (conf < R.min_confidence) return null;
    const tx = jsonish(p.taxonomy) || {};
    const primary = String(tx.primary || p.basic_category || "");
    const hier = (tx.hierarchy || []).join(">");
    const name = String(p["@name"] || "").trim();
    if (R.name_exclude.test(name)) return null;
    if (R.exclude.test(primary)) {
      // A clearly agricultural name can still rescue a mis-categorised listing (e.g. a cooperative filed as "professional_service").
      if (/(government|religious|marketing|printing|computer|software|hotel|restaurant|coffee_shop|church|school|hospital|bank)/.test(primary)) return null;
      if (N.cooperative.test(name)) return {type: "cooperative", primary, conf};
      if (/(\bamata\b|\bmcc\b|milk collection)/i.test(name)) return {type: "milk_centre", primary, conf};
      return null;
    }
    for (const [re, type] of R.category) {
      if (!(re.test(primary) || re.test(hier.split(">").pop() || ""))) continue;
      if (R.needs_agri_name.includes(type) && !N.agri.test(name)) return null;
      return {type, primary, conf};
    }
    if (N.cooperative.test(name)) return {type: "cooperative", primary, conf};
    if (/(\bamata\b|\bmcc\b|milk collection|laiterie)/i.test(name)) return {type: "milk_centre", primary, conf};
    if (N.cold_store.test(name)) return {type: "cold_store", primary, conf};
    if (/(minoterie|maize mill|flour mill|kawunga)/i.test(name)) return {type: "mill", primary, conf};
    if (/(^|\s)(isoko|march[eé])(\s|$)/i.test(name)) return {type: "market", primary, conf};
    return null;
  }
  function convPlaces(vt, z, x, y) {
    const L = vt.layers.place, out = [];
    if (!L) return out;
    const P = project(z, x, y, L.extent);
    for (let i = 0; i < L.length; i++) {
      const f = L.feature(i), p = f.properties;
      const g = f.loadGeometry()[0][0];
      if (g.x < 0 || g.y < 0 || g.x >= L.extent || g.y >= L.extent) continue;
      const c = classifyPlace(p);
      if (!c) continue;
      const pos = P(g);
      out.push({id: p.id, name: p["@name"] || null, type: c.type, category: c.primary, confidence: Math.round(c.conf * 100) / 100,
        lon: pos[0], lat: pos[1]});
    }
    return out;
  }
  const CONVERT = {buildings: convBuildings, transportation: convRoads, base: convPower, places: convPlaces};

  // ------------------------------------------------------------ fetch one theme over an area
  async function theme(area, themeName, z, onProgress) {
    const rel = await release();
    const tiles = tilesFor(area, z);
    if (tiles.length > O.max_tiles) throw new Error(`area needs ${tiles.length} map tiles (limit ${O.max_tiles}); search a smaller area`);

    const results = new Array(tiles.length);
    let done = 0, failed = 0, fromCache = 0, lastErr = null;
    const db = root.EnaSources && root.EnaSources.db;
    await pool(tiles, O.concurrency, async ([tz, tx, ty], k) => {
      // Buildings carry footprint area since cache format 2; older cached tiles are fetched again.
      // Cache format: buildings carry footprint area since v2; places are stored already classified, so their key
      // carries the classification-rules version and a rule change never reuses stale types.
      const key = `ovt${themeName === "buildings" ? "2" : themeName === "places" ? "p" + PLACE_RULES_VERSION : ""}:${rel}:${themeName}:${tz}/${tx}/${ty}`;
      let v = db ? await db.get(key) : null;
      if (v) { results[k] = v.v; fromCache++; }
      else {
        for (let attempt = 0; attempt < 2 && results[k] === undefined; attempt++) {
          try {
            // Spread tiles over the bucket's addresses; on a retry use the next one.
            const r = await archive(rel, themeName, k + attempt).getZxy(tz, tx, ty);
            const conv = r && r.data ? CONVERT[themeName](new root.EnaTiles.VectorTile(new root.EnaTiles.Pbf(new Uint8Array(r.data))), tz, tx, ty) : null;
            results[k] = conv || (themeName === "buildings" ? {flat: [], area: [], src: {}} : []);
            if (db) db.set(key, results[k]);
          } catch (e) { lastErr = e; }
        }
        if (results[k] === undefined) failed++;
      }
      done++;
      if (onProgress) onProgress(done, tiles.length, results);
    });
    if (failed && failed === tiles.length) {
      // The pinned release may have been withdrawn: try the latest release once before giving up.
      if (rel === O.pinned_release && !pinnedBad) { pinnedBad = true; return theme(area, themeName, z, onProgress); }
      throw lastErr || new Error("Overture tiles unavailable");
    }
    return {release: rel, url: url(rel, themeName), tiles: tiles.length, failed, cached: fromCache === tiles.length, results: results.filter(r => r !== undefined)};
  }

  // ------------------------------------------------------------ assemble engine inputs
  function buildingsJSON(parts) {
    let n = 0; parts.forEach(p => { n += p.flat.length; });
    const flat = new Array(n), areas = new Array(n / 2), src = {};
    let o = 0, a = 0, allAreas = true;
    parts.forEach(p => {
      for (let i = 0; i < p.flat.length; i++) flat[o++] = p.flat[i];
      if (p.area && p.area.length * 2 === p.flat.length) for (let i = 0; i < p.area.length; i++) areas[a++] = p.area[i];
      else { allAreas = false; a += p.flat.length / 2; }
      Object.entries(p.src).forEach(([k, v]) => { src[k] = (src[k] || 0) + v; });
    });
    return {compact: "flat", flat, areas: allAreas ? areas : null, sources: src, provider: "overture"};
  }

  // Roads: pieces of the same segment are cut at tile edges; join them, and join segments that meet.
  function roadsJSON(parts) {
    const pieces = [].concat(...parts);
    const lat0 = pieces.length ? pieces[0].coords[0][1] : 0;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
    const SNAP = 1.5, cells = new Map(), vx = [], vy = [];
    const cellKey = (cx, cy) => cx * 1000003 + cy;
    function vertex(lon, lat) {
      const x = lon * kx, y = lat * ky, cx = Math.floor(x / SNAP), cy = Math.floor(y / SNAP);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const list = cells.get(cellKey(cx + i, cy + j));
        if (list) for (const v of list) if (Math.abs(vx[v] - x) <= SNAP && Math.abs(vy[v] - y) <= SNAP) return v;
      }
      const v = vx.length; vx.push(x); vy.push(y);
      const k = cellKey(cx, cy); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(v);
      return v;
    }
    const elements = [], bySeg = new Map();
    pieces.forEach((pc, i) => {
      const nodes = pc.coords.map(c => vertex(c[0], c[1]));
      elements.push({type: "way", id: `ovt:${pc.id}:${i}`, tags: {highway: pc.hw, ...(pc.surface ? {surface: pc.surface} : {}), ...(pc.name ? {name: pc.name} : {})},
        nodes, geometry: pc.coords.map(c => ({lon: c[0], lat: c[1]}))});
      if (!bySeg.has(pc.id)) bySeg.set(pc.id, []);
      bySeg.get(pc.id).push({i, nodes, pc});
    });
    // Tiles overlap by a small buffer, so the piece in one tile ends a little inside the next tile and the
    // next piece starts a little inside this one. Link each cut end to the nearest cut end of another piece
    // of the same segment (they lie on the same road, ~2 buffers apart), else to its nearest vertex.
    let links = 0;
    bySeg.forEach(list => {
      if (list.length < 2) return;
      list.forEach(a => [0, a.nodes.length - 1].forEach((endIdx, e) => {
        if (!a.pc.cut[e]) return;
        const v = a.nodes[endIdx]; let best = -1, bd = 250;
        list.forEach(b => { if (b === a) return; [0, b.nodes.length - 1].forEach((k, j) => { if (!b.pc.cut[j]) return; const w = b.nodes[k];
          const d = Math.hypot(vx[w] - vx[v], vy[w] - vy[v]); if (d < bd && w !== v) { bd = d; best = w; } }); });
        if (best < 0) { bd = 80; list.forEach(b => { if (b === a) return; b.nodes.forEach(w => { const d = Math.hypot(vx[w] - vx[v], vy[w] - vy[v]); if (d < bd && w !== v) { bd = d; best = w; } }); }); }
        if (best >= 0) {
          links++;
          elements.push({type: "way", id: `ovt-link:${a.pc.id}:${a.i}:${e}`, tags: {highway: a.pc.hw, ...(a.pc.surface ? {surface: a.pc.surface} : {})},
            nodes: [v, best], geometry: [{lon: vx[v] / kx, lat: vy[v] / ky}, {lon: vx[best] / kx, lat: vy[best] / ky}], link: true});
        }
      }));
    });
    return {elements, provider: "overture", links};
  }

  function powerJSON(parts) {
    const elements = []; let id = 0;
    [].concat(...parts).forEach(f => {
      if (f.k === "line") elements.push({type: "way", id: `ovt-p${id++}`, tags: {power: f.power, ...(f.voltage ? {voltage: f.voltage} : {})},
        geometry: f.coords.map(c => ({lon: c[0], lat: c[1]}))});
      else if (f.k === "tower") elements.push({type: "node", id: `ovt-p${id++}`, lon: f.coords[0][0], lat: f.coords[0][1], tags: {power: "tower"}});
      else elements.push({type: "node", id: `ovt-p${id++}`, lon: f.coords[0][0], lat: f.coords[0][1], tags: {power: f.power,
        ...(f.name ? {name: f.name} : {}), ...(f.source ? {"generator:source": f.source} : {}), ...(f.operator ? {operator: f.operator} : {}),
        ...(f.voltage ? {voltage: f.voltage} : {})}});
    });
    return {elements, provider: "overture"};
  }

  function placesJSON(parts) {
    const seen = new Set(), elements = [];
    [].concat(...parts).forEach(p => {
      if (seen.has(p.id)) return; seen.add(p.id);
      elements.push({type: "overture", id: p.id, lon: p.lon, lat: p.lat, tags: {name: p.name || undefined, "enagis:type": p.type,
        "enagis:source": "overture", "enagis:category": p.category, "enagis:confidence": p.confidence}});
    });
    return {elements, provider: "overture"};
  }

  root.EnaOverture = {release, tilesFor, theme, buildingsJSON, roadsJSON, powerJSON, placesJSON, classifyPlace, url,
    LICENCE: {
      buildings: "ODbL 1.0 · Overture Maps Foundation; © OpenStreetMap contributors, Google Open Buildings (CC BY 4.0 / ODbL), Microsoft ML Building Footprints (ODbL)",
      transportation: "ODbL 1.0 · Overture Maps Foundation; © OpenStreetMap contributors",
      base: "ODbL 1.0 · Overture Maps Foundation; © OpenStreetMap contributors",
      places: "CDLA-Permissive-2.0 · Overture Maps Foundation (Meta, Microsoft)"
    }};
})(typeof window !== "undefined" ? window : globalThis);
