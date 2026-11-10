// Regenerates the synthetic fleet from its committed seed and prints the headline numbers the page computes live.
// Usage: node scripts/summary.mjs [seed]   (writes data/summary.json)
import { writeFileSync } from 'node:fs';
import * as F from '../core/fleet.mjs';
const seed = Number(process.argv[2] ?? 20260911);
const fleet = F.generateFleet(seed);
const A = F.analyzeFleet(fleet);
const rows = A.bt.rows;
const modelAlerts = rows.filter(r => r.p >= 0.3), rule2 = rows.filter(r => r.now < 2), rule1 = rows.filter(r => r.now < 1);
const diag = A.links.filter(l => l.rc.cause !== 'healthy');
const out = {
  seed, links: fleet.links.length, snrRequiredDb: +F.SNR_REQ.toFixed(3),
  theta: A.theta, model: F.MODEL, hazard: A.cal.hazard, calibrationWindows: A.cal.n,
  backtest: { windows: A.bt.n, flaps: A.bt.positives, expected: +A.bt.expected.toFixed(2), brier: A.bt.brier, skill: A.bt.skill, ece: A.bt.ece, auroc: A.bt.auroc, bins: A.bt.bins },
  alerts: { model_p30: [modelAlerts.length, modelAlerts.filter(r => r.y).length], margin_lt_2dB: [rule2.length, rule2.filter(r => r.y).length], margin_lt_1dB: [rule1.length, rule1.filter(r => r.y).length] },
  lead: A.lead,
  rootCause: { diagnosed: diag.length, correct: diag.filter(l => l.rc.cause === l.cause).length },
  today: { day: A.dNow, atRisk: A.links.filter(l => l.up && l.p >= 0.3).length, expectedFlaps7d: +A.links.filter(l => l.up).reduce((a, l) => a + l.p, 0).toFixed(2) },
  plan360: { picks: A.mp.chosen.map(c => ({ link: c.l.name, cause: c.l.rc.cause, minutes: c.minutes, p: +c.l.p.toFixed(3) })) },
};
writeFileSync(new URL('../data/summary.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify({ backtest: out.backtest.flaps + ' flaps vs ' + out.backtest.expected + ' expected', ece: out.backtest.ece.toFixed(4), alerts: out.alerts, rootCause: out.rootCause, today: out.today }, null, 1));
