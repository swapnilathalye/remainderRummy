// Builds dist/index.html: the whole game as one file.
//
// The native apps do not need this — Capacitor ships www/ as it stands, and
// the browser loads the modules directly. This is for putting the game on the
// web as a single page, and for anywhere a build step is not wanted.

import { build } from 'esbuild';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const CDN_THREE = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600&display=swap';

const inlineThree = process.argv.includes('--offline');

const bundled = await build({
  entryPoints: [root + 'www/js/ui/app.js'],
  bundle: true,
  format: 'iife',
  globalName: 'RemainderRummy',
  target: ['es2019'],
  minify: !process.argv.includes('--debug'),
  write: false,
  legalComments: 'none'
});
const script = bundled.outputFiles[0].text;

const css = await readFile(root + 'www/styles.css', 'utf8');
const shell = await readFile(root + 'www/index.html', 'utf8');
const title = (shell.match(/<title>([^<]*)<\/title>/) || [, 'Remainder Rummy'])[1];
const body = shell
  .split('<body>')[1].split('</body>')[0]
  .replace(/<script[\s\S]*?<\/script>/g, '')
  .trim();

const threeTag = inlineThree
  ? '<script>' + await readFile(root + 'www/vendor/three.min.js', 'utf8') + '</script>'
  : '<script src="' + CDN_THREE + '"></script>';

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no">
<meta name="theme-color" content="#160f1c">
<title>${title}</title>
<link rel="stylesheet" href="${FONTS}">
<style>${css}</style>
</head>
<body>
${body}
${threeTag}
<script>${script}
RemainderRummy.startApp();
</script>
</body>
</html>
`;

await mkdir(root + 'dist', { recursive: true });
await writeFile(root + 'dist/index.html', page);
console.log('dist/index.html  ' + (page.length / 1024).toFixed(0) + ' KB' +
  (inlineThree ? '  (three.js inlined)' : '  (three.js from CDN)'));
void dirname;
void copyFile;
