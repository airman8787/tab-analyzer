// 分離・修復・ピッチ編集（10.）の検証：STFT・調波/打楽器・センター・帯域分割・ハム・雑音・クリック・ピッチシフト・タイムストレッチ・音階補正・音符検出・MIDI
// 実行: node verification/edit-checks.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const A = loadDsp(["stftC", "istftC", "chunked", "hpssSeg", "editProcess", "humDetect", "pitchTrack", "detectNotes", "midiFile", "sepN", "notesJob"]);
const rows = [];
const check = (name, val, exp, tol, unit) => rows.push([name, val, exp, tol, unit, Number.isFinite(val) && Math.abs(val - exp) <= tol + 1e-9]);
const atLeast = (name, val, min, unit) => rows.push([name, val, min, 0, unit, Number.isFinite(val) && val >= min, ">="]);
const FS = 48000;
let sd = 7; const rnd = () => ((sd = sd * 16807 % 2147483647) / 2147483647 - .5);
const sine = (f, n, amp, ph = 0) => { const x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * f * i / FS + ph); return x; };
const add = (...a) => { const y = new Float32Array(a[0].length); for (const x of a) for (let i = 0; i < y.length; i++) y[i] += x[i]; return y; };
// 指定周波数の成分の振幅（区間 [s0, s1) で正弦・余弦に射影）
const amp = (x, f, s0 = 0, s1 = x.length) => { let c = 0, s = 0; for (let i = s0; i < s1; i++) { const p = 2 * Math.PI * f * i / FS; c += x[i] * Math.cos(p); s += x[i] * Math.sin(p); } return 2 * Math.hypot(c, s) / (s1 - s0); };
const db = v => 20 * Math.log10(Math.max(v, 1e-12));
const rms = (x, s0 = 0, s1 = x.length) => { let e = 0; for (let i = s0; i < s1; i++) e += x[i] * x[i]; return Math.sqrt(e / (s1 - s0)); };
const maxDiff = (a, b) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i])); return m; };
const medF0 = x => { const r = A.pitchTrack(x, FS, 60, 2000), a = Array.from(r.f0).filter(v => v > 0).sort((p, q) => p - q); return a[a.length >> 1]; };
const cents = (f, ref) => 1200 * Math.log2(f / ref);

// 1) STFT → 逆 STFT で元に戻る
{ const x = new Float32Array(FS); for (let i = 0; i < x.length; i++) x[i] = rnd(); const S = A.stftC(x, 2048, 512); check("STFT round trip max error", maxDiff(A.istftC(S), x), 0, 1e-5, ""); }
// 2) 区間ごとの処理：つなぎ目があっても一括処理と同じ
{ const n = FS * 25, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / FS) + (i % 12000 < 300 ? rnd() : 0) + 0.01 * rnd();
  const whole = A.hpssSeg([x], FS, { out: "harm" })[0], ch = A.editProcess({ chs: [x], fs: FS, op: "hpss", o: { out: "harm" } }).chs[0];
  check("chunked = whole-signal HPSS (max diff)", maxDiff(whole, ch), 0, 1e-4, ""); }
// 3) 調波・打楽器：持続音は調波側、短い雑音の連打は打楽器側。両方を足すと元に戻る
{ const n = FS * 6, ton = sine(440, n, 0.3), hit = new Float32Array(n); for (let i = 0; i < n; i++) if (i % 24000 < 240) hit[i] = rnd() * 1.5;
  const x = add(ton, hit), H = A.editProcess({ chs: [x], fs: FS, op: "hpss", o: { out: "harm" } }).chs[0], P = A.editProcess({ chs: [x], fs: FS, op: "hpss", o: { out: "perc" } }).chs[0];
  check("HPSS harm + perc = original", maxDiff(add(H, P), x), 0, 1e-4, "");
  check("HPSS 440 Hz tone kept in harmonic", db(amp(H, 440, FS, 5 * FS) / 0.3), 0, 1, "dB");
  let eh = 0, ep = 0; for (let i = FS; i < 5 * FS; i++) if (i % 24000 < 240) { eh += (H[i] - ton[i]) ** 2; ep += hit[i] ** 2; }
  atLeast("HPSS hits removed from harmonic", 10 * Math.log10(ep / eh), 10, "dB"); }
