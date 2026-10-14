// Analyses a field campaign recorded in the trials_template.csv format.
// Usage: node experiment/analyze.js experiment/my_trials.csv
//
// Each trial carries three identical flat absorbent pads: on top of a cap (facing up), on the chest
// (facing forward) and on the back (facing backward). For flat pads the model predicts
//   m_top   = ρ·C·A·vt·T                (a rain gauge riding along with you)
//   m_front = ρ·C·A·η·max(0, v − Ux)·T
//   m_back  = ρ·C·A·η·max(0, Ux − v)·T
// so the ratios r_f = m_front/m_top and r_b = m_back/m_top equal k·max(0, ±(v − Ux)) with k = η/vt.
// Rain intensity, pad area and trial duration all cancel. The signature to look for is a V-shaped
// dip of r_f + r_b to zero at v = Ux; we fit Ux and k and compare with a model that ignores wind.
'use strict';
const fs = require('fs');

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'));
  const head = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    const row = {};
    head.forEach((h, i) => { const v = (cells[i] || '').trim(); row[h] = v === '' ? null : (isNaN(+v) ? v : +v); });
    return row;
  });
}

// Turns raw rows into per-trial observations.
function observations(rows) {
  return rows.filter(r => r.duration_s > 0 && r.top_wet_g != null).map(r => {
    const v = r.course_m / r.duration_s;
    const top = r.top_wet_g - r.top_dry_g, front = r.front_wet_g - r.front_dry_g, back = r.back_wet_g - r.back_dry_g;
    const areaM2 = (r.pad_area_cm2 || 400) / 1e4;
    return {
      id: r.trial_id, v, top, front, back,
      rf: front / top, rb: back / top,
      windAlong: r.wind_along_mps,
      rainFromPad: top / 1000 / 1000 / areaM2 / r.duration_s * 3.6e6, // mm/h implied by the top pad
      rainGauge: r.rain_gauge_mm != null ? r.rain_gauge_mm / r.duration_s * 3600 : null,
    };
  });
}

// Least squares for r = k·|v − Ux| split into front/back parts, scanning Ux and solving k exactly.
function fitWindModel(obs) {
  let best = null;
  for (let U = -6; U <= 10.0001; U += 0.01) {
    let sxy = 0, sxx = 0;
    for (const o of obs) {
      const xf = Math.max(0, o.v - U), xb = Math.max(0, U - o.v);
      sxy += xf * o.rf + xb * o.rb; sxx += xf * xf + xb * xb;
    }
    if (sxx === 0) continue;
    const k = sxy / sxx;
    let rss = 0;
    for (const o of obs) {
      rss += (o.rf - k * Math.max(0, o.v - U)) ** 2 + (o.rb - k * Math.max(0, U - o.v)) ** 2;
    }
    if (!best || rss < best.rss) best = { U, k, rss };
  }
  return best;
}

// The alternative a sceptic would propose: the wind does not matter, the chest just sweeps
// r_f = k·v and the back stays dry.
function fitNoWindModel(obs) {
  let sxy = 0, sxx = 0;
  for (const o of obs) { sxy += o.v * o.rf; sxx += o.v * o.v; }
  const k = sxy / sxx;
  let rss = 0;
  for (const o of obs) rss += (o.rf - k * o.v) ** 2 + o.rb ** 2;
  return { k, rss };
}

const aic = (rss, n, p) => n * Math.log(rss / n) + 2 * p;

function bootstrap(obs, B = 500, seed = 1) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const Us = [], ks = [];
  for (let b = 0; b < B; b++) {
    const sample = obs.map(() => obs[Math.floor(rnd() * obs.length)]);
    const f = fitWindModel(sample);
    if (f) { Us.push(f.U); ks.push(f.k); }
  }
  const q = (a, p) => { const t = a.slice().sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(p * t.length))]; };
  return { U: [q(Us, 0.025), q(Us, 0.975)], k: [q(ks, 0.025), q(ks, 0.975)] };
}

function analyse(rows, opts = {}) {
  const obs = observations(rows);
  const n = 2 * obs.length; // two ratios per trial
  const wind = fitWindModel(obs), none = fitNoWindModel(obs);
  const dAIC = aic(none.rss, n, 1) - aic(wind.rss, n, 2);
  const ci = opts.bootstrap === false ? null : bootstrap(obs, opts.B || 500);
  const measured = obs.map(o => o.windAlong).filter(x => x != null);
  const meanWind = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null;
  return { obs, wind, none, dAIC, ci, meanWind };
}

function report(res) {
  const f = (x, d = 2) => (x == null ? 'n/a' : x.toFixed(d));
  const lines = [];
  lines.push(`Trials: ${res.obs.length}`);
  lines.push('');
  lines.push(' trial   v (m/s)   top (g)  front (g)  back (g)   front/top  back/top');
  for (const o of res.obs) {
    lines.push(` ${String(o.id).padEnd(6)} ${f(o.v).padStart(8)} ${f(o.top).padStart(9)} ${f(o.front).padStart(10)} ${f(o.back).padStart(9)} ${f(o.rf, 3).padStart(11)} ${f(o.rb, 3).padStart(9)}`);
  }
  lines.push('');
  lines.push(`Wind-aware fit:  Ux = ${f(res.wind.U)} m/s` + (res.ci ? ` (95% CI ${f(res.ci.U[0])} to ${f(res.ci.U[1])})` : '') +
    `,  k = η/vt = ${f(res.wind.k, 4)} s/m` + (res.ci ? ` (95% CI ${f(res.ci.k[0], 4)} to ${f(res.ci.k[1], 4)})` : ''));
  lines.push(`  implies η/vt; with vt ≈ 6 m/s for ~2 mm drops, η ≈ ${f(res.wind.k * 6)}`);
  if (res.meanWind != null) lines.push(`Anemometer mean wind along the course: ${f(res.meanWind)} m/s`);
  lines.push(`Wind-blind fit:  k = ${f(res.none.k, 4)} s/m`);
  lines.push(`ΔAIC (wind-blind − wind-aware) = ${f(res.dAIC, 1)}  ${res.dAIC > 10 ? '→ strong evidence for the wind-aware model (dip at v = Ux)' : res.dAIC > 4 ? '→ moderate evidence for the dip' : '→ not enough evidence yet; add trials near and either side of the wind speed'}`);
  return lines.join('\n');
}

module.exports = { parseCSV, observations, fitWindModel, fitNoWindModel, bootstrap, analyse, report };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: node experiment/analyze.js <trials.csv>'); process.exit(1); }
  const res = analyse(parseCSV(fs.readFileSync(file, 'utf8')));
  console.log(report(res));
}
