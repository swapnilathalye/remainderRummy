// What each player is allowed to know.
//
// In a card game you cannot simply broadcast the state: everyone would see
// everyone else's hand. So the engine keeps the whole truth and this file
// decides what one player gets to see of it. The local game redacts too, even
// though it would be harmless not to, because it means the online version will
// not be the first time the code has run this way.

import { cardsOf } from './engine.js';

export const PROTOCOL_VERSION = 1;

function hidesNextDivisor (state) {
  return state.options.shiftMode === 'hidden';
}

// A single event, as player `viewerId` is allowed to receive it.
// Returns null when the event should not reach that player at all.
export function redactEvent (state, event, viewerId) {
  switch (event.t) {
    case 'deal':
      // You see the cards dealt to you. Everyone else gets a face-down card.
      return event.player === viewerId ? event : Object.assign({}, event, { card: null });

    case 'draw':
      // Taking from the discard pile is public: everyone watched it happen.
      if (event.from === 'discard' || event.player === viewerId) return event;
      return Object.assign({}, event, { card: null });

    case 'roundStart':
    case 'shift':
      return hidesNextDivisor(state) ? Object.assign({}, event, { pending: null }) : event;

    default:
      // Discards, shifts, reshuffles, the showdown at the end of a round and
      // the turn pointer are all public by nature.
      return event;
  }
}

export function redactEvents (state, events, viewerId) {
  const out = [];
  for (const e of events) {
    const r = redactEvent(state, e, viewerId);
    if (r) out.push(r);
  }
  return out;
}

// The whole of what one player can see, used to draw the screen and to feed
// the bot. A client should be able to render from this alone.
export function viewFor (state, viewerId) {
  const me = state.players.find(p => p.id === viewerId) || null;
  const discard = state.discard;
  return {
    protocol: PROTOCOL_VERSION,
    phase: state.phase,
    finished: state.finished,
    round: state.round,
    rounds: state.options.rounds,
    target: state.options.target,
    turn: state.turn,
    turnCap: state.turnCap,
    shiftEvery: state.shiftEvery,
    turnsToShift: state.shiftEvery - (state.turn % state.shiftEvery),
    turnsLeft: Math.max(0, state.turnCap - state.turn),
    shiftMode: state.options.shiftMode,
    divisor: state.divisor,
    pendingDivisor: hidesNextDivisor(state) ? null : state.pendingDivisor,
    stockCount: state.stock.length,
    discardCount: discard.length,
    discardTop: discard.length ? cardsOf(state, [discard[discard.length - 1]])[0] : null,
    justTook: state.justTook,
    awaiting: state.awaiting ? Object.assign({}, state.awaiting) : null,
    you: me ? {
      id: me.id,
      seat: state.players.indexOf(me),
      score: me.score,
      hand: cardsOf(state, state.hands[me.id])
    } : null,
    players: state.players.map((p, seat) => ({
      id: p.id, name: p.name, bot: p.bot, seat,
      score: p.score,
      handCount: state.hands[p.id].length,
      turn: state.awaiting ? state.awaiting.player === p.id : false
    }))
  };
}

// Seats as the viewer sees them: you at index 0, then clockwise round the
// table. The renderer uses this so "you" are always at the bottom of the
// screen, whichever seat the server actually gave you.
export function seatsFromViewer (view) {
  const n = view.players.length;
  const mine = view.you ? view.you.seat : 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(view.players[(mine + i) % n]);
  return out;
}
