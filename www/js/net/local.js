// A table that runs entirely in this tab: you plus bots, no network.
//
// It holds the engine, redacts everything it sends you exactly as a server
// would, and paces the bots so the table feels like people thinking rather
// than a machine resolving. Swap this for remote.js and the screen does not
// change.

import { createGame, apply, isRuleError } from '../core/engine.js';
import { redactEvent, viewFor } from '../core/protocol.js';
import { botAction } from '../ai/bot.js';
import { randomSeed } from '../core/rng.js';
import { deckCountFor } from '../core/rules.js';

const BOT_NAMES = ['Mira', 'Tomás', 'Aiko', 'Devi', 'Noor'];
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createLocalTable (config, handlers) {
  const playerCount = config.playerCount;
  const me = 'you';
  const pacing = Object.assign({ think: 650, settle: 220 }, config.pacing);

  const players = [{ id: me, name: 'You', bot: false }];
  for (let i = 1; i < playerCount; i++) {
    players.push({ id: 'bot' + i, name: BOT_NAMES[i - 1], bot: true });
  }

  const state = createGame({
    seed: config.seed || randomSeed(),
    players,
    options: Object.assign({ deckCount: deckCountFor(playerCount) }, config.options)
  });

  let closed = false;
  let pump = Promise.resolve();

  async function emit (events) {
    for (const event of events) {
      if (closed) return;
      const mine = redactEvent(state, event, me);
      if (mine) await handlers.onEvent(mine);
    }
    if (!closed) handlers.onView(viewFor(state, me));
  }

  // Let any bots that are up next take their turns, pausing between so the
  // screen can keep up.
  async function runBots () {
    for (;;) {
      if (closed) return;
      const awaiting = state.awaiting;
      if (!awaiting || awaiting.player === null || awaiting.player === me) return;
      const player = state.players.find(p => p.id === awaiting.player);
      if (!player || !player.bot) return;
      if (handlers.onThinking) handlers.onThinking(player);
      await sleep(pacing.think + Math.random() * 300);
      if (closed) return;
      const action = botAction(viewFor(state, player.id));
      if (!action) return;
      await step(action, player.id);
      await sleep(pacing.settle);
    }
  }

  async function step (action, from) {
    let events;
    try {
      events = apply(state, action, from);
    } catch (err) {
      if (isRuleError(err)) handlers.onError(err);
      else throw err;
      return;
    }
    await emit(events);
  }

  function queue (fn) {
    pump = pump.then(fn).catch(err => {
      if (!closed) handlers.onError(err);
    });
    return pump;
  }

  return {
    me,
    seed: state.seed,
    start () {
      return queue(async () => {
        await step({ type: 'start' }, me);
        await runBots();
      });
    },
    send (action) {
      return queue(async () => {
        await step(action, me);
        await runBots();
      });
    },
    close () { closed = true; },
    // Handy while developing; an online table would never expose this.
    debugState () { return state; }
  };
}
