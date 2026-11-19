# Remainder Rummy

A card game where a set is three or more cards sharing the same **remainder**,
and the divisor shifts while you are playing. Two to six players, one human and
the rest bots, on a 3D table.

This repository is both the game and its deployment package. It runs in a
browser, builds into an Android app and an iPhone app without you owning a Mac,
and is structured so online multiplayer is a change of transport rather than a
rewrite.

---

## Try it now

```bash
npm install
npm run serve        # then open http://localhost:5173
npm test             # plays thousands of hands and checks the rules
```

`npm run bundle` writes `dist/index.html`: the whole game as one file you can
drop on any static host.

---

## What is where

```
www/                 the app, as plain ES modules — no build step needed
  index.html         the shell
  styles.css
  vendor/three.min.js
  js/
    core/            THE RULES. No DOM, no network, no clock.
      rules.js         remainders, sets, scoring
      engine.js        the state machine: actions in, events out
      protocol.js      what each player is allowed to see
      rng.js           seeded, so a game can be replayed from its seed
    ai/bot.js        bots, fed the same redacted view a human gets
    net/
      transport.js     the interface the screen talks to
      local.js         a table in this tab: you plus bots
      remote.js        the same table over a websocket
    ui/
      table3d.js       the 3D table; knows nothing about rules
      app.js           turns events into animation and clicks into actions
      native.js        the little that only matters inside the native apps
server/              a websocket server that imports the same core/
test/                engine tests, and a browser test that plays whole games
tools/               dev server, single-file bundler, signing patch
resources/           app icon and splash sources
.github/workflows/   Android and iOS builds on GitHub's runners
codemagic.yaml       the same two builds on Codemagic
```

**Change a rule in `www/js/core/` and it changes everywhere** — the app, the
bots and the server all import those files.

---

## Before your first store build

1. **Check the app id.** It is `io.github.swapnilathalye.remainderrummy`,
   which is valid because you control that GitHub account. To change it:

   ```bash
   npm run set-app-id io.github.yourname.yourgame
   ```

   That updates `capacitor.config.json` and all three places in
   `codemagic.yaml` at once, and refuses ids Android would reject. You cannot
   change it after the first upload to either store.
2. **Decide on the app name**, also in `capacitor.config.json`.
3. Replace `resources/icon.png` and `resources/splash.png` if you want your own
   artwork. `npm run icons` regenerates every size both platforms need.

---

## Android

### The easy path: GitHub Actions

Push this repository to GitHub. `.github/workflows/android.yml` runs on every
push and produces a **debug APK** as a downloadable artifact — install it on
any Android phone with developer mode on. Nothing to set up, no Mac, no Android
Studio.

### For the Play Store, you need a signed bundle

