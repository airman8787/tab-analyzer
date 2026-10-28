// tab-analyzer の計測値を、独立した参照実装（ref1770.js）と突き合わせる
// 実行: node verification/compare-reference.js [任意のWAVファイル ...]
//   引数なし … 生成信号（音圧の高い音源・ダイナミクスの大きい音源・5.1ch、48 / 44.1 kHz）
//   WAV を指定 … そのファイルも比較する（PCM 16/24/32bit、32bit float、2ch までの L/R として扱う）
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const R = require("./ref1770");
const T = loadDsp(["analyzeLoudness", "truePeak", "chWeight"]);
const db = x => 20 * Math.log10(x);

let sd = 7; const rnd = () => ((sd = sd * 16807 % 2147483647) / 2147483647 - .5);
function synth(kind, fs) {
  if (kind === "brick") { const n = fs * 60, L = new Float32Array(n), Rr = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / fs, v = 0.6 * Math.sin(2 * Math.PI * 55 * t) + 0.45 * rnd() + 0.25 * Math.sin(2 * Math.PI * 3500 * t); L[i] = Math.tanh(2.8 * v) * 0.9; Rr[i] = Math.tanh(2.8 * (v * 0.9 + 0.1 * rnd())) * 0.9; }
    return { chs: [L, Rr], w: [1, 1] }; }
  if (kind === "dyn") { const n = fs * 90, L = new Float32Array(n), Rr = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / fs, g = t < 20 ? 0.05 : t < 50 ? 0.3 : t < 70 ? 1 : 0.15, ph = t % 0.5;
      const v = g * (0.3 * Math.sin(2 * Math.PI * 220 * t) + 0.2 * Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-ph * 8) + 0.15 * rnd() + 0.5 * Math.exp(-ph * 30) * Math.sin(2 * Math.PI * 60 * ph));
      L[i] = v; Rr[i] = v * 0.8 + g * 0.05 * rnd(); }
    return { chs: [L, Rr], w: [1, 1] }; }
  const n = fs * 30, chs = [...Array(6)].map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) { const t = i / fs; chs[2][i] = 0.25 * Math.sin(2 * Math.PI * 200 * t) * (0.6 + 0.4 * Math.sin(t * 2)); const m = 0.1 * Math.sin(2 * Math.PI * 440 * t);
    chs[0][i] = m + 0.03 * rnd(); chs[1][i] = m + 0.03 * rnd(); chs[3][i] = 0.4 * Math.sin(2 * Math.PI * 45 * t); chs[4][i] = 0.06 * rnd(); chs[5][i] = 0.06 * rnd(); }
  return { chs, w: ["L", "R", "C", "LFE", "Ls", "Rs"].map(T.chWeight) };
}

const cases = [];
for (const f of process.argv.slice(2)) cases.push([f, () => { const w = R.readWav(f); const chs = w.chs.slice(0, 2); return { chs, w: chs.map(() => 1), fs: w.rate }; }]);
for (const fs of [48000, 44100]) for (const [k, label] of [["brick", "loud master"], ["dyn", "dynamic"], ["51", "5.1ch"]])
  cases.push([label + " @" + fs / 1000 + "kHz", () => Object.assign(synth(k, fs), { fs })]);

const fmt = a => a[0].toFixed(2) + " / " + a[1].toFixed(2) + " (diff " + (a[0] - a[1] >= 0 ? "+" : "") + (a[0] - a[1]).toFixed(2) + ")";
for (const [name, mk] of cases) {
  const s = mk(), tl = T.analyzeLoudness(s.chs, s.fs, s.w), rl = R.loudness(s.chs, s.fs, s.w);
  let ttp = 0, rtp = 0; for (const c of s.chs) { ttp = Math.max(ttp, T.truePeak(c).tp); rtp = Math.max(rtp, R.truePeakFFT(c).tp); }
  console.log("== " + name + "   (tool / reference)");
  console.log("  integrated " + fmt([tl.integrated, rl.I]) + " LUFS");
  console.log("  LRA        " + fmt([tl.lra, rl.LRA]) + " LU");
  console.log("  max M      " + fmt([tl.momMax, rl.Mmax]) + " LUFS,  max S " + fmt([tl.stMax, rl.Smax]) + " LUFS");
  console.log("  true peak  " + fmt([db(ttp), db(rtp)]) + " dBTP");
}
