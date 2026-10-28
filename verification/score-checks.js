// 譜面（10. のコード・TAB譜、音符・MIDI の拍合わせ）の検証：拍・小節の頭・コード・単音の音符・押さえ方・TAB 譜・拍に合わせた MIDI
// 合成した曲（正解が分かっているもの）で、推定がどれだけ合うかを測る
// 実行: node verification/score-checks.js
"use strict";
const { loadDsp } = require("./lib/load-dsp");
const M = require("./lib/synth-music");
const A = loadDsp(["chordsJob", "chordName", "monoNotes", "notesJob", "tabFinger", "chordShape", "tabText", "tabJob", "beatPos", "midiFileBeats", "barOrigin"]);
const FS = M.FS, rows = [];
const check = (name, val, exp, tol, unit) => rows.push([name, val, exp, tol, unit, Number.isFinite(val) && Math.abs(val - exp) <= tol + 1e-9]);
const atLeast = (name, val, min, unit) => rows.push([name, val, min, 0, unit, Number.isFinite(val) && val >= min, ">="]);
const atMost = (name, val, max, unit) => rows.push([name, val, max, 0, unit, Number.isFinite(val) && val <= max, "<="]);
const rep = (P, k) => { const b = []; for (const c of P) for (let i = 0; i < k; i++) b.push(c); return b; };
const P1 = "C C G G Am Am F F C/E C/E F F G7 G7 C C Am Am Em Em F F G G Dm7 Dm7 G7 G7 CM7 CM7 Am Am".split(" ");
const P2 = "Am Am F F C C G G Dm Dm Am Am E7 E7 Am Am F F G G Em Em Am Am Dm7 Dm7 E E Am7 Am7 E7 E7".split(" ");
// 推定の拍の区間ごとに、中点の正解コードと比べる（simple はメジャー・マイナーだけで比べる）
function chordAcc(r, s, simple) {
  const sim = t => (t.startsWith("m") && t !== "M7") || t === "dim" ? "m" : "";
  let ok = 0, n = 0; const spb = s.beats[1] - s.beats[0];
  for (const c of r.chords) for (let i = c.b0; i < c.b1; i++) {
    const ti = Math.floor(((r.beats[i] + r.beats[i + 1]) / 2 - s.beats[0]) / spb); if (ti < 0 || ti >= s.chords.length) continue;
    const g = s.chords[ti]; n++;
    if (c.root === g.root && (simple ? sim(c.type) === sim(g.type) : c.type === g.type && c.bass === g.bass)) ok++;
  }
  return n ? ok / n : NaN;
}
const beatF = (est, truth) => { const tr = truth.slice(0, -1), R = tr.filter(b => est.some(e => Math.abs(e - b) < 0.07)).length / tr.length, P = Array.from(est).filter(e => tr.some(b => Math.abs(e - b) < 0.07)).length / est.length; return 2 * R * P / (R + P); };

// 1) 拍・テンポ・小節の頭（4/4 の 100・132 BPM、3/4 の 90 BPM）
for (const [bpm, off, meter] of [[100, 0.37, 4], [132, 1.1, 4], [90, 0.5, 3]]) {
  const P = meter === 4 ? rep("C F G C Am F G C".split(" "), 4) : rep("C F G C Am F G C".split(" "), 3);
  const s = M.song({ bpm, off, meter, chords: P.concat(P) }), r = A.chordsJob({ x: s.x, fs: FS, o: { meter } });
  check("beats " + bpm + " BPM " + meter + "/4: tempo", r.bpm, bpm, 0.5, "BPM");
  atLeast("beats " + bpm + " BPM " + meter + "/4: F-measure (±70 ms)", beatF(r.beats, s.beats), 0.95, "");
  const k = (r.beats[r.phase] - s.beats[0]) / (60 / bpm), d = Math.abs(k - Math.round(k / meter) * meter);
  check("beats " + bpm + " BPM " + meter + "/4: downbeat (beats off the bar line)", d, 0, 0.1, "beat");
}
// 2) コード：メジャー・マイナーで比べた正解率と、7th・オンコードまで含めた正解率
const songs = [
  ["piano", { chords: rep(P1, 2) }], ["piano, chord every 2 beats", { chords: rep(P2, 2), bpm: 84 }], ["guitar (Karplus-Strong)", { inst: "guitar", chords: rep(P1, 2) }],
  ["piano + melody", { melody: true, chords: rep(P1, 2) }], ["guitar + melody 120 BPM", { inst: "guitar", melody: true, chords: rep(P2, 2), bpm: 120 }],
  ["noise + melody, A4 = 446 Hz", { melody: true, noise: 0.02, a4: 446, chords: rep(P2, 2) }]];