// 4) センター抽出：中央の 300 Hz だけ残り、左だけの 1 kHz・右だけの 2 kHz は消える
{ const n = FS * 4, v = sine(300, n, 0.3), L = add(v, sine(1000, n, 0.3)), R = add(v, sine(2000, n, 0.3));
  const C = A.editProcess({ chs: [L, R], fs: FS, op: "center", o: { out: "center", beta: 4, lo: 0, hi: 24000 } }).chs, S = A.editProcess({ chs: [L, R], fs: FS, op: "center", o: { out: "sides", beta: 4, lo: 0, hi: 24000 } }).chs;
  const s0 = FS / 2, s1 = n - FS / 2;
  check("center: centre tone level", db(amp(C[0], 300, s0, s1) / 0.3), 0, 0.5, "dB");
  atLeast("center: left-only tone suppressed", -db(amp(C[0], 1000, s0, s1) / 0.3), 30, "dB");
  atLeast("center: right-only tone suppressed", -db(amp(C[1], 2000, s0, s1) / 0.3), 30, "dB");
  atLeast("sides: centre tone suppressed", -db(amp(S[0], 300, s0, s1) / 0.3), 30, "dB");
  check("sides: left-only tone level", db(amp(S[0], 1000, s0, s1) / 0.3), 0, 0.5, "dB"); }
// 5) 帯域分割：低 + 中 + 高 = 元の音、100 Hz は低域だけに入る
{ const n = FS * 3, x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = rnd(); const o = { f1: 200, f2: 2000 };
  const [lo, mi, hi] = ["low", "mid", "high"].map(b => A.editProcess({ chs: [x], fs: FS, op: "band", o: Object.assign({ out: b }, o) }).chs[0]);
  check("band split low+mid+high = original", maxDiff(add(lo, mi, hi), x), 0, 1e-4, "");
  const s = sine(100, n, 0.5), sm = A.editProcess({ chs: [s], fs: FS, op: "band", o: Object.assign({ out: "mid" }, o) }).chs[0];
  atLeast("band split 100 Hz leak into mid", -db(amp(sm, 100, FS, 2 * FS) / 0.5), 40, "dB"); }
