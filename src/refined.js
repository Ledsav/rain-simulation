// Refined exposure: a human-shaped body (speed-dependent posture, see body.js) with the
// horizontally-driven part of the catch reduced by aerodynamic deflection (see aero.js).
//
//   K ≈ K_vertical + η · (K_human − K_vertical)
//
// K_human is the silhouette result C·ΔL/v·|u|·A⊥(û); K_vertical = C·ΔL/v·vt·A⊥(ẑ) is what the
// same body would catch with no relative horizontal motion. Only the excess over K_vertical is
// carried by the relative airflow, so only that part is scaled by η. This split is exact for a
// box and an approximation for other shapes. η comes from the precomputed table
// (src/aero-table.js), interpolated in log D, log V and airflow angle.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./rain-model.js'), require('./body.js'), require('./aero-table.js'));
  } else {
    root.RainRefined = factory(root.RainModel, root.RainBody, root.RainAeroTable);
  }
})(typeof self !== 'undefined' ? self : this, function (RainModel, RainBody, T) {
  'use strict';

  const LEG_SHARE = 0.35; // legs' share of the standing frontal silhouette (body.js mesh)

  function bracket(arr, x) {
    if (x <= arr[0]) return [0, 0, 0];
    if (x >= arr[arr.length - 1]) return [arr.length - 1, arr.length - 1, 0];
    let i = 0;
    while (arr[i + 1] < x) i++;
    return [i, i + 1, (x - arr[i]) / (arr[i + 1] - arr[i])];
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  function grid2(g, dMm, V) {
    const [d0, d1, td] = bracket(T.D.map(Math.log), Math.log(dMm));
    const [v0, v1, tv] = bracket(T.V.map(Math.log), Math.log(Math.max(V, 1e-6)));
    return lerp(lerp(g[d0][v0], g[d0][v1], tv), lerp(g[d1][v0], g[d1][v1], tv), td);
  }

  // Body-averaged collection efficiency for one drop size in airflow (Vx, Vy) relative to the body.
  function eta(dMm, Vx, Vy) {
    const V = Math.hypot(Vx, Vy);
    if (V < 0.05) return 1;
    const ang = Math.atan2(Math.abs(Vy), Math.abs(Vx)) * 180 / Math.PI;
    const [a0, a1, ta] = bracket(T.ANG, ang);
    const torso = lerp(grid2(T.torso[a0], dMm, V), grid2(T.torso[a1], dMm, V), ta);
    const leg = grid2(T.leg, dMm, V);
    return (1 - LEG_SHARE) * torso + LEG_SHARE * leg;
  }

  // Marshall–Palmer weighting: horizontal water flux at diameter D ∝ N(D)·D³.
  function etaMarshallPalmer(rainRateMmH, Vx, Vy) {
    const lam = 4.1 * Math.pow(rainRateMmH, -0.21);
    let num = 0, den = 0;
    for (let D = 0.1; D <= 6; D += 0.05) {
      const w = Math.exp(-lam * D) * D * D * D;
      num += w * eta(D, Vx, Vy); den += w;
    }
    return num / den;
  }

  const topCache = new Map();
  function topArea(posture, res) {
    const key = posture.pose + '|' + posture.leanDeg.toFixed(2) + '|' + res;
    if (!topCache.has(key)) topCache.set(key, RainBody.silhouette(RainBody.humanMesh(posture), [0, 0, -1], { res }).area);
    return topCache.get(key);
  }

  function exposure(params, opts) {
    const o = Object.assign({ dsd: false, aero: true, res: 0.006, posture: null }, opts);
    const p = Object.assign({}, RainModel.DEFAULTS, params);
    const rain = RainModel.rainState(p);
    const posture = o.posture || RainBody.postureForSpeed(p.speed);
    const human = RainBody.exposure(p, { posture, res: o.res });
    const vertical = topArea(posture, o.res) * rain.C * (p.distance / p.speed) * rain.vt * 1000;
    const Vx = rain.Ux - p.speed, Vy = rain.Uy;
    const e = !o.aero ? 1 : (o.dsd ? etaMarshallPalmer(p.rainRateMmH, Vx, Vy) : eta(p.dropDiamMm, Vx, Vy));
    const horizontal = Math.max(0, human.total - vertical);
    return { total: vertical + e * horizontal, human: human.total, vertical, eta: e, posture };
  }

  return { eta, etaMarshallPalmer, exposure, LEG_SHARE };
});
