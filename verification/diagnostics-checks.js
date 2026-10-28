// 診断機能（PSR・DR・トーナルバランス・帯域上限・低域・マッチ EQ・位置合わせ）を、理論値の分かる信号で確かめる
// 実行: node verification/diagnostics-checks.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const D = loadDsp(["analyzeLoudness", "truePeak", "psrAnalysis", "drValue", "tonalCurve", "detectCutoff", "avgSpectrum",
  "lowEndStats", "fitMatchEq", "findLag", "codecCompare", "rbjBiquad", "sosResp", "firDesign", "firApply", "TB_F", "TB_N", "normTonal"]);

const rows = [];
const check = (name, val, exp, tol, unit) => rows.push([name, val, exp, tol, unit || "", Number.isFinite(val) && Math.abs(val - exp) <= tol + 1e-9]);
const ok = (name, cond, note) => rows.push([name, note || "", "", "", "", !!cond]);

// 再現できる乱数（xorshift）とピンク雑音（Paul Kellet の近似フィルタ）
let seed = 12345;
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
function white(n, a) { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a * rnd(); return x; }
function pink(n, a) {
  const x = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rnd();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856; b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    x[i] = a * 0.11 * (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362); b6 = w * 0.115926;
  }
  return x;
}
const sine = (n, fs, f, a) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = a * Math.sin(2 * Math.PI * f * i / fs); return x; };
const db = v => 20 * Math.log10(v);

// ---- PSR ----
{
  const fs = 48000, n = fs * 20, x = sine(n, fs, 1000, Math.pow(10, -20 / 20));
  const loud = D.analyzeLoudness([x, x], fs);
  const p = D.psrAnalysis([x, x], fs, loud);
  check("PSR 1 kHz 正弦波（ステレオ）中央値", p.med, 0, 0.1, "dB");
  const lm = D.analyzeLoudness([x], fs), pm = D.psrAnalysis([x], fs, lm);
  check("PSR 1 kHz 正弦波（モノラル）中央値", pm.med, 3.01, 0.1, "dB");
}
{
  // 雑音の任意の 3 秒窓で、窓だけを切り出して求めたトゥルーピーク − ショートタームと一致するか
  const fs = 44100, n = fs * 30, L = pink(n, 0.5), R = pink(n, 0.5);
  for (let i = fs * 12; i < fs * 12 + 300; i++) { L[i] *= 1.8; R[i] *= 1.8; } // 一瞬のピーク
  const loud = D.analyzeLoudness([L, R], fs), p = D.psrAnalysis([L, R], fs, loud);
  for (const b of [50, 105, 200]) {
    const hop = Math.round(0.1 * fs), s0 = b * hop, s1 = s0 + 30 * hop;
    const tp = Math.max(D.truePeak(L.subarray(s0, s1)).tp, D.truePeak(R.subarray(s0, s1)).tp);
    const st = loud.stSeries[b].v;
    check("PSR 窓 " + b + "（切り出しとの一致）", p.v[b], db(tp) - st, 0.25, "dB");
  }
  ok("PSR 時刻の並び", Math.abs((p.t0 + 105 * p.step) - (105 * 0.1 + 1.5)) < 0.01, "窓の中心");
}
{
  // 強く潰した信号（ハードクリップした雑音）で PSR < 8 の区間が検出されるか
  const fs = 48000, n = fs * 40, L = pink(n, 1), R = pink(n, 1);
  for (let i = fs * 20; i < n; i++) { L[i] = Math.max(-0.25, Math.min(0.25, L[i] * 4)) * 3.5; R[i] = Math.max(-0.25, Math.min(0.25, R[i] * 4)) * 3.5; }
  for (let i = 0; i < fs * 20; i++) { L[i] *= 0.3; R[i] *= 0.3; }
  const loud = D.analyzeLoudness([L, R], fs), p = D.psrAnalysis([L, R], fs, loud);
  ok("PSR < 8 の区間を検出", p.runs.length >= 1 && p.runs[0].a >= 17 && p.runs[0].a <= 22, "区間 " + (p.runs[0] ? p.runs[0].a.toFixed(1) + "–" + p.runs[0].b.toFixed(1) + " 秒, 最小 " + p.runs[0].min.toFixed(1) : "なし"));
  ok("PSR 大きい区間 < 前半", p.loud < 8, "大きい区間 " + p.loud.toFixed(2) + " dB");
}

