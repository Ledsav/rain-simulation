# Soak

How much rain do you catch walking a street in wind-driven rain, and which pace keeps you driest?

Open `src/simulation.html` through a local server (from the repo root: `python -m http.server`, then
visit `http://localhost:8000/src/simulation.html`). A walker in a yellow raincoat crosses a rainy
street. Every drop is simulated, and the coat darkens where the drops land.

## What's here

| Path | What it is |
|---|---|
| `docs/Rain_model.tex` / `.pdf` | The write-up: flux model, closed form for a box body, optimal pace, Monte Carlo validation, realistic body, airflow, field-experiment design |
| `src/rain-model.js` | Closed-form box model + 3D drop-by-drop Monte Carlo engine |
| `src/aero.js` | Potential flow around elliptic body sections and drop trajectories → collection efficiency η |
| `src/aero-table.js` | Precomputed η grid (`node scripts/build-aero-table.js > src/aero-table.js`) |
| `src/body.js` | Parametric human mesh (standing or running, with lean), OBJ loader, silhouette rasteriser |
| `src/refined.js` | Combined estimate: human silhouette + airflow |
| `src/simulation.html` | The interactive app |
| `scripts/analysis.js` | Reproduces every number in the paper's refinement sections |
| `scripts/render-body.js` | Renders `docs/figures/body_poses.png` |
| `experiment/` | Field protocol, data template, analysis script, power simulation |
| `brand/` | Soak wordmark, icon and logo concepts |
| `tests/` | `node --test tests/` |

## The result in one formula

For a box of height h, breadth b and thickness d, rain with fall speed vt and water content
C = R/vt, and wind (Ux, Uy):

    K(v) = C·ΔL·[ (A_top·vt + A_side·|Uy|)/v + A_front·|1 − Ux/v| ]

Go as fast as you can, unless the tailwind Ux exceeds U_crit = (A_top·vt + A_side·|Uy|)/A_front
(≈ 1 m/s); in that case, match the wind. A realistic body collects 20–50% less than the box, and
airflow deflects small drops, which matters most in drizzle. For a runner in a strong tailwind the
minimum softens, because the limbs shield the chest.
