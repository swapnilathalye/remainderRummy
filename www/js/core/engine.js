// The game as a state machine.
//
// Two functions matter: createGame() makes a state object, and apply() takes an
// action from one player and returns the events that follow. The state is plain
// JSON, the only randomness comes from rng.js, and nothing in here knows about
// the screen, the network or elapsed time.
//
// That shape is deliberate. Today the state lives in the browser tab and the
// opponents are bots in the same process. To put the game online you move this
// file to a server, keep it as the only writer of state, and let each client
// send actions and receive the events that protocol.js has redacted for them.
// None of the rules need to change for that to happen.

import { hashSeed, shuffleInPlace, randomInt } from './rng.js';
import {
  DEFAULT_OPTIONS, DIVISORS, makeDeck, deckCountFor,
  isGoingOut, loosePoints, handCost
} from './rules.js';

export const ENGINE_VERSION = 1;

class RuleError extends Error {}
export function isRuleError (err) { return err instanceof RuleError; }
function reject (message) { throw new RuleError(message); }

// ---------------------------------------------------------------- creation

export function createGame (config) {
  const options = Object.assign({}, DEFAULT_OPTIONS, config.options || {});
  const players = config.players.map(p => ({
    id: p.id, name: p.name, bot: !!p.bot, score: 0
  }));
  if (players.length < 2 || players.length > 6) reject('A table seats two to six');

  const deckCount = options.deckCount || deckCountFor(players.length);
  const deck = makeDeck(deckCount);
  const cards = {};
  for (const card of deck) cards[card.id] = { value: card.value, suit: card.suit };

  const state = {
    version: ENGINE_VERSION,
    seed: config.seed,
    rngState: hashSeed(config.seed),
    options: Object.assign({}, options, { deckCount }),
    players,
    cards,
    deckIds: deck.map(c => c.id),
    phase: 'lobby',
    round: 0,
    turn: 0,
    starter: 0,
    current: 0,
    divisor: options.openingDivisor,
    pendingDivisor: 0,
    hands: {},
    stock: [],
    discard: [],
    justTook: null,
    awaiting: null,
    finished: false
  };
  state.shiftEvery = players.length * options.lapsPerDivisor;
  state.turnCap = state.shiftEvery * options.divisorWindows;
  for (const p of players) state.hands[p.id] = [];
  return state;
}

export function cardOf (state, id) {
  const c = state.cards[id];
  return { id, value: c.value, suit: c.suit };
}
export function cardsOf (state, ids) {
  return ids.map(id => cardOf(state, id));
}

// ------------------------------------------------------------ small helpers

function playerIndex (state, id) {
  return state.players.findIndex(p => p.id === id);
}
function currentPlayer (state) {
  return state.players[state.current];
}
function onAClock (state) {
  const m = state.options.shiftMode;
  return m === 'timed' || m === 'hidden' || m === 'biggest';
}
function pickDifferentDivisor (state, from) {
  const choices = DIVISORS.filter(d => d !== from);
  return choices[randomInt(state, choices.length)];
}
function setDivisor (state, divisor) {
  state.divisor = divisor;
  // One step of lookahead is always generated. Whether a player is allowed to
  // see it is protocol.js's problem, not the engine's.
  state.pendingDivisor = pickDifferentDivisor(state, divisor);
}
function moreRoundsAfterThis (state) {
  if (state.options.target) {
    return !state.players.some(p => p.score >= state.options.target);
  }
  return state.round < state.options.rounds;
}

// ------------------------------------------------------------------ dealing

