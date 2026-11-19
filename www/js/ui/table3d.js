// The 3D table.
//
// This module draws things and knows nothing about the rules. It owns a pool of
// card "slots" — meshes with no fixed identity — and the controller tells it
// when a slot moves and, if the player is allowed to know, which card it is.
// That indirection is what makes an online game possible: an opponent's hand is
// real cards on screen but face-down nothings in memory, and a card only gains
// a face at the moment the server reveals it.

const THREE = globalThis.THREE;

const CARD_W = 0.9;
const CARD_H = 1.26;
const TABLE_R = 5.2;
const STOCK_AT = [-0.85, 0.5];
const DISCARD_AT = [0.85, 0.5];
const HAND_DEPTH = 6;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RED = [false, true, true, false];

// Where people sit. You are always at the bottom; the rest fill the far arc in
// clockwise order so nobody is hidden behind your own cards.
const SEAT_ARCS = {
  2: [0], 3: [292, 68], 4: [270, 0, 90],
  5: [257, 326, 34, 103], 6: [250, 305, 0, 55, 110]
};

export function createTable (opts) {
  const canvas = opts.canvas;
  const host = opts.host;
  const reduceMotion = !!opts.reduceMotion;
  const timeScale = reduceMotion ? 0.01 : 1;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch (err) {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const srgb = hex => new THREE.Color(hex).convertSRGBToLinear();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 150);
  const lookAt = new THREE.Vector3(0, 0, 1.1);

  scene.add(new THREE.AmbientLight(srgb(0xfff0e0), 0.66));
  const sun = new THREE.DirectionalLight(srgb(0xffe6c4), 0.6);
  sun.position.set(2.5, 10, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  function texture (w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.anisotropy = maxAniso;
    return t;
  }

  // ----------------------------------------------------------- the furniture
  const feltTex = texture(512, 512, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w / 2);
    g.addColorStop(0, '#93293d'); g.addColorStop(0.7, '#7d2134'); g.addColorStop(1, '#561422');
    x.fillStyle = g; x.fillRect(0, 0, w, h);
    for (let i = 0; i < 9000; i++) {
      x.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.05)';
      x.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5);
    }
    x.strokeStyle = 'rgba(224,176,90,.4)'; x.lineWidth = 2;
    x.beginPath(); x.arc(w / 2, h / 2, w * 0.455, 0, Math.PI * 2); x.stroke();
  });
  const wood = new THREE.MeshPhongMaterial({ color: srgb(0x5b3520), specular: srgb(0x8a6a44), shininess: 50 });
  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_R, TABLE_R, 0.5, 72),
    [wood, new THREE.MeshLambertMaterial({ map: feltTex }), wood]);
  table.position.y = -0.25;
  table.receiveShadow = true;
  scene.add(table);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(TABLE_R, 0.17, 14, 96), wood);
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.02;
  scene.add(rim);

  // The divisor, printed on the felt, flipping over when it changes.
  const decalCanvas = document.createElement('canvas');
  decalCanvas.width = 512; decalCanvas.height = 256;
  const decalTex = new THREE.CanvasTexture(decalCanvas);
  decalTex.encoding = THREE.sRGBEncoding;
  function paintDecal (d) {
    const x = decalCanvas.getContext('2d');
    x.clearRect(0, 0, 512, 256);
    x.fillStyle = 'rgba(240,214,160,.6)';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = 'bold 190px Georgia,"Times New Roman",serif';
    x.fillText('÷' + d, 256, 132);
    decalTex.needsUpdate = true;
  }
  paintDecal(4);
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(2.8, 1.4),
    new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, depthWrite: false }));
  decal.rotation.x = -Math.PI / 2;
  decal.position.set(0, 0.006, -1.75);
  scene.add(decal);
  let decalFlip = null;

  // ---------------------------------------------------------------- the cards
  function roundedCard (w, h, r) {
    const s = new THREE.Shape(); const x = -w / 2; const y = -h / 2;
    s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  const cardGeo = new THREE.ShapeGeometry(roundedCard(CARD_W, CARD_H, 0.07), 6);
  (function fixUVs () {
    const p = cardGeo.attributes.position; const u = cardGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      u.setXY(i, (p.getX(i) + CARD_W / 2) / CARD_W, (p.getY(i) + CARD_H / 2) / CARD_H);
    }
    u.needsUpdate = true;
  })();

  const faceCache = {};
  function faceMaterial (value, suit) {
    const key = suit * 13 + value;
    if (faceCache[key]) return faceCache[key];
    const map = texture(256, 512, x => {
      x.scale(1, 512 / 358);
      x.fillStyle = '#f6efdf'; x.fillRect(0, 0, 256, 358);
      x.strokeStyle = 'rgba(70,45,55,.28)'; x.lineWidth = 3; x.strokeRect(7, 7, 242, 344);
      x.fillStyle = RED[suit] ? '#b3202e' : '#1d1826';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      const corner = () => {
        x.font = 'bold 46px Georgia,"Times New Roman",serif';
        x.fillText(RANKS[value - 1], 38, 42);
        x.font = '38px Georgia,serif';
        x.fillText(SUITS[suit], 38, 86);
      };
      corner();
      x.save(); x.translate(256, 358); x.rotate(Math.PI); corner(); x.restore();
      x.font = 'bold 124px Georgia,"Times New Roman",serif';
      x.fillText(String(value), 128, 166);
      x.font = '52px Georgia,serif';
      x.fillText(SUITS[suit], 128, 258);
    });
    faceCache[key] = new THREE.MeshLambertMaterial({ map });
    return faceCache[key];
  }
  const blankFace = new THREE.MeshLambertMaterial({ color: srgb(0xf6efdf) });
  const backMaterial = new THREE.MeshLambertMaterial({
    map: texture(256, 512, (x, w, h) => {
      x.fillStyle = '#f6efdf'; x.fillRect(0, 0, w, h);
      x.fillStyle = '#1f2a4a'; x.fillRect(14, 20, w - 28, h - 40);
      x.strokeStyle = 'rgba(224,176,90,.55)'; x.lineWidth = 2;
      for (let i = -h; i < w + h; i += 26) {
        x.beginPath(); x.moveTo(i, 20); x.lineTo(i + h, h - 20); x.stroke();
        x.beginPath(); x.moveTo(i, h - 20); x.lineTo(i + h, 20); x.stroke();
      }
      x.fillStyle = '#f6efdf';
      x.fillRect(0, 0, w, 20); x.fillRect(0, h - 20, w, 20);
      x.fillRect(0, 0, 14, h); x.fillRect(w - 14, 0, 14, h);
      x.strokeStyle = '#e0b05a'; x.lineWidth = 4; x.strokeRect(22, 32, w - 44, h - 64);
    })
  });

  const V3 = THREE.Vector3;
  const QUAT = THREE.Quaternion;
  const AXIS_X = new V3(1, 0, 0);
  const AXIS_Y = new V3(0, 1, 0);
  const spinX = a => new QUAT().setFromAxisAngle(AXIS_X, a);
  const spinY = a => new QUAT().setFromAxisAngle(AXIS_Y, a);
  const FACE_DOWN = spinX(Math.PI / 2);
  const FACE_UP = spinX(-Math.PI / 2);

  const MAX_SLOTS = 104;
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    const group = new THREE.Group();
    const front = new THREE.Mesh(cardGeo, blankFace);
    const back = new THREE.Mesh(cardGeo, backMaterial);
    front.position.z = 0.004;
    back.rotation.y = Math.PI; back.position.z = -0.004;
    front.castShadow = back.castShadow = true;
    group.add(front); group.add(back);
    const slot = {
      index: i, group, front, back,
      cardId: null, value: 0, suit: 0,
      tween: null, followsCamera: false, bobbing: false, restY: 0,
      target: { pos: new V3(), quat: new QUAT(), scale: 1 }
    };
    group.userData.slot = slot;
    scene.add(group);
    slots.push(slot);
  }
  const stockSpot = i => new V3(STOCK_AT[0], 0.012 + i * 0.004, STOCK_AT[1]);
  const discardSpot = i => new V3(DISCARD_AT[0], 0.012 + i * 0.008, DISCARD_AT[1]);
  const discardTilt = () => spinY((Math.random() - 0.5) * 0.5).multiply(FACE_UP);

  function setFace (slot, card) {
    if (!card) return;
    slot.cardId = card.id;
    slot.value = card.value;
    slot.suit = card.suit;
    slot.front.material = faceMaterial(card.value, card.suit);
    byId.set(card.id, slot);
  }
  function clearFace (slot) {
    if (slot.cardId) byId.delete(slot.cardId);
    slot.cardId = null;
    slot.front.material = blankFace;
  }
  function castShadow (slot, on) {
    slot.front.castShadow = on;
    slot.back.castShadow = on;
  }

  function move (slot, pos, quat, options) {
    const o = options || {};
    if (slot.tween) slot.tween.done();
    return new Promise(resolve => {
      slot.tween = {
        fromPos: slot.group.position.clone(),
        fromQuat: slot.group.quaternion.clone(),
        fromScale: slot.group.scale.x,
        toPos: pos, toQuat: quat, toScale: o.scale === undefined ? 1 : o.scale,
        startedAt: performance.now() + (o.delay || 0) * timeScale,
        duration: Math.max(1, (o.duration || 420) * timeScale),
        lift: o.lift || 0,
        done: resolve
      };
    });
  }

  // -------------------------------------------------------------- the tableau
  const byId = new Map();          // engine card id -> slot, once we may know it
  let stock = [];                  // slots, face-down
  let discard = [];                // slots, face-up
  let hands = [];                  // per seat, array of slots
  let seats = [];                  // geometry per seat
  let seatCount = 4;
  let myOrder = [];                // card ids, left to right in my hand
  let myDivisor = 4;
  let mySelected = null;
  let myHover = null;
  let bobbing = [];

  function seatGeometry (n) {
    const out = [null];
    for (const deg of SEAT_ARCS[n]) {
      const f = deg * Math.PI / 180;
      const x = 4.0 * Math.sin(f);
      const z = -3.4 * Math.cos(f) + 0.1;
      out.push({
        pos: [x, z], angle: -f,
        label: [Math.max(-5, Math.min(5, x * 1.18)), z - 1.5]
      });
    }
    return out;
  }

  function layoutSeat (seat, faceUp) {
    const geo = seats[seat];
    if (!geo) return Promise.resolve();
    const row = hands[seat];
    const n = row.length;
    const spacing = faceUp ? (seatCount >= 5 ? 0.4 : 0.5) : (seatCount >= 5 ? 0.3 : 0.34);
    let last = Promise.resolve();
    row.forEach((slot, i) => {
      const off = (i - (n - 1) / 2) * spacing;
      const pos = new V3(
        geo.pos[0] + Math.cos(geo.angle) * off,
        0.012 + i * 0.006,
        geo.pos[1] - Math.sin(geo.angle) * off);
      const far = slot.group.position.distanceTo(pos) > 1;
      last = move(slot, pos, spinY(geo.angle).multiply(faceUp ? FACE_UP : FACE_DOWN),
        { duration: far ? 460 : 300, lift: far ? 0.7 : (faceUp ? 0.35 : 0) });
    });
    return last;
  }

  // ---------------------------------------------------------- camera and hand
  let viewW = 1;
  let viewH = 1;
  let gutter = 70;

  // How much room the footer needs. Your hand is laid out just above it, so
  // this has to be re-read whenever the footer changes height — which it does
  // every time the buttons appear or the status text wraps to another line.
  function setGutter (px) {
    gutter = px;
  }

  function resize (footerHeight) {
    viewW = host.clientWidth || 1;
    viewH = host.clientHeight || 1;
    if (footerHeight !== undefined) gutter = footerHeight;
    renderer.setSize(viewW, viewH, false);
    camera.aspect = viewW / viewH;
    const portrait = Math.max(0, Math.min(1, (1.25 - camera.aspect) / 0.75));
    const dir = new V3(0, 1, 0.95 - 0.45 * portrait).normalize();
    const vFov = camera.fov * Math.PI / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
    const dist = Math.max(12.5, (5.5 - 1.0 * portrait) / Math.tan(hFov / 2));
    camera.position.copy(lookAt).addScaledVector(dir, dist);
    camera.lookAt(lookAt);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  const scratch = new V3();
  function layoutMyHand () {
    const n = myOrder.length;
    if (!n) return;
    const visH = 2 * HAND_DEPTH * Math.tan(camera.fov * Math.PI / 360);
    const visW = visH * camera.aspect;
    const perPixel = visH / viewH;
    const rem = [];
    for (const id of myOrder) {
      const slot = byId.get(id);
      rem.push(slot ? slot.value % myDivisor : 0);
    }
    let gaps = 0;
    for (let i = 1; i < n; i++) if (rem[i] !== rem[i - 1]) gaps++;
    const units = (n - 1) + gaps * 0.3;
    const scale = Math.min(0.25 * visH / CARD_H, 0.9 * visW / (CARD_W * (1 + units * 0.58)));
    const width = CARD_W * scale;
    const step = units > 0 ? Math.min(width * 1.06, (0.94 * visW - width) / units) : 0;
    let x = -step * units / 2;
    const y = -visH / 2 + (gutter + 8) * perPixel + CARD_H * scale / 2;
    for (let i = 0; i < n; i++) {
      const slot = byId.get(myOrder[i]);
      if (!slot) continue;
      if (i > 0) x += step * (rem[i] !== rem[i - 1] ? 1.3 : 1);
      const raise = (myOrder[i] === mySelected ? 0.22 : (myOrder[i] === myHover ? 0.07 : 0)) * CARD_H * scale;
      scratch.set(x, y + raise, -HAND_DEPTH + i * 0.015);
      camera.localToWorld(scratch);
      slot.target.pos.copy(scratch);
      slot.target.quat.copy(camera.quaternion);
      slot.target.scale = scale;
    }
  }

  // ------------------------------------------------------------------ picking
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pickable = [];

  function pickAt (clientX, clientY) {
    if (!pickable.length) return null;
    const box = canvas.getBoundingClientRect();
    pointer.set(((clientX - box.left) / box.width) * 2 - 1,
      -((clientY - box.top) / box.height) * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const hits = ray.intersectObjects(pickable.map(s => s.group), true);
    if (!hits.length) return null;
    let obj = hits[0].object;
    while (obj && !obj.userData.slot) obj = obj.parent;
    return obj ? obj.userData.slot : null;
  }

  // -------------------------------------------------------------- frame loop
  let lastFrame = performance.now();
  function frame (now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    layoutMyHand();
    const ease = reduceMotion ? 1 : 1 - Math.exp(-dt * 13);

    for (const slot of slots) {
      const g = slot.group;
      const tw = slot.tween;
      if (tw) {
        let t = (now - tw.startedAt) / tw.duration;
        if (t < 0) continue;
        if (t > 1) t = 1;
        const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        g.position.lerpVectors(tw.fromPos, tw.toPos, e);
        g.position.y += Math.sin(Math.PI * t) * tw.lift;
        g.quaternion.copy(tw.fromQuat).slerp(tw.toQuat, e);
        g.scale.setScalar(tw.fromScale + (tw.toScale - tw.fromScale) * e);
        if (t === 1) { slot.tween = null; slot.restY = tw.toPos.y; tw.done(); }
      } else if (slot.followsCamera) {
        g.position.lerp(slot.target.pos, ease);
        g.quaternion.slerp(slot.target.quat, ease);
        g.scale.setScalar(g.scale.x + (slot.target.scale - g.scale.x) * ease);
      } else if (slot.bobbing && !reduceMotion) {
        g.position.y = slot.restY + 0.06 + 0.05 * Math.sin(now / 170);
      }
    }

    if (decalFlip) {
      const t = Math.min(1, (now - decalFlip.startedAt) / 700);
      if (t >= 0.5 && !decalFlip.painted) { paintDecal(decalFlip.value); decalFlip.painted = true; }
      decal.scale.x = Math.max(0.02, Math.abs(Math.cos(Math.PI * t)));
      if (t === 1) { decal.scale.x = 1; decalFlip = null; }
    }

    renderer.render(scene, camera);
    if (opts.onFrame) opts.onFrame();
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------- the API
  return {
    resize,
    setGutter,

    seatCount: () => seatCount,

    // Start a fresh deal: every slot goes back into the stock, face blank.
    newDeal (deckCount, players) {
      seatCount = players;
      seats = seatGeometry(players);
      hands = [];
      for (let i = 0; i < players; i++) hands.push([]);
      discard = [];
      stock = [];
      byId.clear();
      myOrder = [];
      bobbing = [];
      const size = deckCount * 52;
      slots.forEach((slot, i) => {
        if (slot.tween) { slot.tween.done(); slot.tween = null; }
        slot.followsCamera = false;
        slot.bobbing = false;
        clearFace(slot);
        const inPlay = i < size;
        slot.group.visible = inPlay;
        castShadow(slot, false);
        if (!inPlay) return;
        stock.push(slot);
        const at = stockSpot(stock.length - 1);
        slot.restY = at.y;
        move(slot, at, FACE_DOWN, { duration: 380, delay: i * 4 });
      });
      return 760 + size * 4;
    },

    // A card leaves the stock for somebody's hand. `card` is null when this
    // player is not allowed to know what it is.
    dealTo (seat, card, flying) {
      const slot = stock.pop();
      if (!slot) return Promise.resolve();
      if (card) setFace(slot, card);
      hands[seat].push(slot);
      castShadow(slot, seat !== 0);
      if (seat === 0) {
        slot.followsCamera = true;
        if (slot.tween) { slot.tween.done(); slot.tween = null; }
        return Promise.resolve();
      }
      return layoutSeat(seat, false);
    },

    // The card turned face up to start the discard pile.
    placeUpcard (card) {
      const slot = stock.pop();
      if (!slot) return Promise.resolve();
      setFace(slot, card);
      castShadow(slot, true);
      discard.push(slot);
      return move(slot, discardSpot(discard.length - 1), discardTilt(), { duration: 480, lift: 0.9 });
    },

    // The top of the discard pile goes to a hand.
    takeDiscard (seat, card) {
      const slot = discard.pop();
      if (!slot) return Promise.resolve();
      if (card) setFace(slot, card);
      hands[seat].push(slot);
      castShadow(slot, seat !== 0);
      if (seat === 0) {
        slot.followsCamera = true;
        if (slot.tween) { slot.tween.done(); slot.tween = null; }
        return Promise.resolve();
      }
      return layoutSeat(seat, false);
    },

    // A card is thrown away, and at that moment everybody learns what it was.
    discardFrom (seat, card) {
      const row = hands[seat];
      let slot = byId.get(card.id);
      let at = row.indexOf(slot);
      if (at < 0) {           // an opponent's unknown card: take any of theirs
        slot = row[row.length - 1];
        at = row.length - 1;
      }
      if (!slot) return Promise.resolve();
      row.splice(at, 1);
      setFace(slot, card);
      slot.followsCamera = false;
      castShadow(slot, true);
      discard.push(slot);
      const flight = move(slot, discardSpot(discard.length - 1), discardTilt(),
        { duration: 460, lift: 0.8 });
      if (seat !== 0) layoutSeat(seat, false);
      return flight;
    },

    reshuffle () {
      const top = discard.pop();
      const rest = discard;
      discard = top ? [top] : [];
      rest.forEach((slot, i) => {
        clearFace(slot);
        castShadow(slot, false);
        stock.push(slot);
        move(slot, stockSpot(stock.length - 1), FACE_DOWN, { duration: 400, delay: i * 10, lift: 0.5 });
      });
      if (top) move(top, discardSpot(0), top.group.quaternion.clone(), { duration: 200 });
      return 700 + rest.length * 10;
    },

    // End of a round: everyone turns their cards over.
    revealHands (bySeat) {
      for (let seat = 1; seat < hands.length; seat++) {
        const known = bySeat[seat] || [];
        hands[seat].forEach((slot, i) => { if (known[i]) setFace(slot, known[i]); });
        layoutSeat(seat, true);
      }
      const mine = hands[0];
      mine.forEach((slot, i) => {
        slot.followsCamera = false;
        castShadow(slot, true);
        move(slot, new V3((i - (mine.length - 1) / 2) * 0.62, 0.012 + i * 0.006, 3.0),
          FACE_UP.clone(), { duration: 520, lift: 0.4, delay: i * 40 });
      });
      return 1700;
    },

    setDivisor (value, animate) {
      if (!animate || reduceMotion) { paintDecal(value); return; }
      decalFlip = { startedAt: performance.now(), value, painted: false };
    },

    // The controller owns the order of my hand; the table just draws it.
    setMyHand (order, divisor, selected, hover) {
      myOrder = order;
      myDivisor = divisor;
      mySelected = selected === undefined ? mySelected : selected;
      myHover = hover === undefined ? myHover : hover;
    },

    // Make the stock and the discard pile hover, to say "your move".
    setBob (which) {
      for (const slot of bobbing) {
        slot.bobbing = false;
        if (!slot.tween && !slot.followsCamera) slot.group.position.y = slot.restY;
      }
      bobbing = [];
      if (which === 'piles') {
        if (stock.length) bobbing.push(stock[stock.length - 1]);
        if (discard.length) bobbing.push(discard[discard.length - 1]);
      }
      for (const slot of bobbing) slot.bobbing = true;
    },

    setPickable (what) {
      if (what === 'piles') {
        pickable = [];
        if (stock.length) pickable.push(stock[stock.length - 1]);
        if (discard.length) pickable.push(discard[discard.length - 1]);
      } else if (what === 'hand') {
        pickable = hands[0] ? hands[0].slice() : [];
      } else {
        pickable = [];
      }
    },

    pickAt (x, y) {
      const slot = pickAt(x, y);
      if (!slot) return null;
      if (stock.length && slot === stock[stock.length - 1]) return { kind: 'stock' };
      if (discard.length && slot === discard[discard.length - 1]) {
        return { kind: 'discard', cardId: slot.cardId };
      }
      if (hands[0] && hands[0].indexOf(slot) >= 0) return { kind: 'hand', cardId: slot.cardId };
      return null;
    },

    myHandIds () {
      return hands[0] ? hands[0].map(s => s.cardId).filter(Boolean) : [];
    },

    // Screen position of a point on the table, for the HTML labels.
    project (x, y, z) {
      scratch.set(x, y, z).project(camera);
      return [(scratch.x * 0.5 + 0.5) * viewW, (-scratch.y * 0.5 + 0.5) * viewH];
    },
    projectCardCorner (cardId) {
      const slot = byId.get(cardId);
      if (!slot) return null;
      scratch.set(-CARD_W / 2 + 0.03, CARD_H / 2, 0);
      slot.group.localToWorld(scratch);
      scratch.project(camera);
      return [(scratch.x * 0.5 + 0.5) * viewW, (-scratch.y * 0.5 + 0.5) * viewH];
    },
    seatLabel (seat) {
      const geo = seats[seat];
      return geo ? this.project(geo.label[0], 0.3, geo.label[1]) : null;
    },
    discardLabel () {
      return this.project(DISCARD_AT[0], 0.3, DISCARD_AT[1] - 0.75);
    },
    size () { return [viewW, viewH]; }
  };
}
