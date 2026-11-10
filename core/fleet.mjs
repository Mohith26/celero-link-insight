// Link Insight core: synthetic coherent-link fleet + noise-budget attribution + conformal flap forecasting
// + maintenance planning. Pure ES module (browser and `node --test`), no dependencies.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// ---------- physics: DP-16QAM, Gray coded ----------
export function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
export const ber16qam = (snrDb) => 0.375 * erfc(Math.sqrt(10 ** (snrDb / 10) / 10));
export const FEC_BER = 1.25e-2;                     // pre-FEC BER threshold of the link's FEC (illustrative)
export const SNR_REQ = (() => { let lo = 5, hi = 25; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (ber16qam(m) > FEC_BER) lo = m; else hi = m; } return hi; })(); // ≈13.55 dB

// Illustrative receiver noise model (unamplified coherent-lite link), all terms are noise-to-signal ratios that add:
//   NSR = NSR_trx(module, temperature) + 10^-(Prx+RX_K)/10  + C_PN·linewidth  + C_SOP·ω²
export const MODEL = { RX_K: 31, C_PN: 1.2e-5 /* per kHz */, C_SOP: 2.2e-8 /* per (krad/s)^2 */, C_T: 1.6e-3 /* per °C above 60 */ };

// ---------- synthetic fleet ----------
export const DAYS = 60, PER_DAY = 6, N_T = DAYS * PER_DAY;        // 4-hour telemetry samples
export const T0 = Date.UTC(2026, 8, 11, 4);                       // Sep 11 2026 00:00 EDT
export const SITES = [
  { id: 'DH1', name: 'Data hall 1', x: 150, y: 120 }, { id: 'DH2', name: 'Data hall 2', x: 330, y: 95 },
  { id: 'DH3', name: 'Data hall 3', x: 160, y: 285 }, { id: 'DH4', name: 'Data hall 4', x: 345, y: 265 },
  { id: 'EAST', name: 'DC-East (38 km)', x: 640, y: 180 },
];
export const CAUSES = ['healthy', 'contamination', 'bend', 'laser', 'sop', 'thermal', 'module'];

