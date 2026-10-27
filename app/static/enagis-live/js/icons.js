/* EnaGIS Live: map symbols for facilities, settlements and power infrastructure.
 * One glyph per kind (24 × 24, drawn with white strokes on a coloured disc). The same paths are used
 * for the map (canvas images), the numbered pins, the list and the legend, so they always match.
 */
(function (root) {
  "use strict";
  const DEFS = {
    market:        {color: "#C77D1A", label: "Market",
      d: "M4 9h16l-1.5-4h-13z M4 9c0 1.4 1.1 2.5 2.7 2.5S9.3 10.4 9.3 9c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.1 2.5 2.6 2.5S20 10.4 20 9 M6 12v7h12v-7 M10 19v-4h4v4"},
    cooperative:   {color: "#1E8A5A", label: "Cooperative",
      d: "M8.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M15.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z M4 19c0-2.8 2-4.5 4.5-4.5S13 16.2 13 19 M11 19c0-2.8 2-4.5 4.5-4.5S20 16.2 20 19"},
    milk_centre:   {color: "#2F7FB8", label: "Milk collection centre",
      d: "M9 3h6 M9.5 3v2.5L7.5 8v11.5a1.5 1.5 0 0 0 1.5 1.5h6a1.5 1.5 0 0 0 1.5-1.5V8l-2-2.5V3 M7.5 12h9"},
    cold_store:    {color: "#1F9BBF", label: "Cold store",
      d: "M12 3v18 M4.2 7.5l15.6 9 M4.2 16.5l15.6-9 M9.5 4.5 12 6.5l2.5-2 M9.5 19.5l2.5-2 2.5 2"},
    mill:          {color: "#A0662B", label: "Mill",
      d: "M12 21V9 M12 9c-2.2 0-3.5-1.6-3.5-3.8C10.7 5.2 12 6.8 12 9z M12 9c2.2 0 3.5-1.6 3.5-3.8C13.3 5.2 12 6.8 12 9z M12 14c-2.2 0-3.5-1.6-3.5-3.8 2.2 0 3.5 1.6 3.5 3.8z M12 14c2.2 0 3.5-1.6 3.5-3.8-2.2 0-3.5 1.6-3.5 3.8z"},
    warehouse:     {color: "#6A5D4D", label: "Warehouse / store",
      d: "M3 10.5 12 5l9 5.5V20H3z M7 20v-6h10v6 M7 17h10"},
    agro_factory:  {color: "#7A4FA0", label: "Agro-processing",
      d: "M3 20V11l5 3v-3l5 3V7h3l1.5 13z M3 20h18"},
    agro_shop:     {color: "#5E9B2E", label: "Agro-input / farm shop",
      d: "M12 20v-7 M12 13c-3 0-5-2-5-5 3 0 5 2 5 5z M12 15c0-3 2-5 5-5 0 3-2 5-5 5z M6 20h12"},
    tea_factory:   {color: "#3F7D3A", label: "Tea factory",
      d: "M12 20c-4.5-2-6.5-6-5.5-12 4.5 0 8 2 9.5 6-1 3.5-2.5 5-4 6z M12 20c0-4 1-7 3-9"},
    coffee_station:{color: "#6B3E26", label: "Coffee washing station",
      d: "M12 3.5c4 0 6.5 3.8 6.5 8.5s-2.5 8.5-6.5 8.5-6.5-3.8-6.5-8.5S8 3.5 12 3.5z M12 4c-2 3-2 5 0 8s2 5 0 8"},
    town:          {color: "#5B6B7F", label: "Town centre (stand-in)",
      d: "M4 20V10h5v10 M9 20V5h6v15 M15 20v-8h5v8 M3 20h18"},
    village:       {color: "#8A94A3", label: "Village centre (stand-in)",
      d: "M3.5 12 12 5l8.5 7 M6 11v9h12v-9 M10 20v-5h4v5"},
    substation:    {color: "#0B6A8A", label: "Substation", square: true,
      d: "M13.5 5 8 13h4l-1.5 6L16 11h-4z"},
    generator:     {color: "#3D4F63", label: "Generator / power plant",
      d: "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z M13 7.5l-3.5 5h3l-1 4 3.5-5h-3z"},
    solar:         {color: "#E8A317", label: "Solar generator",
      d: "M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6 7 7 M17 17l1.4 1.4 M5.6 18.4 7 17 M17 7l1.4-1.4"}
  };
  const MUTED = "#A9A398";

  // Inline SVG (for HTML: pins, lists, legend).
  function svg(kind, size, opts) {
    const d = DEFS[kind] || DEFS.village, o = opts || {}, bg = o.muted ? MUTED : d.color, s = size || 18;
    const shape = d.square ? `<rect x="1" y="1" width="22" height="22" rx="5" fill="${bg}" stroke="#fff" stroke-width="1.5"/>`
      : `<circle cx="12" cy="12" r="11" fill="${bg}" stroke="#fff" stroke-width="1.5"/>`;
    return `<svg class="ena-ico" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${o.bare ? "" : shape}` +
      `<g transform="translate(12 12) scale(${o.bare ? 1 : 0.62}) translate(-12 -12)"><path d="${d.d}" fill="none" stroke="${o.bare ? "currentColor" : "#fff"}" stroke-width="${o.bare ? 2 : 2.6}" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  }

  // Canvas image (for MapLibre symbol layers). Returns {width, height, data} at the given pixel ratio.
  function image(kind, muted, px, ratio) {
    const d = DEFS[kind] || DEFS.village, r = ratio || 2, size = Math.round((px || 26) * r);
    const c = document.createElement("canvas"); c.width = c.height = size;
    const g = c.getContext("2d"), k = size / 24;
    g.scale(k, k);
    g.shadowColor = "rgba(3,29,50,.35)"; g.shadowBlur = 1.5; g.shadowOffsetY = 0.6;
    g.fillStyle = muted ? MUTED : d.color; g.strokeStyle = "#fff"; g.lineWidth = 1.6;
    g.beginPath();
    if (d.square) { const x = 1.6, w = 20.8, rr = 4.5; g.moveTo(x + rr, x); g.arcTo(x + w, x, x + w, x + w, rr); g.arcTo(x + w, x + w, x, x + w, rr); g.arcTo(x, x + w, x, x, rr); g.arcTo(x, x, x + w, x, rr); g.closePath(); }
    else g.arc(12, 12, 10.6, 0, Math.PI * 2);
    g.fill(); g.shadowColor = "transparent"; g.stroke();
    g.translate(12, 12); g.scale(0.6, 0.6); g.translate(-12, -12);
    g.lineWidth = 2.6; g.lineCap = "round"; g.lineJoin = "round"; g.strokeStyle = "#fff";
    g.stroke(new Path2D(d.d));
    const im = g.getImageData(0, 0, size, size);
    return {width: size, height: size, data: im.data};
  }

  // Register every symbol on a map (idempotent; call after each style load).
  function register(map) {
    Object.keys(DEFS).forEach(k => {
      [false, true].forEach(m => {
        const id = `ico-${k}${m ? "-m" : ""}`;
        if (!map.hasImage(id)) map.addImage(id, image(k, m, 26, 2), {pixelRatio: 2});
      });
    });
  }

  root.EnaIcons = {DEFS, svg, image, register};
})(typeof window !== "undefined" ? window : globalThis);