// ---- DR ----
{
  const fs = 44100, n = fs * 60, x = sine(n, fs, 997, 0.5);
  check("DR 正弦波", D.drValue([x, x], fs).raw, 0, 0.05, "dB");
  const sq = new Float32Array(n); for (let i = 0; i < n; i++) sq[i] = Math.sin(2 * Math.PI * 100 * i / fs) >= 0 ? 0.5 : -0.5;
  check("DR 矩形波（理論 −3.01）", D.drValue([sq, sq], fs).raw, -3.01, 0.05, "dB");
  // 独立した素直な実装と比べる
  const L = pink(n, 0.4), R = pink(n, 0.3);
  const ref = ch => { const B = 3 * fs, rms = [], pk = []; for (let a = 0; a < ch.length; a += B) { const e = Math.min(ch.length, a + B); if (e - a < fs && rms.length) break; let s = 0, p = 0; for (let i = a; i < e; i++) { s += ch[i] * ch[i]; p = Math.max(p, Math.abs(ch[i])); } rms.push(Math.sqrt(2 * s / (e - a))); pk.push(p); }
    rms.sort((a, b) => b - a); pk.sort((a, b) => b - a); const k = Math.max(1, Math.floor(rms.length * 0.2)); const r = Math.sqrt(rms.slice(0, k).reduce((a, v) => a + v * v, 0) / k); return db(pk[1] / r); };
  check("DR ピンク雑音（素直な実装と一致）", D.drValue([L, R], fs).raw, (ref(L) + ref(R)) / 2, 1e-6, "dB");
}

// ---- トーナルバランス ----
{
  const fs = 48000, n = fs * 30, L = pink(n, 0.4), R = pink(n, 0.4);
  const loud = D.analyzeLoudness([L, R], fs), t = D.tonalCurve(L, R, fs, loud, true);
  let mx = 0; for (let j = 0; j < D.TB_N; j++) if (D.TB_F[j] >= 40 && D.TB_F[j] <= 16000) mx = Math.max(mx, Math.abs(t.m[j]));
  check("トーナル ピンク雑音 40 Hz〜16 kHz の最大偏差", mx, 0, 0.6, "dB");
  // 無相関の L/R：サイドとミッドは同じ大きさ（S − M ≈ 0）
  let sm = 0, c = 0; for (let j = 0; j < D.TB_N; j++) if (D.TB_F[j] >= 100 && D.TB_F[j] <= 10000) { sm += t.s[j] - t.m[j]; c++; }
  check("トーナル 無相関ステレオの S − M", sm / c, 0, 0.5, "dB");
  const W = white(n, 0.3), lw = D.analyzeLoudness([W, W], fs), tw = D.tonalCurve(W, W, fs, lw, false);
  const j1 = D.TB_F.findIndex(f => f >= 250), j2 = D.TB_F.findIndex(f => f >= 8000);
  check("トーナル 白色雑音の傾き（理論 +3.01 dB/oct）", (tw.m[j2] - tw.m[j1]) / Math.log2(D.TB_F[j2] / D.TB_F[j1]), 3.01, 0.3, "dB/oct");
  // ゲート：前半に −30 dB の高域だけの音を置いても、曲線はほぼ変わらない
  const L2 = Float32Array.from(L), R2 = Float32Array.from(R), hiss = white(fs * 10, 0.4 * 0.0316);
  const L3 = new Float32Array(n + fs * 10), R3 = new Float32Array(n + fs * 10); L3.set(hiss); R3.set(hiss); L3.set(L2, fs * 10); R3.set(R2, fs * 10);
  const t3 = D.tonalCurve(L3, R3, fs, D.analyzeLoudness([L3, R3], fs), true);
  let md = 0; for (let j = 0; j < D.TB_N; j++) if (D.TB_F[j] >= 40 && D.TB_F[j] <= 16000) md = Math.max(md, Math.abs(t3.m[j] - t.m[j]));
  check("トーナル 静かな区間を除外（差の最大）", md, 0, 0.6, "dB");
  // normTonal（保存データの曲線をそろえる）：定数を足しても同じになる
  const shifted = Array.from(t.m, v => v + 7), nt = D.normTonal(shifted);
  check("normTonal 定数ずれの除去", nt[30] - t.m[30], 0, 1e-4, "dB");
}