export function generateFleet(seed = 20260911) {
  const r = mulberry32(seed);
  const links = [];
  const pairs = [];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) pairs.push([a, b]);
  let id = 0;
  const add = (from, to, km, cls, weight) => {
    links.push({ id: id++, name: '', from, to, km, cls, weight });
  };
  // 288 inter-building (6 pairs x 48), 128 scale-across to DC-East (4 halls x 32), 64 long in-building rows
  for (const [a, b] of pairs) for (let i = 0; i < 48; i++) add(a, b, 1.2 + 2.6 * r(), 'campus', 2);
  for (let a = 0; a < 4; a++) for (let i = 0; i < 32; i++) add(a, 4, 36 + 4 * r(), 'scale-across', 3);
  for (let a = 0; a < 4; a++) for (let i = 0; i < 16; i++) add(a, a, 0.3 + 0.5 * r(), 'row', 1);

  // assign latent faults
  const pickN = (n, filter) => { const pool = links.filter(l => !l.cause && filter(l)); const out = []; while (out.length < n && pool.length) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]); return out; };
  pickN(30, l => l.cls === 'scale-across').forEach(l => l.cause = 'contamination');
  pickN(12, l => l.cls !== 'row').forEach(l => l.cause = 'contamination');
  pickN(10, l => l.cls === 'scale-across').forEach(l => l.cause = 'bend');
  pickN(18, () => true).forEach(l => l.cause = 'laser');
  pickN(10, l => l.cls === 'scale-across').forEach(l => l.cause = 'sop');
  pickN(4, l => l.cls === 'campus').forEach(l => l.cause = 'sop');
  pickN(9, () => true).forEach(l => l.cause = 'thermal');
  pickN(4, () => true).forEach(l => l.cause = 'module');
  for (const l of links) if (!l.cause) l.cause = 'healthy';

  const thermalRack = Math.floor(r() * 4);
  for (const l of links) {
    const s = SITES[l.from].id, d = SITES[l.to].id;
    l.name = `${s}-${d === s ? 'R' : d}-${String(l.id).padStart(3, '0')}`;
    l.ptx0 = 0.5 + 0.35 * gauss(r);
    l.loss0 = 0.22 * l.km + 1.6 + 0.5 * r() + (l.cls === 'scale-across' ? 1.0 : 0);   // fiber + connectors/splices
    l.snrTrx = 19.0 + 0.35 * gauss(r);
    l.lw0 = 120 + 40 * r();
    l.cd = 16.8 * l.km;
    l.dgd0 = 0.4 + 0.1 * Math.sqrt(l.km) * r();
    l.temp0 = 50 + 6 * r();
    l.onset = Math.floor((8 + 50 * r()) * PER_DAY);
    if (l.cause === 'contamination') l.rate = (0.06 + 0.22 * r()) / PER_DAY;       // dB per sample
    if (l.cause === 'bend') { l.step = 3.5 + 4 * r(); l.recover = r() < 0.3 ? l.onset + Math.floor((1 + 2 * r()) * PER_DAY) : Infinity; }
    if (l.cause === 'laser') { l.double = (5 + 7 * r()) * PER_DAY; l.onset = Math.floor((8 + r() * 48) * PER_DAY); }
    if (l.cause === 'sop') { l.burstRate = (0.10 + 0.22 * r()) / PER_DAY; l.burstAmp = 520 + 700 * r(); l.onset = 0; }
    if (l.cause === 'thermal') { l.rack = thermalRack; l.dT = 14 + 8 * r(); }
    if (l.cause === 'module') l.trxRate = (0.04 + 0.05 * r()) / PER_DAY;
  }

  // simulate telemetry
  const M = (n) => Array.from({ length: links.length }, () => new Float32Array(n));
  const tel = { snr: M(N_T), rx: M(N_T), tx: M(N_T), lw: M(N_T), sop: M(N_T), temp: M(N_T), cd: M(N_T), dgd: M(N_T), fo: M(N_T), flap: M(N_T), trueSnr: M(N_T) };
  for (const l of links) {
    let burstLeft = 0, burstAmp = 0, repairAt = -1;
    l.incidents = [];
    for (let t = 0; t < N_T; t++) {
      // reactive repair after an outage: the fault is cleared (cleaned / re-patched / swapped / fan fixed)
      if (repairAt >= 0 && t >= repairAt) {
        repairAt = -1; l.repairedAt = t;
        if (l.cause !== 'sop') l.onset = Infinity;
      }
      const since = Math.max(0, t - l.onset);
      let extraLoss = 0, ptx = l.ptx0, lw = l.lw0, sop = 6 + 10 * r(), temp = l.temp0 + 2 * Math.sin(2 * Math.PI * t / PER_DAY) + 0.6 * gauss(r), trx = l.snrTrx, fo = 40 * gauss(r) * 0.2;
      if (l.cause === 'contamination' && t >= l.onset) extraLoss += l.rate * since;
      if (l.cause === 'bend' && t >= l.onset && t < l.recover) extraLoss += l.step;
      if (l.cause === 'laser' && t >= l.onset) { lw = l.lw0 * Math.min(40, 2 ** (since / l.double)); /* aging DFB: linewidth grows until the module is swapped */ ptx -= 0.02 * since / PER_DAY; fo += 0.6 * since / PER_DAY; }
      if (l.cause === 'sop') {
        if (burstLeft <= 0 && r() < l.burstRate) { burstLeft = 1 + Math.floor(3 * r()); burstAmp = l.burstAmp * (0.6 + 0.6 * r()); }
        if (burstLeft > 0) { sop = burstAmp * (0.7 + 0.3 * r()); burstLeft--; }
      }
      if (l.cause === 'thermal' && t >= l.onset) temp += l.dT * Math.min(1, since / (4 * PER_DAY));
      if (l.cause === 'module' && t >= l.onset) trx -= l.trxRate * since;
      const prx = ptx - l.loss0 - extraLoss;
      const nsrTrx = 10 ** (-trx / 10) + MODEL.C_T * Math.max(0, temp - 60) * 10 ** (-trx / 10) * 10;
      const nsr = nsrTrx + 10 ** (-(prx + MODEL.RX_K) / 10) + MODEL.C_PN * lw + MODEL.C_SOP * sop * sop;
      const snrTrue = -10 * Math.log10(nsr);
      const i = l.id;
      tel.trueSnr[i][t] = snrTrue;
      tel.snr[i][t] = snrTrue + 0.03 * gauss(r);                 // effective SNR from pre-FEC BER counters (Q-factor), 4 h window
      tel.rx[i][t] = prx + 0.05 * gauss(r);
      tel.tx[i][t] = ptx + 0.03 * gauss(r);
      tel.lw[i][t] = Math.max(20, lw * (1 + 0.08 * gauss(r)));   // carrier-recovery linewidth estimate (kHz)
      tel.sop[i][t] = sop;                                        // peak SOP rotation speed in the interval (krad/s)
      tel.temp[i][t] = temp;
      tel.cd[i][t] = l.cd + 3 * gauss(r);
      tel.dgd[i][t] = l.dgd0 + 0.05 * Math.abs(gauss(r));
      tel.fo[i][t] = fo;
      tel.flap[i][t] = snrTrue < SNR_REQ ? 1 : 0;                  // uncorrectable codewords -> link flap
      if (tel.flap[i][t] && repairAt < 0 && l.cause !== 'healthy') {
        if (!l.incidents.length || t - l.incidents[l.incidents.length - 1] > PER_DAY) l.incidents.push(t);
        if (l.cause !== 'sop') repairAt = t + 3 + Math.floor(9 * r());   // 0.5-2 days to diagnose and fix
      }
    }
  }
  return { links, tel, seed };
}

