// The rules of Remainder Rummy, as pure functions.
//
// Nothing here touches the DOM, the network or the clock, so the same file is
// imported by the browser, by the bot and by the Node server. If you change a
// rule, change it here and every player of the game changes with it.

export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const SUITS = ['♠', '♥', '♦', '♣'];
export const SUIT_IS_RED = [false, true, true, false];
export const DIVISORS = [3, 4, 5, 6, 7];
export const MIN_SET = 3;

export const DEFAULT_OPTIONS = {
  handSize: 7,
  lapsPerDivisor: 3,   // how many times round the table before the divisor moves
  divisorWindows: 3,   // how many divisors a round lasts before it is called off
  shiftMode: 'timed',  // fixed | timed | hidden | king | biggest
  rounds: 3,
  target: 0,           // if > 0, keep dealing until someone passes this score
  openingDivisor: 4
};

export const SHIFT_MODES = ['fixed', 'timed', 'hidden', 'king', 'biggest'];

// A card id is stable and unique even across two decks: "deck-suit-rank".
export function makeDeck (deckCount) {
  const cards = [];
  for (let copy = 0; copy < deckCount; copy++) {
    for (let suit = 0; suit < 4; suit++) {
      for (let value = 1; value <= 13; value++) {
        cards.push({ id: copy + '-' + suit + '-' + value, value, suit, copy });
      }
    }
  }
  return cards;
}

export function cardLabel (card) {
  return RANKS[card.value - 1] + SUITS[card.suit];
}

export function remainderOf (card, divisor) {
  return card.value % divisor;
}

// Cards grouped by the remainder they leave. Keys are numbers as strings.
export function groupByRemainder (cards, divisor) {
  const out = {};
  for (const card of cards) {
    const r = card.value % divisor;
    (out[r] || (out[r] = [])).push(card);
  }
  return out;
}

// A set is MIN_SET or more cards sharing a remainder. Anything in a smaller
// group is loose, and loose cards are what you are scored on.
export function loosePoints (cards, divisor) {
  const groups = groupByRemainder(cards, divisor);
  let total = 0;
  for (const key in groups) {
    if (groups[key].length < MIN_SET) {
      for (const card of groups[key]) total += card.value;
    }
  }
  return total;
}

export function looseCards (cards, divisor) {
  const groups = groupByRemainder(cards, divisor);
  const out = [];
  for (const key in groups) {
    if (groups[key].length < MIN_SET) out.push(...groups[key]);
  }
  return out;
}

// You go out when every card you hold belongs to a set.
export function isGoingOut (cards, divisor) {
  if (!cards.length) return false;
  const groups = groupByRemainder(cards, divisor);
  for (const key in groups) {
    if (groups[key].length < MIN_SET) return false;
  }
  return true;
}

// How bad a hand is, for a player weighing up a discard. A pair is half
// counted because it is one card away from being a set.
export function handCost (cards, divisor) {
  const groups = groupByRemainder(cards, divisor);
  let total = 0;
  for (const key in groups) {
    const group = groups[key];
    if (group.length >= MIN_SET) continue;
    let sum = 0;
    for (const card of group) sum += card.value;
    total += group.length === MIN_SET - 1 ? sum * 0.5 : sum;
  }
  return total;
}

export function deckCountFor (playerCount) {
  return playerCount >= 5 ? 2 : 1;
}

export function sortByRemainder (cards, divisor) {
  return cards.slice().sort((a, b) =>
    (a.value % divisor) - (b.value % divisor) || a.value - b.value || a.suit - b.suit);
}