Make a keystore once. This needs Java installed; any machine will do, including
the free [Google Cloud Shell](https://shell.cloud.google.com) if you would
rather not install anything:

```bash
keytool -genkey -v -keystore release.keystore \
  -alias remainderrummy -keyalg RSA -keysize 2048 -validity 10000
```

**Keep that file and its passwords safe and backed up.** If you lose it you
cannot update your own app on the Play Store; you would have to publish a new
listing under a new id.

Turn it into a secret:

```bash
base64 -w0 release.keystore          # Linux
base64 -i release.keystore           # macOS
certutil -encode release.keystore out.txt   # Windows, then strip the header lines
```

In GitHub → Settings → Secrets and variables → Actions, add:

| Secret | What goes in it |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text from above |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `remainderrummy` |
| `ANDROID_KEY_PASSWORD` | the key password |

The next run also produces `app-release.aab`, which is what the Play Console
wants.

### Building Android on your own machine

Works on Windows or Linux, no Mac involved:

```bash
npm install
npx cap add android
npx cap sync android
npx cap open android      # opens Android Studio
```

---

## iPhone, without a Mac

iOS builds must happen on macOS. You do not need to own one — you rent one for
a few minutes at a time in the cloud. Two routes, in the order I would try them.

### Route 1: Codemagic (recommended)

[codemagic.io](https://codemagic.io) gives free macOS build minutes and, more
importantly, handles iOS code signing for you. `codemagic.yaml` in this
repository is ready for it.

1. Sign up and connect your GitHub repository.
2. In Apple Developer → Users and Access → Integrations, create an **App Store
   Connect API key**. Download the `.p8` file and note the key id and issuer id.
3. In Codemagic → Teams → Integrations, add that key.
4. Codemagic will create and manage the signing certificate and provisioning
   profile itself. This is the step that would otherwise need a Mac.
5. Start a build. You get an `.ipa`, and it can upload straight to TestFlight.

### Route 2: GitHub Actions macOS runners

`.github/workflows/ios.yml` builds on `macos-14`. Free for public repositories;
private ones burn minutes at ten times the Linux rate, so a build costs real
money on a free plan.

Signing here is manual, and this is the fiddly part. You can do all of it from
Linux or Windows with `openssl`:

```bash
# 1. a private key and a signing request
openssl genrsa -out ios_distribution.key 2048
openssl req -new -key ios_distribution.key -out ios_distribution.csr \
  -subj "/emailAddress=you@example.com, CN=Your Name, C=GB"

# 2. upload the .csr at developer.apple.com → Certificates → + → Apple
#    Distribution. Download the resulting ios_distribution.cer.

# 3. turn the pair into a .p12
openssl x509 -in ios_distribution.cer -inform DER -out ios_distribution.pem -outform PEM
openssl pkcs12 -export -inkey ios_distribution.key -in ios_distribution.pem \
  -out ios_distribution.p12 -passout pass:YOUR_PASSWORD
```

Then register your app id on the developer portal, create an **App Store**
provisioning profile for it, download the `.mobileprovision`, and add these
secrets:

| Secret | What goes in it |
| --- | --- |
| `APPLE_CERT_P12_BASE64` | base64 of `ios_distribution.p12` |
| `APPLE_CERT_PASSWORD` | the password you chose above |
| `APPLE_PROVISIONING_PROFILE_BASE64` | base64 of the `.mobileprovision` |
| `APPLE_TEAM_ID` | the ten-character team id from the developer portal |

### Other services worth knowing

- **Ionic Appflow** — made by the Capacitor authors, paid, very little setup.
- **VoltBuilder** — upload a zip, get back an `.ipa`. Cheap, no repository needed.
- **Expo EAS Build** — oriented at React Native, but `eas build` can take any
  iOS project. Free tier queues can be long.

---

## What this honestly costs

| | Cost | Avoidable? |
| --- | --- | --- |
| Google Play developer account | $25, once | No |
| Apple Developer Program | $99 a year | No. TestFlight needs it too. |
| Codemagic | free tier, then ~$0.095/min | Yes, via GitHub Actions |
| GitHub Actions | free for public repos | Yes, pay for private minutes |

Two things that catch people out on the Apple side:

- **App Review guideline 4.2** rejects apps that are a thin wrapper around a
  website. This game is fine — it plays offline, uses native icons and splash,
  and is a real game, not a web page in a frame. Do not add a "visit our site"
  button and hope.
- Review takes a day or two the first time, and a rejection usually costs you
  another round trip. Build in a week before any date you have promised.

---

## Turning on online multiplayer

The work is already done. The screen never touches game state: it sends actions
and receives events, and `www/js/net/` decides where those go.

**Try it locally right now:**

```bash
cd server && npm install && npm start     # ws://localhost:8787
npm run serve                             # in another terminal
```

Open the game, choose **Table → Online**, leave the server as
`ws://localhost:8787`, and join. Open a second browser window, join the same
room name, and you are at the same table. Empty seats fill with bots.

**To put it on the internet:** deploy `server/` anywhere that runs Node and
allows websockets (Fly.io, Railway, Render, a small VPS), put TLS in front of
it so the URL becomes `wss://`, and change the default in `www/js/ui/app.js`.
Note that iOS will refuse a plain `ws://` connection from a released app, so
`wss://` is required, not optional.

**What is deliberately still missing**, and what each one needs:

| Missing | What it takes |
| --- | --- |
| A lobby | A screen listing rooms. The server already keys rooms by name. |
| Accounts | Any auth you like; the server identifies players by an id it issues and already supports reconnecting to the same seat. |
| Persistence | Rooms live in memory. Swap the `rooms` map for Redis or Postgres. |
| A turn clock | The server plays a bot move after 15 seconds for a disconnected player; a visible countdown for everyone is not built. |
| Matchmaking, chat, friends | Not started. |

**Why this design resists cheating:** the server holds the only full state, and
`protocol.js` strips other players' cards out of everything it sends. A player
who opens dev tools and reads every byte the client received still cannot see
another hand, because those bytes were never sent. The engine also rejects any
action that is not that player's to make. `npm test` asserts both of these.

---

## Design notes

**Why a separate engine.** The first version of this game was one file where
the rules, the animation and the turn loop were the same `async` function. It
played well and could never have gone online: there was no state to send, no
action to validate, and the flow assumed one player sat in front of it. Pulling
`core/` out was the whole job.

**Why events rather than state snapshots.** A card game is mostly animation. If
the client is handed a new state it has to diff two snapshots to work out that a
card moved from the stock to a hand. An event says so directly, which is both
smaller on the wire and easier to animate.

**Why cards have no identity until they are shown.** `table3d.js` keeps a pool
of card meshes and binds one to a real card only when the player is allowed to
know what it is. An opponent's hand is seven real objects on screen and seven
unknowns in memory. This is what makes the single-player and online versions
the same code.

**Determinism.** Every shuffle draws from a seeded generator whose entire state
is one integer on the game state, so a game can be replayed exactly from its
seed and action log — useful for bug reports, and the foundation if you ever
want server-side verification of a match.
