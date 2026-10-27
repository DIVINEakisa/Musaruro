/* Reporting on the shipped simulation; never used for fitting, demand or ranking. */
(function (root) {
  'use strict';
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const centered = a => { const m = a.reduce((s, v) => s + v, 0) / a.length; return a.map(v => v - m); };
  // Average sequential orthogonal projections over deterministic shuffled orders and their reverses.
  // Non-negative contributions sum to the linear model's explained variance; residual is explicit.
  // This is a descriptive allocation of sample variance, NOT a causal/Sobol decomposition or a
  // partition of the p5–p95 interval. No simulation draw or scientific parameter changes here.
  function varianceContributions(columns, values) {
    const keys = Object.keys(columns), xs = keys.map(k => centered(columns[k]));
    const y = centered(values), total = dot(y, y), shares = keys.map(() => 0);
    if (!total) return {rows: keys.map(key => ({key, fraction: 0})), residual: 0, explained: 0};
    let state = 407;
    const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const permutations = 64;
    for (let p = 0; p < permutations / 2; p++) {
      const order = keys.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
      for (const seq of [order, order.slice().reverse()]) {
        const basis = [];
        for (const i of seq) {
          let v = xs[i].slice();
          // Reorthogonalisation controls numerical error for correlated predictors.
          for (let pass = 0; pass < 2; pass++) for (const b of basis) { const f = dot(v, b); v = v.map((x, j) => x - f * b[j]); }
          const norm = Math.sqrt(dot(v, v));
          if (norm < 1e-9) continue;
          v = v.map(x => x / norm); basis.push(v);
          shares[i] += dot(y, v) ** 2 / total / permutations;
        }
      }
    }
    const explained = Math.min(1, shares.reduce((a, b) => a + b, 0));
    return {rows: keys.map((key, i) => ({key, fraction: shares[i]})).sort((a, b) => b.fraction - a.fraction),
      explained, residual: Math.max(0, 1 - explained), orders: permutations};
  }
  function report(result, season = 'dry') {
    const trace = result.simulation_trace;
    if (!trace || !trace.seasons[season].length) return null;
    const draws = trace.seasons[season], top = result.sites.filter(s => s[season].rank).sort((a, b) => a[season].rank - b[season].rank);
    const first = top[0], i = trace.site_ids.indexOf(first.id), columns = {};
    for (const key of Object.keys(draws[0].q)) columns[key] = draws.map(d => d.q[key]);
    for (const key of ['max_travel_min', 'urban_producer_weight', 'local_variation_sd']) columns[key] = draws.map(d => d.shared[key]);
    columns.type_mult = draws.map(d => d.types[first.type]);
    columns.persons_per_building = draws.map(d => d.persons_per_building);
    columns.local_variation = draws.map(d => d.local[i]);
    // Compressor hours affect kW, not kWh; keep the structural zero out of chance correlations.
    delete columns.run_hours;
    const variance = varianceContributions(columns, draws.map(d => d.kwh[i]));
    return {label: 'ESTIMATED', method: 'Order-averaged linear sample-variance allocation (64 deterministic orders)',
      caveat: 'Descriptive associations in the existing draws, not causal effects or a decomposition of the interval. Correlated inputs share credit; residual includes nonlinear effects.',
      site_id: first.id, season, draws: draws.length, variance,
      rank_exits: top.slice(0, 3).map(s => ({site_id: s.id, name: s.name,
        outside_top10: draws.filter(d => d.order.indexOf(s.id) >= 10).length,
        drivers: s.drivers.slice(0, 3).map(d => d.key)}))};
  }
  const api = {varianceContributions, report};
  root.EnaHeroReport = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