// ---------- noise-budget attribution ----------
// Features are increases relative to the link's own first-week baseline; NSR terms add, so ΔNSR splits exactly.
export const TERMS = ['rx', 'laser', 'sop', 'thermal'];
export function featureDeltas(tel, i, t, base) {
  const nsrRx = (p) => 10 ** (-(p + MODEL.RX_K) / 10);
  return [
    nsrRx(tel.rx[i][t]) - base.nsrRx,
    tel.lw[i][t] - base.lw,
    tel.sop[i][t] ** 2 - base.sop2,
    Math.max(0, tel.temp[i][t] - 60) - base.hot,
  ];
}
export function baselines(fleet, days = 7) {
  const { tel, links } = fleet;
  const n = days * PER_DAY;
  return links.map((l, i) => {
    let nsr = 0, nsrRx = 0, lw = 0, sop2 = 0, hot = 0;
    for (let t = 0; t < n; t++) {
      nsr += 10 ** (-tel.snr[i][t] / 10); nsrRx += 10 ** (-(tel.rx[i][t] + MODEL.RX_K) / 10);
      lw += tel.lw[i][t]; sop2 += Math.min(tel.sop[i][t], 40) ** 2; hot += Math.max(0, tel.temp[i][t] - 60);
    }
    return { nsr: nsr / n, nsrRx: nsrRx / n, lw: lw / n, sop2: sop2 / n, hot: hot / n };
  });
}
// non-negative least squares (projected coordinate descent) for ΔNSR = Σ θ_k Δx_k, fitted fleet-wide
export function fitTheta(fleet, base, stride = 3) {
  const { tel, links } = fleet;
  const K = TERMS.length;
  const XtX = Array.from({ length: K }, () => new Float64Array(K)), Xty = new Float64Array(K);
  for (let i = 0; i < links.length; i++) for (let t = 0; t < N_T; t += stride) {
    const x = featureDeltas(tel, i, t, base[i]);
    const y = 10 ** (-tel.snr[i][t] / 10) - base[i].nsr;
    for (let a = 0; a < K; a++) { Xty[a] += x[a] * y; for (let b = 0; b < K; b++) XtX[a][b] += x[a] * x[b]; }
  }
  const th = new Float64Array(K);
  for (let it = 0; it < 500; it++) for (let a = 0; a < K; a++) {
    let s = Xty[a]; for (let b = 0; b < K; b++) if (b !== a) s -= XtX[a][b] * th[b];
    th[a] = XtX[a][a] > 0 ? Math.max(0, s / XtX[a][a]) : 0;
  }
  return Array.from(th);
}
// margin-loss attribution for link i at time t (dB of SNR lost vs baseline, split by term + unexplained)
export function attribute(fleet, i, t, base, theta) {
  const { tel } = fleet;
  const x = featureDeltas(tel, i, t, base[i]);
  const nsr = 10 ** (-tel.snr[i][t] / 10);
  const dTotal = nsr - base[i].nsr;
  const parts = x.map((v, k) => Math.max(0, theta[k] * v));
  const explained = parts.reduce((a, b) => a + b, 0);
  const unexplained = Math.max(0, dTotal - explained);
  const lossDb = 10 * Math.log10(nsr / base[i].nsr);
  const denom = explained + unexplained;
  const shares = denom > 0 ? [...parts, unexplained].map(p => p / denom) : [0, 0, 0, 0, 0];
  return { lossDb, shares };
}
// root cause: dominant term over the last 3 days, split rx-power losses into step (bend) vs drift (contamination)
export function rootCause(fleet, i, tNow, base, theta) {
  const { tel } = fleet;
  if (tNow < 7 * PER_DAY) return { cause: 'healthy', lossDb: 0, shares: [0, 0, 0, 0, 0] };
  const acc = [0, 0, 0, 0, 0]; let loss = 0, n = 0;
  for (let t = Math.max(0, tNow - 3 * PER_DAY); t <= tNow; t++) { const a = attribute(fleet, i, t, base, theta); a.shares.forEach((s, k) => acc[k] += s * Math.max(0, a.lossDb)); loss = Math.max(loss, a.lossDb); n++; }
  const tot = acc.reduce((a, b) => a + b, 0);
  const shares = tot > 0 ? acc.map(v => v / tot) : acc;
  if (loss < 0.6) return { cause: 'healthy', lossDb: loss, shares };
  const k = shares.indexOf(Math.max(...shares));
  let cause = ['rx', 'laser', 'sop', 'thermal', 'module'][k];
  if (cause === 'rx') {
    // largest single-step change in received power over the last 10 days
    let jump = 0; for (let t = 7 * PER_DAY; t <= tNow; t++) jump = Math.max(jump, tel.rx[i][t - 1] - tel.rx[i][t]);
    const drop = base[i] ? -10 * Math.log10(10 ** (-(tel.rx[i][tNow] + MODEL.RX_K) / 10) / base[i].nsrRx) : 0;
    cause = jump > 1.2 && jump >= 0.5 * Math.abs(drop) ? 'bend' : 'contamination';
  }
  return { cause, lossDb: loss, shares };
}