// 合成音での実測（simple 0.88〜1.00、full 0.69〜1.00）から少し余裕をとった下限。退行の検出用
const minSimple = [0.97, 0.97, 0.9, 0.9, 0.9, 0.85], minFull = [0.95, 0.8, 0.7, 0.9, 0.65, 0.7];
songs.forEach(([nm, o], i) => {
  const s = M.song(Object.assign({ bpm: 100 }, o));
  const rs = A.chordsJob({ x: s.x, fs: FS, o: { vocab: "simple" } }), rf = A.chordsJob({ x: s.x, fs: FS, o: { vocab: "full" } });
  atLeast("chords " + nm + ": major/minor accuracy", chordAcc(rs, s, true), minSimple[i], "");
  atLeast("chords " + nm + ": exact (7th, slash) accuracy", chordAcc(rf, s, false), minFull[i], "");
  if (i === 0) { const ce = rf.chords.find(c => c.root === 0 && c.bass === 4); atLeast("chords piano: C/E written as a slash chord", ce ? 1 : 0, 1, ""); check("chords piano: key", rf.key.tonic === 0 && !rf.key.minor ? 1 : 0, 1, 0, ""); }
  if (i === 5) check("chords A4 = 446 Hz: tuning estimate", rf.key.cents, 1200 * Math.log2(446 / 440), 5, "cent");
});

// 3) 単音：音が重なって鳴るギターのメロディー（ハイハット入り）と、ドラム入りのベースライン（同じ音の連打を含む）
const mel = [[64, 0], [64, 0.5], [67, 1], [69, 1.5], [71, 2], [72, 2.25], [71, 2.5], [69, 3], [67, 3.5], [64, 4], [62, 4.5], [60, 5], [59, 5.5], [57, 6], [55, 6.5], [52, 7], [52, 7.25], [52, 7.5], [55, 8], [57, 8.5], [60, 9], [64, 9.5], [69, 10], [76, 10.5]];
const gx = new Float32Array(FS * 13); for (const [p, b] of mel) M.pluck(gx, p, 0.5 + b * 0.5, 0.45, 0.3); for (let b = 0; b < 22; b++) M.hat(gx, 0.5 + b * 0.5, 0.05);
const scoreNotes = (got, truth, tol) => { let hit = 0, err = 0; for (const [p, t] of truth) { const m = got.find(n => n.p === p && Math.abs(n.t0 - t) < tol); if (m) { hit++; err += Math.abs(m.t0 - t); } } return { hit, extra: got.filter(n => !truth.some(([p, t]) => p === n.p && Math.abs(n.t0 - t) < tol)).length, ms: 1000 * err / Math.max(1, hit) }; };
{ const r = A.monoNotes(gx, FS, { lo: 40, hi: 88 }), sc = scoreNotes(r.notes, mel.map(([p, b]) => [p, 0.5 + b * 0.5]), 0.04);
  atLeast("mono: overlapping guitar melody, notes found (of 24)", sc.hit, 22, ""); atMost("mono: guitar melody, extra notes", sc.extra, 2, ""); atMost("mono: guitar melody, mean onset error", sc.ms, 10, "ms"); }
const line = [28, 28, 40, 28, 31, 31, 43, 31, 33, 33, 45, 33, 35, 38, 40, 43, 36, 36, 48, 36, 38, 38, 50, 38, 40, 40, 52, 40, 47, 45, 43, 40];
const bx = new Float32Array(FS * 10); line.forEach((p, i) => M.bass(bx, p, 0.6 + i * 0.25, 0.2375, 0.3));
for (let b = 0; b < 16; b++) { const t = 0.6 + b * 0.5; if (b % 2 === 0) M.kick(bx, t, 0.4); else M.snare(bx, t, 0.3); M.hat(bx, t, 0.1); M.hat(bx, t + 0.25, 0.07); }
{ const r = A.monoNotes(bx, FS, { lo: 23, hi: 67 }), sc = scoreNotes(r.notes, line.map((p, i) => [p, 0.6 + i * 0.25]), 0.04);
  atLeast("mono: bass line with drums, notes found (of 32)", sc.hit, 31, ""); atMost("mono: bass line, extra notes", sc.extra, 1, ""); }

