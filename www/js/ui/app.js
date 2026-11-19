// The controller: turns events into animation, and clicks into actions.
//
// It never touches game state directly. Everything it knows arrives as an
// event or a view from the transport, and everything the player does leaves as
// an action. Point it at a websocket instead of a local table and it keeps
// working.

import { createTable } from './table3d.js';
import { createLocalTable } from '../net/local.js';
import { createRemoteTable } from '../net/remote.js';
import {
  RANKS, SUITS, SUIT_IS_RED, SHIFT_MODES,
  groupByRemainder, loosePoints, deckCountFor, sortByRemainder
} from '../core/rules.js';

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const reduceMotion = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const pace = ms => sleep(reduceMotion ? Math.min(ms, 40) : ms);

const SHIFT_COPY = {
  fixed: { label: 'Fixed', desc: 'The divisor holds steady all round. The calmest way to learn the game.' },
  timed: { label: 'Timed', desc: 'Shifts every three laps of the table, and you can see what it will shift to.' },
  hidden: { label: 'Hidden', desc: 'Shifts every three laps, but you only learn the new divisor when it lands.' },
  king: { label: 'On a King', desc: 'The divisor shifts whenever anyone discards a King, so players decide when it happens.' },
  biggest: { label: 'Biggest hand', desc: 'Every three laps, whoever is holding the most loose points chooses the next divisor.' }
};
// Online play is written and has been tested against the server in /server,
// but nothing is deployed yet. Rather than offer players a button that cannot
// work — and ship a dead feature to the stores — the option is hidden. Set
// this to true once the server is running at a public wss:// address, and
// change the default in `setup.url` below to point at it. Nothing else needs
// to change: net/remote.js and the lobby are already wired up.
const ONLINE_ENABLED = false;

const GAME_LENGTHS = [
  { k: 'r3', label: '3 rounds', rounds: 3, target: 0 },
  { k: 'r5', label: '5 rounds', rounds: 5, target: 0 },
  { k: 't100', label: 'To 100 pts', rounds: 24, target: 100 }
];

const label = card => RANKS[card.value - 1] + SUITS[card.suit];
const cardHTML = card =>
  '<span class="cd' + (SUIT_IS_RED[card.suit] ? ' red' : '') + '">' + label(card) + '</span>';

