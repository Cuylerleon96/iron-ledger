/* chart.js — dependency-free SVG charts, styled for the GBA look:
   a faceted stat hexagon on a dashed white web, with the tier word and a
   coloured delta arrow under each axis. */
const Chart = (() => {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const el = (n, a = {}) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const TIER_COLOR = (s) => s >= 85 ? "#a8e878" : s >= 72 ? "#78c850" : s >= 58 ? "#f8d030" : s >= 44 ? "#f8a038" : s >= 28 ? "#ff9080" : "#f0503c";
  const UP = "#f0503c", DOWN = "#58c8f8";

  /* ---------- RADAR ---------- */
  function radar(host, opts) {
    const { axes = [], max = 100, size = 440, rings = 4, fill = "#a8b8f8", title = "" } = opts;
    host.innerHTML = "";
    const n = axes.length;
    if (!n) return;
    const id = String(title).replace(/\W/g, "") || "c";
    // wider than tall: the left/right axis labels need far more room than the
    // top/bottom ones, and a square box clips them at the card edge.
    const padX = 104, padY = 74, W = size + 40, H = size - 10;
    const cx = W / 2, cy = H / 2 + 2;
    const R = Math.min((W - padX * 2) / 2, (H - padY * 2) / 2);
    const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const pt = (i, r) => [cx + Math.cos(ang(i)) * r, cy + Math.sin(ang(i)) * r];

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "radar", role: "img", "aria-label": title || "stat chart" });

    const defs = el("defs");
    const grad = el("radialGradient", { id: "rg-" + id, cx: "50%", cy: "42%", r: "72%" });
    grad.append(el("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": ".55" }));
    grad.append(el("stop", { offset: "55%", "stop-color": fill, "stop-opacity": ".78" }));
    grad.append(el("stop", { offset: "100%", "stop-color": fill, "stop-opacity": ".52" }));
    defs.append(grad);
    svg.append(defs);

    // web: rings + spokes
    for (let r = rings; r >= 1; r--) {
      const rr = (R * r) / rings, pts = [];
      for (let i = 0; i < n; i++) pts.push(pt(i, rr).join(","));
      svg.append(el("polygon", {
        points: pts.join(" "),
        fill: r === rings ? "rgba(255,255,255,.07)" : "none",
        stroke: "#ffffff", "stroke-opacity": r === rings ? ".85" : ".45",
        "stroke-width": r === rings ? 2.4 : 1.6,
        "stroke-dasharray": r === rings ? "none" : "5 6",
      }));
    }
    for (let i = 0; i < n; i++) {
      const [x, y] = pt(i, R);
      svg.append(el("line", { x1: cx, y1: cy, x2: x, y2: y, stroke: "#ffffff", "stroke-opacity": ".4", "stroke-width": 1.6 }));
    }

    // data polygon + internal facets (gives the faceted in-game look)
    const dpts = axes.map((a, i) => pt(i, (Math.max(0, Math.min(max, a.value)) / max) * R));
    svg.append(el("polygon", {
      points: dpts.map((p) => p.join(",")).join(" "),
      fill: `url(#rg-${id})`, stroke: "#ffffff", "stroke-width": 3,
      "stroke-linejoin": "round", class: "radar-shape",
    }));
    for (let i = 1; i < n; i++) {
      svg.append(el("line", {
        x1: cx, y1: cy, x2: dpts[i][0], y2: dpts[i][1],
        stroke: "#ffffff", "stroke-opacity": ".3", "stroke-width": 1.4, class: "radar-shape",
      }));
    }
    dpts.forEach((p, i) => {
      svg.append(el("circle", { cx: p[0], cy: p[1], r: 6, fill: "#0a2a2a", stroke: "#ffffff", "stroke-width": 2.6 }));
      svg.append(el("circle", { cx: p[0], cy: p[1], r: 2.6, fill: axes[i].color || "#f8d030" }));
    });

    // axis labels: name / tier word / value / delta arrow
    axes.forEach((a, i) => {
      const [lx, ly] = pt(i, R + 26);
      const c = Math.cos(ang(i)), s = Math.sin(ang(i));
      const anchor = Math.abs(c) < 0.3 ? "middle" : c > 0 ? "start" : "end";
      const dx = Math.abs(c) < 0.3 ? 0 : c > 0 ? 5 : -5;
      const baseY = ly - (s < -0.45 ? 24 : s > 0.45 ? -4 : 2);
      const g = el("g", { class: "axis-label" });

      const t1 = el("text", { x: lx + dx, y: baseY, "text-anchor": anchor, class: "ax-name" });
      t1.textContent = a.label; g.append(t1);

      const t2 = el("text", { x: lx + dx, y: baseY + 15, "text-anchor": anchor, class: "ax-tier", fill: TIER_COLOR(a.value) });
      t2.textContent = a.tier || ""; g.append(t2);

      const valText = a.valText !== undefined ? a.valText : Math.round(a.value) + (a.unit || "");
      if (valText !== "") {
        const t3 = el("text", { x: lx + dx, y: baseY + 29, "text-anchor": anchor, class: "ax-val" });
        t3.textContent = valText; g.append(t3);
      }

      if (a.delta !== undefined && a.delta !== null && a.delta !== 0) {
        const up = a.delta > 0;
        const ax = anchor === "middle" ? lx + 26 : anchor === "start" ? lx + Math.max(40, String(a.label).length * 7.6 + 6) : lx - Math.max(40, String(a.label).length * 7.6 + 6);
        const ay = baseY - 10;
        g.append(el("path", {
          d: up ? `M${ax} ${ay - 5} L${ax - 5.5} ${ay + 3} L${ax + 5.5} ${ay + 3} Z` : `M${ax} ${ay + 5} L${ax - 5.5} ${ay - 3} L${ax + 5.5} ${ay - 3} Z`,
          fill: up ? UP : DOWN,
        }));
        const dt = el("text", { x: ax + 8, y: ay + 3, class: "ax-delta", fill: up ? UP : DOWN });
        dt.textContent = (up ? "+" : "") + a.delta; g.append(dt);
      }
      svg.append(g);
    });
    host.append(svg);
  }

  /* ---------- LINE ---------- */
  function line(host, opts) {
    const { points = [], color = "#58c8f8", unit = "", height = 170, fillArea = true } = opts;
    host.innerHTML = "";
    if (points.length < 2) { host.innerHTML = `<div class="empty-chart">Not enough sessions yet — log this twice to see a trend.</div>`; return; }
    const W = 640, H = height, P = { l: 48, r: 14, t: 12, b: 24 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "linechart", preserveAspectRatio: "none" });
    const xs = points.map((p) => new Date(p.x).getTime());
    const ys = points.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs) || x0 + 1;
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const padY = (y1 - y0) * 0.18 || Math.max(1, y1 * 0.05);
    const lo = Math.max(0, y0 - padY), hi = y1 + padY;
    const sx = (v) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (v) => H - P.b - ((v - lo) / (hi - lo || 1)) * (H - P.t - P.b);

    for (let i = 0; i <= 3; i++) {
      const v = lo + ((hi - lo) * i) / 3, y = sy(v);
      svg.append(el("line", { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: "#ffffff", "stroke-opacity": ".22", "stroke-width": 1, "stroke-dasharray": "4 5" }));
      const t = el("text", { x: P.l - 7, y: y + 3.5, "text-anchor": "end", class: "lc-ylab" });
      t.textContent = Math.round(v); svg.append(t);
    }
    const d = points.map((p, i) => `${i ? "L" : "M"}${sx(new Date(p.x).getTime())} ${sy(p.y)}`).join(" ");
    if (fillArea) {
      const gid = "lg" + Math.random().toString(36).slice(2, 7);
      const defs = el("defs"); const g = el("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
      g.append(el("stop", { offset: "0%", "stop-color": color, "stop-opacity": ".5" }));
      g.append(el("stop", { offset: "100%", "stop-color": color, "stop-opacity": ".05" }));
      defs.append(g); svg.append(defs);
      svg.append(el("path", { d: `${d} L${sx(x1)} ${H - P.b} L${sx(x0)} ${H - P.b} Z`, fill: `url(#${gid})` }));
    }
    svg.append(el("path", { d, fill: "none", stroke: color, "stroke-width": 3, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    points.forEach((p) => {
      const c = el("circle", { cx: sx(new Date(p.x).getTime()), cy: sy(p.y), r: 4.6, fill: "#0a2a2a", stroke: "#ffffff", "stroke-width": 2.2 });
      const t = el("title"); t.textContent = `${p.x}: ${Math.round(p.y)}${unit}`; c.append(t);
      svg.append(c);
    });
    host.append(svg);
  }

  /* ---------- MULTI-LINE ---------- */
  /* Several series on SHARED fixed axes. The attribute history must be read
     against one 0-100 scale: auto-fitting each line separately would make a flat
     stat look like a dramatic climb, which is exactly the lie a progress chart
     must not tell. */
  function multi(host, opts) {
    const { series = [], height = 190, fixedMax = 100, unit = "" } = opts;
    host.innerHTML = "";
    const usable = series.filter((s) => (s.points || []).length >= 2);
    if (!usable.length) {
      host.innerHTML = `<div class="empty-chart">Not enough history yet — this fills in as you log.</div>`;
      return;
    }
    const W = 640, H = height, P = { l: 40, r: 12, t: 12, b: 24 };
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "linechart", preserveAspectRatio: "none" });
    const allX = usable.reduce((a, s) => a.concat(s.points.map((p) => new Date(p.x).getTime())), []);
    const x0 = Math.min(...allX), x1 = Math.max(...allX) || x0 + 1;
    const hi = Math.max(1, fixedMax || Math.max(...usable.reduce((a, s) => a.concat(s.points.map((p) => p.y)), [1])));
    const sx = (v) => P.l + ((v - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
    const sy = (v) => H - P.b - (Math.max(0, Math.min(hi, v)) / hi) * (H - P.t - P.b);

    for (let i = 0; i <= 4; i++) {
      const v = (hi * i) / 4, y = sy(v);
      svg.append(el("line", { x1: P.l, y1: y, x2: W - P.r, y2: y, stroke: "#ffffff", "stroke-opacity": ".22", "stroke-width": 1, "stroke-dasharray": "4 5" }));
      const t = el("text", { x: P.l - 6, y: y + 3.5, "text-anchor": "end", class: "lc-ylab" });
      t.textContent = Math.round(v); svg.append(t);
    }
    for (const s of usable) {
      const d = s.points.map((p, i) => `${i ? "L" : "M"}${sx(new Date(p.x).getTime())} ${sy(p.y)}`).join(" ");
      svg.append(el("path", { d, fill: "none", stroke: s.color, "stroke-width": 2.6, "stroke-linejoin": "round", "stroke-linecap": "round" }));
      s.points.forEach((p) => {
        const c = el("circle", { cx: sx(new Date(p.x).getTime()), cy: sy(p.y), r: 3.4, fill: "#0a2a2a", stroke: s.color, "stroke-width": 1.8 });
        const t = el("title"); t.textContent = `${s.label} · ${p.x}: ${Math.round(p.y)}${unit}`;
        c.append(t); svg.append(c);
      });
    }
    host.append(svg);
  }

  /* ---------- YEAR GRID ---------- */
  /* One cell per day, shaded by how much was done. Deliberately ONE hue at
     varying opacity: the only thing encoded is "how much", and a categorical
     palette would imply categories that are not there. */
  function heatmap(host, opts) {
    const { days = {} } = opts;
    host.innerHTML = "";
    const keys = Object.keys(days).sort();       // oldest first
    if (!keys.length) { host.innerHTML = `<div class="empty-chart">No history yet.</div>`; return; }
    const top = Math.max(1, ...keys.map((k) => days[k].sets));
    const grid = document.createElement("div");
    grid.className = "hm-grid";
    // The grid is a picture of a year of training, so it gets a name of its own
    // and every cell carries a TEXT alternative — the same fact as the tooltip,
    // but as an accessible name rather than a title (which many users never see,
    // and which a cell that is only shaded cannot convey at all).
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", `Consistency calendar: ${keys.length} day${keys.length === 1 ? "" : "s"} from ${keys[0]} to ${keys[keys.length - 1]}.`);
    const cellText = (k, d) => `${k}: ${d.sets ? d.sets + (d.sets === 1 ? " set" : " sets") : "rest day"}`;
    // pad the first column so every row is a fixed weekday
    const lead = (new Date(keys[0] + "T12:00:00").getDay() + 6) % 7;   // 0 = Monday
    for (let i = 0; i < lead; i++) {
      const b = document.createElement("i"); b.className = "hm-cell pad"; b.setAttribute("aria-hidden", "true"); grid.append(b);
    }
    for (const k of keys) {
      const d = days[k];
      const lvl = d.sets <= 0 ? 0 : Math.min(4, 1 + Math.floor((d.sets / top) * 4));
      const c = document.createElement("i");
      c.className = "hm-cell l" + lvl;
      c.title = cellText(k, d);
      c.setAttribute("role", "img");
      c.setAttribute("aria-label", cellText(k, d));
      grid.append(c);
    }
    host.append(grid);
  }

  /* ---------- BARS ---------- */
  function bars(host, opts) {
    const { items = [], unit = "", max } = opts;
    host.innerHTML = "";
    const top = max || Math.max(1, ...items.map((i) => i.value));
    const wrap = document.createElement("div"); wrap.className = "barchart";
    items.forEach((it) => {
      const row = document.createElement("div"); row.className = "bar-row";
      const pct = Math.max(2, Math.round((it.value / top) * 100));
      row.innerHTML =
        `<span class="bar-lab">${esc(it.label)}</span>` +
        `<span class="bar-track"><i class="bar-fill${it.status === "room to grow" || it.status === "not trained yet" ? " low" : ""}" style="width:${pct}%"></i>` +
        (it.marker !== undefined ? `<i class="bar-mark" data-term="mev-mav-mrv" style="left:${Math.round((it.marker / top) * 100)}%" title="MEV target"></i>` : "") + `</span>` +
        `<span class="bar-val">${it.value}${unit}</span>`;
      wrap.append(row);
    });
    host.append(wrap);
  }

  return { radar, line, multi, heatmap, bars, TIER_COLOR, esc };
})();
if (typeof module !== "undefined") module.exports = Chart;
