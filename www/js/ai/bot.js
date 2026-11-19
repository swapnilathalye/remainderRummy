// The computer players.
//
// A bot is handed exactly the same redacted view a human client gets, and
// returns an action in the same format a human client sends. It has no special
// access to the state. That is the point: a bot can run on the server to fill
// an empty seat, or in a browser as a practice opponent, with no change.

import { DIVISORS, handCost, isGoingOut } from '../core/rules.js';

// How much weight to give the divisor that is coming next, rather than the one
// in force. A player who can see a shift approaching starts arranging for it.
function lookahead (view) {
  const mode = view.shiftMode;
  if (mode === 'fixed' || !view.pendingDivisor) return 0;
  if (mode === 'king') return 0.25;              // could land at any moment
  if (view.turnsLeft <= view.shiftEvery) return 0; // round ends before it shifts
  if (view.turnsToShift <= 1) return 0.9;
  if (view.turnsToShift <= 4) return 0.5;
  return 0;
}

function blendedCost (cards, view) {
  const w = lookahead(view);
  const now = handCost(cards, view.divisor);
  if (!w) return now;
  return (1 - w) * now + w * handCost(cards, view.pendingDivisor);
}

// The discard that leaves the best hand behind. Going out beats everything.
export function bestDiscard (cards, view, banned) {
  let best = null;
  let bestCost = Infinity;
  for (const card of cards) {
    if (banned && card.id === banned) continue;
    const rest = cards.filter(c => c !== card);
    if (isGoingOut(rest, view.divisor)) return { card, cost: -1, goesOut: true };
    // Tiny tie-break towards throwing the bigger card away.
    const cost = blendedCost(rest, view) - card.value * 0.001;
    if (cost < bestCost) { bestCost = cost; best = card; }
  }
  return { card: best, cost: bestCost, goesOut: false };
}

function wantsTheDiscard (view, rnd) {
  const top = view.discardTop;
  if (!top) return false;
  const hand = view.you.hand;
  const after = bestDiscard(hand.concat([top]), view, top.id);
  if (after.goesOut) return true;
  const now = blendedCost(hand, view);
  // Only take it if it clearly helps, and sometimes pass anyway so the bots
  // are not perfectly predictable to play against.
  return after.cost < now - 1.5 && rnd() > 0.12;
}

function bestDivisorFor (view, options) {
  let best = options[0];
  let bestCost = Infinity;
  for (const d of options) {
    const cost = handCost(view.you.hand, d);
    if (cost < bestCost) { bestCost = cost; best = d; }
  }
  return best;
}

// The only function a host needs: give it a view, get back an action.
export function botAction (view, rnd) {
  const random = rnd || Math.random;
  const a = view.awaiting;
  if (!a) return null;
  switch (a.kind) {
    case 'draw':
      return { type: 'draw', from: wantsTheDiscard(view, random) ? 'discard' : 'stock' };
    case 'discard': {
      const pick = bestDiscard(view.you.hand, view, view.justTook);
      return { type: 'discard', card: (pick.card || view.you.hand[0]).id };
    }
    case 'choice':
      return { type: 'choose', divisor: bestDivisorFor(view, a.options || DIVISORS) };
    case 'next':
      return { type: 'next' };
    default:
      return null;
  }
}
