// EBU Tech 3341 / 3342 のうち正弦波で構成される試験ケースを生成し、ラウドネスと LRA を判定する
// 実行: node verification/ebu-synthetic.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const { analyzeLoudness, chWeight } = loadDsp(["analyzeLoudness", "chWeight"]);
const FS = 48000;

// segs: [[dBFS（全チャンネル共通の数値、またはチャンネルごとの配列）, 秒], ...]
function make(segs, nch = 2) {
  let n = 0; for (const s of segs) n += Math.round(s[1] * FS);
  const chs = [...Array(nch)].map(() => new Float32Array(n));
  let p = 0;
  for (const [lv, d] of segs) {
    const m = Math.round(d * FS), lvs = Array.isArray(lv) ? lv : Array(nch).fill(lv);
    for (let i = 0; i < m; i++) {
      const v = Math.sin(2 * Math.PI * 1000 * (p + i) / FS);
      for (let c = 0; c < nch; c++) chs[c][p + i] = Math.pow(10, lvs[c] / 20) * v;
    }
    p += m;
  }
  return chs;
}

const rows = [];
const check = (name, val, exp, tol, unit) => rows.push([name, val, exp, tol, unit, Number.isFinite(val) && Math.abs(val - exp) <= tol + 1e-9]);
const L = (chs, w) => analyzeLoudness(chs, FS, w);

{ const r = L(make([[-23, 20]]));
  check("3341-1 I", r.integrated, -23, 0.1, "LUFS");
  check("3341-1 M", Math.min(...r.momSeries.slice(5).map(x => x.v)), -23, 0.1, "LUFS");
  check("3341-1 S", Math.max(...r.stSeries.slice(1).map(x => x.v)), -23, 0.1, "LUFS"); }
{ const r = L(make([[-33, 20]]));
  check("3341-2 I", r.integrated, -33, 0.1, "LUFS");
  check("3341-2 M", Math.max(...r.momSeries.slice(5).map(x => x.v)), -33, 0.1, "LUFS");
  check("3341-2 S", Math.min(...r.stSeries.slice(1).map(x => x.v)), -33, 0.1, "LUFS"); }
check("3341-3 I", L(make([[-36, 10], [-23, 60], [-36, 10]])).integrated, -23, 0.1, "LUFS");
check("3341-4 I", L(make([[-72, 10], [-36, 10], [-23, 60], [-36, 10], [-72, 10]])).integrated, -23, 0.1, "LUFS");
check("3341-5 I", L(make([[-26, 20], [-20, 20.1], [-26, 20]])).integrated, -23, 0.1, "LUFS");
{ const lay = ["L", "R", "C", "Ls", "Rs"];
  check("3341-6 I (5.0ch)", L(make([[[-28, -28, -24, -30, -30], 20]], 5), lay.map(chWeight)).integrated, -23, 0.1, "LUFS"); }
{ const segs = []; for (let i = 0; i < 5; i++) segs.push([-20, 1.34], [-30, 1.66]);
  const ss = L(make(segs)).stSeries.filter(x => x.t >= 3 && x.t <= 15).map(x => x.v);
  check("3341-9 S min", Math.min(...ss), -23, 0.1, "LUFS");
  check("3341-9 S max", Math.max(...ss), -23, 0.1, "LUFS"); }
{ const segs = []; for (let i = 0; i < 10; i++) segs.push([-20, 0.18], [-30, 2.2]);
  check("3341-12 M max", L(make(segs)).momMax, -23, 0.1, "LUFS"); }
check("3342-1 LRA", L(make([[-20, 20], [-30, 20]])).lra, 10, 1, "LU");
check("3342-2 LRA", L(make([[-20, 20], [-15, 20]])).lra, 5, 1, "LU");
check("3342-3 LRA", L(make([[-40, 20], [-20, 20]])).lra, 20, 1, "LU");
check("3342-4 LRA", L(make([[-50, 20], [-35, 20], [-20, 20], [-35, 20], [-50, 20]])).lra, 15, 1, "LU");

for (const [n, v, e, t, u, ok] of rows)
  console.log((ok ? "PASS" : "FAIL") + "  " + n.padEnd(18) + (Number.isFinite(v) ? v.toFixed(3) : String(v)).padStart(9) + " " + u + "   expected " + e + " ±" + t);
const passed = rows.filter(r => r[5]).length;
console.log(passed + "/" + rows.length + " passed");
process.exitCode = passed === rows.length ? 0 : 1;
