# Changelog

## 1.0.0 — the deployment package

The game was one HTML file where the rules, the animation and the turn loop
were the same `async` function. It played well and could never have gone
online. This release keeps the game exactly as it played and rebuilds what is
underneath it.

### Added

- **A rules engine with no dependencies on the screen** (`www/js/core/`).
  Actions go in, events come out, and the state is plain JSON seeded from a
  single integer, so any game can be replayed from its seed and action log.
- **Per-player redaction** (`core/protocol.js`). Nobody is sent another
  player's cards, not even in the single-player game.
- **A transport seam** (`www/js/net/`). `local.js` runs the table in this tab;
  `remote.js` runs it over a websocket. The screen cannot tell the difference.
- **A websocket server** (`server/`) that imports the same engine, so the rules
  cannot drift between client and server. Rooms, seating, bots filling empty
  seats, and reconnection to the same hand.
- **An online waiting room**: type a room name, others who type the same one
  sit down with you, press Deal when ready.
- **Capacitor project** for Android and iOS, with icon and splash sources.
- **CI that builds both apps without a Mac**: GitHub Actions for Android,
  Codemagic or GitHub's macOS runners for iOS.
- **Tests**: `npm test` plays thousands of hands across every shift mode and
  table size, checking that cards are conserved, scores match an independent
  count, and no player's view contains another player's hand.
  `test/play.mjs` plays whole games through the real interface in a browser.

### Changed

- Cards on the table no longer have a fixed identity. The renderer holds a pool
  of card meshes and binds one to a real card only when the player is allowed
  to know what it is — which is what makes an opponent's hand drawable without
  the client knowing what is in it.
- The deal no longer waits for each card to land before releasing the next.

### Unchanged

The rules, the five divisor-shift modes, table sizes from two to six, the
scoring, the bots' judgement and the look of the table.