// 4) 押さえ方：定番の形と、探索した形が弾ける条件を満たすか
const G = [40, 45, 50, 55, 59, 64], T = M.TYPES;
const shape = (nm, open = G, capo = 0) => { const c = M.parse(nm); return A.chordShape({ root: c.root, type: c.type, bass: c.bass, tones: T[c.type].map(v => (c.root + v) % 12) }, open, capo, 22); };
const fmt = sh => sh ? sh.map(v => v < 0 ? "x" : v).join("") : "none";
{ const std = { C: "x32010", G: "320003", D: "xx0232", A: "x02220", E: "022100", Am: "x02210", Em: "022000", Dm: "xx0231", E7: "020100", G7: "320001", B7: "x21202", "C/E": "032010" };
  let ok = 0; for (const k in std) if (fmt(shape(k)) === std[k]) ok++; check("shapes: standard open chords (of " + Object.keys(std).length + ")", ok, Object.keys(std).length, 0, "");
  check("shapes: F is the barre 133211", fmt(shape("F")) === "133211" ? 1 : 0, 1, 0, "");
  check("shapes: F#m is the barre 244222", fmt(shape("F#m")) === "244222" ? 1 : 0, 1, 0, "");
  // 探索した形：構成音だけ・最低音が根音（オンコードの音）・必要な音がそろう・広がり 3 フレット以内
  let valid = 0, tot = 0;
  for (const r of M.NAMES) for (const ty of ["", "m", "7", "m7", "M7"]) for (const capo of [0, 3]) {
    const c = M.parse(r + ty), tones = T[ty].map(v => (c.root + v) % 12), sh = A.chordShape({ root: c.root, type: ty, bass: c.root, tones }, [38, 45, 50, 55, 59, 64], capo, 22); tot++;
    if (!sh) continue; const snd = sh.map((f, s) => f >= 0 ? [38, 45, 50, 55, 59, 64][s] + capo + f : -1).filter(p => p >= 0), fr = sh.filter(f => f > 0);
    const need = tones.filter((t, i) => !(tones.length >= 4 && i === 2));
    if (snd.length >= 4 && snd.every(p => tones.includes(p % 12)) && snd[0] % 12 === c.root && need.every(t => snd.some(p => p % 12 === t)) && (!fr.length || Math.max(...fr) - Math.min(...fr) <= 3)) valid++;
  }
  check("shapes: searched shapes, drop D, capo 0/3 (valid of " + tot + ")", valid, tot, 0, ""); }

// 5) TAB の押さえ方：音の高さが正しく、手の移動が小さい
{ const sc = [48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65, 67, 69, 71, 72];
  for (const capo of [0, 2]) {
    const ev = sc.map((p, i) => ({ slot: i * 2, t: i * 0.25, ps: [p + capo] })), fi = A.tabFinger(ev, G, capo, 22);
    let ok = 0, maxF = 0, jump = 0, prev = null;
    fi.forEach((f, i) => { const s = f.frets.findIndex(v => v >= 0); if (s >= 0 && G[s] + capo + f.frets[s] === sc[i] + capo) ok++; const fr = f.frets[s]; maxF = Math.max(maxF, fr); if (prev != null && fr > 0 && prev > 0) jump = Math.max(jump, Math.abs(fr - prev)); if (fr > 0) prev = fr; });
    check("tab: C major scale, capo " + capo + ", correct pitch (of 15)", ok, 15, 0, ""); atMost("tab: C major scale, capo " + capo + ", highest fret", maxF, 8, ""); atMost("tab: C major scale, capo " + capo + ", largest jump", jump, 5, "fret");
  }
  const chords = [[48, 52, 55, 60, 64], [43, 47, 50, 55, 59, 67], [45, 52, 57, 60, 64], [41, 48, 53, 57, 60, 65], [40, 47, 52, 55, 59, 64]];
  const fi = A.tabFinger(chords.map((ps, i) => ({ slot: i * 16, t: i * 2, ps })), G, 0, 22);
  let ok = 0; fi.forEach((f, i) => { const got = f.frets.map((v, s) => v >= 0 ? G[s] + v : -1).filter(p => p >= 0).sort((a, b) => a - b); const fr = f.frets.filter(v => v > 0); if (got.join() === chords[i].slice().sort((a, b) => a - b).join() && (!fr.length || Math.max(...fr) - Math.min(...fr) <= 4)) ok++; });
  check("tab: chords C G Am F Em, all notes on distinct strings (of 5)", ok, 5, 0, "");
  const fo = A.tabFinger([{ slot: 0, t: 0, ps: [30, 64] }, { slot: 4, t: 0.25, ps: [95] }], G, 0, 22);
  check("tab: notes below/above the range are dropped", fo.reduce((a, f) => a + f.drop.length, 0), 2, 0, "");
  // テキスト：各行の長さがそろい、フレットの数字が正しい弦の行にある
  const txt = A.tabText(A.tabFinger([{ slot: 0, t: 0, ps: [48] }, { slot: 4, t: 0.25, ps: [64] }, { slot: 20, t: 1.25, ps: [55] }], G, 0, 22), G, { grid: 4, meter: 4, barsPerLine: 2, chords: [{ slot: 0, name: "C" }] });
  const ln = txt.split("\n"), st = ln.filter(l => /^[eBGDAE]\|/.test(l));
  check("tab text: six string lines with equal length", st.length === 6 && st.every(l => l.length === st[0].length) ? 1 : 0, 1, 0, "");
  check("tab text: C3 on the A string 3rd fret, E4 on the open e string, G3 on the open G string", (/^A\|3-/.test(st[4]) && /^e\|-{8}0/.test(st[0]) && /^G\|-{32}\|-{8}0/.test(st[2])) ? 1 : 0, 1, 0, "");
  check("tab text: chord name above the first bar", /^ +C/.test(ln[0]) ? 1 : 0, 1, 0, ""); }