// ---------- forecasting: trend + burst depth, conformal residuals ----------
export const margin = (snrDb) => snrDb - SNR_REQ;
function dailyMedianMargin(tel, i, d) { const a = Array.from(tel.snr[i].slice(d * PER_DAY, (d + 1) * PER_DAY)).sort((x, y) => x - y); return margin((a[2] + a[3]) / 2); }
function dailyMinMargin(tel, i, d) { let m = Infinity; for (let t = d * PER_DAY; t < (d + 1) * PER_DAY; t++) m = Math.min(m, tel.snr[i][t]); return margin(m); }
export function theilSen(ys) {
  const s = [];
  for (let a = 0; a < ys.length; a++) for (let b = a + 1; b < ys.length; b++) s.push((ys[b] - ys[a]) / (b - a));
  s.sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}
// point forecast of the worst margin over the next h days, made at the end of day d0
export function pointForecast(tel, i, d0, h) {
  const med = [], dip = [];
  for (let d = Math.max(0, d0 - 13); d <= d0; d++) { const m = dailyMedianMargin(tel, i, d); med.push(m); dip.push(m - dailyMinMargin(tel, i, d)); }
  const recent = med.slice(-7);
  const slope = Math.min(0, theilSen(recent));
  const now = recent[recent.length - 1];
  dip.sort((a, b) => a - b);
  const burst = dip[Math.floor(0.9 * (dip.length - 1))];
  return { pred: now + slope * h - burst, now, slope, burst };
}
export function actualWorst(tel, i, d0, h) { let m = Infinity; for (let d = d0 + 1; d <= Math.min(DAYS - 1, d0 + h); d++) m = Math.min(m, dailyMinMargin(tel, i, d)); return m; }
export function actualFlap(tel, i, d0, h) { for (let t = (d0 + 1) * PER_DAY; t < Math.min(N_T, (d0 + 1 + h) * PER_DAY); t++) if (tel.flap[i][t]) return true; return false; }
export function inOutage(tel, i, d0) { for (let t = d0 * PER_DAY; t < (d0 + 1) * PER_DAY; t++) if (tel.flap[i][t]) return true; return false; }

