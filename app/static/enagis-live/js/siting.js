/* EnaGIS siting model (Phase 4R, Rwanda): where are agricultural processing and storage facilities likely to be?
 *
 * Unit: 1 km grid cell. Label: the cell holds at least one DOCUMENTED processing or storage facility
 * (mill, milk collection centre, cold store, coffee washing station, agricultural warehouse, agro-processing works)
 * in OpenStreetMap or Overture places. Unlabelled cells are background, not proven absences.
 * Features come only from layers that never encode the label: building footprints (count and roof size,
 * Google/Microsoft/OSM via Overture), roads, the mapped power network and settlement points.
 * Model: L2-regularised logistic regression on standardised features, balanced weights.
 * Test: leave-one-district-out, compared with single-signal baselines (people, density, road, town, grid).
 *
 * Pure and deterministic (no network, no DOM). Serialised into the analysis Web Worker by app.js, so the
 * factory must stay self-contained.
 */
function enaSitingFactory(root) {
  "use strict";
  const CELL = 1000;
  // Facility types that process or store produce (the label). Markets, cooperatives' offices and input shops are not.
  const LABEL_TYPES = {mill: 1, milk_centre: 1, cold_store: 1, coffee_station: 1, warehouse: 1, agro_factory: 1, tea_factory: 1};
  // Wider label used only as a sensitivity check: any documented aggregation point.
  const ANY_TYPES = {...LABEL_TYPES, market: 1, cooperative: 1};
  const CAP = {d_maj: 15000, d_pow: 25000, d_set: 15000};

  const FEATURES = [
    {id: "log_bld", label: "Buildings in the cell", hi: "many buildings", lo: "few buildings", f: r => Math.log1p(r.nb)},
    {id: "log_bld_2km", label: "Buildings within about 2 km", hi: "busy surroundings", lo: "quiet surroundings", f: r => Math.log1p(r.nbN)},
    {id: "log_roof200", label: "Roofs of 200 m² or more", hi: "large roofs (200 m² +)", lo: "no large roofs", f: r => Math.log1p(r.n200), roof: true},
    {id: "log_roof600", label: "Roofs of 600 m² or more", hi: "very large roofs (600 m² +)", lo: "no very large roofs", f: r => Math.log1p(r.n600), roof: true},
    {id: "log_roof_max", label: "Largest roof in the cell", hi: "one big roof", lo: "only small roofs", f: r => Math.log1p(r.amax), roof: true},
    {id: "major_road_km", label: "Major road length in the cell", hi: "a major road runs through", lo: "no major road inside", f: r => Math.min(r.maj_km, 5)},
    {id: "log_minor_road_km", label: "Minor roads and tracks", hi: "dense local roads", lo: "few local roads", f: r => Math.log1p(r.min_km)},
    {id: "log_dist_major_road", label: "Distance to a major road", hi: "away from major roads", lo: "close to a major road", f: r => Math.log1p(r.d_maj / 1000)},
    {id: "log_dist_power", label: "Distance to the mapped grid", hi: "away from the mapped grid", lo: "close to the mapped grid", f: r => Math.log1p(r.d_pow / 1000)},
    {id: "log_dist_centre", label: "Distance to a town or village centre", hi: "away from town centres", lo: "near a town or village centre", f: r => Math.log1p(r.d_set / 1000)},
    {id: "urban_share", label: "Share of buildings in dense blocks", hi: "dense built-up blocks", lo: "rural setting", f: r => r.urb}
  ];
  // Display rule (not part of the evaluation): a look-alike must hold at least one roof of 150 m² or more,
  // since a processing or storage facility needs a building.
  const CAND_MIN_ROOF = 150;
  // Single-signal baselines: higher score = more likely. Each needs no training.
  const BASELINES = {
    people: {label: "Most buildings (people) in the cell", f: r => r.nb},
    density: {label: "Most buildings within 2 km", f: r => r.nbN},
    road: {label: "Closest to a major road", f: r => -r.d_maj},
    town: {label: "Closest to a town or village centre", f: r => -r.d_set},
    grid: {label: "Closest to the mapped grid", f: r => -r.d_pow}
  };

  // ------------------------------------------------------------ cell features
  /* ctx: {P, area, inGeometry, GridIndex, B: {n, xs, ys, areas?}, inside: Uint8Array|null, urban: Uint8Array,
   *       G: parsed roads or null, PW: parsed power or null, settlements: [{x,y}], sites: [{x,y,type,name,id}]} */
  function cells(ctx) {
    const {P, area, B, G, PW} = ctx;
    const key = (i, j) => i * 100003 + j;
    const map = new Map();
    const b = area.bbox;
    const i0 = Math.floor(P.x(b[0]) / CELL), i1 = Math.floor(P.x(b[2]) / CELL);
    const j0 = Math.floor(P.y(b[1]) / CELL), j1 = Math.floor(P.y(b[3]) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cx = (i + 0.5) * CELL, cy = (j + 0.5) * CELL, lon = P.lon(cx), lat = P.lat(cy);
      if (!ctx.inGeometry(area.polygon, lon, lat)) continue;
      map.set(key(i, j), {i, j, lon, lat, px: cx, py: cy, nb: 0, nbN: 0, n200: 0, n600: 0, amax: 0, urbN: 0,
        maj_km: 0, min_km: 0, d_maj: CAP.d_maj, d_pow: CAP.d_pow, d_set: CAP.d_set, urb: 0, y: 0, y_any: 0, sites: []});
    }
    const hasRoof = !!(B && B.areas);
    // Buildings (all buildings feed the 2 km density, including those just outside the boundary).
    const counts = new Map();
    if (B) for (let k = 0; k < B.n; k++) {
      const i = Math.floor(B.xs[k] / CELL), j = Math.floor(B.ys[k] / CELL), kk = key(i, j);
      counts.set(kk, (counts.get(kk) || 0) + 1);
      const c = map.get(kk);
      if (!c) continue;
      c.nb++;
      if (ctx.urban && ctx.urban[k]) c.urbN++;
      if (hasRoof) { const a = B.areas[k]; if (a >= 200) c.n200++; if (a >= 600) c.n600++; if (a > c.amax) c.amax = a; }
    }
    map.forEach(c => {
      let s = 0;
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) s += counts.get(key(c.i + di, c.j + dj)) || 0;
      c.nbN = s; c.urb = c.nb ? c.urbN / c.nb : 0;
    });
    // Roads: length per cell (densified every 100 m) and a point index of major roads.
    let majIdx = null;
    if (G && G.ways) {
      majIdx = new ctx.GridIndex(1000); let mid = 0;
      G.ways.forEach(w => {
        const major = /^(motorway|trunk|primary|secondary|tertiary)(_link)?$/.test(w.highway);
        for (let q = 1; q < w.coords.length; q++) {
          const ax = P.x(w.coords[q - 1][0]), ay = P.y(w.coords[q - 1][1]), bx = P.x(w.coords[q][0]), by = P.y(w.coords[q][1]);
          const len = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(len / 100));
          for (let s = 0; s < steps; s++) {
            const t = (s + 0.5) / steps, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
            const c = map.get(key(Math.floor(x / CELL), Math.floor(y / CELL)));
            if (c) { if (major) c.maj_km += len / steps / 1000; else c.min_km += len / steps / 1000; }
            if (major) majIdx.add(mid++, x, y);
          }
        }
      });
    }
    // Settlement points (raw list, independent of facilities).
    const setIdx = new ctx.GridIndex(2000);
    (ctx.settlements || []).forEach((s, k) => setIdx.add(k, s.x, s.y));
    map.forEach(c => {
      if (majIdx) { const n = majIdx.nearest(c.px, c.py, CAP.d_maj); c.d_maj = n ? n.d : CAP.d_maj; }
      if (PW && PW.index) { const n = PW.index.nearest(c.px, c.py, CAP.d_pow); c.d_pow = n ? n.d : CAP.d_pow; }
      const n = setIdx.nearest(c.px, c.py, CAP.d_set); c.d_set = n ? n.d : CAP.d_set;
    });
    // Labels.
    (ctx.sites || []).forEach(s => {
      const c = map.get(key(Math.floor(s.x / CELL), Math.floor(s.y / CELL)));
      if (!c) return;
      if (LABEL_TYPES[s.type]) { c.y = 1; c.sites.push({id: s.id, type: s.type, name: s.name || null}); }
      if (ANY_TYPES[s.type]) c.y_any = 1;
    });
    const out = Array.from(map.values());
    return {cell_m: CELL, roofs: hasRoof, roads: !!majIdx, power: !!(PW && PW.index), settlements: (ctx.settlements || []).length, cells: out};
  }

  // Compact row for the training table (rounded, small).
  function row(c, district) {
    const r3 = v => Math.round(v * 1000) / 1000, r5 = v => Math.round(v * 1e5) / 1e5;
    return {district, lon: r5(c.lon), lat: r5(c.lat), nb: c.nb, nbN: c.nbN, n200: c.n200, n600: c.n600, amax: Math.round(c.amax),
      maj_km: r3(c.maj_km), min_km: r3(c.min_km), d_maj: Math.round(c.d_maj), d_pow: Math.round(c.d_pow), d_set: Math.round(c.d_set),
      urb: r3(c.urb), y: c.y, y_any: c.y_any, sites: c.sites.map(s => s.type).join("|"), names: c.sites.map(s => s.name || "").join("|")};
  }

  function design(rows, feats) {
    return rows.map(r => feats.map(F => F.f(r)));
  }

  // ------------------------------------------------------------ logistic regression (IRLS, L2, balanced)
  function solve(A, b) {
    const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c]; if (Math.abs(d) < 1e-12) continue;
      for (let r = 0; r < n; r++) { if (r === c) continue; const f = M[r][c] / d; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => Math.abs(r[i]) < 1e-12 ? 0 : r[n] / r[i]);
  }
  function fit(X, y, opts) {
    opts = opts || {};
    const lambda = opts.lambda ?? 1, n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0), sd = new Array(d).fill(0);
    X.forEach(x => x.forEach((v, k) => { mean[k] += v / n; }));
    X.forEach(x => x.forEach((v, k) => { sd[k] += (v - mean[k]) ** 2 / n; }));
    for (let k = 0; k < d; k++) sd[k] = Math.sqrt(sd[k]) || 1;
    const Z = X.map(x => [1].concat(x.map((v, k) => (v - mean[k]) / sd[k])));
    const npos = y.reduce((a, v) => a + v, 0), nneg = n - npos;
    const wPos = npos ? n / (2 * npos) : 1, wNeg = nneg ? n / (2 * nneg) : 1;
    let beta = new Array(d + 1).fill(0);
    for (let it = 0; it < 50; it++) {
      const H = Array.from({length: d + 1}, () => new Array(d + 1).fill(0)), g = new Array(d + 1).fill(0);
      for (let i = 0; i < n; i++) {
        const z = Z[i]; let eta = 0; for (let k = 0; k <= d; k++) eta += beta[k] * z[k];
        const p = 1 / (1 + Math.exp(-eta)), w = y[i] ? wPos : wNeg, r = w * (y[i] - p), h = w * p * (1 - p);
        for (let a = 0; a <= d; a++) { g[a] += r * z[a]; const ha = h * z[a]; for (let c = a; c <= d; c++) H[a][c] += ha * z[c]; }
      }
      for (let a = 0; a <= d; a++) for (let c = 0; c < a; c++) H[a][c] = H[c][a];
      for (let k = 1; k <= d; k++) { g[k] -= lambda * beta[k]; H[k][k] += lambda; }
      const step = solve(H, g);
      let mx = 0; beta = beta.map((v, k) => { mx = Math.max(mx, Math.abs(step[k])); return v + step[k]; });
      if (mx < 1e-7) break;
    }
    return {intercept: beta[0], coef: beta.slice(1), mean, sd, lambda, n, npos};
  }
  function logit(m, x) { let s = m.intercept; for (let k = 0; k < x.length; k++) s += m.coef[k] * (x[k] - m.mean[k]) / m.sd[k]; return s; }

  // ------------------------------------------------------------ metrics
  // Positives captured in the top share k of cells, with ties at the cut-off counted fractionally (expected value
  // under random tie-breaking), so a coarse score is not flattered or punished by an arbitrary order.
  function captured(scores, y, k) {
    const n = scores.length, m = Math.max(1, Math.ceil(k * n));
    const idx = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
    const cut = scores[idx[m - 1]];
    let gt = 0, posGt = 0, eq = 0, posEq = 0;
    for (let i = 0; i < n; i++) {
      if (scores[i] > cut) { gt++; posGt += y[i]; } else if (scores[i] === cut) { eq++; posEq += y[i]; }
    }
    return posGt + posEq * (m - gt) / eq;
  }
  function auc(scores, y) {
    const idx = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b]);
    let rankSum = 0, npos = 0, i = 0;
    while (i < idx.length) {
      let j = i; while (j + 1 < idx.length && scores[idx[j + 1]] === scores[idx[i]]) j++;
      const r = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) if (y[idx[k]]) { rankSum += r; npos++; }
      i = j + 1;
    }
    const nneg = y.length - npos;
    return npos && nneg ? (rankSum - npos * (npos + 1) / 2) / (npos * nneg) : null;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y), pos = (s.length - 1) * p, lo = Math.floor(pos), hi = Math.ceil(pos); return s[lo] + (s[hi] - s[lo]) * (pos - lo); };

  // ------------------------------------------------------------ the registered comparison
  /* rows: training table rows; protocol: {label: "y"|"y_any", ks: [0.1, 0.2], lambda, draws, seed, min_pos, min_blocks} */
  function evaluate(rows, protocol) {
    const P = {label: "y", ks: [0.1, 0.2], lambda: 1, draws: 2000, seed: 20261011, min_pos: 60, min_blocks: 6, ...(protocol || {})};
    const lab = r => r[P.label] ? 1 : 0;
    const districts = Array.from(new Set(rows.map(r => r.district))).sort();
    const byD = new Map(districts.map(d => [d, rows.filter(r => r.district === d)]));
    const posBlocks = districts.filter(d => byD.get(d).some(lab));
    const npos = rows.filter(lab).length;
    const arms = {model: FEATURES, model_no_roofs: FEATURES.filter(F => !F.roof)};
    const per = {}; // per[district][arm] = {n, pos, cap: {k: captured}, scores}
    const pooled = {}; // arm -> {scores: [], y: []}
    const allArms = Object.keys(arms).concat(Object.keys(BASELINES));
    allArms.forEach(a => { pooled[a] = {scores: [], y: []}; });
    const coefs = [];
    districts.forEach(d => {
      const test = byD.get(d), y = test.map(lab);
      per[d] = {n: test.length, pos: y.reduce((a, v) => a + v, 0), arms: {}};
      const train = rows.filter(r => r.district !== d);
      Object.entries(arms).forEach(([a, feats]) => {
        const m = fit(design(train, feats), train.map(lab), {lambda: P.lambda});
        if (a === "model") coefs.push({district: d, coef: m.coef});
        const s = design(test, feats).map(x => logit(m, x));
        per[d].arms[a] = {cap: P.ks.map(k => captured(s, y, k))};
        pooled[a].scores.push(...s); pooled[a].y.push(...y);
      });
      Object.entries(BASELINES).forEach(([a, B]) => {
        const s = test.map(B.f);
        per[d].arms[a] = {cap: P.ks.map(k => captured(s, y, k))};
        pooled[a].scores.push(...s); pooled[a].y.push(...y);
      });
    });
    const recall = (blocks, a, ki) => { let c = 0, p = 0; blocks.forEach(d => { c += per[d].arms[a].cap[ki]; p += per[d].pos; }); return p ? c / p : null; };
    const point = {}; allArms.forEach(a => { point[a] = {recall: P.ks.map((k, ki) => recall(posBlocks, a, ki)), auc: auc(pooled[a].scores, pooled[a].y)}; });
    // Cluster bootstrap over districts with documented positives.
    const rnd = mulberry32(P.seed), boot = {}, margin = P.ks.map(() => []), marginNoRoof = P.ks.map(() => []);
    allArms.forEach(a => { boot[a] = P.ks.map(() => []); });
    for (let t = 0; t < P.draws; t++) {
      const sample = posBlocks.map(() => posBlocks[Math.floor(rnd() * posBlocks.length)]);
      P.ks.forEach((k, ki) => {
        const v = {}; allArms.forEach(a => { v[a] = recall(sample, a, ki); boot[a][ki].push(v[a]); });
        const best = Math.max(...Object.keys(BASELINES).map(a => v[a]));
        margin[ki].push(v.model - best); marginNoRoof[ki].push(v.model - v.model_no_roofs);
      });
    }
    const ci = arr => arr.length ? [q(arr, 0.025), q(arr, 0.975)] : null;
    const bestBaseline = P.ks.map((k, ki) => Object.keys(BASELINES).sort((a, b) => point[b].recall[ki] - point[a].recall[ki])[0]);
    const gate = npos >= P.min_pos && posBlocks.length >= P.min_blocks;
    const m0 = margin[0].length ? ci(margin[0]) : null;
    const verdict = !gate ? "FEASIBILITY" : m0 && m0[0] > 0 ? "KEEP" : "KILL";
    // Coefficient stability across folds (sign agreement).
    const signs = FEATURES.map((F, k) => { const v = coefs.map(c => c.coef[k]); return {feature: F.id, label: F.label, mean: v.reduce((a, x) => a + x, 0) / v.length, positive_share: v.filter(x => x > 0).length / v.length}; });
    return {
      protocol: P, cells: rows.length, districts: districts.length, positive_cells: npos, positive_districts: posBlocks.length, gate,
      arms: allArms.map(a => ({arm: a, label: a === "model" ? "EnaGIS siting model (all features)" : a === "model_no_roofs" ? "Same model without roof-size features" : BASELINES[a].label,
        recall: P.ks.map((k, ki) => ({k, point: point[a].recall[ki], ci: ci(boot[a][ki])})), auc: point[a].auc})),
      best_baseline: bestBaseline,
      margin: P.ks.map((k, ki) => ({k, point: point.model.recall[ki] - point[bestBaseline[ki]].recall[ki], ci: ci(margin[ki])})),
      roof_gain: P.ks.map((k, ki) => ({k, point: point.model.recall[ki] - point.model_no_roofs.recall[ki], ci: ci(marginNoRoof[ki])})),
      verdict, coefficient_stability: signs,
      per_district: districts.map(d => ({district: d, cells: per[d].n, positives: per[d].pos,
        model_captured_10: per[d].arms.model.cap[0], best_baseline_captured_10: per[d].arms[bestBaseline[0]].cap[0]}))
    };
  }

  // Final model on all rows (frozen for use in the app).
  function train(rows, opts) {
    const P = {label: "y", lambda: 1, ...(opts || {})};
    const m = fit(design(rows, FEATURES), rows.map(r => r[P.label] ? 1 : 0), {lambda: P.lambda});
    return {schema: "enagis-siting-v1", features: FEATURES.map(F => F.id), intercept: m.intercept, coef: m.coef, mean: m.mean, sd: m.sd,
      lambda: m.lambda, trained_on: {cells: m.n, positive_cells: m.npos, label: P.label}};
  }

  // ------------------------------------------------------------ use in the app
  /* points: [{x, y}] (projected, same projector as the cells) -> percentile of the cell each point falls in. */
  function apply(model, cellSet, points) {
    if (!model || !cellSet || !cellSet.cells.length) return null;
    const ids = FEATURES.map(F => F.id);
    if (model.features.join() !== ids.join()) return {status: "model_mismatch"};
    if (!cellSet.roofs || !cellSet.roads) return {status: "missing_inputs", missing: [!cellSet.roofs ? "building footprint sizes" : null, !cellSet.roads ? "roads" : null].filter(Boolean)};
    const X = design(cellSet.cells, FEATURES);
    const s = X.map(x => logit(model, x));
    const order = s.map((v, i) => i).sort((a, b) => s[b] - s[a]);
    const pct = new Float32Array(s.length);
    order.forEach((i, r) => { pct[i] = 1 - r / Math.max(1, s.length - 1); });
    const n = s.length, topN = Math.max(1, Math.ceil(n * 0.1));
    const top = order.slice(0, topN);
    // Count and exclude with the label the model was trained on (y: processing or storage; y_any: + markets and cooperatives).
    const lab = model.trained_on && model.trained_on.label === "y_any" ? "y_any" : "y";
    const labelled = cellSet.cells.filter(c => c[lab]).length;
    const capturedTop = top.filter(i => cellSet.cells[i][lab]).length;
    // Strongest-looking cells with no documented point of that kind: worth a check.
    const candidates = order.filter(i => !cellSet.cells[i][lab] && !cellSet.cells[i].y && cellSet.cells[i].amax >= CAND_MIN_ROOF).slice(0, 12).map((i, r) => {
      const c = cellSet.cells[i];
      return {rank: r + 1, lon: c.lon, lat: c.lat, percentile: pct[i], prob: 1 / (1 + Math.exp(-s[i])), nb: c.nb, n200: c.n200, n600: c.n600, amax: c.amax,
        d_maj: c.d_maj, d_pow: c.d_pow, d_set: c.d_set, why: reasons(model, X[i])};
    });
    const at = new Map(); cellSet.cells.forEach((c, i) => at.set(c.i * 100003 + c.j, i));
    const point_pct = (points || []).map(p => { const i = at.get(Math.floor(p.x / CELL) * 100003 + Math.floor(p.y / CELL)); return i === undefined ? null : pct[i]; });
    return {
      status: "ok", cell_m: CELL, cells: n, top_share: 0.1, label: lab, documented_cells: labelled, documented_in_top: capturedTop,
      candidates, point_pct,
      grid: cellSet.cells.map((c, i) => ({i: c.i, j: c.j, lon: c.lon, lat: c.lat, p: pct[i], y: c[lab]}))
    };
  }
  // Top contributions (coefficient x standardised value) in plain words, with the direction the value goes.
  function reasons(model, x) {
    const parts = FEATURES.map((F, k) => { const z = (x[k] - model.mean[k]) / model.sd[k]; return {text: z >= 0 ? F.hi : F.lo, v: model.coef[k] * z}; });
    return parts.filter(p => p.v > 0.05).sort((a, b) => b.v - a.v).slice(0, 3).map(p => p.text);
  }

  return {CELL, LABEL_TYPES, ANY_TYPES, FEATURES: FEATURES.map(F => ({id: F.id, label: F.label, roof: !!F.roof})), BASELINES: Object.fromEntries(Object.entries(BASELINES).map(([k, v]) => [k, v.label])),
    cells, row, fit, logit, captured, auc, evaluate, train, apply, design: (rows) => design(rows, FEATURES), reasons};
}
(function (root) {
  root.enaSitingFactory = enaSitingFactory;
  root.EnaSiting = enaSitingFactory(root);
  if (typeof module !== "undefined") module.exports = root.EnaSiting;
})(typeof window !== "undefined" ? window : globalThis);
