import * as F from '../core/fleet.mjs';

const fleet = F.generateFleet();
const A = F.analyzeFleet(fleet);
const { tel, links: rawLinks } = fleet;
const L = A.links;
const PD = F.PER_DAY, H = 7, D_NOW = A.dNow;

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; };
const fmt = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '–';
const pct = (p) => p >= 0.995 ? '>99%' : p < 0.005 ? '<1%' : Math.round(p * 100) + '%';
const C = { primary: '#99B5DC', light: '#c6d6eb', dim: 'rgba(153,181,220,.28)', grid: 'rgba(153,181,220,.09)', axis: '#7A8694', base: '#ceaa34', crit: '#e2707a', dark: '#064579', white: '#ffffff' };
const pColor = (p) => p >= 0.6 ? C.crit : p >= 0.3 ? C.base : p >= 0.05 ? C.primary : 'rgba(153,181,220,.35)';
const DAY0 = F.T0 - 4 * 3600e3;   // midnight of day 0 (EDT) expressed as a UTC instant
const dateOf = (d) => new Date(DAY0 + d * 86400e3).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const shortDate = (d) => new Date(DAY0 + d * 86400e3).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

const CAUSE = {
  contamination: { label: 'Connector contamination', color: '#99B5DC' },
  bend: { label: 'Fiber bend / macro-loss', color: '#6f8fc0' },
  laser: { label: 'Laser phase noise (aging)', color: '#ceaa34' },
  sop: { label: 'SOP transients (vibration)', color: '#b7a0e0' },
  thermal: { label: 'Thermal (rack airflow)', color: '#e2707a' },
  module: { label: 'Module SNR degradation', color: '#7A8694' },
  healthy: { label: 'Within budget', color: 'rgba(153,181,220,.35)' },
};
const TERM = [
  { key: 'rx', label: 'Received power', color: '#99B5DC' },
  { key: 'laser', label: 'Laser phase noise', color: '#ceaa34' },
  { key: 'sop', label: 'SOP tracking', color: '#b7a0e0' },
  { key: 'thermal', label: 'Thermal', color: '#e2707a' },
  { key: 'other', label: 'Unexplained (module)', color: '#7A8694' },
];
const SITE = (k) => F.SITES[k];
const route = (l) => l.from === l.to ? `${SITE(l.from).id} in-row` : `${SITE(l.from).id} → ${SITE(l.to).id}`;

function dailyMedian(i, d) { const a = Array.from(tel.snr[i].slice(d * PD, (d + 1) * PD)).sort((x, y) => x - y); return F.margin((a[2] + a[3]) / 2); }
function dailyMin(i, d) { let m = Infinity; for (let t = d * PD; t < (d + 1) * PD; t++) m = Math.min(m, tel.snr[i][t]); return F.margin(m); }
function dailyAgg(arr, i, d, how = 'mean') { const s = arr[i].slice(d * PD, (d + 1) * PD); if (how === 'max') return Math.max(...s); return s.reduce((a, b) => a + b, 0) / s.length; }
function firstFlapAfter(i, d0) { for (let t = (d0 + 1) * PD; t < Math.min(F.N_T, (d0 + 1 + H) * PD); t++) if (tel.flap[i][t]) return t; return -1; }

const tip = $('tip');
function showTip(html, ev) { tip.innerHTML = html; tip.style.opacity = 1; tip.style.left = Math.min(window.innerWidth - 290, ev.clientX + 14) + 'px'; tip.style.top = (ev.clientY + 14) + 'px'; }
function hideTip() { tip.style.opacity = 0; }

let reveal = false;
const upLinks = L.filter(l => l.up);
const atRisk = upLinks.filter(l => l.p >= 0.3);
const expectedNow = upLinks.reduce((a, l) => a + l.p, 0);
const staticNow = upLinks.filter(l => l.marginNow < 2).length;
const rows = A.bt.rows;
const modelOp = rows.filter(r => r.p >= 0.3), rule2 = rows.filter(r => r.now < 2);
const caught = (a) => a.filter(r => r.y).length;

// ---------- top bar + KPIs ----------
$('tbMeta').textContent = `Campus A + DC-East · ${L.length} links · ${dateOf(D_NOW + 1)}`;
$('asOf').textContent = `Replay: forecast issued ${dateOf(D_NOW + 1)}, 00:00 (day ${D_NOW + 1} of ${F.DAYS})`;
const nCls = (c) => L.filter(l => l.cls === c).length;
const reduction = 1 - modelOp.length / rule2.length;
$('kpis').innerHTML = [
  { k: 'Links monitored', v: L.length, d: `${nCls('campus')} campus · ${nCls('scale-across')} scale-across · ${nCls('row')} row` },
  { k: 'At risk, next 7 days', v: atRisk.length, s: 'links', d: 'P(flap) ≥ 30%' },
  { k: 'Expected flaps, next 7 days', v: fmt(expectedNow, 1), d: `A static 2 dB alarm flags ${staticNow} links today` },
  { k: 'Backtest calibration', v: fmt(A.bt.expected, 1), s: `predicted · ${A.bt.positives} seen`, d: `Flap windows, held-out days ${F.BT_FROM} to ${F.BT_TO}` },
  { k: 'Alert load vs. 2 dB alarm', v: `${Math.round(reduction * 100)}%`, s: 'fewer', d: `${modelOp.length} vs ${rule2.length} alerts, ${caught(modelOp)} vs ${caught(rule2)} flaps caught` },
].map(x => `<div class="kpi"><div class="k">${x.k}</div><div class="v">${x.v}${x.s ? `<small>${x.s}</small>` : ''}</div><div class="d">${x.d}</div></div>`).join('');

