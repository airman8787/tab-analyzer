// ITU-R BS.1770-4 / EBU Tech 3342 の独立した参照実装（tab-analyzer のコードは使わない）
// ・K特性：規格書に載っている 48 kHz の係数をそのまま使用（他のレートは 48 kHz に変換してから）
// ・ゲート：400 ms ブロック（75% 重なり）を直接計算
// ・LRA：3 s のショートタームを直接計算、パーセンタイルは線形補間
// ・トゥルーピーク：FFT のゼロ詰めによる 16 倍補間
"use strict";
const fs = require("fs");

function readWav(path) {
  const b = fs.readFileSync(path);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("not WAV");
  let p = 12, fmt = null, data = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4), sz = b.readUInt32LE(p + 4);
    if (id === "fmt ") {
      fmt = { tag: b.readUInt16LE(p + 8), ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
      if (fmt.tag === 0xFFFE) fmt.tag = b.readUInt16LE(p + 8 + 24); // 拡張形式は SubFormat の先頭（1=PCM, 3=float）
    }
    if (id === "data") { data = { off: p + 8, size: Math.min(sz, b.length - p - 8) }; break; }
    p += 8 + sz + (sz & 1);
  }
  const tag = fmt.tag;
  const bps = fmt.bits / 8, n = Math.floor(data.size / (bps * fmt.ch));
  const chs = Array.from({ length: fmt.ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < fmt.ch; c++) {
    const o = data.off + (i * fmt.ch + c) * bps;
    chs[c][i] = tag === 3 ? b.readFloatLE(o) : bps === 2 ? b.readInt16LE(o) / 32768 : bps === 3 ? b.readIntLE(o, 3) / 8388608 : b.readInt32LE(o) / 2147483648;
  }
  return { rate: fmt.rate, chs };
}

// 窓付き sinc による任意比率の変換（Kaiser β=10、±48 タップ、通過域は入力ナイキストの 0.49）
function resample(x, fsIn, fsOut) {
  if (fsIn === fsOut) return Float64Array.from(x);
  const HALF = 48, TAB = 4096, B = 10, cutoff = 0.98 * Math.min(1, fsOut / fsIn);
  const I0 = v => { let s = 1, t = 1; for (let k = 1; k < 80; k++) { t *= (v / (2 * k)) ** 2; s += t; if (t < 1e-16 * s) break; } return s; };
  const i0b = I0(B), tab = new Float64Array((2 * HALF) * TAB + 1);
  for (let i = 0; i < tab.length; i++) {
    const d = i / TAB - HALF, r = d / HALF;
    const sinc = d === 0 ? 1 : Math.sin(Math.PI * cutoff * d) / (Math.PI * cutoff * d);
    tab[i] = Math.abs(r) >= 1 ? 0 : cutoff * sinc * I0(B * Math.sqrt(1 - r * r)) / i0b;
  }
  const ratio = fsIn / fsOut, m = Math.floor(x.length / ratio), y = new Float64Array(m);
  for (let j = 0; j < m; j++) {
    const pos = j * ratio, i0 = Math.floor(pos), fr = pos - i0;
    let acc = 0;
    for (let k = -HALF + 1; k <= HALF; k++) {
      const idx = i0 + k; if (idx < 0 || idx >= x.length) continue;
      const t = (fr - k + HALF) * TAB, ti = Math.floor(t), tf = t - ti;
      acc += x[idx] * (tab[ti] + (tab[ti + 1] - tab[ti]) * tf);
    }
    y[j] = acc;
  }
  return y;
}

// 直接形 I の双二次フィルタ
function df1(x, b, a) {
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let n = 0; n < x.length; n++) {
    const v = b[0] * x[n] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2;
    x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
  }
  return y;
}
const PRE = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const RLB = { b: [1.0, -2.0, 1.0], a: [1, -1.99004745483398, 0.99007225036621] };

function loudness(chs, fsIn, weights) {
  const FS = 48000;
  const z = chs.map(c => { const r = resample(c, fsIn, FS); return df1(df1(r, PRE.b, PRE.a), RLB.b, RLB.a); });
  const n = z[0].length, lk = p => -0.691 + 10 * Math.log10(p);
  const block = (start, len) => { let s = 0; z.forEach((zc, c) => { if (!weights[c]) return; let t = 0; for (let i = start; i < start + len; i++) t += zc[i] * zc[i]; s += weights[c] * t / len; }); return s; };
  const step = 4800, M = [], S = [];
  for (let s = 0; s + 19200 <= n; s += step) M.push(block(s, 19200));
  for (let s = 0; s + 144000 <= n; s += step) S.push(block(s, 144000));
  const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
  const absG = M.filter(p => p > 0 && lk(p) > -70);
  const relT = lk(mean(absG)) - 10, gated = absG.filter(p => lk(p) > relT);
  const I = lk(mean(gated));
  const sAbs = S.filter(p => p > 0 && lk(p) > -70), sRel = lk(mean(sAbs)) - 20;
  const v = sAbs.filter(p => lk(p) > sRel).map(lk).sort((a, b) => a - b);
  const pct = q => { const x = q * (v.length - 1), i = Math.floor(x), f = x - i; return i + 1 < v.length ? v[i] * (1 - f) + v[i + 1] * f : v[i]; };
  return { I, LRA: v.length > 1 ? pct(0.95) - pct(0.10) : NaN, Mmax: lk(Math.max(...M)), Smax: lk(Math.max(...S)) };
}

// FFT（基数2、反復型）
function fftInPlace(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) {
      const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = i + k, b = a + len / 2;
      const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}
// トゥルーピーク：ピーク付近（サンプルピークの 85% 以上を含む）ブロックだけ、FFT で 16 倍に補間して最大値を取る
function truePeakFFT(x) {
  let sp = 0; for (const v of x) sp = Math.max(sp, Math.abs(v));
  const N = 4096, CORE = 2048, UP = 16, MARG = (N - CORE) / 2;
  let tp = sp;
  for (let s = MARG; s + CORE + MARG <= x.length; s += CORE) {
    let bm = 0; for (let i = s; i < s + CORE; i++) bm = Math.max(bm, Math.abs(x[i]));
    if (bm < 0.85 * sp) continue;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / N); re[i] = x[s - MARG + i] * (i < MARG / 2 || i >= N - MARG / 2 ? w : 1); }
    fftInPlace(re, im, false);
    const R = new Float64Array(N * UP), J = new Float64Array(N * UP);
    for (let k = 0; k < N / 2; k++) { R[k] = re[k]; J[k] = im[k]; }
    for (let k = 1; k < N / 2; k++) { R[N * UP - k] = re[N - k]; J[N * UP - k] = im[N - k]; }
    R[N / 2] = re[N / 2] / 2; J[N / 2] = im[N / 2] / 2; R[N * UP - N / 2] = re[N / 2] / 2; J[N * UP - N / 2] = im[N / 2] / 2;
    fftInPlace(R, J, true);
    for (let i = MARG * UP; i < (MARG + CORE) * UP; i++) tp = Math.max(tp, Math.abs(R[i] * UP));
  }
  return { sp, tp };
}

module.exports = { readWav, loudness, truePeakFFT };
