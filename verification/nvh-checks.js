// 音響・振動解析（9.）の検証：騒音計・オクターブ・ラウドネス・シャープネス・トーナリティ・伝達関数・次数解析
// 実行: node verification/nvh-checks.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const A = loadDsp(["calK", "sosResp", "weightingSOS", "weightingDb", "soundLevel", "octaveAnalysis", "loudnessStationary", "loudnessTimeVarying",
  "sharpnessDIN", "tonality", "cbWidth", "roughnessModel", "fluctuationModel", "rbjBiquad", "sosRun", "transferFunction", "tachoRPM", "orderMap"]);
const rows = [];
const check = (name, val, exp, tol, unit) => rows.push([name, val, exp, tol, unit, Number.isFinite(val) && Math.abs(val - exp) <= tol + 1e-9]);
const FS = 48000, G = Math.pow(10, 0.3);
const sine = (f, dur, amp, fs = FS) => { const n = Math.round(dur * fs), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / fs); return x; };
let sd = 9; const rnd = () => ((sd = sd * 16807 % 2147483647) / 2147483647 - .5);

// 1) 周波数重み付け：規定式との差（10 Hz〜16 kHz の 1/3 オクターブ点、44.1 / 48 kHz）
for (const fs of [44100, 48000]) for (const t of ["A", "C"]) {
  const sos = A.weightingSOS(fs, t); let m = 0;
  for (let x = -20; x <= 12; x++) { const f = 1000 * Math.pow(G, x / 3); m = Math.max(m, Math.abs(20 * Math.log10(A.sosResp(sos, f, fs)) - A.weightingDb(f, t))); }
  check(t + "-weighting max error @" + fs / 1000 + "k", m, 0, 0.3, "dB");
}
// 2) 騒音計：定常正弦波とトーンバースト（IEC 61672-1 表3、4 kHz）
const K94 = A.calK(94);
{ const r = A.soundLevel(sine(1000, 10, 1), FS, K94); check("1 kHz LAeq", r.LAeq, 94, 0.05, "dB"); check("1 kHz LZpeak", r.LZpeak, 97.01, 0.05, "dB"); }
{ const r = A.soundLevel(sine(100, 10, 1), FS, K94); check("100 Hz LAeq", r.LAeq, 94 - 19.1, 0.1, "dB"); }
const steady = A.soundLevel(sine(4000, 6, 1), FS, K94).LAeq;
const burst = d => { const n = FS * 6, x = new Float32Array(n), s0 = FS * 3, m = Math.round(d * FS); for (let i = s0; i < s0 + m; i++) x[i] = Math.sin(2 * Math.PI * 4000 * (i - s0) / FS); return A.soundLevel(x, FS, K94); };
for (const [d, eF, eS] of [[1, 0, -2.0], [0.2, -1.0, -7.4], [0.05, -4.8, -13.1], [0.01, -11.1, -20.0], [0.002, -18.0, -27.0]]) {
  const r = burst(d); check("burst " + d * 1000 + "ms LAFmax", r.LAFmax - steady, eF, 0.3, "dB"); check("burst " + d * 1000 + "ms LASmax", r.LASmax - steady, eS, 0.3, "dB");
}
// 3) 1/3 オクターブ：帯域中心の正弦波と帯域境界
for (const f of [31.5, 1000, 8000]) { const fm = 1000 * Math.pow(G, Math.round(3 * Math.log(f / 1000) / Math.log(G)) / 3), b = A.octaveAnalysis(sine(fm, 8, 1), FS, 3, K94).find(x => Math.abs(x.fm - fm) < 1e-6); check("1/3 oct centre " + b.nom + " Hz", b.Leq, 94, 0.1, "dB"); }
{ const f2 = 1000 * Math.pow(G, 1 / 6), r = A.octaveAnalysis(sine(f2, 8, 1), FS, 3, K94); check("1/3 oct band edge (1000 band)", r.find(x => x.nom === 1000).Leq, 91, 0.1, "dB"); }
// 4) ラウドネス ISO 532-1：附属書 B.2 の試験信号 1（83.296 sone）と 1 kHz・60 dB（4.019 sone）
check("ISO 532-1 test signal 1", A.loudnessStationary([-60, -60, 78, 79, 89, 72, 80, 89, 75, 87, 85, 79, 86, 80, 71, 70, 72, 71, 72, 74, 69, 65, 67, 77, 68, 58, 45, 30], false).N, 83.296, 83.296 * 0.05, "sone");
{ const x = sine(1000, 3, 1), K = A.calK(60), b = A.octaveAnalysis(x, FS, 3, K).filter(v => v.nom >= 25 && v.nom <= 12500).map(v => v.Leq);
  check("1 kHz 60 dB stationary", A.loudnessStationary(b, false).N, 4.019, 4.019 * 0.05, "sone");
  const tv = A.loudnessTimeVarying(x, FS, K, false), st = tv.N.slice(500); check("1 kHz 60 dB time-varying", st.reduce((a, c) => a + c, 0) / st.length, 4.019, 4.019 * 0.05, "sone"); }