// ---------- topology ----------
let siteFilter = null;
function drawMap() {
  const svg = $('map'); svg.innerHTML = '';
  const defs = el('defs', {}, svg);
  const f = el('filter', { id: 'glow', x: '-50%', y: '-50%', width: '200%', height: '200%' }, defs);
  el('feGaussianBlur', { stdDeviation: '3.2', result: 'b' }, f);
  const m = el('feMerge', {}, f); el('feMergeNode', { in: 'b' }, m); el('feMergeNode', { in: 'SourceGraphic' }, m);
  const g = el('radialGradient', { id: 'siteg' }, defs);
  el('stop', { offset: '0%', 'stop-color': '#064579', 'stop-opacity': '.9' }, g); el('stop', { offset: '100%', 'stop-color': '#064579', 'stop-opacity': '0' }, g);
  // dot-matrix backdrop like the celero.inc map
  for (let x = 14; x < 760; x += 14) for (let y = 14; y < 380; y += 14) el('circle', { cx: x, cy: y, r: 0.9, fill: 'rgba(153,181,220,.07)' }, svg);
  el('rect', { x: 70, y: 40, width: 360, height: 300, rx: 16, fill: 'rgba(6,69,121,.08)', stroke: 'rgba(153,181,220,.16)', 'stroke-dasharray': '3 5' }, svg);
  el('text', { x: 86, y: 62, fill: C.axis, 'font-size': 12 }, svg).textContent = 'Campus A';
  el('rect', { x: 560, y: 110, width: 160, height: 140, rx: 16, fill: 'rgba(6,69,121,.08)', stroke: 'rgba(153,181,220,.16)', 'stroke-dasharray': '3 5' }, svg);
  el('text', { x: 576, y: 132, fill: C.axis, 'font-size': 12 }, svg).textContent = 'DC-East · 36-40 km';

  const bundles = new Map();
  for (const l of L) { const k = l.from + '-' + l.to; if (!bundles.has(k)) bundles.set(k, []); bundles.get(k).push(l); }
  const edges = el('g', {}, svg);
  for (const [k, arr] of bundles) {
    const [a, b] = k.split('-').map(Number);
    const pmax = Math.max(...arr.map(l => l.p));
    const nRisk = arr.filter(l => l.p >= 0.3).length;
    const col = pColor(pmax);
    const A1 = SITE(a), B1 = SITE(b);
    let path;
    if (a === b) {
      path = `M ${A1.x - 18} ${A1.y + 22} C ${A1.x - 46} ${A1.y + 62}, ${A1.x + 46} ${A1.y + 62}, ${A1.x + 18} ${A1.y + 22}`;
    } else {
      const mx = (A1.x + B1.x) / 2, my = (A1.y + B1.y) / 2; const bow = b === 4 ? -18 + 12 * a : 0;
      path = `M ${A1.x} ${A1.y} Q ${mx} ${my + bow} ${B1.x} ${B1.y}`;
    }
    const w = 1.2 + Math.sqrt(arr.length) / 3.2;
    el('path', { d: path, stroke: col, 'stroke-width': w + 3, fill: 'none', opacity: pmax >= 0.3 ? .35 : .12, filter: 'url(#glow)' }, edges);
    const p = el('path', { d: path, stroke: col, 'stroke-width': w, fill: 'none', opacity: pmax >= 0.05 ? .95 : .55, 'stroke-linecap': 'round', style: 'cursor:pointer' }, edges);
    const hit = el('path', { d: path, stroke: 'transparent', 'stroke-width': 16, fill: 'none', style: 'cursor:pointer' }, edges);
    const html = `<b>${a === b ? SITE(a).id + ' in-row' : SITE(a).id + ' ↔ ' + SITE(b).id}</b><br>${arr.length} links · ${nRisk} at risk<br>Highest P(flap, 7 d): <b>${pct(pmax)}</b>`;
    for (const t of [p, hit]) { t.addEventListener('mousemove', ev => showTip(html, ev)); t.addEventListener('mouseleave', hideTip); t.addEventListener('click', () => { siteFilter = siteFilter === k ? null : k; drawTable(); drawMap(); }); }
    if (siteFilter === k) el('path', { d: path, stroke: C.white, 'stroke-width': 1, fill: 'none', 'stroke-dasharray': '2 4' }, edges);
  }
  for (let s = 0; s < F.SITES.length; s++) {
    const S = SITE(s);
    const nRisk = L.filter(l => (l.from === s || l.to === s) && l.p >= 0.3).length;
    el('circle', { cx: S.x, cy: S.y, r: 34, fill: 'url(#siteg)' }, svg);
    el('rect', { x: S.x - 21, y: S.y - 15, width: 42, height: 30, rx: 7, fill: '#06121d', stroke: nRisk ? C.base : 'rgba(153,181,220,.45)', 'stroke-width': 1.2 }, svg);
    el('text', { x: S.x, y: S.y + 4.5, 'text-anchor': 'middle', fill: C.white, 'font-size': 12.5, 'font-family': 'Karla' }, svg).textContent = S.id;
    const lab = el('text', { x: S.x, y: S.y - 22, 'text-anchor': 'middle', fill: nRisk ? '#e8cf7d' : C.axis, 'font-size': 11 }, svg);
    lab.textContent = nRisk ? `${nRisk} at risk` : S.name;
  }
  const medOf = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
  $('clsStrip').innerHTML = [['campus', 'Campus, 1-4 km'], ['scale-across', 'Scale-across, 36-40 km'], ['row', 'In-row, < 1 km']].map(([c, t]) => { const a = L.filter(l => l.cls === c); return `<div><div class="k">${t}</div><div class="v">${fmt(medOf(a.filter(l => l.up).map(l => l.marginNow)), 1)} dB<small>median margin</small></div><div class="m">${a.length} links · ${a.filter(l => l.p >= 0.3).length} at risk · ${fmt(a.filter(l => l.up).reduce((s, l) => s + l.p, 0), 1)} expected flaps</div></div>`; }).join('');
  $('mapLegend').innerHTML = [['< 5%', 'rgba(153,181,220,.55)'], ['5-30%', C.primary], ['30-60%', C.base], ['≥ 60%', C.crit]].map(([t, c]) => `<span><i style="background:${c}"></i>${t}</span>`).join('');
}