export function startApp () {
  const table = createTable({
    canvas: $('stage'),
    host: $('app'),
    reduceMotion,
    onFrame: placeLabels
  });
  if (!table) { $('nogl').hidden = false; return; }

  // ------------------------------------------------------------ local state
  let transport = null;
  let view = null;              // latest redacted view from the host
  let seatOf = new Map();       // player id -> seat on screen, me at 0
  let nameOf = new Map();
  let myHand = [];              // card objects, in the order I show them
  let selected = null;
  let hovered = null;
  let awaiting = null;
  // Every discard is public, so the client can keep its own copy of the pile
  // rather than waiting for the next view to arrive.
  let discardPile = [];
  const topDiscard = () => discardPile[discardPile.length - 1] || null;
  let plates = [null];
  let pendingPick = null;
  let busy = false;             // true while an animation is running

  const setup = {
    players: 6, shift: 'timed', length: 'r3',
    online: false, url: 'ws://localhost:8787', room: 'table', name: 'Player'
  };

  // ------------------------------------------------------------------- HUD
  const badges = [];
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('div');
    b.className = 'badge';
    b.hidden = true;
    $('labels').appendChild(b);
    badges.push(b);
  }

  function makePlates (n) {
    const host = $('labels');
    Array.prototype.forEach.call(host.querySelectorAll('.plate'), el => el.remove());
    plates = [null];
    for (let i = 1; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'plate';
      host.appendChild(el);
      plates.push(el);
    }
  }

  function setStatus (html) {
    $('status').innerHTML = html;
    // Long status lines wrap on a narrow screen, which makes the footer taller.
    table.setGutter($('bottom').offsetHeight);
  }

  function chipText () {
    if (!view || view.phase === 'lobby') return 'Sets share a remainder';
    if (view.phase === 'gameEnd') return 'Game over';
    if (view.phase === 'roundEnd') return 'Next up ÷ ' + view.divisor;
    const left = view.turnsLeft;
    const soon = view.turnsToShift;
    if (left <= view.shiftEvery) return 'Round ends in ' + left + ' turn' + (left === 1 ? '' : 's');
    switch (view.shiftMode) {
      case 'fixed': return 'Fixed at ÷ ' + view.divisor + ' this round';
      case 'king': return 'A King shifts it to ÷ ' + view.pendingDivisor;
      case 'hidden': return 'Shifts in ' + soon + ' turn' + (soon === 1 ? '' : 's') + ', divisor unseen';
      case 'biggest': return 'Biggest hand calls it in ' + soon + ' turn' + (soon === 1 ? '' : 's');
      default: return 'Shifts to ÷ ' + view.pendingDivisor + ' in ' + soon + ' turn' + (soon === 1 ? '' : 's');
    }
  }

  function refreshHUD () {
    $('divNow').textContent = '÷ ' + (view ? view.divisor : 4);
    $('divNext').textContent = chipText();
    $('roundTxt').textContent = view && view.phase !== 'lobby'
      ? ('Round ' + view.round + (view.target ? ' · to ' + view.target + ' pts' : ' of ' + view.rounds) +
         ' · ' + view.players.length + ' players')
      : 'A card game of remainders';

    if (view) {
      for (const p of view.players) {
        const seat = seatOf.get(p.id);
        if (!seat || !plates[seat]) continue;
        plates[seat].innerHTML = '<b>' + p.name + '</b> <span>' + p.score + ' pts</span>';
        plates[seat].classList.toggle('on', !!p.turn);
      }
    }

    const divisor = view ? view.divisor : 4;
    let line = view && view.you ? 'You have ' + view.you.score + ' pts' : '';
    if (myHand.length && view && view.phase === 'playing') {
      line += ' · loose cards now ' + loosePoints(myHand, divisor);
    }
    if (selected) {
      const card = myHand.find(c => c.id === selected);
      if (card) {
        line += ' · ' + card.value + ' ÷ ' + divisor + ' = ' +
          Math.floor(card.value / divisor) + ' remainder ' + (card.value % divisor);
      }
    }
    $('me').textContent = line;

    const top = topDiscard();
    const mine = awaiting && transport && awaiting.player === transport.me && !busy;
    const drawing = mine && awaiting.kind === 'draw';
    const discarding = mine && awaiting.kind === 'discard';
    $('btnStock').hidden = !drawing;
    $('btnTake').hidden = !drawing || !top;
    $('btnDiscard').hidden = !discarding;
    if (drawing && top) $('btnTake').textContent = 'Take ' + label(top);
    if (discarding) {
      const card = myHand.find(c => c.id === selected);
      const blocked = selected && selected === awaiting.justTook;
      $('btnDiscard').disabled = !card || blocked;
      $('btnDiscard').textContent = !card
        ? 'Choose a card'
        : (blocked ? 'Keep ' + label(card) + ' this turn' : 'Discard ' + label(card));
    }

    const groups = groupByRemainder(myHand, divisor);
    badges.forEach((b, i) => {
      const card = myHand[i];
      if (!card || !view || view.phase !== 'playing') { b.hidden = true; return; }
      const r = card.value % divisor;
      b.hidden = false;
      b.textContent = 'r' + r;
      b.style.setProperty('--c', 'var(--r' + r + ')');
      b.classList.toggle('set', groups[r].length >= 3);
      b.dataset.card = card.id;
    });
    const db = $('discBadge');
    if (top && view && view.phase === 'playing') {
      const r = top.value % divisor;
      db.hidden = false;
      db.textContent = 'r' + r;
      db.style.setProperty('--c', 'var(--r' + r + ')');
    } else db.hidden = true;

    // Showing or hiding the buttons changes how tall the footer is, and your
    // hand sits directly above it. Re-measure before the next frame lays the
    // cards out, or they end up underneath the status line.
    table.setGutter($('bottom').offsetHeight);
    table.setMyHand(myHand.map(c => c.id), divisor, selected, hovered);
    table.setPickable(drawing ? 'piles' : (discarding ? 'hand' : null));
    table.setBob(drawing ? 'piles' : null);
  }

  function place (el, x, y, centred) {
    if (centred) {
      const half = el.offsetWidth / 2;
      const [w] = table.size();
      const cx = Math.max(8 + half, Math.min(w - 8 - half, x));
      el.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + y.toFixed(1) + 'px) translate(-50%,-50%)';
    } else {
      el.style.transform = 'translate(' + x.toFixed(1) + 'px,' + (y - 4).toFixed(1) + 'px) translateY(-100%)';
    }
  }

  function placeLabels () {
    for (let seat = 1; seat < plates.length; seat++) {
      const at = table.seatLabel(seat);
      if (at) place(plates[seat], at[0], at[1], true);
    }
    for (const b of badges) {
      if (b.hidden || !b.dataset.card) continue;
      const at = table.projectCardCorner(b.dataset.card);
      if (at) place(b, at[0], at[1], false);
    }
    const db = $('discBadge');
    if (!db.hidden) {
      const at = table.discardLabel();
      if (at) place(db, at[0], at[1], true);
    }
  }

  let bannerTimer = 0;
  function banner (over, big, line) {
    const el = $('banner');
    el.innerHTML = '<small>' + over + '</small><strong>' + big + '</strong><span>' + line + '</span>';
    el.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => el.classList.remove('show'), 1700);
  }

  let sheetAction = null;
  function showSheet (html, button, action) {
    $('sheetBody').innerHTML = html;
    const btn = $('sheetBtn');
    if (button) { btn.hidden = false; btn.textContent = button; } else btn.hidden = true;
    sheetAction = action;
    $('overlay').hidden = false;
    if (button) btn.focus();
  }
  function hideSheet () {
    $('overlay').hidden = true;
    sheetAction = null;
    $('sheetBody').textContent = '';
  }
  $('sheetBtn').addEventListener('click', () => {
    const act = sheetAction;
    rememberFields();   // read the inputs before hideSheet() removes them
    hideSheet();
    if (act) act();
  });

  function resize () {
    table.resize($('bottom').offsetHeight);
  }
  window.addEventListener('resize', resize);

  // --------------------------------------------------------- opening screen
  function pills (kind, items, chosen, tight) {
    return '<div class="pick' + (tight ? ' tight' : '') + '">' + items.map(it =>
      '<button type="button" data-k="' + kind + '" data-v="' + it.v + '"' +
      (it.v === chosen ? ' class="on"' : '') + '>' + it.t + '</button>').join('') + '</div>';
  }
  function setupHTML () {
    const decks = deckCountFor(setup.players);
    const shift = SHIFT_COPY[setup.shift];
    const len = GAME_LENGTHS.find(g => g.k === setup.length);
    return '<h2>Remainder Rummy</h2>' +
      '<p>Sets are three or more cards that share a remainder. Draw one card, discard one. ' +
      'Go out when every card in your hand sits in a set, and everyone else scores the value ' +
      'of their loose cards. Lowest total wins.</p>' +
      '<p class="over">Players</p>' +
      pills('n', [2, 3, 4, 5, 6].map(v => ({ v, t: v })), setup.players, true) +
      '<p class="note">' + decks + ' deck' + (decks > 1 ? 's' : '') + ' · 7 cards each · ' +
      'a lap of the table is ' + setup.players + ' turns</p>' +
      '<p class="over">Divisor shift</p>' +
      pills('s', SHIFT_MODES.map(k => ({ v: k, t: SHIFT_COPY[k].label })), setup.shift) +
      '<p class="note">' + shift.desc + '</p>' +
      '<p class="over">Game</p>' +
      pills('g', GAME_LENGTHS.map(g => ({ v: g.k, t: g.label })), setup.length) +
      '<p class="note">' + (len.target
        ? 'Keep playing until someone passes ' + len.target + ' points. Lowest total then wins.'
        : 'Play ' + len.rounds + ' rounds, then compare totals.') + '</p>' +
      (!ONLINE_ENABLED ? '' :
      '<p class="over">Table</p>' +
      pills('o', [{ v: 'off', t: 'On this device' }, { v: 'on', t: 'Online' }], setup.online ? 'on' : 'off') +
      (setup.online
        ? '<div class="field"><label for="pname">Your name</label>' +
          '<input id="pname" type="text" value="' + setup.name + '" autocomplete="off" maxlength="16">' +
          '<label for="srv">Server</label>' +
          '<input id="srv" type="text" value="' + setup.url + '" autocomplete="off" spellcheck="false">' +
          '<label for="room">Room</label>' +
          '<input id="room" type="text" value="' + setup.room + '" autocomplete="off" spellcheck="false">' +
          '</div><p class="note">Needs the server in /server running. Everyone who joins the same ' +
          'room sits at the same table, and empty seats are filled with bots.</p>'
        : '<p class="note">You and ' + (setup.players - 1) + ' computer players, no connection needed.</p>'));
  }
  function dealLabel () {
    return setup.online ? 'Join the table' : 'Deal for ' + setup.players + ' players';
  }
  function showSetup () {
    if (transport) { transport.close(); transport = null; }
    view = null;
    myHand = [];
    awaiting = null;
    refreshHUD();
    showSheet(setupHTML(), dealLabel(), begin);
  }

  function rulesHTML () {
    const mode = SHIFT_COPY[view ? view.shiftMode : setup.shift];
    return '<h2>How to play</h2><ol>' +
      '<li>Every round has a divisor. Divide a card’s value by it and keep the <em>remainder</em>. ' +
      'Ace is 1, Jack 11, Queen 12, King 13.</li>' +
      '<li>A set is three or more cards with the same remainder. With ÷ 4, the 5, 9 and King all leave 1.</li>' +
      '<li>On your turn, draw one card from the stock or the discard pile, then discard one.</li>' +
      '<li>Go out by making every card in your hand part of a set. Everyone else takes the value of ' +
      'their loose cards as penalty points.</li>' +
      '<li>When the divisor shifts, every remainder changes and your sets rearrange.</li></ol>' +
      '<p>This table is playing the <em>' + mode.label + '</em> shift. ' + mode.desc + '</p>' +
      '<p>The coloured tags above your cards show each remainder. A filled tag means that card is ' +
      'already in a set.</p>';
  }

  $('sheetBody').addEventListener('click', ev => {
    let el = ev.target;
    while (el && el !== ev.currentTarget && !(el.getAttribute && el.getAttribute('data-k'))) el = el.parentNode;
    if (!el || el === ev.currentTarget || !el.getAttribute) return;
    const kind = el.getAttribute('data-k');
    const value = el.getAttribute('data-v');
    if (kind === 'd') {
      const resolve = pendingPick;
      pendingPick = null;
      hideSheet();
      if (resolve) resolve(Number(value));
      return;
    }
    if (kind === 'n') setup.players = Number(value);
    else if (kind === 's') setup.shift = value;
    else if (kind === 'g') setup.length = value;
    else if (kind === 'o') setup.online = value === 'on';
    rememberFields();
    $('sheetBody').innerHTML = setupHTML();
    $('sheetBtn').textContent = dealLabel();
  });
  function rememberFields () {
    const srv = $('srv');
    const room = $('room');
    const name = $('pname');
    if (srv) setup.url = srv.value.trim() || setup.url;
    if (room) setup.room = room.value.trim() || setup.room;
    if (name) setup.name = name.value.trim().slice(0, 16) || setup.name;
  }

  $('btnRules').addEventListener('click', () => { if ($('overlay').hidden) showSheet(rulesHTML(), 'Back to the table', null); });
  $('btnNew').addEventListener('click', () => {
    if (pendingPick) { const r = pendingPick; pendingPick = null; r(4); }
    showSetup();
  });

  // ------------------------------------------------------------ the events
  function handSorted () {
    return sortByRemainder(myHand, view ? view.divisor : 4);
  }
  function resortHand () { myHand = handSorted(); }

  async function onEvent (event) {
    switch (event.t) {
      case 'gameStart': {
        const n = event.players.length;
        const mineAt = event.players.findIndex(p => p.id === transport.me);
        seatOf = new Map();
        nameOf = new Map();
        event.players.forEach((p, i) => {
          seatOf.set(p.id, (i - mineAt + n) % n);
          nameOf.set(p.id, p.id === transport.me ? 'You' : p.name);
        });
        makePlates(n);
        break;
      }

      case 'roundStart': {
        busy = true;
        myHand = [];
        selected = null;
        discardPile = [];
        const n = seatOf.size;
        const settle = table.newDeal(deckCountFor(n), n);
        table.setDivisor(event.divisor, false);
        setStatus('Dealing round ' + event.round + '.');
        refreshHUD();
        await pace(settle);
        break;
      }

      case 'deal': {
        const seat = seatOf.get(event.player);
        // Deliberately not awaited: cards should keep leaving the dealer's
        // hand while the last one is still in the air.
        table.dealTo(seat, event.card);
        if (event.card) { myHand.push(event.card); resortHand(); }
        refreshHUD();
        await pace(seatOf.size >= 5 ? 40 : 55);
        break;
      }

      case 'upcard':
        discardPile.push(event.card);
        await pace(420);
        await table.placeUpcard(event.card);
        await pace(560);
        break;

      case 'draw': {
        const seat = seatOf.get(event.player);
        if (event.from === 'discard') { discardPile.pop(); await table.takeDiscard(seat, event.card); }
        else await table.dealTo(seat, event.card);
        if (event.card && event.player === transport.me) { myHand.push(event.card); resortHand(); }
        refreshHUD();
        break;
      }

      case 'discard': {
        const seat = seatOf.get(event.player);
        discardPile.push(event.card);
        if (event.player === transport.me) {
          myHand = myHand.filter(c => c.id !== event.card.id);
          selected = null;
        } else {
          setStatus(nameOf.get(event.player) + ' discards the ' + cardHTML(event.card) + '.');
        }
        await table.discardFrom(seat, event.card);
        refreshHUD();
        break;
      }

      case 'reshuffle': {
        discardPile = discardPile.slice(-1);
        setStatus('The stock ran out, so the discard pile is shuffled back in.');
        await pace(table.reshuffle());
        break;
      }

      case 'shift': {
        table.setDivisor(event.divisor, true);
        resortHand();
        const who = event.by ? nameOf.get(event.by) : null;
        const line = who
          ? (event.by === transport.me ? 'Your call.' : who + ' called it.')
          : (event.reason === 'king' ? 'A King turned it over.' : 'New remainders. Check your sets.');
        banner('The divisor shifts', '÷ ' + event.divisor, line);
        setStatus('The divisor is now ' + event.divisor + '. Every remainder has changed.');
        refreshHUD();
        await pace(1900);
        break;
      }

      case 'choiceNeeded':
        if (event.player !== transport.me) {
          setStatus(nameOf.get(event.player) + ' is holding the most loose points and is choosing the next divisor.');
        }
        break;

      case 'roundEnd': {
        busy = true;
        refreshHUD();
        const winner = event.winner;
        setStatus(winner === null
          ? 'Nobody went out. Everyone counts their loose cards.'
          : (winner === transport.me ? 'You went out. Every card is in a set.'
            : nameOf.get(winner) + ' goes out.'));
        const bySeat = [];
        for (const r of event.results) bySeat[seatOf.get(r.id)] = r.hand;
        await pace(table.revealHands(bySeat));
        await showResults(event);
        break;
      }

      case 'gameEnd': {
        busy = true;
        let html = '<p class="over">Final standings · lowest total wins</p>';
        const best = event.standings[0].score;
        const winners = event.standings.filter(s => s.score === best);
        html += '<h2>' + (winners.length > 1 ? 'A tie at the top'
          : (winners[0].id === transport.me ? 'You win the table' : winners[0].name + ' wins the table')) +
          '</h2><div class="res">';
        for (const s of event.standings) {
          html += '<div class="res-row' + (s.score === best ? ' win' : '') + '">' +
            '<div class="res-head"><span class="res-name">' + (s.id === transport.me ? 'You' : s.name) +
            '</span><span class="res-pts">' + s.score + ' pts</span></div></div>';
        }
        showSheet(html + '</div>', 'New game', showSetup);
        break;
      }

      case 'await': {
        awaiting = {
          player: event.player, kind: event.kind,
          options: event.options, justTook: event.justTook
        };
        busy = false;
        if (event.kind === 'next') break;
        if (event.player === transport.me) {
          if (event.kind === 'draw') {
            const top = topDiscard();
            setStatus('Your turn. Draw from the stock' +
              (top ? ', or take the ' + cardHTML(top) + ' (remainder ' + (top.value % event.divisor) + ')' : '') + '.');
          } else if (event.kind === 'discard') {
            setStatus('Tap a card to choose it, then tap it again to discard.');
          } else if (event.kind === 'choice') {
            await askForDivisor(event.options || []);
          }
        } else if (event.kind !== 'choice') {
          setStatus(nameOf.get(event.player) + ' is thinking.');
        }
        refreshHUD();
        break;
      }
    }
  }

  async function showResults (event) {
    const divisor = event.divisor;
    let html = '<p class="over">Round ' + view.round + (view.target ? '' : ' of ' + view.rounds) +
      ' · scored at ÷ ' + divisor + '</p><h2>' +
      (event.winner === null ? 'Nobody went out'
        : (event.winner === transport.me ? 'You went out' : nameOf.get(event.winner) + ' went out')) +
      '</h2><div class="res">';
    for (const r of event.results) {
      const groups = groupByRemainder(r.hand, divisor);
      const keys = Object.keys(groups).map(Number).sort((a, b) => a - b);
      html += '<div class="res-row' + (r.id === event.winner ? ' win' : '') + '">' +
        '<div class="res-head"><span class="res-name">' + nameOf.get(r.id) + '</span>' +
        '<span class="res-pts">' + (r.id === event.winner ? 'Out' : '+' + r.points) + '</span>' +
        '<span class="res-total">' + r.total + ' total</span></div><div class="res-cards">' +
        keys.map(k => '<span class="grp ' + (groups[k].length >= 3 ? 'set' : 'loose') +
          '" style="--c:var(--r' + k + ')"><b>r' + k + '</b>' +
          groups[k].map(cardHTML).join(' ') + '</span>').join('') +
        '</div></div>';
    }
    html += '</div><p>Solid boxes are sets. Dashed boxes are loose cards, and their values count against you.</p>';
    await new Promise(resolve => {
      showSheet(html, event.more ? 'Deal the next round' : 'See the final standings', () => {
        transport.send({ type: 'next' });
        resolve();
      });
    });
  }

  // The online waiting room. Deliberately plain: everyone who types the same
  // room name lands here, and the first to press Deal starts the table.
  function showLobby (players, started, room) {
    if (started) { if (!$('overlay').hidden) hideSheet(); return; }
    const len = GAME_LENGTHS.find(g => g.k === setup.length);
    const seats = players.map(p =>
      '<div class="res-row"><div class="res-head"><span class="res-name">' +
      (p.id === transport.me ? p.name + ' (you)' : p.name) + '</span>' +
      '<span class="res-total">' + (p.bot ? 'bot' : 'ready') + '</span></div></div>').join('');
    showSheet(
      '<p class="over">Room · ' + (room || setup.room) + '</p>' +
      '<h2>Waiting for players</h2>' +
      '<div class="res">' + seats + '</div>' +
      '<p class="note">Anyone who joins the room <em>' + (room || setup.room) + '</em> on this ' +
      'server sits down here. Deal when you are ready and any empty seats are filled with bots. ' +
      'Table of ' + setup.players + ', ' + SHIFT_COPY[setup.shift].label.toLowerCase() + ' shift, ' +
      (len.target ? 'race to ' + len.target : len.rounds + ' rounds') + '.</p>',
      'Deal the table',
      () => transport.startTable({
        playerCount: setup.players,
        shiftMode: setup.shift,
        rounds: len.rounds,
        target: len.target
      }));
    setStatus(players.length + ' at the table. Waiting to deal.');
  }

  function askForDivisor (options) {
    return new Promise(resolve => {
      pendingPick = d => { transport.send({ type: 'choose', divisor: d }); resolve(); };
      setStatus('You hold the most loose points, so the next divisor is your call.');
      showSheet('<h2>Your call</h2><p>You are holding the most loose points, so you choose the ' +
        'next divisor.</p><div class="pick">' +
        options.map(d => '<button type="button" data-k="d" data-v="' + d + '"><b>÷ ' + d +
          '</b><i>' + loosePoints(myHand, d) + ' loose</i></button>').join('') +
        '</div><p class="note">Each figure is what your hand would score if the round ended on that ' +
        'divisor. Your hand: ' + myHand.map(cardHTML).join(' ') + '</p>', null, null);
    });
  }

  function onView (next) {
    view = next;
    // The host is the authority on what I hold; keep the display honest.
    if (view.you && !busy) {
      const ids = new Set(view.you.hand.map(c => c.id));
      if (myHand.length !== ids.size || myHand.some(c => !ids.has(c.id))) {
        myHand = sortByRemainder(view.you.hand, view.divisor);
      }
    }
    refreshHUD();
  }

  // ------------------------------------------------------------------ input
  const canvas = $('stage');
  canvas.addEventListener('pointermove', ev => {
    if (ev.pointerType !== 'mouse') return;
    const hit = table.pickAt(ev.clientX, ev.clientY);
    canvas.style.cursor = hit ? 'pointer' : 'default';
    hovered = (awaiting && awaiting.kind === 'discard' && hit && hit.kind === 'hand') ? hit.cardId : null;
    table.setMyHand(myHand.map(c => c.id), view ? view.divisor : 4, selected, hovered);
  });
  canvas.addEventListener('click', ev => {
    if (!awaiting || busy || awaiting.player !== transport.me) return;
    const hit = table.pickAt(ev.clientX, ev.clientY);
    if (!hit) return;
    if (awaiting.kind === 'draw') {
      if (hit.kind === 'stock') play({ type: 'draw', from: 'stock' });
      else if (hit.kind === 'discard') play({ type: 'draw', from: 'discard' });
    } else if (awaiting.kind === 'discard' && hit.kind === 'hand') {
      if (selected === hit.cardId && hit.cardId !== awaiting.justTook) play({ type: 'discard', card: hit.cardId });
      else { selected = hit.cardId; refreshHUD(); }
    }
  });
  $('btnStock').addEventListener('click', () => play({ type: 'draw', from: 'stock' }));
  $('btnTake').addEventListener('click', () => play({ type: 'draw', from: 'discard' }));
  $('btnDiscard').addEventListener('click', () => {
    if (selected && awaiting && selected !== awaiting.justTook) play({ type: 'discard', card: selected });
  });
  document.addEventListener('keydown', ev => {
    if (!awaiting || awaiting.kind !== 'discard' || !$('overlay').hidden || busy) return;
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    const at = myHand.findIndex(c => c.id === selected);
    const next = ev.key === 'ArrowRight'
      ? myHand[(at + 1) % myHand.length]
      : myHand[(at <= 0 ? myHand.length : at) - 1];
    if (next) { selected = next.id; refreshHUD(); }
    ev.preventDefault();
  });

  function play (action) {
    if (!transport || busy) return;
    busy = true;
    selected = null;
    hovered = null;
    refreshHUD();
    transport.send(action);
  }

  // ------------------------------------------------------------------ start
  function begin () {
    rememberFields();
    if (!ONLINE_ENABLED) setup.online = false;
    const len = GAME_LENGTHS.find(g => g.k === setup.length);
    const options = {
      shiftMode: setup.shift,
      rounds: len.rounds,
      target: len.target
    };
    const handlers = {
      onEvent,
      onView,
      onLobby: showLobby,
      onError: err => setStatus(err.message || String(err)),
      onStatus: text => setStatus(text)
    };
    if (transport) transport.close();
    if (setup.online) {
      transport = createRemoteTable({ url: setup.url, room: setup.room, name: setup.name }, handlers);
      transport.start();
      setStatus('Connecting to ' + setup.url + '…');
    } else {
      transport = createLocalTable({
        playerCount: setup.players,
        options,
        pacing: { think: setup.players >= 5 ? 400 : 650, settle: setup.players >= 5 ? 180 : 240 }
      }, handlers);
      transport.start();
    }
  }

  resize();
  refreshHUD();
  showSetup();
}
