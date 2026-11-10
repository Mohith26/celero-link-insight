# Link Insight for Celero coherent DSPs (concept)

**Live demo:** https://mohith26.github.io/celero-link-insight/

An unofficial concept for a fleet-telemetry feature that a coherent DSP vendor could ship next to its silicon: every link's
lost SNR margin is split into physical causes, and each link gets a **calibrated probability of a flap in the next 7 days**
plus the fix a technician should make first.

Built by Mohith Gajjela. Not affiliated with Celero Communications. All data is synthetic.

## Why this feature

Coherent links are moving inside AI data centers. A PAM4 module can tell an operator little more than Rx power and a
pre-FEC BER. A coherent DSP already estimates the individual impairments to do its job: received power, carrier-recovery
phase noise, polarization (SOP) tracking speed, CD, DGD, frequency offset, temperature. That telemetry is enough to answer
the two questions an operator actually asks about a fleet of thousands of links:

1. *Which links are going to flap this week?* (with a probability you can trust, not a red/green threshold)
2. *Why, and what do I send a technician to do?* (clean a connector, re-patch a bend, swap a module, fix airflow)

## How it works

All code is in `core/fleet.mjs` (pure ES module, no dependencies; runs in the browser and under `node --test`).

1. **Simulator.** 480 DP-16QAM links (288 campus 1-4 km, 128 scale-across 36-40 km, 64 in-row) over 60 days of 4-hour
   telemetry. Faults with distinct signatures are injected: connector contamination (slow Rx-power drift), fiber bends
   (step loss, sometimes recovering), aging lasers (linewidth growth), SOP transients from vibration (bursts), rack thermal
   problems, and module SNR degradation. Links flap when effective SNR falls below the FEC limit (BER 1.25e-2, 13.55 dB
   for Gray-coded 16QAM) and get repaired 0.5-2 days later.
2. **Noise-budget attribution.** Noise powers add, so the change in noise-to-signal ratio is linear in each link's own
   telemetry deltas: ΔNSR = θ_rx·ΔNSR_rx + θ_pn·Δlinewidth + θ_sop·ΔSOP² + θ_T·Δheat + unexplained. The θ's are fitted
   **once across the whole fleet** with non-negative least squares (projected coordinate descent). Each link's lost
   margin (dB) is then split into those terms; the dominant term over the last 3 days is the root cause, and Rx-power
   losses are separated into *step* (bend) vs *drift* (contamination) from the largest single-sample change.
3. **Forecast.** For each link: Theil-Sen trend of the daily median margin over the last 7 days, minus the 90th-percentile
   depth of its intra-day dips, gives a point forecast of the worst margin over the next 7 days.
4. **Calibrated probability.** Locally adaptive split conformal prediction: residuals (actual worst margin minus
   forecast) are normalized by a per-link scale (recent volatility around the trend, trend steepness, dip depth), pooled
   over calibration windows on days 14-33, and P(worst margin < 0 dB) is read off that distribution. Sudden events on
   quiet links (bends, cable hits) are invisible to any trend, so a per-class base hazard, estimated from the calibration
   windows the trend model called safe, is combined in: P = 1 − (1 − P_trend)(1 − λ_class).
5. **Maintenance planner.** 0/1 knapsack (DP over 5-minute steps) that chooses fixes maximizing removed expected
   flap-cost (probability × link weight) within a technician shift.

## Results on the committed seed (held-out days 41-52)

Reproduce with `node scripts/summary.mjs` (writes `data/summary.json`); the page computes the same numbers live.

| Metric | Value |
|---|---|
| Flap windows predicted vs observed | 84.8 vs 85 (5,736 link-windows) |
| Expected calibration error | 0.37 points |
| AUROC | 0.963 |
| Alerts at P ≥ 30% vs a static "margin < 2 dB" alarm | 52 vs 228 alerts, catching 44 vs 43 flap windows |
| Root cause vs simulator ground truth | 44 of 44 degraded links correct |
| Fleet-fit coefficients vs simulator | all within 4.1% |

Across 5 other seeds the expected flap count lands within about 30% of observed, ECE stays under 0.7 points, AUROC 0.90-0.99,
and the P ≥ 30% alert set stays several times smaller than the 2 dB alarm for a similar catch (`scripts/summary.mjs <seed>`).

## Tests

```
node --test
```

11 tests: BER curve and FEC threshold, erfc accuracy, deterministic seeding, NNLS recovers the generating coefficients,
root-cause accuracy, attribution shares sum to one, Theil-Sen robustness, conformal probability monotonicity, held-out
calibration (expected vs observed within 15%, ECE < 1 pt, AUROC > 0.9), calibration/backtest window separation, and
knapsack optimality against brute force.

## Honest limitations

- **The physics is illustrative.** Penalty magnitudes (phase-noise coefficient, SOP tracking penalty, thermal term) were
  chosen so each impairment can push a link past the FEC limit within weeks. Real penalty curves are nonlinear and specific
  to the DSP (equalizer and carrier-recovery design, baud rate). The method itself only needs additive noise powers and
  features that grow with each impairment; on real data the fleet-wide fit would replace these constants.
- Because the simulator and the attribution share the same additive model, the coefficient recovery and the 44/44 root
  cause are a consistency check, not evidence about real fiber plants. Real faults overlap and telemetry is noisier.
- Sudden faults on quiet links are not forecastable by any trend; the model only prices them at a class base rate.
- The UI is my rebuild of Celero's public web design system (Karla/Arial, neutral #010B13, primary #99B5DC, radii from the
  site's Automatic.css). Celero has no public software UI to copy, so the app shell is invented.

## Novelty note

I found no telemetry or analytics product from Celero (site, press releases, careers page, news coverage as of Nov 2026).
Competitors do ship fleet analytics: Marvell's RELIANT interconnect telemetry platform (Mar 2026) advertises "predictive
link status analytics" and automated diagnostics, Credo pairs DSP telemetry with PILOT firmware for "zero flap optics",
and Ciena's Liquid Spectrum / Nokia WaveSuite do margin analytics for telecom networks. What I did not find published
anywhere is the specific combination here: a fleet-fitted additive noise budget per coherent link for root cause, plus
conformal, backtested-calibrated flap probabilities and a shift-level repair plan.

## Files

- `index.html`, `assets/style.css`, `assets/app.js`: the single-page console (CDN font only, no build step)
- `core/fleet.mjs`: simulator, attribution, forecasting, conformal calibration, backtest, planner
- `test/fleet.test.mjs`: unit tests
- `scripts/summary.mjs`: seeded regeneration of the headline numbers
