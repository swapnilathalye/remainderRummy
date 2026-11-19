// A websocket server for online tables.
//
// It imports the very same engine the app uses, so the rules cannot drift
// between client and server. The server is the only writer of state: clients
// send actions and receive events that have been redacted for them, which is
// what stops a modified client from reading anyone else's hand.
//
//   npm install && npm start
//   then point the app at ws://localhost:8787
//
// What is here: rooms, seating, bots filling empty seats, per-player
// redaction, action validation, reconnection by player id.
// What is not, and would matter in production: accounts, a database, rate
// limiting, TLS, and a turn timer that acts for a player who walks away.

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createGame, apply, isRuleError } from '../www/js/core/engine.js';
import { redactEvent, viewFor } from '../www/js/core/protocol.js';
import { botAction } from '../www/js/ai/bot.js';
import { randomSeed } from '../www/js/core/rng.js';
import { deckCountFor } from '../www/js/core/rules.js';

const PORT = Number(process.env.PORT || 8787);
const BOT_NAMES = ['Mira', 'Tomás', 'Aiko', 'Devi', 'Noor'];
const TURN_PACE = 700;

const rooms = new Map();

function getRoom (name) {
  let room = rooms.get(name);
  if (!room) {
    room = { name, seats: [], sockets: new Map(), state: null, options: null, timer: null };
    rooms.set(name, room);
  }
  return room;
}

function send (socket, message) {
  if (socket.readyState === 1) socket.send(JSON.stringify(message));
}

function broadcastLobby (room) {
  const players = room.seats.map(s => ({ id: s.id, name: s.name, bot: s.bot }));
  for (const socket of room.sockets.values()) {
    send(socket, { t: 'lobby', room: room.name, players, started: !!room.state });
  }
}

function broadcastEvents (room, events) {
  for (const seat of room.seats) {
    const socket = room.sockets.get(seat.id);
    if (!socket) continue;
    const mine = events.map(e => redactEvent(room.state, e, seat.id)).filter(Boolean);
    if (mine.length) send(socket, { t: 'events', events: mine });
    send(socket, { t: 'view', view: viewFor(room.state, seat.id) });
  }
}

function startGame (room, options) {
  const wanted = options.playerCount || room.seats.length;
  for (let i = room.seats.length; i < wanted; i++) {
    room.seats.push({ id: 'bot-' + randomUUID().slice(0, 8), name: BOT_NAMES[i - 1] || ('Bot ' + i), bot: true });
  }
  room.options = options;
  room.state = createGame({
    seed: randomSeed(),
    players: room.seats.map(s => ({ id: s.id, name: s.name, bot: s.bot })),
    options: Object.assign({ deckCount: deckCountFor(room.seats.length) }, options)
  });
  step(room, { type: 'start' }, room.seats[0].id);
}

function step (room, action, playerId) {
  let events;
  try {
    events = apply(room.state, action, playerId);
  } catch (err) {
    if (isRuleError(err)) {
      const socket = room.sockets.get(playerId);
      if (socket) send(socket, { t: 'error', message: err.message });
      return;
    }
    throw err;
  }
  broadcastEvents(room, events);
  scheduleBot(room);
}

// If the table is waiting on a bot, or on a human who has disconnected, play
// for them after a pause.
function scheduleBot (room) {
  clearTimeout(room.timer);
  const awaiting = room.state && room.state.awaiting;
  if (!awaiting) return;

  if (awaiting.player === null) {
    // Round over: move on by itself so one idle player cannot stall the table.
    room.timer = setTimeout(() => step(room, { type: 'next' }, room.seats[0].id), 6000);
    return;
  }
  const seat = room.seats.find(s => s.id === awaiting.player);
  if (!seat) return;
  const connected = room.sockets.has(seat.id);
  if (!seat.bot && connected) return;

  room.timer = setTimeout(() => {
    const action = botAction(viewFor(room.state, seat.id));
    if (action) step(room, action, seat.id);
  }, seat.bot ? TURN_PACE : 15000);
}

const wss = new WebSocketServer({ port: PORT });

wss.on('connection', socket => {
  let room = null;
  let playerId = null;

  socket.on('message', raw => {
    let message;
    try { message = JSON.parse(raw); } catch (err) { return; }

    if (message.t === 'ping') return send(socket, { t: 'pong' });

    if (message.t === 'hello') {
      room = getRoom(message.room || 'table');
      // Reconnecting players keep their seat and their hand.
      const existing = message.playerId && room.seats.find(s => s.id === message.playerId);
      if (existing) {
        playerId = existing.id;
      } else {
        if (room.state) return send(socket, { t: 'error', message: 'That table has already started' });
        if (room.seats.length >= 6) return send(socket, { t: 'error', message: 'That table is full' });
        playerId = randomUUID();
        // Two people called "Player" at one table is confusing, so number them.
        let name = (message.name || 'Player').slice(0, 16);
        if (room.seats.some(s => s.name === name)) name = name + ' ' + (room.seats.length + 1);
        room.seats.push({ id: playerId, name, bot: false });
      }
      room.sockets.set(playerId, socket);
      send(socket, {
        t: 'welcome',
        you: playerId,
        room: room.name,
        players: room.seats.map(s => ({ id: s.id, name: s.name, bot: s.bot }))
      });
      broadcastLobby(room);
      if (room.state) {
        send(socket, { t: 'view', view: viewFor(room.state, playerId) });
        scheduleBot(room);
      }
      return;
    }

    if (!room || !playerId) return;

    if (message.t === 'start') {
      if (!room.state) {
        startGame(room, message.options || {});
        broadcastLobby(room);
      }
      return;
    }
    if (message.t === 'action') {
      if (!room.state) return send(socket, { t: 'error', message: 'The game has not started' });
      step(room, message.action, playerId);
    }
  });

  socket.on('close', () => {
    if (!room || !playerId) return;
    room.sockets.delete(playerId);
    // The seat stays, so the player can come back to the same hand.
    scheduleBot(room);
    if (room.sockets.size === 0 && !room.state) rooms.delete(room.name);
  });
});

console.log('Remainder Rummy server listening on ws://localhost:' + PORT);
