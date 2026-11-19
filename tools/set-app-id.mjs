// Changes the app id everywhere it appears, in one command.
//
//   npm run set-app-id io.github.yourname.yourgame
//
// The id has to be identical in capacitor.config.json and codemagic.yaml or
// the iOS signing step will ask Apple for a bundle id the project does not
// build, and the error you get back will not mention either file.
//
// Change it BEFORE your first upload to either store. Afterwards it is the
// app's identity for good: renaming means a new listing, and your existing
// users stop receiving updates.

import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url).pathname;
const next = process.argv[2];

if (!next) {
  const current = JSON.parse(await readFile(root + 'capacitor.config.json', 'utf8'));
  console.log('Current app id: ' + current.appId);
  console.log('Usage: npm run set-app-id io.github.yourname.yourgame');
  process.exit(0);
}

// Android builds the id into a Java package name, so the rules are Java's.
const segments = next.split('.');
const problems = [];
if (segments.length < 2) problems.push('needs at least two segments separated by dots');
if (next.includes('-')) problems.push('hyphens are not allowed; Android will refuse to compile');
for (const s of segments) {
  if (!s) problems.push('empty segment (two dots in a row, or a leading/trailing dot)');
  else if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) {
    problems.push('"' + s + '" must start with a letter and contain only letters, digits or _');
  }
}
if (problems.length) {
  console.error('That app id will not work:');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}
if (/[A-Z]/.test(next)) {
  console.warn('Note: capital letters are legal but unconventional in an app id, and some');
  console.warn('tooling treats ids case-insensitively. All lowercase is the safe choice.');
}

const edits = [
  { file: 'capacitor.config.json', find: /("appId"\s*:\s*")[^"]*(")/, replace: '$1' + next + '$2' },
  { file: 'codemagic.yaml', find: /(PACKAGE_NAME:\s*")[^"]*(")/, replace: '$1' + next + '$2' },
  { file: 'codemagic.yaml', find: /(bundle_identifier:\s*)\S+/, replace: '$1' + next },
  { file: 'codemagic.yaml', find: /(BUNDLE_ID:\s*)\S+/, replace: '$1' + next }
];

let changed = 0;
const cache = new Map();
for (const edit of edits) {
  const path = root + edit.file;
  if (!cache.has(path)) cache.set(path, await readFile(path, 'utf8'));
  const before = cache.get(path);
  const after = before.replace(edit.find, edit.replace);
  if (after !== before) changed++;
  cache.set(path, after);
}
for (const [path, text] of cache) await writeFile(path, text);

console.log('App id set to ' + next + ' in ' + changed + ' place(s).');
console.log('If you have already run `npx cap add android` or `cap add ios`, delete those');
console.log('folders and add them again — the old id is baked into the native projects.');