// 6) ハム除去：50 / 60 Hz を判定し、倍音ごと 30 dB 以上下げる。音楽の成分は変わらない
for (const f0 of [50, 60]) {
  const n = FS * 8, mus = add(sine(440, n, 0.2), sine(523.25, n, 0.1)), hum = new Float32Array(n); for (let h = 1; h <= 6; h++) { const s = sine(f0 * h, n, 0.02 / h); for (let i = 0; i < n; i++) hum[i] += s[i]; }
  const x = add(mus, hum); for (let i = 0; i < n; i++) x[i] += 0.001 * rnd();
  const r = A.editProcess({ chs: [x], fs: FS, op: "hum", o: { f0: "auto", nh: 8, bw: 2 } });
  check("hum: detected fundamental " + f0, r.f0, f0, 0, "Hz");
  let worst = Infinity; for (let h = 1; h <= 6; h++) worst = Math.min(worst, db(amp(x, f0 * h, FS, 7 * FS)) - db(amp(r.chs[0], f0 * h, FS, 7 * FS)));
  atLeast("hum " + f0 + " Hz: harmonics reduced (worst)", worst, 30, "dB");
  check("hum " + f0 + " Hz: 440 Hz level change", db(amp(r.chs[0], 440, FS, 7 * FS) / amp(x, 440, FS, 7 * FS)), 0, 0.1, "dB");
}
{ const x = add(sine(440, FS * 6, 0.2)); for (let i = 0; i < x.length; i++) x[i] += 0.01 * rnd(); check("hum: no hum → not detected", A.humDetect(x, FS).f0 === null ? 1 : 0, 1, 0, ""); }
// 7) 雑音の低減：最初の 2 秒は雑音だけ。雑音は 10 dB 以上下がり、1 kHz の音はほぼ変わらない
for (const mode of ["range", "auto"]) {
  const n = FS * 8, x = new Float32Array(n), tone = sine(1000, n, 0.1); for (let i = 0; i < n; i++) x[i] = (i >= 2 * FS ? tone[i] : 0) + 0.006 * rnd();
  const o = { red: 20, alpha: 2 }; if (mode === "range") { o.s0 = 0; o.s1 = 2 * FS; }
  const y = A.editProcess({ chs: [x], fs: FS, op: "denoise", o }).chs[0];
  atLeast("denoise (" + mode + "): noise reduced", db(rms(x, FS / 4, 1.75 * FS) / rms(y, FS / 4, 1.75 * FS)), 10, "dB");
  check("denoise (" + mode + "): tone level change", db(amp(y, 1000, 3 * FS, 7 * FS) / amp(x, 1000, 3 * FS, 7 * FS)), 0, 1, "dB");
}
// 8) クリック除去：20 個のクリックを検出して誤差を 20 dB 以上減らす。クリックのない音では何もしない
{ const n = FS * 6, clean = add(sine(330, n, 0.2), sine(880, n, 0.1), sine(1750, n, 0.05)); for (let i = 0; i < n; i++) clean[i] += 0.002 * rnd();
  const x = Float32Array.from(clean); for (let c = 0; c < 20; c++) { const p = Math.round((0.2 + c * 0.28) * FS), len = 1 + (c % 6) * 3; for (let j = 0; j < len; j++) x[p + j] += (c % 2 ? -1 : 1) * (0.3 + 0.2 * Math.abs(rnd())); }
  const r = A.editProcess({ chs: [x], fs: FS, op: "declick", o: { k: 8, maxMs: 2 } }), e0 = rms(add(x, clean.map(v => -v))), e1 = rms(add(r.chs[0], clean.map(v => -v)));
  check("declick: clicks found", r.clicks, 20, 0, "");
  atLeast("declick: error reduced", db(e0 / e1), 20, "dB");
  check("declick: clean signal untouched (detections)", A.editProcess({ chs: [clean], fs: FS, op: "declick", o: { k: 8, maxMs: 2 } }).clicks, 0, 0, "");
  // ドラム風のアタック（減衰する雑音の連打）はクリックと見なさず、その合間のクリックだけを直す（感度「高」でも）
  const dr = Float32Array.from(clean); for (let b = 0; b < 12; b++) { const s = Math.round((0.1 + b * 0.5) * FS); for (let i = 0; i < 2400; i++) dr[s + i] += rnd() * Math.exp(-i / 400) * 0.5; }
  for (let c = 0; c < 10; c++) { const p = Math.round((0.35 + c * 0.5) * FS); for (let j = 0; j < 3; j++) dr[p + j] += 0.4; }
  check("declick with drum hits (standard): detections = 10 clicks", A.editProcess({ chs: [dr], fs: FS, op: "declick", o: { k: 8, maxMs: 2 } }).clicks, 10, 0, "");
  // 感度「高」は見逃しを減らす代わりに、まれに余分な検出が出てもよい（10〜11 個）
  check("declick with drum hits (high): detections", A.editProcess({ chs: [dr], fs: FS, op: "declick", o: { k: 5, maxMs: 2 } }).clicks, 10.5, 0.5, ""); }
