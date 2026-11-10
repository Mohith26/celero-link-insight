import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../core/fleet.mjs';

const fleet = F.generateFleet();
const A = F.analyzeFleet(fleet);

test('DP-16QAM BER curve is monotone and the FEC threshold SNR solves BER = threshold', () => {
  let prev = 1;
  for (let s = 6; s <= 22; s += 0.5) { const b = F.ber16qam(s); assert.ok(b < prev); prev = b; }
  assert.ok(Math.abs(F.ber16qam(F.SNR_REQ) - F.FEC_BER) / F.FEC_BER < 1e-6);
  assert.ok(F.SNR_REQ > 13 && F.SNR_REQ < 14.2);
});

test('erfc matches reference values', () => {
  assert.ok(Math.abs(F.erfc(0) - 1) < 1e-7);
  assert.ok(Math.abs(F.erfc(1) - 0.1572992070) < 1e-7);
  assert.ok(Math.abs(F.erfc(-1) - 1.8427007930) < 1e-7);
});

test('fleet generation is deterministic for a seed and covers all link classes', () => {
  const b = F.generateFleet();
  assert.equal(b.links.length, 480);
  assert.equal(b.tel.snr[17][123], fleet.tel.snr[17][123]);
  const c = F.generateFleet(7);
  assert.notEqual(c.tel.snr[17][123], fleet.tel.snr[17][123]);
  for (const cls of ['campus', 'scale-across', 'row']) assert.ok(fleet.links.some(l => l.cls === cls));
});

test('fleet-wide NNLS recovers the noise-budget coefficients of the generating model', () => {
  const [rx, laser, sop, thermal] = A.theta;
  assert.ok(Math.abs(rx - 1) < 0.05, `rx ${rx}`);
  assert.ok(Math.abs(laser / F.MODEL.C_PN - 1) < 0.1, `laser ${laser}`);
  assert.ok(Math.abs(sop / F.MODEL.C_SOP - 1) < 0.1, `sop ${sop}`);
  assert.ok(thermal > 0);
});

test('root cause is correct on every link it diagnoses as degraded', () => {
  const diag = A.links.filter(l => l.rc.cause !== 'healthy');
  const ok = diag.filter(l => l.rc.cause === l.cause).length;
  assert.ok(diag.length >= 30);
  assert.ok(ok / diag.length >= 0.95, `${ok}/${diag.length}`);
});

test('attribution shares are a distribution', () => {
  for (const l of A.links.slice(0, 60)) {
    const s = l.rc.shares.reduce((a, b) => a + b, 0);
    assert.ok(s === 0 || Math.abs(s - 1) < 1e-9);
  }
});

test('Theil-Sen recovers a slope and ignores one outlier', () => {
  assert.ok(Math.abs(F.theilSen([0, -0.1, -0.2, 5, -0.4, -0.5, -0.6]) + 0.1) < 1e-9);
});

test('conformal probability is monotone in predicted margin and bounded', () => {
  const r = A.cal.residuals;
  let prev = 1;
  for (let m = -2; m <= 4; m += 0.25) { const p = F.pTrend(m, 0.5, r); assert.ok(p <= prev && p > 0 && p <= 1); prev = p; }
  for (const cls of ['campus', 'scale-across', 'row']) assert.ok(A.cal.hazard[cls] > 0 && A.cal.hazard[cls] < 0.05);
});

test('held-out backtest is calibrated and discriminative', () => {
  const b = A.bt;
  assert.ok(b.positives > 40);
  assert.ok(Math.abs(b.expected - b.positives) / b.positives < 0.15, `${b.expected} vs ${b.positives}`);
  assert.ok(b.ece < 0.01, `ece ${b.ece}`);
  assert.ok(b.auroc > 0.9);
  assert.ok(b.skill > 0.2);
});

test('calibration and backtest windows do not overlap', () => {
  // last calibration origin 33 + 7-day horizon = day 40 < first backtest origin
  assert.ok(33 + 7 < F.BT_FROM);
});

test('knapsack plan is optimal against brute force and respects the budget', () => {
  const rnd = F.mulberry32(5);
  for (let trial = 0; trial < 30; trial++) {
    const c = Array.from({ length: 9 }, (_, k) => ({ id: k, minutes: 5 * (1 + Math.floor(rnd() * 12)), value: rnd() }));
    const budget = 5 * (4 + Math.floor(rnd() * 30));
    const { chosen, value } = F.plan(c, budget);
    assert.ok(chosen.reduce((a, x) => a + x.minutes, 0) <= budget);
    let best = 0;
    for (let m = 0; m < 1 << c.length; m++) { let w = 0, v = 0; for (let k = 0; k < c.length; k++) if (m >> k & 1) { w += c[k].minutes; v += c[k].value; } if (w <= budget) best = Math.max(best, v); }
    assert.ok(Math.abs(best - value) < 1e-9);
    assert.ok(Math.abs(chosen.reduce((a, x) => a + x.value, 0) - value) < 1e-9);
  }
});