// ---------- at-risk table ----------
let selected = null;
function riskList() {
  let arr = L.filter(l => l.p >= 0.05);
  if (siteFilter) { const [a, b] = siteFilter.split('-').map(Number); arr = arr.filter(l => l.from === a && l.to === b); }
  return arr.sort((x, y) => (x.up === y.up ? y.p - x.p : x.up ? 1 : -1));
}
function drawTable() {
  const arr = riskList();
  const shown = arr.slice(0, 9);
  $('riskSub').textContent = `${arr.length} links with P(flap, 7 d) ≥ 5%${siteFilter ? ' in the selected bundle' : ''} · sorted by probability`;
  const head = `<tr><th>Link</th><th>Route</th><th class="num">Margin</th><th>P(flap, 7 d)</th><th>Root cause</th>${reveal ? '<th>Next 7 days</th>' : ''}</tr>`;
  const body = shown.map(l => {
    const ff = firstFlapAfter(l.i, D_NOW);
    const nx = !l.up ? '<span class="tag hit">Down now</span>' : ff >= 0 ? `<span class="tag hit">Flapped ${shortDate(Math.floor(ff / PD))}</span>` : '<span class="tag miss">No flap</span>';
    const cs = CAUSE[l.rc.cause];
    return `<tr class="row${selected === l.i ? ' sel' : ''}" data-i="${l.i}">
      <td class="mono">${l.name}</td><td class="muted">${route(l)}</td>
      <td class="num">${l.up ? fmt(l.marginNow, 2) + ' dB' : '<span class="muted">down</span>'}</td>
      <td><span class="pbar"><span class="track"><span class="fill" style="width:${Math.max(4, l.p * 100)}%;background:${pColor(l.p)}"></span></span>${l.up ? pct(l.p) : 'down'}</span></td>
      <td><span class="cause"><span class="dot" style="background:${cs.color}"></span>${cs.label}</span></td>${reveal ? `<td>${nx}</td>` : ''}</tr>`;
  }).join('');
  const more = arr.length > shown.length ? `<tr><td colspan="${reveal ? 6 : 5}" class="muted" style="border:0;padding-top:9px">+ ${arr.length - shown.length} more below 5% shown in Links</td></tr>` : '';
  $('riskTbl').innerHTML = head + body + more;
  $('riskTbl').querySelectorAll('tr.row').forEach(tr => tr.addEventListener('click', () => { selected = +tr.dataset.i; drawTable(); drawDetail(); }));
}