function beginRound (state, events) {
  state.round += 1;
  state.turn = 0;
  state.justTook = null;
  state.phase = 'playing';
  state.starter = (state.round - 1) % state.players.length;
  state.current = state.starter;
  setDivisor(state, state.round === 1 ? state.options.openingDivisor : state.pendingDivisor);

  const ids = shuffleInPlace(state, state.deckIds.slice());
  state.stock = ids;
  state.discard = [];
  for (const p of state.players) state.hands[p.id] = [];

  events.push({
    t: 'roundStart',
    round: state.round,
    divisor: state.divisor,
    pending: state.pendingDivisor,
    starter: state.players[state.starter].id,
    stock: state.stock.length
  });

  const n = state.players.length;
  for (let k = 0; k < state.options.handSize; k++) {
    for (let j = 0; j < n; j++) {
      const player = state.players[(state.starter + j) % n];
      const id = state.stock.pop();
      state.hands[player.id].push(id);
      events.push({ t: 'deal', player: player.id, card: cardOf(state, id), index: k });
    }
  }
  const up = state.stock.pop();
  state.discard.push(up);
  events.push({ t: 'upcard', card: cardOf(state, up), stock: state.stock.length });

  state.awaiting = { player: currentPlayer(state).id, kind: 'draw' };
}

function reshuffleDiscard (state, events) {
  if (state.discard.length <= 1) return false;
  const top = state.discard.pop();
  const rest = shuffleInPlace(state, state.discard.slice());
  state.discard = [top];
  state.stock = rest;
  events.push({ t: 'reshuffle', stock: state.stock.length });
  return true;
}

// ------------------------------------------------------------------ scoring

function finishRound (state, events, winnerId) {
  const divisor = state.divisor;
  const results = state.players.map(p => {
    const hand = state.hands[p.id];
    const points = p.id === winnerId ? 0 : loosePoints(cardsOf(state, hand), divisor);
    p.score += points;
    return { id: p.id, points, total: p.score, hand: cardsOf(state, hand) };
  });
  state.phase = 'roundEnd';
  state.lastWinner = winnerId;
  state.awaiting = { player: null, kind: 'next' };
  events.push({ t: 'roundEnd', winner: winnerId, divisor, results, more: moreRoundsAfterThis(state) });
}

function finishGame (state, events) {
  state.phase = 'gameEnd';
  state.finished = true;
  state.awaiting = null;
  const standings = state.players
    .map(p => ({ id: p.id, name: p.name, score: p.score }))
    .sort((a, b) => a.score - b.score);
  events.push({ t: 'gameEnd', standings });
}

// -------------------------------------------------------------- turn engine

// Who has to choose the next divisor under the "biggest hand" rule: whoever is
// carrying the most loose points right now, earliest seat winning a tie.
function biggestHandPlayer (state) {
  let best = -1;
  let who = state.players[0];
  for (const p of state.players) {
    const v = loosePoints(cardsOf(state, state.hands[p.id]), state.divisor);
    if (v > best) { best = v; who = p; }
  }
  return who;
}

function shiftDue (state, discarded) {
  const mode = state.options.shiftMode;
  if (mode === 'fixed') return null;
  if (mode === 'king') return discarded && discarded.value === 13 ? 'king' : null;
  if (!onAClock(state)) return null;
  return state.turn > 0 && state.turn % state.shiftEvery === 0 ? 'clock' : null;
}

function applyShift (state, events, divisor, reason, byId) {
  setDivisor(state, divisor);
  events.push({
    t: 'shift', divisor, pending: state.pendingDivisor, reason, by: byId || null
  });
}

function advanceTurn (state, events) {
  state.current = (state.current + 1) % state.players.length;
  state.justTook = null;
  state.phase = 'playing';
  state.awaiting = { player: currentPlayer(state).id, kind: 'draw' };
}

function afterDiscard (state, events, discarded) {
  const actor = currentPlayer(state);
  if (isGoingOut(cardsOf(state, state.hands[actor.id]), state.divisor)) {
    finishRound(state, events, actor.id);
    return;
  }
  state.turn += 1;
  if (state.turn >= state.turnCap) {
    finishRound(state, events, null);
    return;
  }
  const reason = shiftDue(state, discarded);
  if (reason) {
    if (state.options.shiftMode === 'biggest') {
      const chooser = biggestHandPlayer(state);
      state.phase = 'choosing';
      state.awaiting = {
        player: chooser.id,
        kind: 'choice',
        options: DIVISORS.filter(d => d !== state.divisor)
      };
      events.push({ t: 'choiceNeeded', player: chooser.id, options: state.awaiting.options });
      return;
    }
    applyShift(state, events, state.pendingDivisor, reason, null);
  }
  advanceTurn(state, events);
}

