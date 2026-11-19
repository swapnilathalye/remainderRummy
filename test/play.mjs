// Browser smoke test: plays whole games through the real UI.
// Needs the dev server running (npm run serve) and Playwright installed.
//
//   node test/play.mjs [baseUrl]

import { createRequire } from 'node:module';
// Playwright may be installed globally rather than in this project, so resolve
// it the forgiving way: PLAYWRIGHT=/path/to/playwright node test/play.mjs
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.argv[2] || 'http://localhost:5173/';
const SHOT_DIR = process.env.SHOT_DIR || '';

const peek = page => page.evaluate(() => {
  const el = id => document.getElementById(id);
  const overlay = el('overlay');
  const open = !overlay.hidden;
  return {
    open,
    pick: open && !!document.querySelector('[data-k="d"]'),
    sheetBtn: open && !el('sheetBtn').hidden,
    final: open && /Final standings/.test(el('sheetBody').textContent),
    stock: !el('btnStock').hidden,
    discard: !el('btnTake').hidden,
    toDiscard: !el('btnDiscard').hidden,
    canDiscard: !el('btnDiscard').hidden && !el('btnDiscard').disabled,
    divisor: el('divNow').textContent,
    chip: el('divNext').textContent,
    round: el('roundTxt').textContent,
    status: el('status').textContent
  };
});

async function playOne (browser, { players, shift, length, label, steps = 500, shot = false }) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  page.on('requestfailed', r => errors.push('REQFAIL ' + r.url()));

  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-k="n"]', { timeout: 15000 });
  for (const [k, v] of [['n', players], ['s', shift], ['g', length]]) {
    await page.click(`[data-k="${k}"][data-v="${v}"]`);
    await page.waitForTimeout(60);
  }
  await page.click('#sheetBtn');

  const seen = { divisors: new Set(), rounds: new Set(), picks: 0, draws: 0, discards: 0, sheets: 0 };
  let done = false;
  let idle = 0;
  let shotTaken = false;

  for (let i = 0; i < steps && !done; i++) {
    await page.waitForTimeout(120);
    const s = await peek(page);
    seen.divisors.add(s.divisor);
    if (s.round) seen.rounds.add(s.round);
    if (s.final) { done = true; break; }
    if (s.pick) {
      if (shot && !shotTaken && SHOT_DIR) { await page.screenshot({ path: SHOT_DIR + '/pick.png' }); shotTaken = true; }
      await page.click('[data-k="d"]'); seen.picks++; idle = 0; continue;
    }
    if (s.sheetBtn) { await page.click('#sheetBtn'); seen.sheets++; idle = 0; continue; }
    if (s.stock) {
      if (shot && !shotTaken && SHOT_DIR) { await page.screenshot({ path: SHOT_DIR + '/turn.png' }); shotTaken = true; }
      await page.click('#btnStock'); seen.draws++; idle = 0; continue;
    }
    if (s.toDiscard) {
      let played = false;
      for (let k = 0; k < 4; k++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(40);
        if ((await peek(page)).canDiscard) { await page.click('#btnDiscard'); seen.discards++; played = true; break; }
      }
      if (played) { idle = 0; continue; }
    }
    idle++;
  }

  const result = {
    label,
    draws: seen.draws,
    discards: seen.discards,
    rounds: seen.rounds.size,
    sheets: seen.sheets,
    picks: seen.picks,
    divisors: [...seen.divisors].join(' '),
    finished: done,
    idleStreak: idle,
    errors: errors.slice(0, 4)
  };
  console.log(JSON.stringify(result));
  if (shot && SHOT_DIR && done) await page.screenshot({ path: SHOT_DIR + '/final.png' });
  await page.close();
  return result;
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
const runs = [
  { players: 4, shift: 'timed', length: 'r3', label: '4p timed 3r', shot: true },
  { players: 2, shift: 'biggest', length: 'r3', label: '2p biggest 3r' },
  { players: 6, shift: 'king', length: 'r3', label: '6p king 3r', steps: 900 },
  { players: 3, shift: 'hidden', length: 'r3', label: '3p hidden 3r' },
  { players: 5, shift: 'fixed', length: 't100', label: '5p fixed to100', steps: 900 }
];
let bad = 0;
for (const run of runs) {
  const r = await playOne(browser, run);
  if (r.errors.length) bad++;
  if (!r.finished) console.log('   (did not reach the end within the step budget)');
}
await browser.close();
console.log(bad ? bad + ' run(s) logged errors' : 'No console or page errors in any run');
process.exit(bad ? 1 : 0);
