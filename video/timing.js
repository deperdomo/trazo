// Tiempos (en segundos) compartidos por la animación (index.html) y la banda sonora (sound.mjs).
// La música va a 120 BPM: un pulso cada 0,5 s y un compás cada 2 s. Los cortes caen en inicio de compás.
const seq = (t, step, n) => Array.from({ length: n }, (_, i) => +(t + step * i).toFixed(3));
globalThis.T = {
  end: 40, // = data-duration de #root en index.html
  cuts: [4, 10, 16, 24, 30, 36],
  logo: [0.2, 1.1], // [inicio, duración] del garabato
  slam: 1.5,
  tiles: seq(5, 0.15, 6),
  avatars: seq(6, 0.2, 6),
  deal: seq(10.75, 0.125, 5),
  flips: seq(11.75, 0.25, 4),
  fake: 13,
  strokes: seq(17, 0.5, 10),
  doubts: [22.25, 22.75],
  count: seq(24.5, 0.5, 3),
  votes: 26,
  caught: 27.5,
  guess: 31,
  wrong: 31.75,
  stars: seq(33, 0.25, 5),
  outroLogo: [36.2, 0.8],
  outroSlam: 37,
  cta: 37.5,
};
