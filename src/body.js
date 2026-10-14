// Realistic body shapes for the rain-exposure model.
//
// For any body — convex or not — the water collected per unit time is C·|u|·A⊥(û), where A⊥
// is the silhouette area seen looking along the relative rain velocity u (each drop is caught
// by the first surface it meets). We compute A⊥ by z-buffer rasterisation of a triangle mesh
// projected onto the plane perpendicular to û, which also tells us which body part and which
// facing (top/front/back/side) each intercepted drop lands on.
//
// Meshes come from a parametric anthropometric model (standing or running pose, with trunk
// lean) or from an OBJ file, e.g. a 3D body scan.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./rain-model.js'));
  else root.RainBody = factory(root.RainModel);
})(typeof self !== 'undefined' ? self : this, function (RainModel) {
  'use strict';

  // ------------------------------------------------------------------ vector helpers
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const deg = Math.PI / 180;
  const dirFromAngle = (fwdDeg) => [Math.sin(fwdDeg * deg), 0, -Math.cos(fwdDeg * deg)]; // downward, tilted forward

  // ------------------------------------------------------------------ mesh building
  // A mesh is { tris: [{a, b, c, region}] } with vertices as [x, y, z] arrays (x forward, z up).

  function pushQuad(tris, p0, p1, p2, p3, region) {
    tris.push({ a: p0, b: p1, c: p2, region }, { a: p0, b: p2, c: p3, region });
  }

  // Tapered elliptic tube between centres p0 and p1 with closed ends. rx is the semi-axis in the
  // plane containing the forward (x) direction, ry the lateral one.
  function frustum(tris, p0, p1, r0, r1, region, segs = 20) {
    const w = norm(sub(p1, p0));
    let u = sub([1, 0, 0], scl(w, w[0]));
    if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = sub([0, 0, 1], scl(w, w[2]));
    u = norm(u);
    const v = cross(w, u);
    const ring = (p, r) => Array.from({ length: segs }, (_, i) => {
      const t = 2 * Math.PI * i / segs;
      return add(p, add(scl(u, r[0] * Math.cos(t)), scl(v, r[1] * Math.sin(t))));
    });
    const A = ring(p0, r0), B = ring(p1, r1);
    for (let i = 0; i < segs; i++) {
      const j = (i + 1) % segs;
      pushQuad(tris, A[i], A[j], B[j], B[i], region);
      tris.push({ a: p0, b: A[j], c: A[i], region }, { a: p1, b: B[i], c: B[j], region });
    }
  }

  function ellipsoid(tris, c, r, region, segs = 20) {
    const pt = (i, j) => {
      const th = Math.PI * i / segs, ph = 2 * Math.PI * j / segs;
      return [c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.sin(th) * Math.sin(ph), c[2] + r[2] * Math.cos(th)];
    };
    for (let i = 0; i < segs; i++) for (let j = 0; j < segs; j++) {
      pushQuad(tris, pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1), region);
    }
  }

  function box(tris, lo, hi, region) {
    const P = (x, y, z) => [x ? hi[0] : lo[0], y ? hi[1] : lo[1], z ? hi[2] : lo[2]];
    pushQuad(tris, P(0, 0, 1), P(1, 0, 1), P(1, 1, 1), P(0, 1, 1), region); // top
    pushQuad(tris, P(0, 0, 0), P(0, 1, 0), P(1, 1, 0), P(1, 0, 0), region); // bottom
    pushQuad(tris, P(1, 0, 0), P(1, 1, 0), P(1, 1, 1), P(1, 0, 1), region); // front (+x)
    pushQuad(tris, P(0, 0, 0), P(0, 0, 1), P(0, 1, 1), P(0, 1, 0), region); // back
    pushQuad(tris, P(0, 1, 0), P(0, 1, 1), P(1, 1, 1), P(1, 1, 0), region); // left (+y)
    pushQuad(tris, P(0, 0, 0), P(1, 0, 0), P(1, 0, 1), P(0, 0, 1), region); // right
  }

  function boxMesh(h = 1.75, b = 0.45, d = 0.25) {
    const tris = [];
    box(tris, [-d / 2, -b / 2, 0], [d / 2, b / 2, h], 'box');
    return { tris };
  }

  // Parametric adult (≈ 50th-percentile male, stature 1.75 m; segment sizes are rounded
  // anthropometric values). pose: 'stand' | 'run'. leanDeg tilts the trunk forward about the hips.
  function humanMesh(opts) {
    const o = Object.assign({ pose: 'stand', leanDeg: 0, scale: 1 }, opts);
    const run = o.pose === 'run';
    const tris = [];
    const hip = [0, 0, 0.92];
    const axis = [Math.sin(o.leanDeg * deg), 0, Math.cos(o.leanDeg * deg)];
    const along = (s, y = 0) => add(add(hip, scl(axis, s)), [0, y, 0]);
    const T = (p) => p; // trunk points already include lean

    // legs: thigh 0.42 m, shank 0.43 m; running stride ±22° thighs, trailing shank flexed
    for (const side of [1, -1]) {
      const y = 0.095 * side;
      const lead = side === 1;
      const thighA = run ? (lead ? 22 : -22) : 0;
      const shankA = run ? (lead ? 5 : -55) : 0;
      const hipJ = [0, y, hip[2]];
      const knee = add(hipJ, scl(dirFromAngle(thighA), 0.42));
      const ankle = add(knee, scl(dirFromAngle(shankA), 0.43));
      frustum(tris, hipJ, knee, [0.085, 0.08], [0.055, 0.05], 'legs');
      frustum(tris, knee, ankle, [0.05, 0.048], [0.035, 0.033], 'legs');
      const footDir = run && !lead ? norm([Math.cos(-35 * deg), 0, Math.sin(-35 * deg)]) : [1, 0, 0];
      frustum(tris, add(ankle, [-0.05 * footDir[0], 0, -0.03]), add(ankle, add(scl(footDir, 0.2), [0, 0, -0.03])), [0.035, 0.045], [0.025, 0.045], 'legs');
    }

    // trunk: pelvis, abdomen, chest, shoulders, neck, head (semi-axes [forward, lateral])
    frustum(tris, T(along(-0.06)), T(along(0.10)), [0.115, 0.175], [0.11, 0.155], 'trunk');
    frustum(tris, T(along(0.10)), T(along(0.36)), [0.11, 0.155], [0.125, 0.17], 'trunk');
    frustum(tris, T(along(0.36)), T(along(0.52)), [0.125, 0.17], [0.09, 0.16], 'trunk');
    frustum(tris, T(along(0.52)), T(along(0.63)), [0.055, 0.055], [0.05, 0.05], 'head');
    const headC = add(along(0.72), scl(axis, 0));
    ellipsoid(tris, headC, [0.10, 0.08, 0.115], 'head');

    // arms: shoulders at trunk height 0.50; standing arms hang, running elbows at 90°
    for (const side of [1, -1]) {
      const sh = along(0.49, 0.19 * side);
      ellipsoid(tris, sh, [0.06, 0.055, 0.06], 'arms', 12);
      const swing = run ? (side === 1 ? -25 : 25) : 0;      // opposite to the legs
      const elbow = add(sh, scl(dirFromAngle(swing), 0.31));
      const foreA = run ? swing + 90 : 0;                    // forearm forward-ish
      const wrist = add(elbow, scl(dirFromAngle(foreA), 0.26));
      const sideOut = [0, 0.015 * side, 0];
      frustum(tris, sh, add(elbow, sideOut), [0.05, 0.045], [0.04, 0.038], 'arms');
      frustum(tris, add(elbow, sideOut), add(wrist, sideOut), [0.04, 0.038], [0.028, 0.03], 'arms');
      const hand = add(add(wrist, scl(dirFromAngle(foreA), run ? 0.04 : 0.07)), sideOut);
      ellipsoid(tris, hand, run ? [0.05, 0.03, 0.04] : [0.045, 0.022, 0.085], 'arms', 10);
    }

    if (o.scale !== 1) for (const t of tris) { t.a = scl(t.a, o.scale); t.b = scl(t.b, o.scale); t.c = scl(t.c, o.scale); }
    return { tris };
  }

  // Minimal OBJ reader (v / f lines; polygons are fan-triangulated). up: 'z' | 'y'; forward: the
  // OBJ axis the body faces ('x' | '-x' | 'z' | '-z' | 'y' | '-y'); scale converts to metres.
  function parseOBJ(text, opts) {
    const o = Object.assign({ up: 'z', forward: 'x', scale: 1, region: 'body' }, opts);
    const verts = [], tris = [];
    const axisVec = (s) => {
      const neg = s[0] === '-', k = neg ? s[1] : s[0];
      const v = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[k];
      return neg ? scl(v, -1) : v;
    };
    const up = axisVec(o.up), fwd = axisVec(o.forward), lat = cross(up, fwd);
    for (const line of text.split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts[0] === 'v') {
        const p = [+parts[1], +parts[2], +parts[3]];
        verts.push(scl([dot(p, fwd), dot(p, lat), dot(p, up)], o.scale));
      } else if (parts[0] === 'f') {
        const idx = parts.slice(1).map(s => {
          const i = parseInt(s.split('/')[0], 10);
          return i < 0 ? verts.length + i : i - 1;
        });
        for (let k = 1; k + 1 < idx.length; k++) tris.push({ a: verts[idx[0]], b: verts[idx[k]], c: verts[idx[k + 1]], region: o.region });
      }
    }
    // stand it on the ground, centred over the origin
    let minZ = Infinity, sx = 0, sy = 0;
    for (const v of verts) { minZ = Math.min(minZ, v[2]); sx += v[0]; sy += v[1]; }
    const shift = [-sx / verts.length, -sy / verts.length, -minZ];
    for (const v of verts) { v[0] += shift[0]; v[1] += shift[1]; v[2] += shift[2]; }
    return { tris };
  }

  // ------------------------------------------------------------------ silhouette rasterisation

  function facingClass(n) {
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    if (az >= ax && az >= ay) return n[2] > 0 ? 'top' : 'bottom';
    if (ax >= ay) return n[0] > 0 ? 'front' : 'back';
    return 'side';
  }

  // Silhouette of `mesh` seen along direction `dir` (the way the drops travel). Returns the
  // area in m² plus breakdowns by body region and by surface facing.
  function silhouette(mesh, dir, opts) {
    const o = Object.assign({ res: 0.005 }, opts);
    const w = norm(dir);
    let e1 = cross(w, [0, 0, 1]);
    if (Math.hypot(e1[0], e1[1], e1[2]) < 1e-9) e1 = [0, 1, 0];
    e1 = norm(e1);
    const e2 = cross(w, e1);

    const proj = mesh.tris.map(t => {
      const P = [t.a, t.b, t.c].map(p => [dot(p, e1), dot(p, e2), dot(p, w)]);
      let n = norm(cross(sub(t.b, t.a), sub(t.c, t.a)));
      if (dot(n, w) > 0) n = scl(n, -1); // the surface the drop meets faces against it
      return { P, region: t.region, facing: facingClass(n) };
    });
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const t of proj) for (const p of t.P) {
      u0 = Math.min(u0, p[0]); u1 = Math.max(u1, p[0]); v0 = Math.min(v0, p[1]); v1 = Math.max(v1, p[1]);
    }
    const res = o.res;
    const nu = Math.ceil((u1 - u0) / res) + 1, nv = Math.ceil((v1 - v0) / res) + 1;
    const depth = new Float64Array(nu * nv).fill(Infinity);
    const owner = new Int32Array(nu * nv).fill(-1);

    proj.forEach((t, ti) => {
      const [A, B, C] = t.P;
      const area = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
      if (Math.abs(area) < 1e-14) return;
      const iu0 = Math.max(0, Math.floor((Math.min(A[0], B[0], C[0]) - u0) / res));
      const iu1 = Math.min(nu - 1, Math.ceil((Math.max(A[0], B[0], C[0]) - u0) / res));
      const iv0 = Math.max(0, Math.floor((Math.min(A[1], B[1], C[1]) - v0) / res));
      const iv1 = Math.min(nv - 1, Math.ceil((Math.max(A[1], B[1], C[1]) - v0) / res));
      for (let j = iv0; j <= iv1; j++) {
        const y = v0 + (j + 0.5) * res;
        for (let i = iu0; i <= iu1; i++) {
          const x = u0 + (i + 0.5) * res;
          const l1 = ((B[0] - x) * (C[1] - y) - (B[1] - y) * (C[0] - x)) / area;
          const l2 = ((C[0] - x) * (A[1] - y) - (C[1] - y) * (A[0] - x)) / area;
          const l3 = 1 - l1 - l2;
          if (l1 < 0 || l2 < 0 || l3 < 0) continue;
          const d = l1 * A[2] + l2 * B[2] + l3 * C[2];
          const k = j * nu + i;
          if (d < depth[k]) { depth[k] = d; owner[k] = ti; }
        }
      }
    });

    const px = res * res;
    const out = { area: 0, byRegion: {}, byFacing: {} };
    if (o.grid) out.grid = { nu, nv, res, cells: Array.from(owner, k => (k < 0 ? null : proj[k])) };
    for (let k = 0; k < owner.length; k++) {
      if (owner[k] < 0) continue;
      const t = proj[owner[k]];
      out.area += px;
      out.byRegion[t.region] = (out.byRegion[t.region] || 0) + px;
      out.byFacing[t.facing] = (out.byFacing[t.facing] || 0) + px;
    }
    return out;
  }

  // ------------------------------------------------------------------ exposure

  // Speed-dependent posture: walking upright; running with a trunk lean that grows with speed
  // (≈ 4° at 3 m/s to ≈ 10° at 7 m/s — a modelling assumption, see the paper).
  function postureForSpeed(v) {
    if (v < 2.2) return { pose: 'stand', leanDeg: 0 };
    return { pose: 'run', leanDeg: Math.min(12, 4 + 1.5 * (v - 3)) };
  }

  const meshCache = new Map();
  function meshForPosture(post) {
    const key = post.pose + '|' + post.leanDeg.toFixed(2);
    if (!meshCache.has(key)) meshCache.set(key, humanMesh(post));
    return meshCache.get(key);
  }

  // Water collected (litres) by a mesh over the trip: K = C·ΔL/v·|u|·A⊥(û).
  function exposure(params, opts) {
    const o = Object.assign({ mesh: null, posture: null, res: 0.005 }, opts);
    const p = Object.assign({}, RainModel.DEFAULTS, params);
    const rain = RainModel.rainState(p);
    const u = RainModel.relativeVelocity(p, rain);
    const speed = Math.hypot(u.x, u.y, u.z);
    const posture = o.posture || postureForSpeed(p.speed);
    const mesh = o.mesh || meshForPosture(posture);
    const sil = silhouette(mesh, [u.x, u.y, u.z], { res: o.res });
    const factor = rain.C * (p.distance / p.speed) * speed * 1000; // litres per m² of silhouette
    const out = { total: sil.area * factor, area: sil.area, posture, byRegion: {}, byFacing: {} };
    for (const k in sil.byRegion) out.byRegion[k] = sil.byRegion[k] * factor;
    for (const k in sil.byFacing) out.byFacing[k] = sil.byFacing[k] * factor;
    return out;
  }

  return { boxMesh, humanMesh, parseOBJ, silhouette, exposure, postureForSpeed, frustum, ellipsoid, box };
});