// ------------------------------------------------------------------ actions

export function legalActions (state, playerId) {
  const a = state.awaiting;
  if (!a) return [];
  if (a.player !== null && a.player !== playerId) return [];
  if (a.kind === 'draw') {
    const kinds = ['stock'];
    if (state.discard.length) kinds.push('discard');
    return [{ type: 'draw', from: kinds }];
  }
  if (a.kind === 'discard') {
    return [{ type: 'discard', cards: state.hands[playerId].filter(id => id !== state.justTook) }];
  }
  if (a.kind === 'choice') return [{ type: 'choose', divisors: a.options }];
  if (a.kind === 'next') return [{ type: 'next' }];
  return [];
}

// The single entry point. Returns the events produced, and throws a RuleError
// if the action was not this player's to make.
export function apply (state, action, playerId) {
  const events = [];
  const awaiting = state.awaiting;

  if (action.type === 'start') {
    if (state.phase !== 'lobby') reject('The game has already started');
    events.push({
      t: 'gameStart',
      players: state.players.map(p => ({ id: p.id, name: p.name, bot: p.bot })),
      options: state.options
    });
    beginRound(state, events);
    return close(state, events);
  }

  if (!awaiting) reject('Nothing to do');
  if (awaiting.player !== null && awaiting.player !== playerId) {
    reject('It is not your turn');
  }

  switch (action.type) {
    case 'draw': {
      if (awaiting.kind !== 'draw') reject('You cannot draw now');
      let id;
      if (action.from === 'discard') {
        if (!state.discard.length) reject('The discard pile is empty');
        id = state.discard.pop();
        state.justTook = id;
      } else {
        if (!state.stock.length && !reshuffleDiscard(state, events)) {
          finishRound(state, events, null);
          return close(state, events);
        }
        id = state.stock.pop();
        state.justTook = null;
      }
      state.hands[playerId].push(id);
      state.awaiting = { player: playerId, kind: 'discard' };
      events.push({
        t: 'draw',
        player: playerId,
        from: action.from === 'discard' ? 'discard' : 'stock',
        card: cardOf(state, id),
        stock: state.stock.length
      });
      return close(state, events);
    }

    case 'discard': {
      if (awaiting.kind !== 'discard') reject('You cannot discard now');
      const hand = state.hands[playerId];
      const at = hand.indexOf(action.card);
      if (at < 0) reject('You are not holding that card');
      if (action.card === state.justTook) reject('That card was just taken from the pile');
      hand.splice(at, 1);
      state.discard.push(action.card);
      const card = cardOf(state, action.card);
      events.push({ t: 'discard', player: playerId, card });
      afterDiscard(state, events, card);
      return close(state, events);
    }

    case 'choose': {
      if (awaiting.kind !== 'choice') reject('No divisor to choose');
      if (awaiting.options.indexOf(action.divisor) < 0) reject('That divisor is not on offer');
      applyShift(state, events, action.divisor, 'choice', playerId);
      advanceTurn(state, events);
      return close(state, events);
    }

    case 'next': {
      if (awaiting.kind !== 'next') reject('The round is still running');
      if (moreRoundsAfterThis(state)) beginRound(state, events);
      else finishGame(state, events);
      return close(state, events);
    }

    default:
      reject('Unknown action: ' + action.type);
  }
}

// Every batch of events ends by saying who the table is waiting on, so a client
// never has to infer it.
function close (state, events) {
  if (state.awaiting) {
    events.push({
      t: 'await',
      player: state.awaiting.player,
      kind: state.awaiting.kind,
      options: state.awaiting.options || null,
      justTook: state.justTook,
      divisor: state.divisor,
      turn: state.turn,
      turnsLeft: Math.max(0, state.turnCap - state.turn),
      turnsToShift: state.shiftEvery - (state.turn % state.shiftEvery)
    });
  }
  return events;
}
