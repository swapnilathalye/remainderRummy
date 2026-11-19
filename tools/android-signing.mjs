// Adds a release signing config to the generated Android project.
//
// Capacitor regenerates android/ from a template that only knows how to build
// debug. This patches in a release signing config that reads its passwords from
// the environment, so nothing secret is ever written to a file in the repo.
//
// Expects android/app/release.keystore to exist, and at build time:
//   RR_KEYSTORE_PASSWORD, RR_KEY_ALIAS, RR_KEY_PASSWORD
//
// Safe to run twice: it does nothing if the config is already there.

import { readFile, writeFile, access } from 'node:fs/promises';

const GRADLE = new URL('../android/app/build.gradle', import.meta.url).pathname;
const KEYSTORE = new URL('../android/app/release.keystore', import.meta.url).pathname;
const MARKER = '// remainder-rummy release signing';

const SIGNING_BLOCK = `
    ${MARKER}
    signingConfigs {
        release {
            storeFile file("release.keystore")
            storePassword System.getenv("RR_KEYSTORE_PASSWORD")
            keyAlias System.getenv("RR_KEY_ALIAS")
            keyPassword System.getenv("RR_KEY_PASSWORD")
        }
    }
`;

try {
  await access(KEYSTORE);
} catch (err) {
  console.error('No android/app/release.keystore found. See README.md, "Signing the Android build".');
  process.exit(1);
}

let gradle = await readFile(GRADLE, 'utf8');
if (gradle.includes(MARKER)) {
  console.log('Signing config already present; nothing to do.');
  process.exit(0);
}

const at = gradle.indexOf('buildTypes {');
if (at < 0) {
  console.error('Could not find buildTypes in android/app/build.gradle. ' +
    'Capacitor may have changed its template; add the signing config by hand.');
  process.exit(1);
}
gradle = gradle.slice(0, at) + SIGNING_BLOCK.trim() + '\n\n    ' + gradle.slice(at);

// Point the release build type at it.
const release = gradle.indexOf('release {', gradle.indexOf('buildTypes {'));
if (release < 0) {
  console.error('Could not find the release build type.');
  process.exit(1);
}
const insertAt = gradle.indexOf('\n', release) + 1;
gradle = gradle.slice(0, insertAt) +
  '            signingConfig signingConfigs.release\n' +
  gradle.slice(insertAt);

await writeFile(GRADLE, gradle);
console.log('Release signing config added to android/app/build.gradle');