// ---------- link detail ----------
function sparkline(svg, ys, color, refIdx) {
  svg.innerHTML = '';
  const w = 200, h = 30; svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none');
  const lo = Math.min(...ys), hi = Math.max(...ys), sp = hi - lo || 1;
  const pts = ys.map((y, k) => `${(k / (ys.length - 1) * w).toFixed(1)},${(h - 3 - (y - lo) / sp * (h - 6)).toFixed(1)}`);
  el('polyline', { points: pts.join(' '), fill: 'none', stroke: color, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }, svg);
  if (refIdx != null) el('line', { x1: refIdx / (ys.length - 1) * w, x2: refIdx / (ys.length - 1) * w, y1: 0, y2: h, stroke: 'rgba(153,181,220,.25)', 'stroke-dasharray': '2 2', 'vector-effect': 'non-scaling-stroke' }, svg);
}
function drawDetail() {
  const l = L[selected];
  const i = l.i;
  const f = l.f;
  const [q10, q50, q90] = F.band(f.pred, f.s, A.cal.residuals, [0.1, 0.5, 0.9]);
  const chip = !l.up ? '<span class="chip crit">Down now</span>' : l.p >= 0.6 ? `<span class="chip crit">P(flap, 7 d) ${pct(l.p)}</span>` : l.p >= 0.3 ? `<span class="chip warn">P(flap, 7 d) ${pct(l.p)}</span>` : `<span class="chip ok">P(flap, 7 d) ${pct(l.p)}</span>`;
  const cs = CAUSE[l.rc.cause];
  const lossDb = Math.max(0, l.rc.lossDb);
  const shares = l.rc.shares;
  const act = F.ACTIONS[l.rc.cause];
  const ff = firstFlapAfter(i, D_NOW);
  const trendTxt = f.slope < -0.005 ? `losing ${fmt(-f.slope * 7, 2)} dB/week` : 'flat trend';
  $('detail').innerHTML = `
    <div class="card-h"><div>
      <div class="det-title"><h2 class="mono" style="font-family:Karla">${l.name}</h2>${chip}<span class="det-meta">${route(l)} · ${fmt(l.km, 1)} km · ${l.cls} · DP-16QAM</span></div>
      <p class="sub">Daily median and worst SNR margin above the FEC limit (${fmt(F.SNR_REQ, 2)} dB effective SNR). Forecast: ${trendTxt}, worst 4-hour dip ${fmt(f.burst, 2)} dB, 80% conformal band for the worst margin over the next 7 days.</p>
    </div><label class="toggle"><input type="checkbox" id="reveal2" ${reveal ? 'checked' : ''}> <span>Reveal next 7 days</span></label></div>
    <div class="det-grid">
      <div><svg id="marginChart" viewBox="0 0 820 372"></svg></div>
      <div>
        <div class="budget">
          <h3>Noise budget: ${fmt(lossDb, 2)} dB of margin lost vs. this link's first week</h3>
          <div class="stack">${TERM.map((t, k) => `<div style="width:${(shares[k] * 100).toFixed(2)}%;background:${t.color}"></div>`).join('')}</div>
          <ul class="blist">${TERM.map((t, k) => `<li><span><span class="sw" style="background:${t.color}"></span>${t.label}</span><span>${fmt(shares[k] * lossDb, 2)} dB · ${Math.round(shares[k] * 100)}%</span></li>`).join('')}</ul>
          <div class="action">${l.rc.cause === 'healthy' ? `<b>No action.</b> Margin is within ${fmt(lossDb, 2)} dB of baseline.` : `<b>${act.label}</b> · est. ${act.min} min<br><span class="muted">Diagnosis: ${cs.label.toLowerCase()}${l.rc.cause === 'bend' ? ' (step drop in received power)' : l.rc.cause === 'contamination' ? ' (gradual received-power drift)' : ''}.</span>${reveal ? `<br><span class="muted">Replay:</span> ${!l.up ? 'already down' : ff >= 0 ? `flapped ${shortDate(Math.floor(ff / PD))}` : 'no flap in the next 7 days'}` : ''}`}</div>
        </div>
        <div class="tele"><h3>DSP telemetry, daily, last 30 days</h3><div class="spark-grid" id="sparks"></div></div>
      </div>
    </div>`;
  $('reveal2').addEventListener('change', e => setReveal(e.target.checked));

  // margin chart
  const svg = $('marginChart');
  const W = 820, Hh = 372, ml = 44, mr = 16, mt = 14, mb = 30;
  const dStart = 0, dEnd = F.DAYS - 1;
  const med = [], mn = [];
  for (let d = dStart; d <= dEnd; d++) { med.push(dailyMedian(i, d)); mn.push(dailyMin(i, d)); }
  const visEnd = reveal ? dEnd : D_NOW;
  const vals = [...med.slice(0, visEnd + 1), ...mn.slice(0, visEnd + 1), q10, q90, 0];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  lo = Math.floor(lo - 0.3); hi = Math.ceil(hi + 0.3);
  const x = (d) => ml + (d - dStart) / (dEnd - dStart) * (W - ml - mr);
  const y = (v) => mt + (hi - v) / (hi - lo) * (Hh - mt - mb);
  const step = hi - lo > 8 ? 2 : 1;
  for (let v = lo; v <= hi; v += step) {
    el('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: C.grid }, svg);
    el('text', { x: ml - 8, y: y(v) + 4, 'text-anchor': 'end', fill: C.axis, 'font-size': 11 }, svg).textContent = v + (v === hi ? ' dB' : '');
  }
  for (let d = 0; d <= dEnd; d += 7) el('text', { x: x(d), y: Hh - 9, 'text-anchor': 'middle', fill: C.axis, 'font-size': 11 }, svg).textContent = shortDate(d);
  // FEC limit + outage zone
  el('rect', { x: ml, y: y(0), width: W - ml - mr, height: Math.max(0, y(lo) - y(0)), fill: 'rgba(226,112,122,.07)' }, svg);
  el('line', { x1: ml, x2: W - mr, y1: y(0), y2: y(0), stroke: C.crit, 'stroke-width': 1, 'stroke-dasharray': '4 4' }, svg);
  el('text', { x: ml + 6, y: y(0) + 14, fill: C.crit, 'font-size': 11 }, svg).textContent = 'FEC limit: link flaps below 0 dB';
  // forecast region
  el('rect', { x: x(D_NOW + 1), y: mt, width: x(dEnd) - x(D_NOW + 1), height: Hh - mt - mb, fill: 'rgba(6,69,121,.16)' }, svg);
  el('line', { x1: x(D_NOW + 1), x2: x(D_NOW + 1), y1: mt, y2: Hh - mb, stroke: 'rgba(153,181,220,.5)', 'stroke-dasharray': '2 3' }, svg);
  el('text', { x: x(D_NOW + 1) + 6, y: mt + 12, fill: C.primary, 'font-size': 11 }, svg).textContent = 'Forecast · 7 days';
  const line = (arr, d0, d1, attrs) => el('polyline', { points: arr.slice(d0, d1 + 1).map((v, k) => `${x(d0 + k).toFixed(1)},${y(v).toFixed(1)}`).join(' '), fill: 'none', ...attrs }, svg);
  // area under median
  const area = med.slice(0, D_NOW + 1).map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`);
  const gid = 'ga' + i;
  const lg = el('linearGradient', { id: gid, x1: 0, x2: 0, y1: 0, y2: 1 }, el('defs', {}, svg));
  el('stop', { offset: '0%', 'stop-color': '#99B5DC', 'stop-opacity': '.20' }, lg); el('stop', { offset: '100%', 'stop-color': '#99B5DC', 'stop-opacity': '0' }, lg);
  el('polygon', { points: `${x(0)},${y(lo)} ${area.join(' ')} ${x(D_NOW)},${y(lo)}`, fill: `url(#${gid})` }, svg);
  line(mn, 0, D_NOW, { stroke: 'rgba(153,181,220,.45)', 'stroke-width': 1 });
  line(med, 0, D_NOW, { stroke: C.primary, 'stroke-width': 2 });
  // forecast: median trend and the 7-day worst-margin band at the horizon
  const xs = x(D_NOW), xe = x(dEnd);
  el('line', { x1: xs, y1: y(f.now), x2: xe, y2: y(f.now + f.slope * H), stroke: C.light, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }, svg);
  const bw = 18;
  el('rect', { x: xe - bw, y: y(q90), width: bw, height: Math.max(2, y(q10) - y(q90)), rx: 4, fill: 'rgba(153,181,220,.18)', stroke: 'rgba(153,181,220,.55)' }, svg);
  el('line', { x1: xe - bw, x2: xe, y1: y(q50), y2: y(q50), stroke: C.white, 'stroke-width': 1.5 }, svg);
  el('text', { x: xe - bw - 6, y: y(q50) + 4, 'text-anchor': 'end', fill: C.light, 'font-size': 11 }, svg).textContent = `worst 7-day margin ${fmt(q10, 1)} to ${fmt(q90, 1)} dB`;
  if (reveal) {
    line(mn, D_NOW, dEnd, { stroke: 'rgba(255,255,255,.55)', 'stroke-width': 1 });
    line(med, D_NOW, dEnd, { stroke: C.white, 'stroke-width': 1.6 });
    for (let t = (D_NOW + 1) * PD; t < F.N_T; t++) if (tel.flap[i][t]) el('circle', { cx: x(t / PD), cy: y(Math.max(lo + 0.15, F.margin(tel.snr[i][t]))), r: 3, fill: C.crit }, svg);
  }
  // hover readout
  const hv = el('g', { opacity: 0 }, svg);
  const hl = el('line', { y1: mt, y2: Hh - mb, stroke: 'rgba(255,255,255,.25)' }, hv);
  const ov = el('rect', { x: ml, y: mt, width: W - ml - mr, height: Hh - mt - mb, fill: 'transparent' }, svg);
  ov.addEventListener('mousemove', ev => {
    const r = svg.getBoundingClientRect(); const sx = (ev.clientX - r.left) / r.width * W;
    const d = Math.max(0, Math.min(visEnd, Math.round((sx - ml) / (W - ml - mr) * (dEnd - dStart))));
    hl.setAttribute('x1', x(d)); hl.setAttribute('x2', x(d)); hv.setAttribute('opacity', 1);
    showTip(`<b>${shortDate(d)}</b><br>Median margin ${fmt(med[d], 2)} dB<br>Worst 4 h ${fmt(mn[d], 2)} dB`, ev);
  });
  ov.addEventListener('mouseleave', () => { hv.setAttribute('opacity', 0); hideTip(); });

  // sparklines (last 30 days to today, or through the replay)
  const d0 = D_NOW - 29, d1 = reveal ? dEnd : D_NOW;
  const series = [
    { l: 'Rx power', u: 'dBm', a: tel.rx, how: 'mean', d: 2 },
    { l: 'Laser linewidth', u: 'kHz', a: tel.lw, how: 'mean', d: 0 },
    { l: 'SOP speed, peak', u: 'krad/s', a: tel.sop, how: 'max', d: 0 },
    { l: 'Module temp', u: '°C', a: tel.temp, how: 'mean', d: 1 },
    { l: 'Freq. offset', u: 'MHz', a: tel.fo, how: 'mean', d: 1 },
    { l: 'DGD', u: 'ps', a: tel.dgd, how: 'mean', d: 2 },
  ];
  const sp = $('sparks');
  sp.innerHTML = series.map((s, k) => `<div class="spark"><div class="l">${s.l}<b id="sv${k}"></b></div><svg id="sp${k}"></svg></div>`).join('');
  series.forEach((s, k) => {
    const ys = []; for (let d = d0; d <= d1; d++) ys.push(dailyAgg(s.a, i, d, s.how));
    $('sv' + k).textContent = `${fmt(dailyAgg(s.a, i, D_NOW, s.how), s.d)} ${s.u}`;
    sparkline($('sp' + k), ys, k === 0 && (l.rc.cause === 'contamination' || l.rc.cause === 'bend') || k === 1 && l.rc.cause === 'laser' || k === 2 && l.rc.cause === 'sop' || k === 3 && l.rc.cause === 'thermal' ? C.base : C.primary, reveal ? D_NOW - d0 : null);
  });
}

// ---------- calibration (reliability) ----------
function axes(svg, W, Hh, m, xmax, ymax, xl, yl, xt, yt) {
  const x = (v) => m.l + v / xmax * (W - m.l - m.r), y = (v) => Hh - m.b - v / ymax * (Hh - m.t - m.b);
  for (const v of yt) { el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), stroke: C.grid }, svg); el('text', { x: m.l - 7, y: y(v) + 4, 'text-anchor': 'end', fill: C.axis, 'font-size': 11 }, svg).textContent = typeof v === 'number' && ymax <= 1 ? Math.round(v * 100) + '%' : v; }
  for (const v of xt) el('text', { x: x(v), y: Hh - m.b + 16, 'text-anchor': 'middle', fill: C.axis, 'font-size': 11 }, svg).textContent = xmax <= 1 ? Math.round(v * 100) + '%' : v;
  el('text', { x: (m.l + W - m.r) / 2, y: Hh - 4, 'text-anchor': 'middle', fill: C.axis, 'font-size': 11 }, svg).textContent = xl;
  const yt1 = el('text', { x: 12, y: (m.t + Hh - m.b) / 2, 'text-anchor': 'middle', fill: C.axis, 'font-size': 11, transform: `rotate(-90 12 ${(m.t + Hh - m.b) / 2})` }, svg); yt1.textContent = yl;
  return { x, y };
}
function drawRel() {
  const svg = $('rel'); svg.innerHTML = '';
  const W = 420, Hh = 300, m = { l: 48, r: 12, t: 10, b: 40 };
  const { x, y } = axes(svg, W, Hh, m, 1, 1, 'Predicted P(flap within 7 days)', 'Observed flap rate', [0, .25, .5, .75, 1], [0, .25, .5, .75, 1]);
  el('line', { x1: x(0), y1: y(0), x2: x(1), y2: y(1), stroke: 'rgba(153,181,220,.35)', 'stroke-dasharray': '4 4' }, svg);
  el('text', { x: x(0.5), y: y(0.5) + 16, fill: C.axis, 'font-size': 11, transform: `rotate(-33 ${x(0.5)} ${y(0.5) + 16})` }, svg).textContent = 'perfect calibration';
  const bins = A.bt.bins.filter(b => b.n > 0);
  el('polyline', { points: bins.map(b => `${x(b.pred)},${y(b.obs)}`).join(' '), fill: 'none', stroke: C.primary, 'stroke-width': 1.6 }, svg);
  const wilson = (k, n, z = 1.645) => { const ph = k / n, d = 1 + z * z / n, c = (ph + z * z / (2 * n)) / d, h = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; };
  for (const b of bins) {
    const [wl, wh] = wilson(Math.round(b.obs * b.n), b.n);
    el('line', { x1: x(b.pred), x2: x(b.pred), y1: y(wl), y2: y(wh), stroke: 'rgba(153,181,220,.55)', 'stroke-width': 1.2 }, svg);
    for (const v of [wl, wh]) el('line', { x1: x(b.pred) - 4, x2: x(b.pred) + 4, y1: y(v), y2: y(v), stroke: 'rgba(153,181,220,.55)', 'stroke-width': 1.2 }, svg);
    b.cover = wl <= b.pred && b.pred <= wh;
    if (b.pred >= 0.1) el('text', { x: x(b.pred) + (b.pred > 0.85 ? -8 : 8), y: y(b.obs) + 16, fill: C.axis, 'font-size': 10.5, 'text-anchor': b.pred > 0.85 ? 'end' : 'start' }, svg).textContent = 'n=' + b.n.toLocaleString();
  }
  for (const b of bins) {
    const c = el('circle', { cx: x(b.pred), cy: y(b.obs), r: Math.min(7, 3 + Math.log10(b.n)), fill: 'rgba(153,181,220,.25)', stroke: C.primary, 'stroke-width': 1.4 }, svg);
    c.addEventListener('mousemove', ev => showTip(`<b>${pct(b.lo)} to ${pct(Math.min(1, b.hi))} bin</b><br>${b.n} link-windows<br>Predicted ${fmt(b.pred * 100, 1)}% · observed ${fmt(b.obs * 100, 1)}%<br>Bar: 90% Wilson interval`, ev));
    c.addEventListener('mouseleave', hideTip);
  }
  $('relSub').textContent = `${A.bt.n.toLocaleString()} link-windows on held-out days ${F.BT_FROM} to ${F.BT_TO}, after calibration on days 14 to 40`;
  $('relNote').innerHTML = `Predicted <b>${fmt(A.bt.expected, 1)}</b> flap windows, <b>${A.bt.positives}</b> happened. ${bins.filter(b => b.cover).length} of ${bins.length} bins' 90% intervals contain the predicted rate. Expected calibration error <b>${fmt(A.bt.ece * 100, 2)} pts</b>, AUROC <b>${fmt(A.bt.auroc, 3)}</b>, Brier skill <b>${fmt(A.bt.skill * 100, 0)}%</b> over the base rate.`;
}