// Locally adaptive (normalized) split conformal: score = (actual worst margin - predicted) / sigma(link, origin).
// sigma grows with recent volatility around the trend, the trend steepness and burst depth, so steady links get tight
// bands and degrading links get wide ones.
export function sigma(tel, i, d0, h, f) {
  let v = 0; const ys = [];
  for (let d = d0 - 6; d <= d0; d++) ys.push(dailyMedianMargin(tel, i, d));
  ys.forEach((y, k) => { const fit = ys[6] + f.slope * (k - 6); v += (y - fit) ** 2; });
  return 0.1 + Math.sqrt(v / ys.length) + 0.5 * Math.abs(f.slope) * h + 0.5 * f.burst;
}
export const SAFE_P = 0.02;
// Calibration windows: forecast origins d0 in [from, to], scored on links that are up at the origin.
// Returns sorted normalized residuals plus a per-class "sudden onset" hazard: the observed flap rate among windows
// the trend model called safe (bends, cable hits and SOP bursts on quiet links that no trend can see coming).
export function calibrate(fleet, { h = 7, from = 14, to = 33 } = {}) {
  const res = [], rows = [];
  for (let d0 = from; d0 <= to; d0++) for (let i = 0; i < fleet.links.length; i++) {
    if (inOutage(fleet.tel, i, d0)) continue;
    const f = pointForecast(fleet.tel, i, d0, h);
    const s = sigma(fleet.tel, i, d0, h, f);
    res.push((actualWorst(fleet.tel, i, d0, h) - f.pred) / s);
    rows.push({ i, f, s, y: actualFlap(fleet.tel, i, d0, h) });
  }
  const residuals = Float64Array.from(res).sort();
  const hazard = {};
  for (const cls of ['campus', 'scale-across', 'row']) {
    const safe = rows.filter(r => fleet.links[r.i].cls === cls && pTrend(r.f.pred, r.s, residuals) < SAFE_P);
    // add-one smoothing so a class with no observed sudden flaps never gets probability exactly 0
    hazard[cls] = (safe.filter(r => r.y).length + 1) / (safe.length + 2);
  }
  return { residuals, hazard, n: res.length };
}
// conformal predictive probability that the worst margin over the horizon drops below 0 dB under the trend model
export function pTrend(pred, s, residuals) {
  // count normalized residuals r with pred + s*r < 0  <=>  r < -pred/s
  let lo = 0, hi = residuals.length; const x = -pred / s;
  while (lo < hi) { const m = (lo + hi) >> 1; if (residuals[m] < x) lo = m + 1; else hi = m; }
  return (lo + 1) / (residuals.length + 1);
}
// total flap probability: trend-driven margin exhaustion OR a sudden event at the class base rate
export function pFlap(pred, s, cal, cls) {
  const pt = pTrend(pred, s, cal.residuals);
  return 1 - (1 - pt) * (1 - cal.hazard[cls]);
}
// conformal band for the worst margin over the horizon (normalized quantiles rescaled by this link's sigma)
export function band(pred, s, residuals, qs) { return qs.map(q => pred + s * residuals[Math.min(residuals.length - 1, Math.max(0, Math.floor(q * (residuals.length + 1)) - 1))]); }
export function linkForecast(fleet, i, d0, h, cal) {
  const f = pointForecast(fleet.tel, i, d0, h);
  const s = sigma(fleet.tel, i, d0, h, f);
  return { ...f, s, p: pFlap(f.pred, s, cal, fleet.links[i].cls), pt: pTrend(f.pred, s, cal.residuals) };
}

