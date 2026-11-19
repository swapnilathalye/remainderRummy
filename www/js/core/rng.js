// Seeded, serialisable randomness.
//
// Every random decision in the engine goes through here, and the generator's
// whole state is a single integer kept on the game state. That means a game is
// fully reproducible from its seed plus the list of actions played, which is
// what lets a future server replay or verify a match.

export function hashSeed (text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// mulberry32: small, fast, good enough for shuffling cards.
export function nextRandom (holder) {
  let a = holder.rngState | 0;
  a = (a + 0x6D2B79F5) | 0;
  holder.rngState = a;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt (holder, n) {
  return Math.floor(nextRandom(holder) * n);
}

export function shuffleInPlace (holder, array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = randomInt(holder, i + 1);
    const tmp = array[i];
    array[i] = array[j];
    array[j] = tmp;
  }
  return array;
}

export function randomSeed () {
  return (Math.floor(Math.random() * 0xFFFFFFFF) >>> 0).toString(36);
}
