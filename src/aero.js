// Aerodynamic deflection of raindrops around the body.
//
// The air moving past the walker (relative velocity V = (Ux − v, Uy) in the body frame) is
// modelled as 2D potential flow around an elliptic cylinder — a horizontal cross-section of
// the torso (or a circular one for a leg). Drops start far upstream moving with the air and
// falling at terminal speed, and are integrated with a Reynolds-number-dependent drag law.
// The collection efficiency η is the fraction of drops on the upstream capture tube that
// actually touch the body; η → 1 for large drops (ballistic), η → 0 for fine drizzle that
// follows the streamlines around the body.
//
// Potential flow is accurate upstream of a bluff body (where capture is decided) but has no
// boundary layer or wake; see docs/Rain_model.tex for the discussion.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rain-model.js'));
  else root.RainAero = factory(root.RainModel);
})(typeof self !== 'undefined' ? self : this, function (RainModel) {
  'use strict';

  const RHO_AIR = 1.2;       // kg/m³
  const MU_AIR = 1.81e-5;    // Pa·s
  const RHO_W = 1000;        // kg/m³
  const G = 9.81;

  // ------------------------------------------------------------- drag & terminal speed

  // Drag acceleration magnitude per unit relative speed, i.e. |a| = dragRate(|w|)·|w|.
  // Clift–Gauvin correlation for a sphere, scaled by k to account for drop deformation.
  function dragRate(w, D, k) {
    const Re = RHO_AIR * w * D / MU_AIR;
    const visc = (24 * MU_AIR / (RHO_AIR * D)) * (1 + 0.15 * Math.pow(Re, 0.687));
    const form = Re > 0 ? 0.42 * w / (1 + 42500 * Math.pow(Re, -1.16)) : 0;
    return k * 0.75 * (RHO_AIR / RHO_W) * (visc + form) / D;
  }

  function sphereTerminalVelocity(D) {
    let lo = 0, hi = 15;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (dragRate(mid, D, 1) * mid > G) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  }

  // Drops up to 0.5 mm are spheres (the drag law reproduces Gunn–Kinzer to a few %); larger
  // drops flatten, so their drag is scaled to match the Atlas et al. fit used by the box model.
  function dropDynamics(dMm) {
    const D = dMm / 1000;
    if (dMm <= 0.5) {
      const vt = sphereTerminalVelocity(D);
      return { D, vt, k: 1 };
    }
    const vt = RainModel.terminalVelocity(dMm);
    const k = G / (dragRate(vt, D, 1) * vt);
    return { D, vt, k };
  }

  // ------------------------------------------------------------- potential flow

  // Complex helpers on [re, im] pairs.
  const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
  const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
  function csqrt(a) {
    const r = Math.hypot(a[0], a[1]);
    const re = Math.sqrt(Math.max(0, (r + a[0]) / 2));
    let im = Math.sqrt(Math.max(0, (r - a[0]) / 2));
    if (a[1] < 0) im = -im;
    return [re, im];
  }

  // Ellipse x²/a² + y²/b² = 1 is the image of the circle |ζ| = R under z = ζ − k²/ζ, with
  // R = (a+b)/2 and k² = R(b−a)/2 (k² may be negative). Uniform stream U = Ux + iUy past the
  // circle has complex potential W = Ū ζ + U R²/ζ; the velocity is conj(dW/dz).
  function makeEllipseFlow(a, b, Ux, Uy) {
    const R = (a + b) / 2, k2 = R * (b - a) / 2;
    const U = [Ux, Uy], Ubar = [Ux, -Uy];
    return function velocity(x, y) {
      const z = [x, y];
      const disc = csqrt([x * x - y * y + 4 * k2, 2 * x * y]);
      let zeta = [(z[0] + disc[0]) / 2, (z[1] + disc[1]) / 2];
      const alt = [(z[0] - disc[0]) / 2, (z[1] - disc[1]) / 2];
      if (Math.hypot(alt[0], alt[1]) > Math.hypot(zeta[0], zeta[1])) zeta = alt;
      const z2 = cmul(zeta, zeta);
      const num = [Ubar[0] - cdiv(cmul(U, [R * R, 0]), z2)[0], Ubar[1] - cdiv(cmul(U, [R * R, 0]), z2)[1]];
      const den = [1 + cdiv([k2, 0], z2)[0], cdiv([k2, 0], z2)[1]];
      const dW = cdiv(num, den);
      return [dW[0], -dW[1]];
    };
  }

  // ------------------------------------------------------------- trajectories

  // Integrates one drop released at lateral offset s (perpendicular to the stream) and
  // reports whether it touches the ellipse.
  function dropHits(s, shape, V, drop) {
    const { a, b } = shape;
    const speed = Math.hypot(V[0], V[1]);
    const ex = V[0] / speed, ey = V[1] / speed;        // stream direction
    const px = -ey, py = ex;                             // perpendicular
    const L = 12 * Math.max(a, b);
    const flow = makeEllipseFlow(a, b, V[0], V[1]);

    let x = -L * ex + s * px, y = -L * ey + s * py;
    let vx = V[0], vy = V[1];                           // moving with the undisturbed air
    let vz = -drop.vt;
    const tau = drop.vt / G;                             // drop response time
    const dt = Math.min(0.02 * Math.min(a, b) / speed, tau / 3);
    const maxSteps = Math.ceil(6 * L / speed / dt);

    const acc = (x, y, vx, vy, vz) => {
      const [ax, ay] = flow(x, y);
      const wx = vx - ax, wy = vy - ay, wz = vz;
      const w = Math.hypot(wx, wy, wz);
      const r = dragRate(w, drop.D, drop.k);
      return [-r * wx, -r * wy, -r * wz - G];
    };

    for (let i = 0; i < maxSteps; i++) {
      if ((x * x) / (a * a) + (y * y) / (b * b) <= 1) return true;
      if (x * ex + y * ey > 1.5 * Math.max(a, b)) return false;  // passed the body
      // RK4 on (x, y, vx, vy, vz)
      const k1 = acc(x, y, vx, vy, vz);
      const x2 = x + 0.5 * dt * vx, y2 = y + 0.5 * dt * vy;
      const vx2 = vx + 0.5 * dt * k1[0], vy2 = vy + 0.5 * dt * k1[1], vz2 = vz + 0.5 * dt * k1[2];
      const k2 = acc(x2, y2, vx2, vy2, vz2);
      const x3 = x + 0.5 * dt * vx2, y3 = y + 0.5 * dt * vy2;
      const vx3 = vx + 0.5 * dt * k2[0], vy3 = vy + 0.5 * dt * k2[1], vz3 = vz + 0.5 * dt * k2[2];
      const k3 = acc(x3, y3, vx3, vy3, vz3);
      const x4 = x + dt * vx3, y4 = y + dt * vy3;
      const vx4 = vx + dt * k3[0], vy4 = vy + dt * k3[1], vz4 = vz + dt * k3[2];
      const k4 = acc(x4, y4, vx4, vy4, vz4);
      x += dt / 6 * (vx + 2 * vx2 + 2 * vx3 + vx4);
      y += dt / 6 * (vy + 2 * vy2 + 2 * vy3 + vy4);
      vx += dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      vy += dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
      vz += dt / 6 * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    }
    return false; // stalled at the stagnation point: follows the flow, never touches
  }

  // Half-width of the ellipse silhouette seen along stream direction (ex, ey).
  function projectedHalfWidth(a, b, ex, ey) {
    return Math.sqrt(a * a * ey * ey + b * b * ex * ex);
  }

  const etaCache = new Map();

  // Collection efficiency of an elliptic cross-section with semi-axes a (along the walking
  // direction) and b (lateral) for drops of diameter dMm in a relative airstream (Vx, Vy).
  function collectionEfficiency(dMm, Vx, Vy, shape) {
    const speed = Math.hypot(Vx, Vy);
    if (speed < 0.05) return 1; // no airflow to deflect anything; horizontal flux is ~0 anyway
    const key = [dMm, Vx.toFixed(3), Vy.toFixed(3), shape.a, shape.b].join('|');
    if (etaCache.has(key)) return etaCache.get(key);

    const drop = dropDynamics(dMm);
    const V = [Vx, Vy];
    const h = projectedHalfWidth(shape.a, shape.b, Vx / speed, Vy / speed);
    // The capture tube is an interval of offsets; bisect each edge from the centre outwards.
    const centre = 0;
    let eta;
    if (!dropHits(centre, shape, V, drop)) {
      eta = 0;
    } else {
      const edge = (sign) => {
        let inside = 0, outside = sign * 1.2 * h;
        for (let i = 0; i < 22; i++) {
          const mid = (inside + outside) / 2;
          if (dropHits(mid, shape, V, drop)) inside = mid; else outside = mid;
        }
        return (inside + outside) / 2;
      };
      eta = Math.min(1, (edge(1) - edge(-1)) / (2 * h));
    }
    etaCache.set(key, eta);
    return eta;
  }

  // Marshall–Palmer drop-size distribution N(D) = N0·exp(−ΛD), Λ = 4.1·R^−0.21 mm⁻¹.
  // Horizontal water flux at diameter D ∝ N(D)·D³ (every drop moves with the air), so the
  // efficiency felt by the body is the D³-weighted mean of η(D).
  function dsdEfficiency(rainRateMmH, Vx, Vy, shape, opts) {
    const o = Object.assign({ dMin: 0.1, dMax: 6, bins: 24 }, opts);
    const lam = 4.1 * Math.pow(rainRateMmH, -0.21);
    let num = 0, den = 0;
    const step = (o.dMax - o.dMin) / o.bins;
    for (let i = 0; i < o.bins; i++) {
      const D = o.dMin + (i + 0.5) * step;
      const w = Math.exp(-lam * D) * D * D * D;
      num += w * collectionEfficiency(+D.toFixed(3), Vx, Vy, shape);
      den += w;
    }
    return num / den;
  }

  // Box-model exposure with the horizontal (front/back/side) terms reduced by η of the torso
  // cross-section. The top term is unchanged: the relative airflow is horizontal.
  function exposure(params) {
    const p = Object.assign({}, RainModel.DEFAULTS, params);
    const rain = RainModel.rainState(p);
    const base = RainModel.exposure(p);
    const shape = { a: p.thickness / 2, b: p.breadth / 2 };
    const eta = collectionEfficiency(p.dropDiamMm, rain.Ux - p.speed, rain.Uy, shape);
    const out = Object.assign({}, base, { eta });
    out.front = base.front * eta;
    out.back = base.back * eta;
    out.side = base.side * eta;
    out.total = out.top + out.front + out.back + out.side;
    return out;
  }

  return {
    RHO_AIR, MU_AIR, G,
    dragRate, sphereTerminalVelocity, dropDynamics,
    makeEllipseFlow, dropHits, collectionEfficiency, dsdEfficiency, exposure,
  };
});