// ---------- backtest on held-out origins (days 41-52, after every calibration window has closed) ----------
export const BT_FROM = 41, BT_TO = 52;
export function backtest(fleet, cal, { h = 7, from = BT_FROM, to = BT_TO, ruleDb = 1.0 } = {}) {
  const rows = [];
  for (let d0 = from; d0 <= to; d0++) for (let i = 0; i < fleet.links.length; i++) {
    if (inOutage(fleet.tel, i, d0)) continue;   // score only links that are up at the forecast origin
    const f = linkForecast(fleet, i, d0, h, cal);
    rows.push({ d0, i, p: f.p, now: f.now, y: actualFlap(fleet.tel, i, d0, h) ? 1 : 0 });
  }
  const n = rows.length;
  const brier = rows.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / n;
  const base = rows.reduce((a, r) => a + r.y, 0) / n;
  const brierRef = rows.reduce((a, r) => a + (base - r.y) ** 2, 0) / n;
  const edges = [0, 0.02, 0.1, 0.3, 0.6, 0.9, 1.0000001];
  let ece = 0;
  const bins = edges.slice(0, -1).map((lo, k) => {
    const hi = edges[k + 1];
    const b = rows.filter(r => r.p >= lo && r.p < hi);
    const pred = b.length ? b.reduce((a, r) => a + r.p, 0) / b.length : null;
    const obs = b.length ? b.reduce((a, r) => a + r.y, 0) / b.length : null;
    if (b.length) ece += b.length / n * Math.abs(pred - obs);
    return { lo, hi, n: b.length, pred, obs };
  });
  // AUROC (rank-based, ties averaged)
  const pos = rows.filter(r => r.y).length, neg = n - pos;
  const sorted = rows.slice().sort((a, b) => a.p - b.p);
  let sumPos = 0; for (let k = 0; k < sorted.length;) { let j = k; while (j < sorted.length && sorted[j].p === sorted[k].p) j++; const avg = (k + j + 1) / 2; for (let m = k; m < j; m++) if (sorted[m].y) sumPos += avg; k = j; }
  const auroc = pos && neg ? (sumPos - pos * (pos + 1) / 2) / (pos * neg) : null;
  const expected = rows.reduce((a, r) => a + r.p, 0);
  return { n, positives: pos, expected, brier, brierRef, skill: 1 - brier / brierRef, ece, bins, auroc, rows };
}

