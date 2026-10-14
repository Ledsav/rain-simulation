// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/rain-model.js');
const A = require('../src/aero.js');
const B = require('../src/body.js');
const R = require('../src/refined.js');
const E = require('../experiment/analyze.js');
const C = require('../experiment/simulate-campaign.js');

test('drag law reproduces Gunn–Kinzer terminal speeds for small drops', () => {
  for (const [d, v] of [[0.1, 0.27], [0.2, 0.72], [0.3, 1.17], [0.5, 2.06]]) {
    assert.ok(Math.abs(A.sphereTerminalVelocity(d / 1000) - v) < 0.06, `D=${d}`);
  }
});

test('potential flow is tangential on the ellipse and uniform far away', () => {
  const f = A.makeEllipseFlow(0.125, 0.225, 2, 1);
  for (let t = 0; t < 2 * Math.PI; t += 0.3) {
    const x = 0.125 * Math.cos(t) * 1.000001, y = 0.225 * Math.sin(t) * 1.000001;
    const [u, v] = f(x, y);
    const nx = x / 0.125 ** 2, ny = y / 0.225 ** 2;
    assert.ok(Math.abs(u * nx + v * ny) / Math.hypot(nx, ny) < 1e-4);
  }
  const [u, v] = f(50, 30);
  assert.ok(Math.abs(u - 2) < 1e-3 && Math.abs(v - 1) < 1e-3);
});

test('collection efficiency rises with drop size and with airspeed', () => {
  const sh = { a: 0.125, b: 0.225 };
  const e = [0.2, 0.5, 2].map(d => A.collectionEfficiency(d, 2, 0, sh));
  assert.ok(e[0] < e[1] && e[1] < e[2] && e[2] <= 1);
  assert.ok(A.collectionEfficiency(0.5, 1, 0, sh) < A.collectionEfficiency(0.5, 4, 0, sh));
  assert.ok(A.collectionEfficiency(0.2, 1, 0, { a: 0.065, b: 0.065 }) > A.collectionEfficiency(0.2, 1, 0, sh), 'thin legs catch more');
});

test('the precomputed table matches direct integration', () => {
  for (const [d, V] of [[0.35, 1.2], [1.2, 2.5], [2.5, 4.5]]) {
    const direct = (1 - R.LEG_SHARE) * A.collectionEfficiency(d, V, 0, { a: 0.125, b: 0.225 }) + R.LEG_SHARE * A.collectionEfficiency(d, V, 0, { a: 0.065, b: 0.065 });
    assert.ok(Math.abs(R.eta(d, V, 0) - direct) < 0.01, `D=${d} V=${V}`);
  }
});

test('a box mesh reproduces the closed-form box model', () => {
  for (const p of [{ speed: 1.4 }, { speed: 3.3, windSpeed: 3, windDirDeg: 180 }, { speed: 2, windSpeed: 4, windDirDeg: 120 }]) {
    const K = M.exposure(p).total, S = B.exposure(p, { mesh: B.boxMesh() }).total;
    assert.ok(Math.abs(S / K - 1) < 0.005, JSON.stringify(p));
  }
});

test('silhouette of a sphere is πr² from any direction', () => {
  const t = []; B.ellipsoid(t, [0, 0, 1], [0.3, 0.3, 0.3], 's', 60);
  for (const d of [[1, 0, 0], [0.3, -0.5, -1], [0, 0, -1]]) {
    assert.ok(Math.abs(B.silhouette({ tris: t }, d).area / (Math.PI * 0.09) - 1) < 0.01);
  }
});

test('human mesh has realistic stature and frontal area', () => {
  const m = B.humanMesh({ pose: 'stand' });
  let top = -Infinity; for (const tr of m.tris) for (const p of [tr.a, tr.b, tr.c]) top = Math.max(top, p[2]);
  assert.ok(Math.abs(top - 1.75) < 0.02);
  const front = B.silhouette(m, [1, 0, 0]).area;
  assert.ok(front > 0.45 && front < 0.6, `frontal ${front}`); // published values ≈ 0.5 m² for an adult man
});

test('refined model collects less than the box and keeps the headwind ordering', () => {
  const still = R.exposure({ speed: 1.4 }).total, box = M.exposure({ speed: 1.4 }).total;
  assert.ok(still < box);
  assert.ok(R.exposure({ speed: 1.4, windSpeed: 3, windDirDeg: 180 }).total > still);
});

test('experiment analysis recovers the wind speed from a synthetic campaign', () => {
  const res = E.analyse(C.campaign(2, 11), { B: 100 });
  assert.ok(Math.abs(res.wind.U - C.SETUP.windAlong) < 0.4, `U=${res.wind.U}`);
  assert.ok(res.dAIC > 10);
  assert.ok(res.ci.U[0] < C.SETUP.windAlong && res.ci.U[1] > C.SETUP.windAlong);
});
