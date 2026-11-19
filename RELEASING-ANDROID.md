# Releasing on Google Play

Written for a first release by a solo developer with no Mac. Follow it in
order; the steps that take calendar time are flagged, and there is one of them
that will surprise you.

## The timeline, before anything else

A first Android release is **about three weeks of waiting**, not an afternoon.
That is not Google being slow at review — it is one specific rule:

> **Personal developer accounts created after 13 November 2023 must run a
> closed test with at least 12 testers, opted in continuously for 14 days,
> before they may even apply for production access.**

Twelve real people, on twelve real Google accounts, who stay opted in for
fourteen consecutive days. If someone opts out on day nine, their fourteen days
restart. Only after that can you click "Apply for production", and then review
takes a few days more.

So the single most useful thing you can do today is **line up twelve people**.
Everything else here takes an evening.

(If you register as an *organisation* rather than a person, this rule does not
apply — but that needs a D-U-N-S number and takes its own time to verify.)

## What it costs

| | |
| --- | --- |
| Play Console account | $25, one payment, forever |
| Everything else here | free |

---

## Step 1 — Make your signing key

This one file is the identity of your app. If you lose it, you can never
update your own app again; you would have to publish a new listing and leave
your users behind. If someone else gets it, they can publish updates that
Android will accept as yours.

Any machine with Java will do — your own, or the free
[Google Cloud Shell](https://shell.cloud.google.com) if you would rather not
install anything.

```bash
keytool -genkey -v -keystore release.keystore \
  -alias remainderrummy -keyalg RSA -keysize 2048 -validity 10000
```

It asks for two passwords (keystore and key — you may use the same one) and
some name and location details, which only appear inside the certificate and
are not shown to users.

**Back it up now**, before you go any further: a password manager, an encrypted
drive, somewhere that is not only this laptop. Back up the two passwords with
it. A keystore without its passwords is useless.

Do not commit it. `.gitignore` already excludes `*.keystore`, `*.jks` and
`*.p12`, but check before you push.

## Step 2 — Give the key to the build, not to the repository

Turn the file into text:

```bash
base64 -w0 release.keystore          # Linux
base64 -i release.keystore           # macOS
certutil -encode release.keystore out.txt   # Windows, then delete the ---- header and footer lines
```

In GitHub, go to **Settings → Secrets and variables → Actions → New repository
secret** and add four:

| Name | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the base64 text |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `remainderrummy` |
| `ANDROID_KEY_PASSWORD` | the key password |

Secrets are write-only: once saved, nobody including you can read them back,
only replace them. That is why you keep your own backup.

## Step 3 — Build the signed bundle

Push anything, or go to **Actions → Android → Run workflow**. The two steps
that said *skipped* before will now run, and the artifacts at the bottom of
the run will include **`app-release.aab`**.

That `.aab` is what Play wants. The `.apk` on the releases page is a debug
build and Play will refuse it.

Download it on a computer — artifacts need a signed-in browser.

## Step 4 — Create the app in Play Console

Sign up at [play.google.com/console](https://play.google.com/console) and pay
the $25. Identity verification takes a day or two, so do this early.

Then **Create app**, and have these ready:

- **App name** — Remainder Rummy (up to 30 characters, must be free on Play)
- **Default language**, app or game: **game**, free or paid: **free**
- Declarations about ads (you have none) and content guidelines

## Step 5 — The forms nobody warns you about

Play will not let you publish until every one of these is green. None are
hard, but together they are an evening.

**Privacy policy (a URL, required).** The game collects nothing — no accounts,
no analytics, no network calls at all now that online play is switched off.
You still need a policy saying so, at a public URL. GitHub Pages is the free
option: put a `privacy.html` in a `docs/` folder, enable Pages in repository
settings, and use that address.

**Data safety.** A questionnaire about what you collect. For this app the
answer is "no data collected" throughout, which makes it quick — but answer it
honestly, because it is checked against your app's actual behaviour and
getting it wrong is a suspension risk, not a warning.

**Content rating.** A questionnaire that issues IARC ratings. A card game with
no violence, no gambling and no user content rates as low as it goes. Be
careful on the gambling questions: this game has no wagering and no simulated
gambling, so answer no.

**Target audience.** If you include under-13s you inherit the Families policy
and a stricter review. Simplest first release: 13+.

**App access.** Everything is reachable with no login, so say so.

**Store listing**, which needs assets:

| Asset | Requirement |
| --- | --- |
| App icon | 512 × 512 PNG, 32-bit |
| Feature graphic | 1024 × 500 PNG or JPG, no transparency |
| Phone screenshots | at least 2, 16:9 or 9:16, 1080p is safe |
| Short description | up to 80 characters |
| Full description | up to 4000 characters |

`resources/icon.png` is 1024 × 1024, so resize it for the 512 icon. The
feature graphic and screenshots do not exist yet.

## Step 6 — Closed testing, and the fourteen days

Go to **Testing → Closed testing**, create a track, upload the `.aab`, and add
your testers by email address. Each one must **accept the invitation link and
install the app** — an invited tester who never opts in does not count.

Watch the tester count on the dashboard. You need 12 opted in, held for 14
consecutive days. The clock is per-tester, so somebody joining late moves the
finish line.

While you wait, this is the time to fix whatever the testers find. You can
push new builds to the closed track freely; it does not reset the clock.

## Step 7 — Apply for production

After 14 days with 12 testers, the Play Console dashboard offers **Apply for
production**. Google reviews your account and your app. Expect a few days, and
expect that a first application is sometimes sent back with questions.

Then **Production → Create new release**, upload the `.aab`, write release
notes, roll out. A first review usually takes a day or two but can take a
week. Start with a staged rollout at 20% if you want a safety margin.

---

## Things that will bite

**Target API level.** Play has required apps to target Android 16 (API 36)
since 31 August 2026. This project uses Capacitor 8, which targets 36, so you
are fine — but if you ever downgrade Capacitor, uploads start getting
rejected with a message about the target API level.

**Version codes must increase.** Every upload needs a higher `versionCode`
than the last, and you cannot reuse one even from a deleted release.
`android/app/build.gradle` has `versionCode 1`. Capacitor regenerates that
folder, so for the second release either commit the `android/` folder or set
the version in the workflow.

**The debug APK and the release AAB are different apps** as far as Android is
concerned — different signing keys. You cannot update one with the other, and
on a phone that already has the debug build you must uninstall it first.

**Play App Signing.** Google will offer to hold a signing key of its own and
re-sign your uploads. Accepting is the sensible default: it means a lost
keystore is recoverable. Your upload key still matters, so keep backing it up.

**Your repository is public**, which is why CI is free. That also means anyone
can read the game's source. That is fine for an open project but worth a
deliberate decision before launch, not after.
