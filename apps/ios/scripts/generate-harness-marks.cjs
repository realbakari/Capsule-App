// Run from the repository root: node apps/ios/scripts/generate-harness-marks.cjs
// Regenerates apps/ios/.../Assets.xcassets/Harness from the desktop's provider-marks.ts,
// spelling out arc flags ("01" -> "0 1"): CoreSVG misreads the compact form browsers accept.
const fs = require("fs");
const src = fs.readFileSync("apps/desktop/src/renderer/src/lib/provider-marks.ts", "utf8");
const re = /"([a-z0-9-]+)":\s*\{\s*title:\s*"([^"]+)",(?:\s*hex:\s*"([^"]+)",)?\s*paths:\s*\[([\s\S]*?)\],/g;
const num = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
function normalize(d) {
  let i = 0, out = [], cmd = null;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const number = () => { ws(); const m = d.slice(i).match(num); if (!m) throw new Error("number at " + i + " in " + d.slice(i, i + 20)); i += m[0].length; return m[0]; };
  const flag = () => { ws(); const c = d[i]; if (c !== "0" && c !== "1") throw new Error("flag at " + i); i++; return c; };
  const counts = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  while (true) {
    ws(); if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) { cmd = d[i++]; out.push(cmd); if (cmd.toLowerCase() === "z") continue; }
    const lower = cmd.toLowerCase();
    if (lower === "a") out.push([number(), number(), number(), flag(), flag(), number(), number()].join(" "));
    else out.push(Array.from({ length: counts[lower] }, number).join(" "));
  }
  return out.join(" ");
}
const root = "apps/ios/Capsule/Resources/Assets.xcassets/Harness";
let m, n = 0;
while ((m = re.exec(src))) {
  const [, id, , , body] = m;
  const paths = [...body.matchAll(/"([^"]+)"/g)].map((x) => normalize(x[1]));
  const dir = `${root}/harness-${id}.imageset`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(`${dir}/harness-${id}.svg`, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">${paths.map((d) => `<path fill="#000" fill-rule="evenodd" clip-rule="evenodd" d="${d}"/>`).join("")}</svg>\n`);
  n++;
}
console.log("wrote", n);
