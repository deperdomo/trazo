// Check único de las reglas: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as G from './game.ts';

const DOT = [500, 500, 0];

/** Sala con n jugadores (p0 anfitrión y QM), ya en fase de dibujo. `fake` es el índice del falso artista entre los artistas. */
function playing(n = 5, fake = 0, word = 'Jirafa') {
  const room = G.newRoom('ABC123', 'p0', 't0', 'Jugador 0');
  for (let i = 1; i < n; i++) G.addPlayer(room, `p${i}`, `t${i}`, `Jugador ${i}`);
  assert.equal(G.startGame(room, 'p0', 5), undefined);
  assert.equal(G.setup(room, 'p0', 'Animales', word, 'p2', () => fake / (n - 1)), undefined);
  return room;
}

function drawAll(room: G.Room) {
  while (room.phase === 'drawing') assert.equal(G.addStroke(room, G.currentDrawer(room)!, DOT), undefined);
}

/** Vota cada artista a quien diga `targets` (por orden de asiento p1, p2, ...). */
function voteAll(room: G.Room, targets: string[]) {
  drawAll(room);
  assert.equal(G.openVote(room, room.qmId), undefined);
  const artists = room.players.filter((p) => p.id !== room.qmId);
  artists.forEach((p, i) => assert.equal(G.vote(room, p.id, targets[i]), undefined));
}

const scores = (room: G.Room) => Object.fromEntries(room.players.map((p) => [p.id, p.score]));

test('dos vueltas de un trazo por turno, empezando por quien elige el QM', () => {
  const room = playing();
  assert.deepEqual(room.order, ['p2', 'p3', 'p4', 'p1']);
  assert.equal(room.fakeId, 'p1');
  assert.equal(G.addStroke(room, 'p3', DOT), 'No es tu turno');
  assert.equal(G.addStroke(room, 'p0', DOT), 'No es tu turno'); // el QM no dibuja
  assert.equal(G.addStroke(room, 'p2', [1, 2]), 'Trazo no válido');
  assert.equal(G.addStroke(room, 'p2', [1, 2, 0, 1001, 5, 0]), 'Trazo no válido');
  drawAll(room);
  assert.equal(room.strokes.length, 8);
  assert.deepEqual(room.strokes.map((s) => s.id), ['p2', 'p3', 'p4', 'p1', 'p2', 'p3', 'p4', 'p1']);
  assert.equal(room.phase, 'voting');
});

test('nadie ve secretos que no le tocan', () => {
  const room = playing();
  const view = (id: string) => G.viewFor(room, id, 5);
  assert.equal(view('p1').card, 'X'); // falso artista
  assert.equal(view('p2').card, 'Jirafa');
  assert.equal(view('p0').fakeId, 'p1'); // solo el QM sabe quién es
  assert.equal(view('p2').fakeId, null);
  assert.equal(view('p1').word, null);
  assert.ok(!JSON.stringify(view('p1')).includes('Jirafa'));
  assert.ok(!JSON.stringify(view('p2')).includes('"t0"')); // los tokens no salen

  drawAll(room);
  G.openVote(room, 'p0');
  G.vote(room, 'p2', 'p1');
  assert.equal(view('p3').votes, null); // votos ocultos hasta el recuento
  assert.deepEqual(view('p3').voted, ['p2']);
});

test('pillado y falla: cada artista (no el falso ni el QM) gana 1 punto', () => {
  const room = playing();
  voteAll(room, ['p2', 'p1', 'p1', 'p1']);
  assert.equal(room.caught, true);
  assert.equal(room.phase, 'guess');
  assert.equal(G.submitGuess(room, 'p2', 'Jirafa'), 'Solo adivina el falso artista');
  assert.equal(G.submitGuess(room, 'p1', 'Cebra'), undefined);
  assert.equal(room.phase, 'guess'); // no coincide: decide el QM
  assert.equal(G.viewFor(room, 'p1', 5).word, 'Jirafa'); // ya no puede cambiar el intento
  assert.equal(G.submitGuess(room, 'p1', 'Jirafa'), 'Ahora no se puede adivinar'); // un solo intento
  assert.equal(G.judge(room, 'p0', false), undefined);
  assert.deepEqual(scores(room), { p0: 0, p1: 0, p2: 1, p3: 1, p4: 1 });
});

