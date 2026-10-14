// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/rain-model.js');

const close = (a, b, rel = 1e-9) => assert.ok(Math.abs(a - b) <= rel * Math.max(1, Math.abs(b)), `${a} != ${b}`);

test('terminal velocity matches Gunn–Kinzer to ~0.3 m/s', () => {
  // Gunn & Kinzer (1949): 0.5 mm ≈ 2.06, 1 mm ≈ 4.03, 2 mm ≈ 6.49, 4 mm ≈ 8.83 m/s
  for (const [d, v] of [[0.5, 2.06], [1, 4.03], [2, 6.49], [4, 8.83]]) {
    assert.ok(Math.abs(M.terminalVelocity(d) - v) < 0.3, `D=${d}: ${M.terminalVelocity(d)}`);
  }
});

test('concentration is consistent with rain rate: R = C · vt', () => {
  const r = M.rainState({ rainRateMmH: 5, dropDiamMm: 2 });
  close(r.C * r.vt * 3.6e6, 5);
  // Liquid water content of moderate rain is a fraction of a gram per m³, not 500 g/m³.
  assert.ok(r.C * 1e6 > 0.1 && r.C * 1e6 < 0.5, `LWC ${r.C * 1e6} g/m³`);
});

test('vertical rain: K = C·ΔL·(A_top·vt/v + A_front)', () => {
  const p = { speed: 1.4, distance: 200, windSpeed: 0 };
  const r = M.rainState(p), A = M.bodyAreas(p), K = M.exposure(p);
  close(K.total, 1000 * r.C * 200 * (A.top * r.vt / 1.4 + A.front));
  assert.equal(K.back, 0);
  assert.equal(K.side, 0);
});

test('front sweep C·ΔL·A_front is independent of speed in still air', () => {
  close(M.exposure({ speed: 1, windSpeed: 0 }).front, M.exposure({ speed: 5, windSpeed: 0 }).front);
});

test('headwind wets the front more than still air (relative speed v + |Ux|)', () => {
  const still = M.exposure({ speed: 1.4, windSpeed: 0 });
  const head = M.exposure({ speed: 1.4, windSpeed: 2, windDirDeg: 180 });
  close(head.front / still.front, (1.4 + 2) / 1.4);
  assert.equal(head.back, 0);
});

test('moving with the tailwind keeps front and back dry', () => {
  const K = M.exposure({ speed: 3, windSpeed: 3, windDirDeg: 0 });
  assert.ok(K.front < 1e-12 && K.back < 1e-12);
});

test('only one of front/back is ever wet', () => {
  for (const v of [0.5, 1.4, 3.3, 6]) for (const phi of [0, 45, 135, 180]) {
    const K = M.exposure({ speed: v, windSpeed: 3, windDirDeg: phi });
    assert.ok(K.front === 0 || K.back === 0);
  }
});

test('crosswind wets one side and does not change front/back', () => {
  const still = M.exposure({ speed: 2, windSpeed: 0 });
  const cross = M.exposure({ speed: 2, windSpeed: 3, windDirDeg: 90 });
  assert.ok(cross.side > 0);
  close(cross.front, still.front, 1e-9);
});

test('optimal speed: run flat out in still air, headwind and weak tailwind', () => {
  assert.equal(M.optimalSpeed({ windSpeed: 0 }, 8).regime, 'max-speed');
  assert.equal(M.optimalSpeed({ windSpeed: 3, windDirDeg: 180 }, 8).regime, 'max-speed');
  const o = M.optimalSpeed({ windSpeed: 0.5, windDirDeg: 0 }, 8);
  assert.ok(o.Ucrit > 0.5);
  assert.equal(o.regime, 'max-speed');
});

test('optimal speed: match a strong tailwind, and it beats a brute-force scan', () => {
  const p = { windSpeed: 3, windDirDeg: 0 };
  const o = M.optimalSpeed(p, 8);
  assert.equal(o.regime, 'match-wind');
  close(o.speed, 3);
  let best = Infinity, bestV = 0;
  for (let v = 0.2; v <= 8; v += 0.01) {
    const k = M.exposure(Object.assign({}, p, { speed: v })).total;
    if (k < best) { best = k; bestV = v; }
  }
  assert.ok(Math.abs(bestV - 3) < 0.02, `scan optimum ${bestV}`);
});

test('segmentEntryFace picks the face a drop actually crosses', () => {
  const box = { x0: -1, x1: 1, y0: -1, y1: 1, z0: 0, z1: 2 };
  assert.equal(M.segmentEntryFace(0, 0, 3, 0, 0, -2, box).face, 'top');
  assert.equal(M.segmentEntryFace(2, 0, 1, -2, 0, 0, box).face, 'front');
  assert.equal(M.segmentEntryFace(-2, 0, 1, 2, 0, 0, box).face, 'back');
  assert.equal(M.segmentEntryFace(0, 2, 1, 0, -2, 0, box).face, 'side');
  assert.equal(M.segmentEntryFace(2, 0, 3, 0, 0, -2, box), null);
  // grazing the top-front corner diagonally: enters through the later slab (front)
  assert.equal(M.segmentEntryFace(1.5, 0, 2.2, -1, 0, -1, box).face, 'front');
});

// Monte Carlo must agree with the analytic flux within statistical error.
const scenarios = [
  { name: 'still air, walking', speed: 1.4, windSpeed: 0 },
  { name: 'headwind 3 m/s, running', speed: 3.3, windSpeed: 3, windDirDeg: 180 },
  { name: 'tailwind 5 m/s, walking', speed: 1.4, windSpeed: 5, windDirDeg: 0 },
  { name: 'tailwind 2 m/s, running', speed: 3.3, windSpeed: 2, windDirDeg: 0 },
  { name: 'quartering wind 4 m/s', speed: 2, windSpeed: 4, windDirDeg: 120 },
];
for (const s of scenarios) {
  test(`Monte Carlo agrees with model: ${s.name}`, () => {
    const p = Object.assign({ distance: 40, rainRateMmH: 10 }, s);
    const sim = M.simulate(p, { seed: 7, targetParcels: 6000 });
    const K = M.exposure(p);
    for (const f of [...M.FACES, 'total']) {
      const sigma = f === 'total' ? sim.totalSigma : sim[f + 'Sigma'];
      const tol = 4.5 * Math.max(sigma, sim.weight * M.rainState(p).dropVol * 1000);
      assert.ok(Math.abs(sim[f] - K[f]) <= tol, `${f}: sim ${sim[f]} vs model ${K[f]} (tol ${tol})`);
    }
  });
}
