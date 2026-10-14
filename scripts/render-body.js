// Renders silhouettes of the parametric body (standing, running) as an SVG figure.
// Usage: node scripts/render-body.js > docs/figures/body_poses.svg
const B = require('../src/body.js');

const COLORS = { head: '#d95926', trunk: '#3987e5', arms: '#199e70', legs: '#c98500', box: '#888' };
const views = [
  ['Standing, front', B.humanMesh({ pose: 'stand' }), [-1, 0, 0]],
  ['Standing, side', B.humanMesh({ pose: 'stand' }), [0, -1, 0]],
  ['Running, 6° lean', B.humanMesh({ pose: 'run', leanDeg: 6 }), [0, -1, 0]],
  ['Running — top view', B.humanMesh({ pose: 'run', leanDeg: 6 }), [0, 0, -1]],
];
const scale = 160; // px per metre
let x = 20;
const parts = [];
for (const [title, mesh, dir] of views) {
  const s = B.silhouette(mesh, dir, { res: 0.006, grid: true });
  const g = s.grid;
  const w = g.nu * g.res * scale, h = g.nv * g.res * scale;
  const rects = [];
  for (let j = 0; j < g.nv; j++) for (let i = 0; i < g.nu; i++) {
    const c = g.cells[j * g.nu + i];
    if (!c) continue;
    // side views: e1 = dir × z points backwards, so mirror to put forward on the right;
    // top view: e2 points forward, so use it as the horizontal axis
    const col = dir[2] !== 0 ? j : (dir[1] !== 0 ? g.nu - 1 - i : i);
    const px = x + col * g.res * scale;
    const py = 40 + (dir[2] !== 0 ? i : j) * g.res * scale;
    rects.push(`<rect x="${px.toFixed(1)}" y="${py.toFixed(1)}" width="${(g.res * scale + 0.4).toFixed(2)}" height="${(g.res * scale + 0.4).toFixed(2)}" fill="${COLORS[c.region]}"/>`);
  }
  parts.push(`<text x="${x}" y="24" font-size="13" font-family="Helvetica,Arial">${title} · A⊥ = ${s.area.toFixed(3)} m²</text>`, ...rects);
  x += Math.max(dir[2] !== 0 ? h : w, 200) + 40;
}
const W = x, H = 40 + 1.9 * scale + 30;
const legend = Object.entries(COLORS).filter(([k]) => k !== 'box').map(([k, c], i) =>
  `<rect x="${20 + i * 90}" y="${H - 18}" width="12" height="12" fill="${c}"/><text x="${36 + i * 90}" y="${H - 8}" font-size="12" font-family="Helvetica,Arial">${k}</text>`).join('');
process.stdout.write(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="white"/>${parts.join('')}${legend}</svg>`);
