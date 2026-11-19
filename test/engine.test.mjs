// Engine checks. Run with: npm test
//
// These play whole games with bots in every seat and assert the things that
// must never break: cards are conserved, hands are the right size, scores
// match an independent count, no player can see another player's hand, and the
// same seed always produces the same game.

import { createGame, apply, cardsOf } from '../www/js/core/engine.js';
import { viewFor, redactEvent } from '../www/js/core/protocol.js';
import { botAction } from '../www/js/ai/bot.js';
import { loosePoints, isGoingOut, SHIFT_MODES, deckCountFor } from '../www/js/core/rules.js';
import { nextRandom, hashSeed } from '../www/js/core/rng.js';

let checks = 0;
let failures = 0;
function ok (condition, message) {
  checks++;
  if (!condition) { failures++; console.error('  FAIL: ' + message); }
}
function eq (a, b, message) {
  ok(a === b, message + ' (got ' + JSON.stringify(a) + ', wanted ' + JSON.stringify(b) + ')');
}

function makeTable (playerCount, options, seed) {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    players.push({ id: 'p' + i, name: 'P' + i, bot: true });
  }
  return createGame({
    seed: seed || ('seed-' + playerCount + '-' + options.shiftMode),
    players,
    options: Object.assign({ deckCount: deckCountFor(playerCount) }, options)
  });
}

function countCards (state) {
  let n = state.stock.length + state.discard.length;
  for (const p of state.players) n += state.hands[p.id].length;
  return n;
}

// Play a whole game with a deterministic bot rng, returning a transcript.
function playOut (state, limit) {
  const rngHolder = { rngState: hashSeed('bot-' + state.seed) };
  const rnd = () => nextRandom(rngHolder);
  const transcript = [];
  const deckSize = state.deckIds.length;
  let steps = 0;

  let events = apply(state, { type: 'start' }, state.players[0].id);
  transcript.push(...events.map(e => e.t));

  while (state.awaiting && steps < (limit || 4000)) {
    steps++;
    const who = state.awaiting.player === null ? state.players[0].id : state.awaiting.player;
    const view = viewFor(state, who);
    const action = botAction(view, rnd);
    if (!action) break;

    // Hands are 7 cards except between a draw and a discard.
    for (const p of state.players) {
      const size = state.hands[p.id].length;
      const expected = state.phase === 'roundEnd' || state.phase === 'gameEnd'
        ? size
        : (state.awaiting.kind === 'discard' && state.awaiting.player === p.id ? 8 : 7);
      if (state.phase === 'playing' || state.phase === 'choosing') {
        ok(size === expected, 'hand size for ' + p.id + ' was ' + size + ', wanted ' + expected);
      }
    }
    ok(countCards(state) === deckSize, 'cards conserved: ' + countCards(state) + ' of ' + deckSize);

    events = apply(state, action, who);
    transcript.push(...events.map(e => e.t));

    const ended = events.find(e => e.t === 'roundEnd');
    if (ended) {
      // Re-derive every score independently of the engine.
      for (const r of ended.results) {
        const hand = cardsOf(state, state.hands[r.id]);
        const want = r.id === ended.winner ? 0 : loosePoints(hand, ended.divisor);
        eq(r.points, want, 'round points for ' + r.id);
      }
      if (ended.winner) {
        ok(isGoingOut(cardsOf(state, state.hands[ended.winner]), ended.divisor),
          'the winner really was going out');
      }
    }
    if (events.some(e => e.t === 'gameEnd')) break;
  }
  return { transcript, steps };
}

console.log('Playing every shift mode at every table size...');
for (const mode of SHIFT_MODES) {
  for (let n = 2; n <= 6; n++) {
    const state = makeTable(n, { shiftMode: mode, rounds: 2 });
    const { transcript } = playOut(state);
    ok(transcript.includes('gameEnd'), mode + '/' + n + 'p reached the end of the game');
    eq(state.phase, 'gameEnd', mode + '/' + n + 'p finished in the right phase');
    if (mode === 'fixed') {
      // A fixed table shifts between rounds but never inside one.
      const shifts = transcript.filter(t => t === 'shift').length;
      eq(shifts, 0, 'fixed mode never shifts mid-round');
    }
  }
}