// Lead time on every flap episode that starts in the held-out period: days of warning before the first flap.
// Model alert: P(flap in 7 d) >= pAlert. Baseline: the usual static alarm, margin below ruleDb.
export function leadTimes(fleet, cal, { h = 7, pAlert = 0.3, ruleDb = 1.0, from = BT_FROM + 1 } = {}) {
  const out = [];
  for (let i = 0; i < fleet.links.length; i++) for (const first of fleet.links[i].incidents) {
    if (first < from * PER_DAY) continue;
    const dFlap = Math.floor(first / PER_DAY);
    let model = null, rule = null;
    for (let d0 = Math.max(14, dFlap - h); d0 < dFlap; d0++) {
      if (inOutage(fleet.tel, i, d0)) continue;
      const f = linkForecast(fleet, i, d0, h, cal);
      const lead = first / PER_DAY - (d0 + 1);
      if (model === null && f.p >= pAlert) model = lead;
      if (rule === null && f.now < ruleDb) rule = lead;
    }
    out.push({ i, name: fleet.links[i].name, dFlap, first, model, rule, cause: fleet.links[i].cause });
  }
  return out;
}
export function median(xs) { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
export function summarizeLead(lt) {
  const m = lt.filter(x => x.model !== null), r = lt.filter(x => x.rule !== null);
  return {
    episodes: lt.length, modelWarned: m.length, ruleWarned: r.length,
    // missing warnings count as 0 days of warning
    medModel: median(lt.map(x => x.model ?? 0)), medRule: median(lt.map(x => x.rule ?? 0)),
    earlier: lt.filter(x => (x.model ?? 0) > (x.rule ?? 0)).length,
  };
}

// ---------- maintenance plan: 0/1 knapsack over technician minutes ----------
export const ACTIONS = {
  contamination: { label: 'Inspect and clean connectors', min: 20 },
  bend: { label: 'Trace route, fix bend or re-patch', min: 45 },
  laser: { label: 'Swap transceiver module', min: 30 },
  sop: { label: 'Re-route fiber away from vibration', min: 60 },
  thermal: { label: 'Restore rack airflow', min: 25 },
  module: { label: 'Swap transceiver module', min: 30 },
};
export function plan(candidates, budgetMin, step = 5) {
  // candidates: [{ value, minutes, ... }]  maximise Σ value subject to Σ minutes <= budget
  const W = Math.floor(budgetMin / step), n = candidates.length;
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(W + 1));
  for (let k = 1; k <= n; k++) {
    const w = Math.ceil(candidates[k - 1].minutes / step), v = candidates[k - 1].value;
    for (let c = 0; c <= W; c++) dp[k][c] = Math.max(dp[k - 1][c], c >= w ? dp[k - 1][c - w] + v : -Infinity);
  }
  const chosen = []; let c = W;
  for (let k = n; k >= 1; k--) if (dp[k][c] !== dp[k - 1][c]) { chosen.push(candidates[k - 1]); c -= Math.ceil(candidates[k - 1].minutes / step); }
  return { chosen: chosen.reverse(), value: dp[n][W] };
}

// ---------- everything the page needs ----------
export function analyzeFleet(fleet, { h = 7, budgetMin = 360 } = {}) {
  const base = baselines(fleet);
  const theta = fitTheta(fleet, base);
  const cal = calibrate(fleet, { h });
  const dNow = DAYS - 1 - h, tNow = (dNow + 1) * PER_DAY - 1;   // "today" = day 52, so the next 7 days are known for the replay
  const links = fleet.links.map((l, i) => {
    const up = !inOutage(fleet.tel, i, dNow);
    const f = linkForecast(fleet, i, dNow, h, cal);
    const rc = rootCause(fleet, i, tNow, base, theta);
    let flaps30 = 0; for (let t = tNow - 30 * PER_DAY + 1; t <= tNow; t++) if (fleet.tel.flap[i][t] && !fleet.tel.flap[i][t - 1]) flaps30++;
    return { ...l, i, up, p: up ? f.p : 1, f, rc, flaps30, marginNow: margin(fleet.tel.snr[i][tNow]), futureFlap: actualFlap(fleet.tel, i, dNow, h) };
  });
  const bt = backtest(fleet, cal, { h });
  const lt = leadTimes(fleet, cal, { h });
  const cands = links.filter(l => l.up && l.p >= 0.05 && l.rc.cause !== 'healthy')
    .map(l => ({ id: l.i, minutes: ACTIONS[l.rc.cause].min, value: l.p * l.weight, l }));
  const mp = plan(cands, budgetMin);
  return { base, theta, cal, dNow, tNow, links, bt, lt, lead: summarizeLead(lt), mp, cands };
}
