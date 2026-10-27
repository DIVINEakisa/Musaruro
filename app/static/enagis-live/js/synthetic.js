/* Offline demo data: a SYNTHETIC area (invented roads, buildings and sites) so the interface can be
 * explored without internet. The app shows a "SYNTHETIC DATA" ribbon whenever this is loaded.
 * Nothing here describes a real place. */
(function (root) {
  "use strict";
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function makeSynthetic(seed) {
    const r = rng(seed || 7);
    const W = 29.45, S = -1.65, E = 29.75, N = -1.35;
    const bbox = [W, S, E, N];
    let nid = 1, wid = 1;
    const ids = new Map(), roads = [];
    const node = (lon, lat) => { const k = lon.toFixed(5) + "," + lat.toFixed(5); if (!ids.has(k)) ids.set(k, nid++); return ids.get(k); };
    const way = (pts, tags) => roads.push({type: "way", id: wid++, nodes: pts.map(p => node(p[0], p[1])), geometry: pts.map(([lon, lat]) => ({lon, lat})), tags});
    const wobble = (x0, y0, x1, y1, n, amp) => Array.from({length: n + 1}, (_, i) => {
      const t = i / n, j = (i === 0 || i === n) ? 0 : (r() - 0.5) * amp;
      return [+(x0 + (x1 - x0) * t + j).toFixed(5), +(y0 + (y1 - y0) * t + j).toFixed(5)];
    });
    // Trunk roads
    way(wobble(W, -1.50, E, -1.48, 60, 0.004), {highway: "primary", surface: "asphalt"});
    way(wobble(29.60, S, 29.58, N, 60, 0.004), {highway: "secondary", surface: "asphalt"});
    way(wobble(W, -1.40, E, -1.62, 60, 0.004), {highway: "tertiary"});
    // Feeder roads and paths
    for (let k = 0; k < 26; k++) {
      const x = W + r() * (E - W), y = S + r() * (N - S), x2 = x + (r() - 0.5) * 0.14, y2 = y + (r() - 0.5) * 0.14;
      way(wobble(x, y, x2, y2, 14, 0.003), {highway: k % 3 === 0 ? "unclassified" : "track", surface: k % 3 === 0 ? "gravel" : "dirt"});
    }
    for (let k = 0; k < 40; k++) {
      const x = W + r() * (E - W), y = S + r() * (N - S);
      way(wobble(x, y, x + (r() - 0.5) * 0.06, y + (r() - 0.5) * 0.06, 8, 0.002), {highway: "path"});
    }
    // Settlement clusters with buildings
    const clusters = Array.from({length: 22}, () => ({x: W + 0.02 + r() * (E - W - 0.04), y: S + 0.02 + r() * (N - S - 0.04), n: 150 + Math.floor(r() * 900), s: 0.004 + r() * 0.012}));
    clusters.push({x: 29.596, y: -1.492, n: 2600, s: 0.006}); // market town
    const buildings = [];
    let bid = 1;
    clusters.forEach(c => { for (let i = 0; i < c.n; i++) {
      const a = r() * 2 * Math.PI, d = Math.sqrt(-2 * Math.log(r() + 1e-9)) * c.s;
      buildings.push({type: "way", id: 5e6 + bid++, center: {lon: +(c.x + Math.cos(a) * d).toFixed(6), lat: +(c.y + Math.sin(a) * d).toFixed(6)}});
    }});
    for (let i = 0; i < 4000; i++) buildings.push({type: "way", id: 5e6 + bid++, center: {lon: +(W + r() * (E - W)).toFixed(6), lat: +(S + r() * (N - S) * 0.6).toFixed(6)}});
    // Sites: invented names, obviously synthetic
    const kinds = [["amenity", "marketplace", "Market"], ["office", "cooperative", "Cooperative"], ["craft", "miller", "Mill"],
      ["building", "warehouse", "Store"], ["industrial", "dairy", "Milk centre"], ["shop", "agrarian", "Farm shop"]];
    const sites = [];
    clusters.forEach((c, i) => {
      const k = kinds[i % kinds.length];
      sites.push({type: "node", id: 100 + i, lat: +(c.y + 0.001).toFixed(6), lon: +(c.x + 0.001).toFixed(6), tags: {[k[0]]: k[1], name: `Synthetic ${k[2]} ${String.fromCharCode(65 + i)}`}});
      if (i % 2 === 0) sites.push({type: "node", id: 300 + i, lat: +(c.y + 0.012).toFixed(6), lon: +(c.x - 0.01).toFixed(6), tags: {place: "village", name: `Synthetic Village ${i + 1}`}});
    });
    const line = (x0, y0, x1, y1, n) => Array.from({length: n + 1}, (_, i) => ({lon: x0 + (x1 - x0) * i / n, lat: y0 + (y1 - y0) * i / n}));
    const power = [
      {type: "way", id: 9001, tags: {power: "line", voltage: "30000"}, geometry: line(W, -1.497, E, -1.477, 30)},
      {type: "way", id: 9002, tags: {power: "minor_line"}, geometry: line(29.597, -1.49, 29.58, -1.38, 20)},
      {type: "node", id: 9003, lat: -1.493, lon: 29.60, tags: {power: "substation", name: "Synthetic substation"}},
      {type: "node", id: 9004, lat: -1.60, lon: 29.70, tags: {power: "generator", "generator:source": "solar"}}
    ];
    const time = [], tmax = [], tmean = [], rain = [], sw = [];
    for (let d = 0; d < 366; d++) {
      const date = new Date(Date.UTC(2024, 0, 1) + d * 864e5).toISOString().slice(0, 10), m = +date.slice(5, 7);
      time.push(date); tmax.push(23 + Math.sin((d - 200) / 58) * 2.5); tmean.push(18 + Math.sin((d - 200) / 58) * 1.5);
      rain.push([3, 4, 5, 10, 11].includes(m) ? 5 + r() * 4 : r() * 2); sw.push(15 + Math.cos(d / 58) * 2.5);
    }
    return {
      area: {name: "Synthetic District", display_name: "Synthetic test area · invented data, not a real place", bbox, polygon: null, country_code: "rw", kind: "synthetic"},
      osm: {sites: {elements: sites}, roads: {elements: roads}, buildings: {elements: buildings}, power: {elements: power}},
      climate: {latitude: -1.5, longitude: 29.6, elevation: 1800, daily: {time, temperature_2m_max: tmax, temperature_2m_mean: tmean, precipitation_sum: rain, shortwave_radiation_sum: sw}},
      retrieved_at: "synthetic", synthetic: true,
      sources: [{id: "synthetic", label: "Synthetic demo data (invented)", licence: "None: not real data", endpoint: "built into the app", retrieved_at: "n/a"}]
    };
  }
  root.ENA_SYNTH = () => makeSynthetic(7);
  if (typeof module !== "undefined") module.exports = {makeSynthetic};
})(typeof window !== "undefined" ? window : globalThis);
