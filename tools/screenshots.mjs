// Captures Play Store phone screenshots from the real game.
//
//   npm run serve                      # in one terminal
//   node tools/screenshots.mjs         # in another
//
// Shots come out 1080 x 1920. That matters: Google Play rejects a phone
// screenshot whose long side is more than twice its short side, so the tall
// 9:20 shape of a modern phone is not allowed. 360 x 640 CSS pixels at 3x
// gives exactly 16:9 while still being narrow enough to trigger the phone
// layout, which is on a 640px breakpoint.

import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const BASE = process.env.BASE || 'http://localhost:5173/';
const OUT = new URL('../store/screenshots/', import.meta.url).pathname;
const VIEW = { width: 360, height: 640 };
const SCALE = 3;

const sleep = ms => new Promise(r => setTimeout(r, ms));

const peek = page => page.evaluate(() => {
  const el = id => document.getElementById(id);
  const overlay = el('overlay');
  return {
    open: !overlay.hidden,
    sheet: overlay.hidden ? '' : el('sheetBody').textContent,
    sheetBtn: !overlay.hidden && !el('sheetBtn').hidden,
    pick: !overlay.hidden && !!document.querySelector('[data-k="d"]'),
    banner: el('banner').classList.contains('show'),
    stock: !el('btnStock').hidden,
    toDiscard: !el('btnDiscard').hidden,
    canDiscard: !el('btnDiscard').hidden && !el('btnDiscard').disabled,
    status: el('status').textContent
  };
});

async function openGame (browser, { players, shift, length }) {
  const page = await browser.newPage({ viewport: VIEW, deviceScaleFactor: SCALE });
  // Reduced motion makes the engine's waits short and snaps cards to their
  // resting places. For a still photograph that is what we want anyway, and
  // it is the difference between this finishing in minutes and not at all
  // under software rendering.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('[data-k="n"]', { timeout: 20000 });
  for (const [k, v] of [['n', players], ['s', shift], ['g', length]]) {
    await page.click(`[data-k="${k}"][data-v="${v}"]`);
    await sleep(80);
  }
  return page;
}

// Take one turn if it is ours, so the table keeps moving while we wait for
// whatever state we are trying to photograph.
async function nudge (page) {
  const s = await peek(page);
  if (s.pick) { await page.click('[data-k="d"]'); return true; }
  if (s.sheetBtn) { await page.click('#sheetBtn'); return true; }
  if (s.stock) { await page.click('#btnStock'); return true; }
  if (s.toDiscard) {
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('ArrowRight');
      await sleep(50);
      if ((await peek(page)).canDiscard) { await page.click('#btnDiscard'); return true; }
    }
  }
  return false;
}

// Poll quickly for a fleeting state (the shift banner is up for 1.7 seconds).
async function waitFor (page, test, { timeout = 180000, poll = 120 } = {}) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const s = await peek(page);
    if (test(s)) return s;
    await nudge(page);
    await sleep(poll);
  }
  return null;
}

async function shoot (page, name) {
  await page.screenshot({ path: OUT + name });
  console.log('  ' + name);
}

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
});
await mkdir(OUT, { recursive: true });

// 1. The setup screen: says what the game is before anyone has played a hand.
console.log('setup screen');
{
  const page = await openGame(browser, { players: 4, shift: 'timed', length: 'r3' });
  await sleep(1200);
  await shoot(page, '01-setup.png');
  await page.close();
}

// 2 and 3. A hand in progress, then the divisor shifting.
console.log('table and shift');
{
  const page = await openGame(browser, { players: 4, shift: 'timed', length: 'r3' });
  await page.click('#sheetBtn');
  const turn = await waitFor(page, s => s.stock, { timeout: 180000 });
  if (turn) { await sleep(600); await shoot(page, '02-table.png'); }
  else console.log('  (never reached our turn)');

  const banner = await waitFor(page, s => s.banner, { timeout: 240000, poll: 90 });
  if (banner) await shoot(page, '03-shift.png');
  else console.log('  (missed the shift banner)');
  await page.close();
}

// 4. Being asked to choose the next divisor, with the cost of each shown.
console.log('your call');
{
  const page = await openGame(browser, { players: 2, shift: 'biggest', length: 'r3' });
  await page.click('#sheetBtn');
  const pick = await waitFor(page, s => s.pick, { timeout: 240000 });
  if (pick) { await sleep(400); await shoot(page, '04-your-call.png'); }
  else console.log('  (no divisor choice came our way)');
  await page.close();
}

// 5. The end of a round, showing how sets and loose cards are scored.
console.log('round results');
{
  const page = await openGame(browser, { players: 4, shift: 'timed', length: 'r3' });
  await page.click('#sheetBtn');
  const done = await waitFor(page, s => s.open && /scored at/.test(s.sheet), { timeout: 300000 });
  if (done) { await sleep(500); await shoot(page, '05-scoring.png'); }
  else console.log('  (round did not finish in time)');
  await page.close();
}

await browser.close();
console.log('\nWritten to store/screenshots/');