// 9) ピッチシフト：440 Hz → +12 半音で 880 Hz、−5 半音で 329.6 Hz。長さとレベルは変わらない
for (const semi of [12, -5, 0.5]) {
  const x = sine(440, FS * 3, 0.3), y = A.editProcess({ chs: [x], fs: FS, op: "shift", o: { semi } }).chs[0], exp = 440 * Math.pow(2, semi / 12);
  check("pitch shift " + semi + " st: frequency", cents(medF0(y), exp), 0, 3, "cent");
  check("pitch shift " + semi + " st: level", db(rms(y, FS / 2, 2.5 * FS) / rms(x, FS / 2, 2.5 * FS)), 0, 1, "dB");
  check("pitch shift " + semi + " st: length", y.length, x.length, 0, "samples");
}
// 10) タイムストレッチ：長さは倍率どおり、周波数は変わらない
for (const ratio of [1.5, 0.75]) {
  const x = sine(440, FS * 3, 0.3), y = A.editProcess({ chs: [x], fs: FS, op: "stretch", o: { ratio } }).chs[0];
  check("time stretch x" + ratio + ": length", y.length / x.length, ratio, 1e-4, "");
  check("time stretch x" + ratio + ": frequency", cents(medF0(y), 440), 0, 3, "cent");
  check("time stretch x" + ratio + ": level", db(rms(y, FS / 2, y.length - FS / 2) / 0.3 * Math.SQRT2), 0, 1, "dB");
}
// 11) 音階への補正（PSOLA）：450 Hz → 440 Hz、440 Hz はそのまま、C メジャーでは A# を使わず A に寄せる
const harm = (f, n) => { const x = new Float32Array(n); for (let h = 1; h <= 5; h++) { const s = sine(f * h, n, 0.25 / h); for (let i = 0; i < n; i++) x[i] += s[i]; } return x; };
{ const y = A.editProcess({ chs: [harm(450, FS * 2)], fs: FS, op: "tune", o: { amount: 1, speedMs: 0 } }).chs[0]; check("tune 450 Hz → A4 (chromatic)", cents(medF0(y), 440), 0, 5, "cent"); }
{ const x = harm(440, FS * 2), y = A.editProcess({ chs: [x], fs: FS, op: "tune", o: { amount: 1, speedMs: 0 } }).chs[0];
  check("tune 440 Hz unchanged: pitch", cents(medF0(y), 440), 0, 2, "cent"); check("tune 440 Hz unchanged: level", db(rms(y, FS / 4, 1.75 * FS) / rms(x, FS / 4, 1.75 * FS)), 0, 0.5, "dB"); }
{ const maj = [1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1], y = A.editProcess({ chs: [harm(455, FS * 2)], fs: FS, op: "tune", o: { amount: 1, speedMs: 0, scale: maj } }).chs[0];
  check("tune 455 Hz in C major → A4 (not A#)", cents(medF0(y), 440), 0, 5, "cent"); }
{ const y = A.editProcess({ chs: [harm(450, FS * 2)], fs: FS, op: "tune", o: { amount: 0.5, speedMs: 0 } }).chs[0]; check("tune 50% amount: half-way", cents(medF0(y), 450), cents(440, 450) / 2, 4, "cent"); }
// 12) 音符の検出：ピアノ風の音（倍音つき・減衰）の和音 C4 E4 G4 と単音 5 つ
const NOTES = [[60, 0.5, 1.5], [64, 0.5, 1.5], [67, 0.5, 1.5], [57, 2.0, 2.35], [59, 2.4, 2.75], [60, 2.8, 3.15], [62, 3.2, 3.55], [64, 3.6, 3.95]];
{ const n = FS * 4.5, x = new Float32Array(n);
  for (const [p, t0, t1] of NOTES) { const f = 440 * Math.pow(2, (p - 69) / 12), s0 = Math.round(t0 * FS), s1 = Math.round(t1 * FS); for (let i = s0; i < s1; i++) { const t = (i - s0) / FS, env = Math.exp(-t * 2.5) * Math.min(1, t / 0.005) * Math.min(1, (s1 - i) / (0.01 * FS)); let v = 0; for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; x[i] += 0.15 * env * v; } }
  for (let i = 0; i < n; i++) x[i] += 0.0005 * rnd();
  const r = A.detectNotes(x, FS, {}), used = new Set(); let hit = 0, onErr = 0;
  for (const [p, t0] of NOTES) { const k = r.notes.findIndex((m, i) => !used.has(i) && m.p === p && Math.abs(m.t0 - t0) < 0.06); if (k >= 0) { used.add(k); hit++; onErr = Math.max(onErr, Math.abs(r.notes[k].t0 - t0)); } }
  check("notes: detected (of " + NOTES.length + ")", hit, NOTES.length, 0, "");
  check("notes: extra (false) notes", r.notes.length - hit, 0, 1, "");
  check("notes: worst onset error", onErr * 1000, 0, 30, "ms");
  // 13) MIDI：ヘッダ・トラック長・ノートオンの数
  const mid = A.midiFile(r.notes, 120), txt = String.fromCharCode(...mid.slice(0, 4)) + String.fromCharCode(...mid.slice(14, 18)), tl = (mid[18] << 24) | (mid[19] << 16) | (mid[20] << 8) | mid[21];
  check("MIDI header MThd/MTrk", txt === "MThdMTrk" ? 1 : 0, 1, 0, ""); check("MIDI track length", tl, mid.length - 22, 0, "bytes");
  let on = 0; for (let i = 22; i < mid.length - 2; i++) if (mid[i] === 0x90) on++; check("MIDI note-on count", on, r.notes.length, 0, ""); }