// ---- 帯域の上限 ----
{
  const fs = 44100, n = fs * 20;
  const lp = (x, fc) => D.firApply(x, D.firDesign("lowpass", fc, 0, 1023, fs, 9));
  const a = D.detectCutoff(D.avgSpectrum(lp(white(n, 0.3), 16000), fs));
  check("帯域上限 16 kHz でカットした白色雑音", a ? a.f : NaN, 16000, 300, "Hz");
  const b = D.detectCutoff(D.avgSpectrum(lp(pink(n, 0.4), 19000), fs));
  check("帯域上限 19 kHz でカットしたピンク雑音", b ? b.f : NaN, 19000, 300, "Hz");
  ok("帯域上限 カットなしのピンク雑音は検出しない", !D.detectCutoff(D.avgSpectrum(pink(n, 0.4), fs)));
  // ゆるやかなハイシェルフ（−12 dB）は「切れている」とは扱わない
  const sos = [D.rbjBiquad("highshelf", 8000, 0.707, -12, fs)], x = pink(n, 0.4), y = new Float32Array(n);
  { const c = sos[0]; let z1 = 0, z2 = 0; for (let i = 0; i < n; i++) { const v = c[0] * x[i] + z1; z1 = c[1] * x[i] - c[3] * v + z2; z2 = c[2] * x[i] - c[4] * v; y[i] = v; } }
  ok("帯域上限 なだらかな減衰は検出しない", !D.detectCutoff(D.avgSpectrum(y, fs)));
}

// ---- 低域 ----
{
  const fs = 48000, n = fs * 20, x = sine(n, fs, 50, 0.5);
  const loud = D.analyzeLoudness([x, x], fs), le = D.lowEndStats(x, fs, loud);
  check("低域クレスト 50 Hz 正弦波（理論 3.01）", le.crest, 3.01, 0.15, "dB");
}

// ---- マッチ EQ ----
{
  const fs = 48000;
  const truth = [["lowshelf", 90, 0.707, 3], ["peaking", 1000, 1.2, 4], ["peaking", 3500, 2, -3], ["highshelf", 9000, 0.707, -3]];
  const sos = truth.map(t => D.rbjBiquad(t[0], t[1], t[2], t[3], fs));
  const diff = D.TB_F.map(f => 20 * Math.log10(D.sosResp(sos, f, fs)));
  const fit = D.fitMatchEq(diff, fs);
  // 目標は平均を引いた形なので、形が合っているかを見る
  check("マッチ EQ 既知の 4 段 EQ の再現（残差 RMS）", fit.rms, 0, 0.5, "dB");
  ok("マッチ EQ バンド数", fit.bands.length >= 3 && fit.bands.length <= 6, fit.bands.map(b => b.type + " " + Math.round(b.f) + "Hz " + b.g.toFixed(1) + "dB").join(", "));
  const flat = D.fitMatchEq(D.TB_F.map(() => 2), fs);
  ok("マッチ EQ 平坦な差（音量差だけ）では EQ を置かない", flat.bands.length === 0);
}

// ---- 位置合わせ・コーデック比較 ----
{
  const fs = 48000, x = white(fs * 3, 0.3), lag = 1234, y = new Float32Array(x.length + lag); y.set(x, lag);
  check("位置合わせ（相互相関）", D.findLag(x, y.subarray(0, x.length), 4096), lag, 0, "サンプル");
  const a = [white(fs * 5, 0.3), white(fs * 5, 0.3)];
  const c = D.codecCompare(a, a.map(v => Float32Array.from(v)), fs);
  ok("同じ音声の比較は差分なし", c.nmr === -Infinity && c.over0.length === 0);
  const b = a.map(v => { const w = Float32Array.from(v); for (let i = 0; i < w.length; i++) w[i] += 0.003 * rnd(); return w; });
  const c2 = D.codecCompare(a, b, fs);
  check("差分レベル（理論 20log(0.003/0.3) = −40 dB）", c2.nmr, -40, 0.5, "dB");
  const hot = a.map(v => Float32Array.from(v, (s, i) => i === fs * 2 ? 1.2 : s));
  const c3 = D.codecCompare(a, hot, fs);
  ok("0 dBTP を超えた位置", c3.over0.length === 1 && Math.abs(c3.over0[0].t - 2) < 0.11 && c3.over0[0].dur > 0, c3.over0.map(o => o.t.toFixed(1) + " 秒 " + o.db.toFixed(2) + " dBTP").join(", "));
}

let fail = 0;
for (const [name, val, exp, tol, unit, pass] of rows) {
  if (!pass) fail++;
  const v = typeof val === "number" ? val.toFixed(3) : val;
  console.log((pass ? "OK  " : "NG  ") + name + (exp !== "" ? "：" + v + " " + unit + "（期待 " + exp + " ± " + tol + "）" : val ? "：" + v : ""));
}
console.log("\n" + (rows.length - fail) + "/" + rows.length + " 合格");
process.exitCode = fail ? 1 : 0;