test('pillado pero acierta (sin mayúsculas ni tildes): falso artista y QM ganan 2', () => {
  const room = playing(5, 0, 'Camión');
  voteAll(room, ['p2', 'p1', 'p1', 'p1']);
  assert.equal(G.submitGuess(room, 'p1', '  camion '), undefined);
  assert.equal(room.guessed, true);
  assert.equal(room.phase, 'result');
  assert.deepEqual(scores(room), { p0: 2, p1: 2, p2: 0, p3: 0, p4: 0 });
});

test('empate en el máximo de votos: no pillado, falso artista y QM ganan 2', () => {
  const room = playing();
  voteAll(room, ['p2', 'p1', 'p1', 'p2']); // p1: 2 votos, p2: 2 votos
  assert.equal(room.caught, false);
  assert.equal(room.phase, 'result');
  assert.deepEqual(scores(room), { p0: 2, p1: 2, p2: 0, p3: 0, p4: 0 });
  assert.equal(G.isCaught({ a: 'f', b: 'f', c: 'x' }, 'f'), true);
  assert.equal(G.isCaught({ a: 'x', b: 'x', c: 'f' }, 'f'), false);
  assert.equal(G.isCaught({}, 'f'), false);
});

test('el QM rota al siguiente asiento y gana quien llega a 5 puntos', () => {
  const room = playing();
  voteAll(room, ['p2', 'p1', 'p1', 'p2']); // ronda 1: p0 (QM) y p1 (falso) +2
  assert.equal(G.nextRound(room, 'p3'), 'Solo el QM o el anfitrión pueden continuar');
  assert.equal(G.nextRound(room, 'p0'), undefined);
  assert.equal(room.qmId, 'p1');
  assert.equal(room.round, 2);
  assert.equal(room.strokes.length, 0);

  // Ronda 2: QM p1, falso p0, no pillado -> p0: 4, p1: 4
  assert.equal(G.setup(room, 'p1', 'Frutas', 'Pera', 'p0', () => 0), undefined);
  assert.equal(room.fakeId, 'p0');
  voteAll(room, ['p2', 'p0', 'p0', 'p2']);
  assert.deepEqual(room.winners, []);
  G.nextRound(room, 'p1');
  assert.equal(room.qmId, 'p2');

  // Ronda 3: QM p2, falso p0, no pillado -> p0: 6 gana
  G.setup(room, 'p2', 'Frutas', 'Uva', 'p0', () => 0);
  voteAll(room, ['p1', 'p0', 'p0', 'p1']);
  assert.deepEqual(scores(room), { p0: 6, p1: 4, p2: 2, p3: 0, p4: 0 });
  assert.deepEqual(room.winners, ['p0']);

  // Nueva partida: sala de espera con los puntos a cero
  G.nextRound(room, 'p0');
  assert.equal(room.phase, 'lobby');
  assert.deepEqual(scores(room), { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0 });
});

test('sala de espera: nombres, aforo y colores', () => {
  const room = G.newRoom('ABC123', 'p0', 't0', 'Ana');
  assert.equal(G.canJoin(room, 'ana'), 'Ese nombre ya está en la sala');
  assert.match(G.canJoin(room, 'A')!, /entre 2 y 20/);
  assert.equal(G.startGame(room, 'p0', 5), 'Hacen falta al menos 5 jugadores');
  for (let i = 1; i < 10; i++) G.addPlayer(room, `p${i}`, `t${i}`, `Jugador ${i}`);
  assert.equal(new Set(room.players.map((p) => p.color)).size, 10); // un rotulador distinto cada uno
  assert.equal(G.canJoin(room, 'Otro'), 'La sala está llena');
  assert.equal(G.setColor(room, 'p1', 0), 'Ese color ya está cogido');
  G.removePlayer(room, 'p9');
  assert.equal(G.setColor(room, 'p1', 9), undefined);
  G.startGame(room, 'p0', 5);
  assert.equal(G.canJoin(room, 'Tarde'), 'La partida ya ha empezado');
});

test('turno de un desconectado: el anfitrión puede saltarlo', () => {
  const room = playing();
  room.players.forEach((p) => (p.connected = true));
  assert.equal(G.skipTurn(room, 'p0'), 'Jugador 2 sigue conectado');
  room.players[2].connected = false;
  assert.equal(G.skipTurn(room, 'p3'), 'Solo el anfitrión puede saltar un turno');
  assert.equal(G.skipTurn(room, 'p0'), undefined);
  assert.equal(G.currentDrawer(room), 'p3');
});