// 12b) 混ざった音での音符検出（目安の確認）：ベース + 3 和音 × 6 小節に、ドラム風の雑音・センターのビブラート音（G4 付近）・ハムを重ねる
{ const n = FS * 12, x = new Float32Array(n), truth = [], CH = [[60, 64, 67], [65, 69, 72], [67, 71, 74]], BS = [48, 53, 55];
  const tone = (p, t0, amp) => { const f = 440 * Math.pow(2, (p - 69) / 12); for (let i = Math.round(t0 * FS); i < Math.round((t0 + 1.9) * FS); i++) { const t = i / FS - t0, env = Math.exp(-t * 1.5) * Math.min(1, t / 0.005); let v = 0; for (let h = 1; h <= 6; h++) v += Math.sin(2 * Math.PI * f * h * t) / h; x[i] += amp * env * v; } };
  for (let b = 0; b < 6; b++) { tone(BS[b % 3], b * 2, 0.12); truth.push([BS[b % 3], b * 2]); for (const p of CH[b % 3]) { tone(p, b * 2, 0.06); truth.push([p, b * 2]); } }
  for (let k = 0; k < 24; k++) { const s = Math.round(k * 0.5 * FS); for (let i = 0; i < 2400; i++) x[s + i] += rnd() * Math.exp(-i / 400) * 0.5; }
  let ph = 0; for (let i = 0; i < n; i++) { const t = i / FS, f = 392 * Math.pow(2, (Math.sin(2 * Math.PI * 5.5 * t) * 0.3 + 0.4) / 12); ph += 2 * Math.PI * f / FS; x[i] += 0.08 * (Math.sin(ph) + 0.4 * Math.sin(2 * ph)) * (t > 1 && t < 11 ? 1 : 0) + 0.01 * Math.sin(2 * Math.PI * 50 * t); }
  const r = A.notesJob({ x, fs: FS, harm: true, o: { lo: 36, hi: 96, maxPoly: 6, floorDb: -36, rel: 0.15 } });
  let hit = 0; for (const [p, t] of truth) if (r.notes.some(m => m.p === p && Math.abs(m.t0 - t) < 0.08)) hit++;
  const other = r.notes.filter(m => !truth.some(([p, t]) => m.p === p && m.t0 >= t - 0.08 && m.t0 < t + 1.95) && !(m.p >= 67 && m.p <= 68)).length;
  // 混ざった音では半分弱しか拾えない（オクターブで重なる音・減衰した音を落とす）。退行の検出用の基準線
  atLeast("notes in a mix: chord/bass notes found (of 24)", hit, 9, "");
  check("notes in a mix: notes that are neither chord nor voice", other, 0, 3, ""); }

for (const [n, v, e, t, u, ok, ge] of rows) console.log((ok ? "PASS" : "FAIL") + "  " + n.padEnd(44) + (Number.isFinite(v) ? (+v).toFixed(3) : String(v)).padStart(10) + " " + u + "   expected " + (ge ? ">= " + e : (+e).toFixed(3) + " ±" + (+(+t).toFixed(4))));
const passed = rows.filter(r => r[5]).length;
console.log(passed + "/" + rows.length + " passed");
process.exitCode = passed === rows.length ? 0 : 1;
