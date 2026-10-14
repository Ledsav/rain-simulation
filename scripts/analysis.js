// Produces every number used in the refinement sections of docs/Rain_model.tex.
// Usage: node scripts/analysis.js            (prints tables; takes ~1 minute)
const M = require('../src/rain-model.js');
const A = require('../src/aero.js');
const B = require('../src/body.js');

const TORSO = { a: 0.125, b: 0.225 };
const LEG = { a: 0.065, b: 0.065 };
const SCEN = [
  ['Still air', 0, 0], ['Headwind 3 m/s', 3, 180], ['Tailwind 2 m/s', 2, 0],
  ['Tailwind 5 m/s', 5, 0], ['Crosswind 3 m/s', 3, 90],
];
const f = (x, d = 1) => x.toFixed(d);
const mL = (litres) => litres * 1000;

// Refined model (src/refined.js): human silhouette with speed-dependent posture, horizontal part
// scaled by the Marshall–Palmer-weighted collection efficiency from the precomputed table.
const REF = require('../src/refined.js');
const refined = (p, opts = {}) => REF.exposure(p, Object.assign({ dsd: true }, opts));
const bodyEta = (R, Vx, Vy) => REF.etaMarshallPalmer(R, Vx, Vy);
const legShare = REF.LEG_SHARE;

console.log('== A. Collection efficiency η (monodisperse), torso ellipse 0.25×0.45 m | leg Ø0.13 m');
const Ds = [0.1, 0.2, 0.3, 0.5, 1, 2, 3];
console.log('V (m/s) | ' + Ds.map(d => `D=${d}`).join(' '));
for (const V of [0.5, 1, 2, 3, 5, 8]) {
  console.log(`torso ${V} | ` + Ds.map(d => f(A.collectionEfficiency(d, V, 0, TORSO), 2)).join(' '));
}
for (const V of [1, 3, 5]) {
  console.log(`leg   ${V} | ` + Ds.map(d => f(A.collectionEfficiency(d, V, 0, LEG), 2)).join(' '));
}

console.log('\n== B. Marshall–Palmer-weighted body efficiency (legs share of frontal area = ' + f(legShare, 2) + ')');
for (const R of [1, 5, 20]) {
  console.log(`R=${R} mm/h | ` + [0.5, 1, 2, 3, 5].map(V => `V=${V}: ${f(bodyEta(R, V, 0), 3)}`).join('  '));
}
console.log('drizzle (monodisperse 0.2 mm) | ' + [0.5, 1, 2, 3, 5].map(V => `V=${V}: ${f(A.collectionEfficiency(0.2, V, 0, TORSO), 3)}`).join('  '));

console.log('\n== C. Body shape: box vs human (mL, 200 m, 5 mm/h, 2 mm drops)');
console.log('scenario | v | box | human | human/box | human by region (head/trunk/arms/legs)');
for (const [name, U, phi] of SCEN) for (const v of [1.4, 3.3]) {
  const p = { speed: v, windSpeed: U, windDirDeg: phi };
  const box = M.exposure(p).total, hu = B.exposure(p);
  const r = hu.byRegion;
  console.log(`${name} | ${v} | ${f(mL(box))} | ${f(mL(hu.total))} | ${f(hu.total / box, 2)} | ${['head', 'trunk', 'arms', 'legs'].map(k => f(mL(r[k] || 0))).join('/')}`);
}
const st = B.humanMesh({ pose: 'stand' });
console.log('standing areas: frontal ' + f(B.silhouette(st, [1, 0, 0]).area, 3) + ' top ' + f(B.silhouette(st, [0, 0, -1]).area, 3) + ' side ' + f(B.silhouette(st, [0, 1, 0]).area, 3));

console.log('\n== D. Lean sensitivity, running pose at 3.3 m/s (mL)');
for (const [name, U, phi] of [SCEN[0], SCEN[1], SCEN[3]]) {
  console.log(name + ' | ' + [0, 5, 10, 15].map(l => `${l}°: ${f(mL(B.exposure({ speed: 3.3, windSpeed: U, windDirDeg: phi }, { posture: { pose: 'run', leanDeg: l } }).total))}`).join('  '));
}
console.log('stand vs run pose at 3.3 m/s still air: ' +
  f(mL(B.exposure({ speed: 3.3 }, { posture: { pose: 'stand', leanDeg: 0 } }).total)) + ' vs ' +
  f(mL(B.exposure({ speed: 3.3 }, { posture: { pose: 'run', leanDeg: 4.5 } }).total)));

console.log('\n== E. Combined refined model (human + airflow, MP drops at 5 mm/h) vs box (mL)');
console.log('scenario | box walk/run | refined walk/run | box optimum | refined optimum (scan 0.6–8 m/s)');
for (const [name, U, phi] of SCEN) {
  const bw = M.exposure({ speed: 1.4, windSpeed: U, windDirDeg: phi }).total, br = M.exposure({ speed: 3.3, windSpeed: U, windDirDeg: phi }).total;
  const rw = refined({ speed: 1.4, windSpeed: U, windDirDeg: phi }), rr = refined({ speed: 3.3, windSpeed: U, windDirDeg: phi });
  const bo = M.optimalSpeed({ windSpeed: U, windDirDeg: phi }, 8);
  let best = Infinity, bv = 0;
  for (let v = 0.6; v <= 8.001; v += 0.1) {
    const k = refined({ speed: v, windSpeed: U, windDirDeg: phi }).total;
    if (k < best) { best = k; bv = v; }
  }
  console.log(`${name} | ${f(mL(bw))}/${f(mL(br))} | ${f(mL(rw.total))}/${f(mL(rr.total))} (η ${f(rw.eta, 2)}/${f(rr.eta, 2)}) | ${f(bo.speed)} → ${f(mL(M.exposure({ speed: bo.speed, windSpeed: U, windDirDeg: phi }).total))} | ${f(bv)} → ${f(mL(best))}`);
}

console.log('\n== F. Curves for the figure: (v, box, human, refined) in mL');
for (const [name, U, phi] of [SCEN[0], SCEN[3]]) {
  const rows = [];
  for (let v = 0.6; v <= 8.001; v += 0.2) {
    const p = { speed: v, windSpeed: U, windDirDeg: phi };
    const r = refined(p);
    rows.push(`${f(v)} ${f(mL(M.exposure(p).total), 2)} ${f(mL(r.human), 2)} ${f(mL(r.total), 2)}`);
  }
  console.log('# ' + name + '\n' + rows.join('\n'));
}
