# Store assets

Everything the Play Console listing asks for, except the two things only you
can write: the privacy policy URL and your contact email.

Regenerate any of it with:

```bash
npm run serve                      # in one terminal
node tools/screenshots.mjs         # real gameplay, 1080x1920
node tools/feature-graphic.mjs     # feature graphic and 512 icon
```

## What is here

| File | Where it goes | Requirement |
| --- | --- | --- |
| `icon-512.png` | Store listing → App icon | 512 × 512, 32-bit PNG |
| `feature-graphic.png` | Store listing → Feature graphic | exactly 1024 × 500, no transparency |
| `screenshots/01-setup.png` | Phone screenshots | 1080 × 1920 |
| `screenshots/02-table.png` | Phone screenshots | a hand with two complete sets |
| `screenshots/03-shift.png` | Phone screenshots | the divisor changing mid-round |
| `screenshots/04-your-call.png` | Phone screenshots | choosing the next divisor |
| `screenshots/05-scoring.png` | Phone screenshots | how a round is scored |

All five screenshots are real gameplay, not mock-ups, captured from the build
in this repository.

**Why 1080 × 1920 and not a taller phone shape.** Play rejects a phone
screenshot whose long side is more than twice its short side, so the 9:20 of a
modern handset is not allowed. 16:9 is safe.

Upload at least two. Four or five is better: Play shows the first few in search
results, so lead with `02-table.png`, which shows the mechanic at a glance.

## Listing text

**Short description** (80 characters maximum — this one is 74):

```
A card game where sets share a remainder, and the divisor keeps changing.
```

**Full description** (4000 characters maximum):

```
Remainder Rummy is a card game built on one idea: a set is three or more cards
that leave the same remainder.

Divide by 4, and the 5, the 9 and the King all leave 1 — so they belong
together. Collect sets, discard what does not fit, and go out when every card
in your hand belongs somewhere. Everyone else counts the value of their loose
cards against them, and the lowest total wins.

Then the divisor changes, and every set you built comes apart.

That is the game. Your hand is never worth a fixed amount; it is worth
whatever the current divisor says it is worth. A King is treasure under one
divisor and dead weight under the next, and the good players are the ones
already holding cards for the divisor that has not arrived yet.

FIVE WAYS THE DIVISOR CAN CHANGE

• Fixed — it never moves. The calm way to learn the game.
• Timed — it shifts every three laps of the table, and you can see what is
  coming, so you can prepare.
• Hidden — it shifts on the same schedule, but you find out only when it lands.
• On a King — it shifts whenever anyone discards a King, so the players decide
  when the ground moves. A King is worth 13 against you, which makes throwing
  one a real decision.
• Biggest hand — whoever is carrying the most loose points chooses the next
  divisor, and is shown exactly what each one would cost them. Being behind
  gives you the steering wheel.

AT THE TABLE

• Two to six players, with computer opponents that plan around the coming
  shift rather than only the current one
• Three rounds, five rounds, or a race to 100 points
• A proper 3D table where the cards are dealt, flipped and thrown
• Every card tagged with its remainder, so you can see the sets forming

NO NONSENSE

No adverts. No in-app purchases. No accounts. No tracking. The game collects
nothing about you and works with no connection at all.

Good for anyone who likes rummy, and quietly good at mental arithmetic for
anyone learning division and remainders.
```

## Still to do

- **Privacy policy URL.** Required even though the app collects nothing. The
  text is short: say it collects, stores and transmits no personal data. Host
  it on GitHub Pages from a `docs/` folder in this repository and use that
  address.
- **Contact email.** Play shows it publicly on the listing, so consider one
  you are happy to publish.
- A **tablet screenshot** is optional, and only worth adding if you intend to
  list the app as tablet-friendly.