console.log('Checking that a seed replays identically...');
{
  const a = playOut(makeTable(4, { shiftMode: 'timed', rounds: 2 }, 'repeat-me'));
  const b = playOut(makeTable(4, { shiftMode: 'timed', rounds: 2 }, 'repeat-me'));
  eq(a.transcript.join(','), b.transcript.join(','), 'same seed, same game');
  const c = playOut(makeTable(4, { shiftMode: 'timed', rounds: 2 }, 'different'));
  ok(a.transcript.join(',') !== c.transcript.join(','), 'a different seed plays differently');
}

console.log('Checking that one player cannot see another player\'s hand...');
{
  const state = makeTable(4, { shiftMode: 'timed', rounds: 1 });
  apply(state, { type: 'start' }, 'p0');
  const view = viewFor(state, 'p0');
  eq(view.you.hand.length, 7, 'you can see your own seven cards');
  for (const p of view.players) {
    ok(!p.hand, 'no hand leaked for ' + p.id);
    eq(p.handCount, 7, 'but the count of ' + p.id + '\'s cards is public');
  }
  const secret = JSON.stringify(state.hands.p1);
  ok(!JSON.stringify(view).includes(secret.slice(2, 20)), 'p1\'s cards are absent from p0\'s view');

  const dealt = apply(state, { type: 'draw', from: 'stock' }, 'p0');
  const drawEvent = dealt.find(e => e.t === 'draw');
  ok(redactEvent(state, drawEvent, 'p0').card !== null, 'you see the card you drew');
  eq(redactEvent(state, drawEvent, 'p1').card, null, 'nobody else sees what you drew from the stock');
}

console.log('Checking that hidden mode hides the next divisor...');
{
  const state = makeTable(4, { shiftMode: 'hidden', rounds: 1 });
  apply(state, { type: 'start' }, 'p0');
  eq(viewFor(state, 'p0').pendingDivisor, null, 'hidden mode withholds the coming divisor');
  const timed = makeTable(4, { shiftMode: 'timed', rounds: 1 });
  apply(timed, { type: 'start' }, 'p0');
  ok(viewFor(timed, 'p0').pendingDivisor > 0, 'timed mode shows it');
}

console.log('Checking that illegal actions are refused...');
{
  const state = makeTable(3, { shiftMode: 'timed', rounds: 1 });
  apply(state, { type: 'start' }, 'p0');
  const first = state.awaiting.player;
  const other = state.players.find(p => p.id !== first).id;
  let threw = false;
  try { apply(state, { type: 'draw', from: 'stock' }, other); } catch (e) { threw = true; }
  ok(threw, 'playing out of turn is refused');
  threw = false;
  try { apply(state, { type: 'discard', card: state.hands[first][0] }, first); } catch (e) { threw = true; }
  ok(threw, 'discarding before drawing is refused');

  apply(state, { type: 'draw', from: 'discard' }, first);
  const took = state.justTook;
  threw = false;
  try { apply(state, { type: 'discard', card: took }, first); } catch (e) { threw = true; }
  ok(threw, 'you cannot discard the card you just took from the pile');
}

console.log('Checking the race-to-a-target game length...');
{
  const state = makeTable(4, { shiftMode: 'timed', rounds: 24, target: 60 });
  playOut(state);
  eq(state.phase, 'gameEnd', 'a target game ends');
  ok(state.players.some(p => p.score >= 60), 'it ended because someone passed the target');
}

console.log('');
if (failures) {
  console.error(failures + ' of ' + checks + ' checks failed');
  process.exit(1);
}
console.log('All ' + checks + ' checks passed');
