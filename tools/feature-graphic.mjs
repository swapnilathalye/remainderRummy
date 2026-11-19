// Builds the Play Store feature graphic (1024 x 500) and the 512 x 512
// listing icon.
//
//   node tools/feature-graphic.mjs
//
// The feature graphic has hard rules: exactly 1024 x 500, PNG or JPEG, and no
// transparency. Play also crops or overlays it on some surfaces, so nothing
// that must be read sits near an edge.

import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');

const root = new URL('../', import.meta.url).pathname;
const OUT = root + 'store/';

async function fontFace (family, file, weight) {
  const data = await readFile(root + 'node_modules/@fontsource/' + family + '/files/' + file);
  return `@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;` +
    `src:url(data:font/woff2;base64,${data.toString('base64')}) format("woff2")}`;
}

const fonts = [
  await fontFace('bricolage-grotesque', 'bricolage-grotesque-latin-700-normal.woff2', 700),
  await fontFace('figtree', 'figtree-latin-500-normal.woff2', 500)
].join('');

// One card, drawn the way the game draws them.
function card (rank, value, suit, red, remainder, transform) {
  return `<div class="card ${red ? 'red' : ''}" style="transform:${transform}">
    <span class="tag r${remainder}">r${remainder}</span>
    <b class="corner">${rank}<i>${suit}</i></b>
    <b class="big">${value}</b>
    <i class="pip">${suit}</i>
  </div>`;
}

const graphic = `<!doctype html><html><head><meta charset="utf-8"><style>
${fonts}
*{box-sizing:border-box;margin:0}
body{width:1024px;height:500px;overflow:hidden;background:#160f1c;
  font-family:"figtree",system-ui,sans-serif;color:#f5eddc}
.stage{position:relative;width:1024px;height:500px;
  background:radial-gradient(ellipse 70% 90% at 72% 50%,#5a2338,#2a1726 55%,#160f1c 100%)}
.felt{position:absolute;right:-110px;top:-120px;width:720px;height:720px;border-radius:50%;
  background:radial-gradient(circle at 45% 40%,#9c2c42,#6b1b2c 70%,#521321);
  box-shadow:0 0 0 14px #5b3520, 0 30px 80px rgba(0,0,0,.55)}
.copy{position:absolute;left:72px;top:142px;width:430px}
h1{font-family:"bricolage-grotesque",sans-serif;font-weight:700;font-size:74px;line-height:.95;
  letter-spacing:-.02em;margin-bottom:18px}
h1 em{font-style:normal;color:#e0b05a;display:block}
p{font-size:24px;line-height:1.3;color:#d9c9d6;max-width:390px}
.fan{position:absolute;right:92px;top:92px;width:430px;height:330px}
.card{position:absolute;left:120px;top:20px;width:150px;height:212px;border-radius:14px;
  background:linear-gradient(#fdf8ec,#eadfc4);box-shadow:0 14px 30px rgba(0,0,0,.45);
  color:#1d1826;font-family:Georgia,"Times New Roman",serif;transform-origin:50% 115%}
.card.red{color:#b3202e}
.corner{position:absolute;left:12px;top:8px;font-size:30px;line-height:1.05}
.corner i{display:block;font-style:normal;font-size:24px}
.big{position:absolute;inset:52px 0 auto 0;text-align:center;font-size:76px;line-height:1}
.pip{position:absolute;inset:auto 0 24px 0;text-align:center;font-style:normal;font-size:34px}
.tag{position:absolute;left:8px;top:-16px;font-family:"figtree",sans-serif;font-weight:700;
  font-size:17px;padding:2px 9px;border-radius:999px;color:#160f1c}
.r1{background:#ffb454}.r2{background:#7fe0b0}.r3{background:#ff8fa3}
.divisor{position:absolute;right:270px;bottom:44px;font-family:Georgia,serif;font-size:132px;
  color:rgba(240,214,160,.42);line-height:1}
</style></head><body><div class="stage">
  <div class="felt"></div>
  <div class="divisor">&divide;4</div>
  <div class="fan">
    ${card('5', '5', '&hearts;', true, 1, 'rotate(-20deg) translate(-116px,16px)')}
    ${card('9', '9', '&spades;', false, 1, 'rotate(-7deg) translate(-40px,-4px)')}
    ${card('K', '13', '&diams;', true, 1, 'rotate(7deg) translate(38px,-4px)')}
    ${card('6', '6', '&clubs;', false, 2, 'rotate(20deg) translate(114px,16px)')}
  </div>
  <div class="copy">
    <h1>Remainder<em>Rummy</em></h1>
    <p>Sets are cards that share a remainder &mdash; and the divisor keeps changing.</p>
  </div>
</div></body></html>`;

const icon512 = `<!doctype html><html><head><meta charset="utf-8">
<style>*{margin:0}body{width:512px;height:512px;overflow:hidden}
img{width:512px;height:512px;display:block}</style></head>
<body><img src="data:image/png;base64,${(await readFile(root + 'resources/icon.png')).toString('base64')}"></body></html>`;

const browser = await chromium.launch();
await mkdir(OUT, { recursive: true });

let page = await browser.newPage({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
await page.setContent(graphic, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: OUT + 'feature-graphic.png' });
await page.close();

page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
await page.setContent(icon512, { waitUntil: 'load' });
await page.screenshot({ path: OUT + 'icon-512.png' });
await page.close();

await browser.close();
console.log('store/feature-graphic.png  1024x500');
console.log('store/icon-512.png         512x512');