// 5) シャープネス DIN 45692：1 kHz 中心・臨界帯域幅の雑音 60 dB → 1 acum（周波数領域で帯域を切り出して生成）
{ const N = 1 << 18, re = new Float64Array(N), im = new Float64Array(N);
  for (let k = Math.ceil(920 * N / FS); k <= Math.floor(1080 * N / FS); k++) { const ph = 2 * Math.PI * (rnd() + .5); re[k] = Math.cos(ph); im[k] = Math.sin(ph); re[N - k] = re[k]; im[N - k] = -im[k]; }
  // 逆 DFT（FFT）
  for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= N; len <<= 1) { const a = 2 * Math.PI / len; for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(a * k), wi = Math.sin(a * k), p = i + k, q = p + len / 2, xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr; re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi; } }
  const x = new Float32Array(N); let e = 0; for (let i = 0; i < N; i++) { x[i] = re[i]; e += re[i] * re[i]; } const g = 1 / Math.sqrt(e / N); for (let i = 0; i < N; i++) x[i] *= g;
  const b = A.octaveAnalysis(x, FS, 3, 60).filter(v => v.nom >= 25 && v.nom <= 12500).map(v => v.Leq);
  check("DIN 45692 sharpness reference", A.sharpnessDIN(A.loudnessStationary(b, false).Ns), 1, 0.05, "acum"); }
// 6) トーナリティ ECMA-74：白色雑音中のトーンの TNR を解析解と比較
for (const [ft, Lt, Ln] of [[1000, 60, 30], [3000, 50, 35]]) {
  const n = FS * 8, x = new Float32Array(n), At = Math.SQRT2 * Math.pow(10, (Lt - 100) / 20), sg = Math.sqrt(12) * Math.pow(10, (Ln - 100) / 20);
  for (let i = 0; i < n; i++) x[i] = At * Math.sin(2 * Math.PI * ft * i / FS) + sg * rnd();
  const exp = Lt - (Ln - 10 * Math.log10(FS / 2) + 10 * Math.log10(A.cbWidth(ft)));
  check("ECMA-74 TNR " + ft + " Hz", A.tonality(x, FS, 100, 1)[0].tnr, exp, 0.5, "dB");
}
// 7) ラフネス・変動強度（モデル）：校正点
const am = (fm, m, dur) => { const n = Math.round(FS * dur), x = new Float32Array(n); for (let i = 0; i < n; i++) { const t = i / FS; x[i] = (1 + m * Math.sin(2 * Math.PI * fm * t)) * Math.sin(2 * Math.PI * 1000 * t) / Math.sqrt(1 + m * m / 2); } return x; };
check("roughness model 1 asper point", A.roughnessModel(am(70, 1, 2), FS, A.calK(60)).R, 1, 0.02, "asper");
check("fluctuation model 1 vacil point", A.fluctuationModel(am(4, 1, 8), FS, A.calK(60)).F, 1, 0.02, "vacil");
// 8) 伝達関数：白色雑音 → ピーキング +9 dB @1 kHz
{ const x = new Float32Array(FS * 20); for (let i = 0; i < x.length; i++) x[i] = rnd(); const sos = [A.rbjBiquad("peaking", 1000, 2, 9, FS)], y = A.sosRun(x, sos), r = A.transferFunction(x, y, FS, 4096);
  let m = 0; for (const f of [100, 500, 1000, 2000, 5000]) { const k = Math.round(f / r.bh); m = Math.max(m, Math.abs(r.mag[k] - 20 * Math.log10(A.sosResp(sos, k * r.bh, FS)))); }
  check("transfer function H1 error", m, 0, 0.05, "dB"); }
// 9) 次数解析：600→3000 rpm、次数 2（振幅 0.5）
{ const n = FS * 10, x = new Float32Array(n), t = new Float32Array(n); let ph = 0; for (let i = 0; i < n; i++) { ph += (600 + 2400 * i / n) / 60 / FS; x[i] = 0.5 * Math.sin(2 * Math.PI * 2 * ph); t[i] = (ph % 1) < 0.05 ? 1 : 0; }
  const m = A.orderMap(x, FS, A.tachoRPM(t, FS, 1), 100, 6, 0.25, 100), q = Math.round(2 / 0.25) - 1; let s = 0, c = 0; for (let k = 0; k < m.nc; k++) if (m.count[k]) { s += m.db[k * m.no + q]; c++; }
  check("order 2 level", s / c, 100 + 20 * Math.log10(0.5) - 3.01, 0.5, "dB"); }

for (const [n, v, e, t, u, ok] of rows) console.log((ok ? "PASS" : "FAIL") + "  " + n.padEnd(34) + (Number.isFinite(v) ? v.toFixed(3) : String(v)).padStart(9) + " " + u + "   expected " + e.toFixed(3) + " ±" + (+t.toFixed(3)));
const passed = rows.filter(r => r[5]).length;
console.log(passed + "/" + rows.length + " passed");
process.exitCode = passed === rows.length ? 0 : 1;
