// Banda sonora sintetizada: música + efectos, sin samples ni dependencias. Genera assets/soundtrack.wav.
// Uso: node sound.mjs
import { writeFileSync } from 'node:fs';
import './timing.js';

const T = globalThis.T;
const SR = 44100;
const N = SR * T.end;
const out = new Float32Array(N);
const TAU = Math.PI * 2;
let seed = 7; // ruido determinista: el mismo audio en cada ejecución
const noise = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 31 - 1;
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

/** Suma una voz: fn(segundos desde su inicio, progreso 0..1) -> muestra. */
const play = (at, dur, gain, fn) => {
  const s = Math.round(at * SR);
  const n = Math.round(dur * SR);
  for (let i = 0; i < n && s + i < N; i++) out[s + i] += gain * fn(i / SR, i / n);
};

const sine = Math.sin;
const pluck = (ph) => Math.sin(ph) + 0.4 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph);
const fat = (ph) => Math.tanh(2.5 * Math.sin(ph));
const square = (ph) => Math.sign(Math.sin(ph));
const tone = (at, dur, gain, f, decay, shape = sine) =>
  play(at, dur, gain, (x) => shape(TAU * f * x) * Math.exp(-decay * x) * Math.min(1, x * 400));
const sweep = (at, dur, gain, f0, f1, decay) =>
  play(at, dur, gain, (x) => Math.sin(TAU * (f0 * x + ((f1 - f0) * x * x) / (2 * dur))) * Math.exp(-decay * x));
const hiss = (at, dur, gain, decay) => {
  let prev = 0;
  play(at, dur, gain, (x) => {
    const n = noise();
    const v = n - prev;
    prev = n;
    return v * Math.exp(-decay * x);
  });
};

const kick = (at, gain = 0.9) =>
  play(at, 0.3, gain, (x) => Math.sin(TAU * (48 * x + 3.9 * (1 - Math.exp(-28 * x)))) * Math.exp(-9 * x));
const clap = (at) => hiss(at, 0.18, 0.2, 22);
const hat = (at) => hiss(at, 0.05, 0.07, 70);
const pop = (at, i = 0) => sweep(at, 0.12, 0.28, 500 + 70 * i, 1000 + 140 * i, 25);
const tick = (at, f = 1200) => tone(at, 0.1, 0.35, f, 35);
const ding = (at) => [1318.5, 1975.5, 2637].forEach((f, i) => tone(at, 1.4, 0.16 / (i + 1), f, 4));
const buzz = (at) => [0, 0.16].forEach((d) => tone(at + d, 0.14, 0.16, 98, 3, square));
const hit = (at) => {
  kick(at, 1.2);
  tone(at, 0.9, 0.5, 40, 4);
  hiss(at, 0.5, 0.25, 8);
};
const whoosh = (at) => {
  let lp = 0;
  play(at - 0.3, 0.7, 0.4, (_, p) => {
    lp += (0.03 + 0.4 * Math.sin(Math.PI * p)) * (noise() - lp);
    return lp * Math.sin(Math.PI * p) ** 2;
  });
};
const scribble = (at, dur) => {
  let lp = 0;
  let prev = 0;
  play(at, dur, 0.5, (x, p) => {
    const n = noise();
    lp += 0.35 * (n - prev - lp);
    prev = n;
    return lp * (0.35 + 0.65 * Math.abs(Math.sin(TAU * 7 * x))) * Math.sqrt(Math.sin(Math.PI * p));
  });
};
const riser = (at, dur) => {
  let lp = 0;
  play(at, dur, 0.3, (_, p) => {
    lp += (0.02 + 0.5 * p * p) * (noise() - lp);
    return lp * p * p;
  });
  sweep(at, dur, 0.06, 200, 1600, -1.5);
};

// ── Música ───────────────────────────────────────────────────────────────────
// Do – La m – Fa – Sol, un acorde por compás: [bajo, ...notas del arpegio]
const CHORDS = [
  [36, 72, 76, 79, 84],
  [33, 69, 72, 76, 81],
  [41, 65, 69, 72, 77],
  [43, 67, 71, 74, 79],
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 2, 3, 1, 2];
const [drop, finale] = [T.cuts[0], T.cuts.at(-1)];

// Intro: colchón que crece, arpegio tras el golpe del título y subida hasta la entrada del ritmo.
[48, 60, 64, 67].forEach((n) => play(0, drop, 0.05, (x, p) => Math.sin(TAU * hz(n) * x) * p));
[60, 64, 67, 72, 76, 79, 84, 88].forEach((n, i) => tone(T.slam + i * 0.25, 0.5, 0.12, hz(n), 7, pluck));
riser(drop - 1, 1);

for (let bar = 0, t = drop; t < finale; bar++, t += 2) {
  const [root, ...notes] = CHORDS[bar % 4];
  const fill = T.cuts.includes(t + 2); // último compás de la escena: redoble en vez de bombo
  for (let s = 0; s < 16; s++) {
    const at = t + s * 0.125;
    tone(at, 0.25, 0.09, hz(notes[ARP[s]]), 10, pluck);
    if (s % 2 === 0) tone(at, 0.22, 0.26, hz(root + (s % 4 === 2 ? 12 : 0)), 6, fat);
    if (s % 4 === 0 && !(fill && s >= 12)) kick(at);
    if (s % 4 === 2) hat(at);
    if (s % 8 === 4) clap(at);
    if (fill && s >= 12) hiss(at, 0.1, 0.1 + 0.03 * (s - 12), 30);
  }
  // Colchón que "respira" con el compás
  notes.slice(0, 3).forEach((n) => play(t, 2, 0.035, (x, p) => Math.sin(TAU * hz(n - 12) * x) * Math.sin(Math.PI * p)));
}

// Final: acorde sostenido y arpegio hacia arriba.
[36, 48, 60, 64, 67, 72].forEach((n) => tone(finale, 4, 0.11, hz(n), 1.1, pluck));
[72, 76, 79, 84].forEach((n, i) => tone(finale + 0.25 + i * 0.25, 0.6, 0.12, hz(n), 6, pluck));

// ── Efectos, en los mismos tiempos que la animación ──────────────────────────
T.cuts.forEach(whoosh);
scribble(...T.logo);
scribble(...T.outroLogo);
[T.slam, T.fake, T.caught, finale, T.outroSlam].forEach(hit);
[T.slam, T.votes, T.outroSlam].forEach(ding);
[T.tiles, T.avatars, T.deal, T.flips, T.stars].forEach((list) => list.forEach(pop));
T.doubts.forEach((t, i) => pop(t, 3 - 2 * i));
pop(T.cta, 4);
T.strokes.forEach((t) => scribble(t, 0.4));
T.count.forEach((t, i) => tick(t, i === 2 ? 1600 : 1200));
buzz(T.wrong);

// ── Máster: saturación suave, fundido final y WAV mono de 16 bits ─────────────
const wav = Buffer.alloc(44 + N * 2);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + N * 2, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(SR, 24);
wav.writeUInt32LE(SR * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, (N - i) / SR);
  wav.writeInt16LE(Math.round(Math.tanh(out[i] * 1.2) * fade * 0.92 * 32767), 44 + i * 2);
}
writeFileSync(new URL('./assets/soundtrack.wav', import.meta.url), wav);
console.log(`assets/soundtrack.wav: ${T.end}s`);