// ---------- alert efficiency ----------
function drawEff() {
  const svg = $('eff'); svg.innerHTML = '';
  const W = 420, Hh = 300, m = { l: 48, r: 14, t: 10, b: 40 };
  const ps = [0.98, 0.95, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03];
  const rs = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5];
  const mPts = ps.map(p => { const a = rows.filter(r => r.p >= p); return { t: p, n: a.length, c: caught(a) }; });
  const rPts = rs.map(v => { const a = rows.filter(r => r.now < v); return { t: v, n: a.length, c: caught(a) }; });
  const xmax = Math.ceil(Math.max(...mPts.map(p => p.n), ...rPts.map(p => p.n)) / 50) * 50;
  const ymax = Math.ceil(A.bt.positives / 10) * 10;
  const xt = []; for (let v = 0; v <= xmax; v += xmax > 300 ? 100 : 50) xt.push(v);
  const yt = []; for (let v = 0; v <= ymax; v += ymax > 60 ? 20 : 10) yt.push(v);
  const { x, y } = axes(svg, W, Hh, m, xmax, ymax, 'Alerts raised (link-days)', 'Flaps caught within 7 days', xt, yt);
  el('line', { x1: x(0), x2: x(xmax), y1: y(A.bt.positives), y2: y(A.bt.positives), stroke: 'rgba(153,181,220,.3)', 'stroke-dasharray': '3 4' }, svg);
  el('text', { x: x(xmax) - 4, y: y(A.bt.positives) - 5, 'text-anchor': 'end', fill: C.axis, 'font-size': 11 }, svg).textContent = `${A.bt.positives} flap windows`;
  const curve = (pts, col, lbl, unit) => {
    el('polyline', { points: pts.map(p => `${x(p.n)},${y(p.c)}`).join(' '), fill: 'none', stroke: col, 'stroke-width': 2 }, svg);
    for (const p of pts) { const c = el('circle', { cx: x(p.n), cy: y(p.c), r: 3.2, fill: '#010B13', stroke: col, 'stroke-width': 1.5 }, svg); c.addEventListener('mousemove', ev => showTip(`<b>${lbl}</b> ${unit(p.t)}<br>${p.n} alerts · ${p.c} flaps caught · precision ${fmt(p.c / Math.max(1, p.n) * 100, 0)}%`, ev)); c.addEventListener('mouseleave', hideTip); }
  };
  curve(rPts, C.axis, 'Static alarm: margin <', v => v + ' dB');
  curve(mPts, C.primary, 'Link Insight: P(flap) ≥', v => Math.round(v * 100) + '%');
  const mo = mPts.find(p => p.t === 0.3), ro = rPts.find(p => p.t === 2);
  el('circle', { cx: x(mo.n), cy: y(mo.c), r: 6, fill: 'none', stroke: C.white, 'stroke-width': 1.3 }, svg);
  el('circle', { cx: x(ro.n), cy: y(ro.c), r: 6, fill: 'none', stroke: C.white, 'stroke-width': 1.3 }, svg);
  el('text', { x: x(mo.n) - 9, y: y(mo.c) - 10, 'text-anchor': 'end', fill: C.light, 'font-size': 11 }, svg).textContent = 'P ≥ 30%';
  el('text', { x: x(ro.n) + 4, y: y(ro.c) + 20, 'text-anchor': 'middle', fill: C.axis, 'font-size': 11 }, svg).textContent = 'margin < 2 dB';
  const lg = el('g', { transform: `translate(${x(xmax * 0.50)},${y(ymax * 0.24)})` }, svg);
  el('line', { x1: 0, x2: 16, y1: 0, y2: 0, stroke: C.primary, 'stroke-width': 2 }, lg); el('text', { x: 22, y: 4, fill: C.light, 'font-size': 11 }, lg).textContent = 'Link Insight probability';
  el('line', { x1: 0, x2: 16, y1: 17, y2: 17, stroke: C.axis, 'stroke-width': 2 }, lg); el('text', { x: 22, y: 21, fill: C.axis, 'font-size': 11 }, lg).textContent = 'Static margin alarm';
  $('effNote').innerHTML = `At P ≥ 30% Link Insight raises <b>${mo.n}</b> alerts and catches <b>${mo.c}</b> flap windows. A 2 dB margin alarm needs <b>${ro.n}</b> alerts to catch <b>${ro.c}</b>. Sudden bends and SOP hits on quiet links stay unpredictable for both.`;
}

