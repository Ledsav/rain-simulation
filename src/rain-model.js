// Directional rain exposure: analytic model + 3D Monte Carlo engine.
// Shared by src/simulation.html (browser global `RainModel`) and tests (CommonJS).
//
// Frame: the person walks along +x, z is up, y is to the person's left.
// The body is an axis-aligned box: thickness d (x), breadth b (y), height h (z).
// Rain velocity V_R = (Ux, Uy, -vt): drops are carried horizontally by the wind
// and fall at their terminal velocity vt. Person velocity V_P = (v, 0, 0).
// Rain velocity relative to the person: u = V_R - V_P.
// Volume flux onto a face with outward normal n and area A:  C * A * max(0, -u.n).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RainModel = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MM_PER_H_TO_M_PER_S = 1 / 3.6e6;
  const FACES = ['top', 'front', 'back', 'side'];

  const DEFAULTS = {
    speed: 1.4,         // v, m/s
    distance: 200,      // ΔL, m
    rainRateMmH: 5,     // R, mm/h
    dropDiamMm: 2,      // D, mm
    windSpeed: 0,       // U, m/s
    windDirDeg: 0,      // φ: 0 = tailwind (blowing along +x), 180 = headwind, 90 = crosswind
    height: 1.75,       // h, m
    breadth: 0.45,      // b, m (shoulder width)
    thickness: 0.25,    // d, m (chest-to-back)
  };

  // Atlas, Srivastava & Sekhon (1973) fit to the Gunn–Kinzer (1949) measurements.
  // D in mm, result in m/s; reasonable for 0.3 mm ≲ D ≲ 6 mm.
  function terminalVelocity(dMm) {
    return Math.max(0.05, 9.65 - 10.3 * Math.exp(-0.6 * dMm));
  }

  function withDefaults(p) {
    return Object.assign({}, DEFAULTS, p);
  }

  function rainState(params) {
    const p = withDefaults(params);
    const vt = terminalVelocity(p.dropDiamMm);
    const R = p.rainRateMmH * MM_PER_H_TO_M_PER_S;   // m³ of water per m² of ground per s
    const C = R / vt;                                 // m³ of water per m³ of air
    const dropVol = (Math.PI / 6) * Math.pow(p.dropDiamMm / 1000, 3);
    const phi = p.windDirDeg * Math.PI / 180;
    const Ux = p.windSpeed * Math.cos(phi);
    const Uy = p.windSpeed * Math.sin(phi);
    return {
      vt, C, dropVol,
      n: C / dropVol,                                 // drops per m³
      Ux, Uy,
      thetaDeg: Math.atan2(p.windSpeed, vt) * 180 / Math.PI,
    };
  }

  function bodyAreas(params) {
    const p = withDefaults(params);
    return {
      top: p.breadth * p.thickness,
      front: p.breadth * p.height,
      back: p.breadth * p.height,
      side: p.thickness * p.height,
    };
  }

  function relativeVelocity(params, rain) {
    const p = withDefaults(params);
    const r = rain || rainState(p);
    return { x: r.Ux - p.speed, y: r.Uy, z: -r.vt };
  }

  // Volume rate (m³/s) arriving on each face.
  function faceRates(params) {
    const p = withDefaults(params);
    const rain = rainState(p);
    const A = bodyAreas(p);
    const u = relativeVelocity(p, rain);
    return {
      top: rain.C * A.top * Math.max(0, -u.z),
      front: rain.C * A.front * Math.max(0, -u.x),
      back: rain.C * A.back * Math.max(0, u.x),
      side: rain.C * A.side * Math.abs(u.y),
    };
  }

  // Total water (litres) collected over the trip, per face and in total.
  function exposure(params) {
    const p = withDefaults(params);
    const v = Math.max(1e-6, p.speed);
    const duration = p.distance / v;
    const rates = faceRates(p);
    const out = { duration, total: 0 };
    for (const f of FACES) {
      out[f] = rates[f] * duration * 1000;
      out.total += out[f];
    }
    return out;
  }

  // Speed in (0, vMax] that minimises total exposure. With a = A_top·vt + A_side·|Uy|:
  //   K(v) = C·ΔL·[ a/v + A_f·|1 − Ux/v| ]
  // which falls for v < Ux and, for v > Ux, falls iff a > A_f·Ux. Hence the optimum is
  // v* = Ux when Ux exceeds U_crit = a/A_f (and is reachable), otherwise v* = vMax.
  function optimalSpeed(params, vMax) {
    const p = withDefaults(params);
    const rain = rainState(p);
    const A = bodyAreas(p);
    const a = A.top * rain.vt + A.side * Math.abs(rain.Uy);
    const Ucrit = a / A.front;
    if (rain.Ux > Ucrit && rain.Ux <= vMax) {
      return { speed: rain.Ux, regime: 'match-wind', Ucrit };
    }
    return { speed: vMax, regime: 'max-speed', Ucrit };
  }

  // ---------------------------------------------------------------- Monte Carlo

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Which face of the box does the segment p -> p + d enter first? Returns null on a miss.
  // Slab method; the segment is parameterised by s ∈ [0, 1].
  function segmentEntryFace(px, py, pz, dx, dy, dz, box) {
    let sNear = 0, sFar = 1, face = null;
    const axes = [
      [px, dx, box.x0, box.x1, 'back', 'front'],
      [py, dy, box.y0, box.y1, 'side', 'side'],
      [pz, dz, box.z0, box.z1, 'bottom', 'top'],
    ];
    for (const [p0, d, lo, hi, loFace, hiFace] of axes) {
      if (Math.abs(d) < 1e-15) {
        if (p0 < lo || p0 > hi) return null;
        continue;
      }
      let s1 = (lo - p0) / d, s2 = (hi - p0) / d, enter = loFace;
      if (s1 > s2) { const t = s1; s1 = s2; s2 = t; enter = hiFace; }
      if (s1 > sNear) { sNear = s1; face = enter; }
      if (s2 < sFar) sFar = s2;
      if (sNear > sFar) return null;
    }
    if (face === null) return null; // started inside the box
    return { face, s: sNear };
  }

  // Simulates drops in the person's rest frame inside a box-shaped window around the body.
  // The upstream rain field is kept exactly uniform by injecting drops through every inflow
  // boundary at the rate n·|u·n|·area, so counted hits are an unbiased estimate of the flux.
  class Simulation {
    constructor(params, opts) {
      const o = Object.assign({ targetParcels: 3000, seed: 1, marginX: 2.6, marginY: 0.5, marginZ: 0.8 }, opts);
      this.p = withDefaults(params);
      this.rand = mulberry32(o.seed);
      this.rain = rainState(this.p);
      this.areas = bodyAreas(this.p);
      this.u = relativeVelocity(this.p, this.rain);

      const p = this.p;
      this.body = {
        x0: -p.thickness / 2, x1: p.thickness / 2,
        y0: -p.breadth / 2, y1: p.breadth / 2,
        z0: 0, z1: p.height,
      };
      this.dom = {
        x0: this.body.x0 - o.marginX, x1: this.body.x1 + o.marginX,
        y0: this.body.y0 - o.marginY, y1: this.body.y1 + o.marginY,
        z0: 0, z1: p.height + o.marginZ,
      };
      const Lx = this.dom.x1 - this.dom.x0, Ly = this.dom.y1 - this.dom.y0, Lz = this.dom.z1 - this.dom.z0;
      const volume = Lx * Ly * Lz;

      // Each simulated parcel stands for `weight` real drops.
      this.parcelDensity = o.targetParcels / volume;
      this.weight = this.rain.n / this.parcelDensity;
      this.parcelVolume = this.weight * this.rain.dropVol; // m³ of water per parcel

      this.inflowDebt = [0, 0, 0];

      const cap = Math.ceil(o.targetParcels * 1.5) + 64;
      this.x = new Float64Array(cap);
      this.y = new Float64Array(cap);
      this.z = new Float64Array(cap);
      this.count = 0;

      this.time = 0;
      this.distance = 0;
      this.hits = { top: 0, front: 0, back: 0, side: 0 };
      this.lastHits = []; // {face, x, y, z} hits from the most recent step, for rendering
      this.lastGround = []; // {x, y} drops that reached the ground in the most recent step

      for (let i = 0; i < o.targetParcels; i++) {
        const x = this.dom.x0 + this.rand() * Lx;
        const y = this.dom.y0 + this.rand() * Ly;
        const z = this.dom.z0 + this.rand() * Lz;
        if (this.insideBody(x, y, z)) continue;
        this.add(x, y, z);
      }
    }

    insideBody(x, y, z) {
      const b = this.body;
      return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
    }

    add(x, y, z) {
      if (this.count >= this.x.length) this.grow();
      const i = this.count++;
      this.x[i] = x; this.y[i] = y; this.z[i] = z;
    }

    grow() {
      const n = this.x.length * 2;
      for (const k of ['x', 'y', 'z']) {
        const a = new Float64Array(n); a.set(this[k]); this[k] = a;
      }
    }

    removeAt(i) {
      const last = --this.count;
      this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    }

    get finished() {
      return this.distance >= this.p.distance - 1e-9;
    }

    // Advance by dt seconds. Drops keep falling when `moving` is false (the person stands still
    // and nothing is counted), which lets the view idle without biasing the tally.
    step(dt, moving = true) {
      if (moving && !this.finished) {
        const remaining = (this.p.distance - this.distance) / this.p.speed;
        dt = Math.min(dt, remaining);
      } else {
        moving = false;
      }
      const ux = moving ? this.u.x : this.rain.Ux, uy = this.u.y, uz = this.u.z;
      const dx = ux * dt, dy = uy * dt, dz = uz * dt;
      const b = this.body, D = this.dom;
      this.lastHits.length = 0;
      this.lastGround.length = 0;

      for (let i = this.count - 1; i >= 0; i--) {
        const x = this.x[i], y = this.y[i], z = this.z[i];
        const hit = segmentEntryFace(x, y, z, dx, dy, dz, b);
        if (hit) {
          if (moving) {
            this.hits[hit.face]++;
            this.lastHits.push({ face: hit.face, x: x + dx * hit.s, y: y + dy * hit.s, z: z + dz * hit.s });
          }
          this.removeAt(i);
          continue;
        }
        const nx = x + dx, ny = y + dy, nz = z + dz;
        if (nz <= D.z0 && this.lastGround.length < 80) this.lastGround.push({ x: x + dx * (z / -dz), y: y + dy * (z / -dz) });
        if (nz <= D.z0 || nx < D.x0 || nx > D.x1 || ny < D.y0 || ny > D.y1 || nz > D.z1) {
          this.removeAt(i);
          continue;
        }
        this.x[i] = nx; this.y[i] = ny; this.z[i] = nz;
      }

      this.inject(dt, ux, uy, uz);
      if (moving) {
        this.time += dt;
        this.distance = Math.min(this.p.distance, this.distance + this.p.speed * dt);
      }
    }

    inject(dt, ux, uy, uz) {
      const D = this.dom, nd = this.parcelDensity;
      const Lx = D.x1 - D.x0, Ly = D.y1 - D.y0, Lz = D.z1 - D.z0;
      const rates = [nd * Math.abs(uz) * Lx * Ly, nd * Math.abs(ux) * Ly * Lz, nd * Math.abs(uy) * Lx * Lz];
      const entry = [D.z1, ux > 0 ? D.x0 : D.x1, uy > 0 ? D.y0 : D.y1];
      for (let k = 0; k < 3; k++) {
        this.inflowDebt[k] += rates[k] * dt;
        while (this.inflowDebt[k] >= 1) {
          this.inflowDebt[k] -= 1;
          // Entered at a random instant within the step, so advance part of the way in.
          const f = this.rand();
          let x = D.x0 + this.rand() * Lx, y = D.y0 + this.rand() * Ly, z = D.z0 + this.rand() * Lz;
          if (k === 0) z = entry[0];
          else if (k === 1) x = entry[1];
          else y = entry[2];
          x += ux * dt * f; y += uy * dt * f; z += uz * dt * f;
          if (z <= D.z0 || x < D.x0 || x > D.x1 || y < D.y0 || y > D.y1 || z > D.z1) continue;
          if (this.insideBody(x, y, z)) continue;
          this.add(x, y, z);
        }
      }
    }

    // Collected water in litres, with 1σ Poisson uncertainty.
    collected() {
      const out = { total: 0, totalSigma: 0, hits: 0 };
      for (const f of FACES) {
        const n = this.hits[f];
        out[f] = n * this.parcelVolume * 1000;
        out[f + 'Sigma'] = Math.sqrt(n) * this.parcelVolume * 1000;
        out.total += out[f];
        out.hits += n;
      }
      out.totalSigma = Math.sqrt(out.hits) * this.parcelVolume * 1000;
      return out;
    }
  }

  // Runs a full trip headlessly (or a fixed duration, if given) and returns collected water.
  function simulate(params, opts) {
    const o = Object.assign({ dt: 1 / 120, duration: null }, opts);
    const sim = new Simulation(params, o);
    const limit = o.duration == null ? Infinity : o.duration;
    while (!sim.finished && sim.time < limit - 1e-12) {
      sim.step(Math.min(o.dt, limit - sim.time));
    }
    return Object.assign(sim.collected(), { time: sim.time, distance: sim.distance, weight: sim.weight });
  }

  return {
    DEFAULTS, FACES,
    terminalVelocity, rainState, bodyAreas, relativeVelocity,
    faceRates, exposure, optimalSpeed,
    segmentEntryFace, Simulation, simulate, mulberry32,
  };
});