// 6) 通し：ギターのメロディーから TAB 譜（拍・コード・音符・押さえ方）
{ const r = A.tabJob({ x: gx, fs: FS, o: { open: G, capo: 0, maxFret: 22, mode: "mono", grid: 4, barsPerLine: 2 } });
  let ok = 0; for (const f of r.fing) { const s = f.frets.findIndex(v => v >= 0); if (s >= 0 && r.notes.some(n => n.p === G[s] + f.frets[s])) ok++; }
  atLeast("tab job: guitar melody, notes", r.notes.length, 22, ""); check("tab job: every TAB note matches a detected pitch", ok, r.fing.length, 0, "");
  check("tab job: 120 BPM", r.chords.bpm, 120, 1, "BPM"); }

// 7) 拍に合わせた MIDI：テンポの揺れ（±4%）を拍ごとのテンポで書き、音符を 16 分に揃えたとき、テンポを積分した時刻が元の時刻に戻る
{ const beats = []; let t = 0.5; for (let i = 0; i < 40; i++) { beats.push(t); t += 0.5 * (1 + 0.04 * Math.sin(i / 3)); }
  const notes = []; for (let k = 0; k < 120; k++) { const p = k * 0.25, t0 = A.beatPos ? beats[Math.floor(p)] + (p - Math.floor(p)) * (beats[Math.floor(p) + 1] - beats[Math.floor(p)]) : 0; notes.push({ p: 60 + k % 12, t0: t0 + 0.008 * Math.sin(k), t1: t0 + 0.1, v: 90 }); }
  const origin = A.barOrigin(beats, 0, 4, notes[0].t0), mid = A.midiFileBeats(notes, beats, { meter: 4, grid: 4, origin });
  // 読み戻し
  const d = Array.from(mid); let i = 22, tick = 0, tempo = [[0, 500000]], on = [];
  const vlq = () => { let v = 0, b; do { b = d[i++]; v = (v << 7) | (b & 127); } while (b & 128); return v; };
  while (i < d.length) { tick += vlq(); const st = d[i++]; if (st === 0xff) { const ty = d[i++], len = vlq(); if (ty === 0x51) tempo.push([tick, (d[i] << 16) | (d[i + 1] << 8) | d[i + 2]]); i += len; } else { const a = d[i++], b = d[i++]; if ((st & 0xf0) === 0x90 && b > 0) on.push(tick); } }
  const sec = tk => { let s = beats[0], last = 0, us = 500000; for (const [t0, u] of tempo) { if (t0 > tk) break; s += (t0 - last) / 480 * us / 1e6; last = t0; us = u; } return s + (tk - last) / 480 * us / 1e6; };
  check("midi: note-on count", on.length, 120, 0, ""); check("midi: ticks on the 16th grid", on.every(t => t % 120 === 0) ? 1 : 0, 1, 0, "");
  let mx = 0; on.forEach((tk, k) => { mx = Math.max(mx, Math.abs(sec(tk) - (notes[k].t0 - 0.008 * Math.sin(k)))); });
  atMost("midi: time from the tempo map vs grid time (max)", mx * 1000, 2, "ms");
  check("midi: tempo events (one per beat)", tempo.length - 1, beats.length, 1, ""); }
// 8) 音符・MIDI の単音モードは拍と小節の頭も返す
{ const r = A.notesJob({ x: gx, fs: FS, beats: true, o: { mode: "mono", lo: 40, hi: 88, meter: 4 } });
  atLeast("notes job (mono): notes", r.notes.length, 22, ""); check("notes job: beats returned at 120 BPM", r.bpmBeats, 120, 1, "BPM"); }

for (const [n, v, e, t, u, ok, ge] of rows) console.log((ok ? "PASS" : "FAIL") + "  " + n.padEnd(76) + (Number.isFinite(v) ? (+v).toFixed(3) : String(v)).padStart(9) + " " + u + "   expected " + (ge ? ge + " " + e : (+e).toFixed(3) + " ±" + (+(+t).toFixed(4))));
const passed = rows.filter(r => r[5]).length;
console.log(passed + "/" + rows.length + " passed");
process.exitCode = passed === rows.length ? 0 : 1;