// ---------- coefficients ----------
function drawCoef() {
  const effThermal = F.MODEL.C_T * 10 * rawLinks.reduce((a, l) => a + 10 ** (-l.snrTrx / 10), 0) / rawLinks.length;
  const truth = [1, F.MODEL.C_PN, F.MODEL.C_SOP, effThermal];
  const units = ['per unit NSR', 'per kHz', 'per (krad/s)²', 'per °C over 60'];
  const sci = (v) => { if (v === 1 || (v > 0.1 && v < 10)) return v.toFixed(3); const e = Math.floor(Math.log10(v)); return `${(v / 10 ** e).toFixed(2)}×10<sup>${e}</sup>`; };
  const names = ['Received power', 'Laser phase noise', 'SOP tracking', 'Thermal'];
  $('coef').innerHTML = `<tr><th>Term</th><th>Fitted</th><th>Simulator</th><th>Unit</th></tr>` + A.theta.map((th, k) =>
    `<tr><td><span class="cause"><span class="dot" style="background:${TERM[k].color}"></span>${names[k]}</span></td><td>${sci(th)}</td><td class="muted">${sci(truth[k])}</td><td class="muted">${units[k]}</td></tr>`).join('');
  const errs = A.theta.map((t, k) => Math.abs(t / truth[k] - 1));
  const diag = L.filter(l => l.rc.cause !== 'healthy');
  $('coefNote').innerHTML = `Noise powers add, so ΔNSR = Σ θ<sub>k</sub>·Δx<sub>k</sub> is linear in each link's telemetry. Every coefficient lands within <b>${fmt(Math.max(...errs) * 100, 1)}%</b> of the simulator, and the dominant term gives the root cause: correct on <b>${diag.filter(l => l.rc.cause === l.cause).length} of ${diag.length}</b> links diagnosed as degraded today.`;
  const counts = {}; for (const l of diag) counts[l.rc.cause] = (counts[l.rc.cause] || 0) + 1;
  $('diag').innerHTML = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="dg"><span class="dot" style="background:${CAUSE[k].color}"></span>${CAUSE[k].label}<b>${n}</b></span>`).join('');
}

// ---------- planner ----------
function drawPlan() {
  const budget = +$('budget').value;
  $('budgetOut').textContent = `${Math.floor(budget / 60)} h ${String(budget % 60).padStart(2, '0')} min`;
  const { chosen } = F.plan(A.cands, budget);
  const used = chosen.reduce((a, c) => a + c.minutes, 0);
  const avoided = chosen.reduce((a, c) => a + c.l.p, 0);
  const left = A.cands.filter(c => !chosen.includes(c)).sort((a, b) => b.value / b.minutes - a.value / a.minutes);
  const wouldFlap = chosen.filter(c => firstFlapAfter(c.l.i, D_NOW) >= 0).length;
  const cols = ['#99B5DC', '#c6d6eb', '#6f8fc0', '#b7a0e0', '#ceaa34'];
  $('plan').innerHTML = `
    <div class="plan-sum">
      <div class="big">${fmt(avoided, 2)}</div><div class="lbl">expected flaps removed of ${fmt(A.cands.reduce((a, c) => a + c.l.p, 0), 2)} on fixable links</div>
      <div class="big">${chosen.length}<small style="font-size:16px;color:#7A8694"> / ${A.cands.length}</small></div><div class="lbl">fixes scheduled · ${used} of ${budget} min used</div>
      ${reveal ? `<div class="lbl">Replay: <b style="color:#fff">${wouldFlap}</b> of the scheduled links flapped in the next 7 days</div>` : ''}
    </div>
    <div>
      <div class="timeline">${chosen.map((c, k) => `<div style="width:${c.minutes / budget * 100}%;background:${cols[k % cols.length]}" title="${c.l.name}">${c.minutes / budget >= 0.05 ? c.minutes + ' min' : ''}</div>`).join('')}</div>
      <table class="tbl"><tr><th>#</th><th>Link</th><th>Action</th><th class="num">Minutes</th><th class="num">P(flap, 7 d)</th><th class="num">Weight</th></tr>
      ${chosen.map((c, k) => `<tr><td class="muted">${k + 1}</td><td class="mono">${c.l.name}</td><td>${F.ACTIONS[c.l.rc.cause].label}</td><td class="num">${c.minutes}</td><td class="num">${pct(c.l.p)}</td><td class="num muted">${c.l.weight}×</td></tr>`).join('')}
      ${left.length ? `<tr><td colspan="6" class="muted" style="border:0;padding-top:9px">Not scheduled: ${left.slice(0, 3).map(c => `${c.l.name} (${pct(c.l.p)}, ${c.minutes} min)`).join(', ')}${left.length > 3 ? ` and ${left.length - 3} more` : ''}</td></tr>` : ''}
      </table>
    </div>`;
}

function setReveal(v) { reveal = v; $('reveal').checked = v; drawTable(); drawDetail(); drawPlan(); }
$('reveal').addEventListener('change', e => setReveal(e.target.checked));
$('budget').addEventListener('input', drawPlan);
$('btnExport').addEventListener('click', () => {
  const lines = ['link,route,class,margin_db,p_flap_7d,root_cause,action'];
  for (const l of riskList()) lines.push([l.name, route(l), l.cls, l.up ? l.marginNow.toFixed(2) : 'down', l.p.toFixed(4), l.rc.cause, F.ACTIONS[l.rc.cause]?.label ?? ''].join(','));
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'link-insight-at-risk.csv'; a.click();
});

selected = riskList().find(l => l.up)?.i ?? 0;
drawMap(); drawTable(); drawDetail(); drawRel(); drawEff(); drawCoef(); drawPlan();
