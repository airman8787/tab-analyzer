// トゥルーピークを、真のピークが理論的に分かる正弦波で検証する
// ・44.1 / 48 / 96 kHz × 6 周波数 × 5 位相（Tech 3341 と同じ許容範囲 +0.2 / −0.4 dB）
// ・0.01〜0.45 fs を 0.01 刻み、位相 15° 刻みで掃引し、最大誤差を表示
// 実行: node verification/truepeak-sine.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const { truePeak } = loadDsp(["truePeak"]);
const db = x => 20 * Math.log10(x);

let pass = 0, tot = 0;
for (const FS of [44100, 48000, 96000]) for (const div of [4, 6, 8, 3.3, 2.5, 2.2]) for (const phDeg of [0, 22.5, 45, 60, 90]) {
  const A = Math.pow(10, -6 / 20), f = FS / div, n = FS * 2, x = new Float32Array(n), ph = phDeg * Math.PI / 180;
  for (let i = 0; i < n; i++) x[i] = A * Math.sin(2 * Math.PI * f * i / FS + ph);
  const err = db(truePeak(x).tp) + 6; tot++;
  if (err <= 0.2 && err >= -0.4) pass++;
  else console.log("FAIL  fs " + FS + "  f " + Math.round(f) + " Hz  phase " + phDeg + "°  err " + err.toFixed(3) + " dB");
}
console.log(pass + "/" + tot + " within +0.2 / -0.4 dB");

let mx = -9, mn = 9;
for (let fr = 0.01; fr <= 0.4501; fr += 0.01) for (let d = 0; d < 360; d += 15) {
  const n = 4800, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin(2 * Math.PI * fr * i + d * Math.PI / 180);
  const e = db(truePeak(x).tp / 0.5); mx = Math.max(mx, e); mn = Math.min(mn, e);
}
console.log("sweep 0.01-0.45 fs, all phases: error max " + mx.toFixed(4) + " dB, min " + mn.toFixed(4) + " dB");
process.exitCode = pass === tot ? 0 : 1;
