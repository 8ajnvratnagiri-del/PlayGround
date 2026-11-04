/* =====================================================================
   LOS SANTOS 2D — a top-down open-world crime game
   Pure canvas 2D. No external assets. Built to run from a static server.
   ===================================================================== */

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const radarCanvas = document.getElementById('radar');
const rctx = radarCanvas.getContext('2d');

const TAU = Math.PI * 2;
const WORLD_W = 4800;
const WORLD_H = 4800;
const LAND_BOTTOM = 4440;
const BEACH_TOP = 4120;
const ROAD_X = [240, 720, 1200, 1680, 2160, 2640, 3120, 3600, 4080, 4560];
const ROAD_Y = [240, 720, 1200, 1680, 2160, 2640, 3120, 3600, 4080];
const PLAYER_R = 13;
const isTouch = (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const dist2 = (ax, ay, bx, by) => (bx - ax) ** 2 + (by - ay) ** 2;
const angleLerp = (a, b, t) => {
  let d = ((b - a + Math.PI) % TAU + TAU) % TAU - Math.PI;
  return a + d * t;
};
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[Math.floor(Math.random() * arr.length)];
const fmtMoney = (n) => '$' + Math.max(0, Math.floor(n)).toLocaleString('en-US');
const roadWidth = (i) => i % 2 === 0 ? 120 : 84;
const halfRoad = (i) => roadWidth(i) / 2;

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const mapRandom = mulberry32(0x51A7BEEF);

function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function circleRect(cx, cy, r, x, y, w, h) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  return dist2(cx, cy, nx, ny) < r * r;
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function segRect(x1, y1, x2, y2, r) {
  // coarse segment-vs-rect test, enough for bullets
  const steps = Math.max(2, Math.ceil(dist(x1, y1, x2, y2) / 14));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (pointInRect(lerp(x1, x2, t), lerp(y1, y2, t), r)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* DOM                                                                */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const dom = {
  hud: $('hud'), title: $('title-screen'), pause: $('pause-screen'), fail: $('fail-screen'), end: $('end-screen'),
  health: $('health-bar'), armor: $('armor-bar'), cash: $('cash'), wanted: $('wanted'),
  clock: $('clock'), district: $('district'), missionState: $('mission-state'), missionTitle: $('mission-title'),
  missionObjective: $('mission-objective'), missionDistance: $('mission-distance'), weaponHud: $('weapon-hud'),
  weaponName: $('weapon-name'), ammo: $('ammo'), reserve: $('reserve'), weaponIcon: $('weapon-icon'),
  vehicleHud: $('vehicle-hud'), speedNumber: $('speed-number'), speedBar: $('speed-bar'), vehicleName: $('vehicle-name'),
  radio: $('radio-station'), prompt: $('prompt'), promptText: $('prompt-text'), toastStack: $('toast-stack'),
  missionBanner: $('mission-banner'), bannerKicker: $('banner-kicker'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
  start: $('start-btn'), newGame: $('new-game-btn'), touch: $('touch-ui'), joystick: $('joystick'), stick: $('stick'),
  btnFire: $('btn-fire'), btnAction: $('btn-action'), btnSprint: $('btn-sprint'), btnReload: $('btn-reload'),
  btnPause: $('btn-pause'), soundToggle: $('sound-toggle'), pauseCash: $('pause-cash'), pauseMissions: $('pause-missions'),
  pauseWanted: $('pause-wanted'), resume: $('resume-btn'), pauseSound: $('pause-sound-btn'),
  pauseRestart: $('pause-restart-btn'), respawn: $('respawn-btn'), failMenu: $('fail-menu-btn'),
  failKicker: $('fail-kicker'), failTitle: $('fail-title'), failReason: $('fail-reason'),
  endCash: $('end-cash'), endKills: $('end-kills'), endCrashes: $('end-crashes'), freeRoam: $('free-roam-btn'),
  objectiveArrow: $('objective-arrow'), arrowDistance: $('arrow-distance'),
};

/* ------------------------------------------------------------------ */
/* Audio — tiny procedural synthwave + arcade SFX                     */
/* ------------------------------------------------------------------ */

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.noiseBuffer = null;
    this.enabled = true;
    this.musicOn = true;
    this.step = 0;
    this.nextStep = 0;
    this.engineOsc = null;
    this.engineGain = null;
    this.engineFilter = null;
    this.started = false;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.72;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.19;
    this.musicGain.connect(this.master);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.5;
    this.sfxGain.connect(this.master);

    const len = Math.floor(this.ctx.sampleRate * 0.7);
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.nextStep = this.ctx.currentTime + 0.1;
    this.started = true;
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.72 : 0, this.ctx.currentTime, 0.04);
  }

  tone(freq, dur, type = 'sine', vol = 0.1, when = 0, slideTo = null) {
    if (!this.ctx || !this.enabled) return;
    const t = when || this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.sfxGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  noise(dur = 0.1, vol = 0.2, when = 0, freq = 900, type = 'lowpass') {
    if (!this.ctx || !this.enabled || !this.noiseBuffer) return;
    const t = when || this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t); src.stop(t + dur + 0.02);
  }

  shoot() {
    this.noise(0.075, 0.23, 0, 1600, 'highpass');
    this.tone(130, 0.09, 'square', 0.14, 0, 55);
  }

  smg() {
    this.noise(0.045, 0.15, 0, 2100, 'highpass');
    this.tone(190, 0.05, 'square', 0.08, 0, 70);
  }

  hit() {
    this.noise(0.055, 0.12, 0, 700, 'bandpass');
    this.tone(85, 0.08, 'triangle', 0.08, 0, 50);
  }

  reload() {
    this.tone(520, 0.035, 'square', 0.07);
    setTimeout(() => this.tone(340, 0.04, 'square', 0.06), 90);
  }

  explosion() {
    this.noise(0.6, 0.5, 0, 260);
    this.tone(54, 0.55, 'sawtooth', 0.3, 0, 24);
    this.noise(0.2, 0.2, 0.06, 1800, 'highpass');
  }

  pickup() {
    this.tone(660, 0.07, 'sine', 0.1);
    this.tone(990, 0.12, 'sine', 0.08, this.ctx ? this.ctx.currentTime + 0.06 : 0);
  }

  missionComplete() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.32, 'triangle', 0.12, t + i * 0.11));
  }

  missionStart() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    this.tone(110, 0.5, 'sawtooth', 0.1, t, 220);
    this.tone(220, 0.35, 'triangle', 0.08, t + 0.12, 440);
  }

  wasted() {
    const t = this.ctx ? this.ctx.currentTime : 0;
    this.tone(220, 1.0, 'sawtooth', 0.16, t, 55);
    this.tone(110, 1.2, 'triangle', 0.12, t + 0.1, 38);
  }

  buy() {
    this.tone(880, 0.06, 'square', 0.06);
    this.tone(1320, 0.08, 'square', 0.05, this.ctx ? this.ctx.currentTime + 0.05 : 0);
  }

  startEngine() {
    if (!this.ctx || this.engineOsc) return;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 55;
    f.type = 'lowpass'; f.frequency.value = 300;
    g.gain.value = 0.0001;
    o.connect(f); f.connect(g); g.connect(this.sfxGain);
    o.start();
    g.gain.setTargetAtTime(0.045, this.ctx.currentTime, 0.15);
    this.engineOsc = o; this.engineGain = g; this.engineFilter = f;
  }

  updateEngine(speed, throttle) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const abs = Math.abs(speed);
    this.engineOsc.frequency.setTargetAtTime(48 + abs * 0.14 + throttle * 14, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(240 + abs * 0.7, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.025 + Math.min(abs / 500, 1) * 0.04, t, 0.12);
  }

  stopEngine() {
    if (!this.engineOsc) return;
    const o = this.engineOsc, g = this.engineGain;
    try {
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
      setTimeout(() => { try { o.stop(); } catch {} }, 240);
    } catch {}
    this.engineOsc = null; this.engineGain = null; this.engineFilter = null;
  }

  updateMusic() {
    if (!this.ctx || !this.started || !this.enabled || !this.musicOn) return;
    const now = this.ctx.currentTime;
    if (this.nextStep < now - 0.5) this.nextStep = now + 0.05;
    while (this.nextStep < now + 0.22) {
      this.scheduleStep(this.step, this.nextStep);
      this.step = (this.step + 1) % 32;
      this.nextStep += 0.24;
    }
  }

  scheduleStep(step, when) {
    const chords = [
      [45, 57, 60, 64], [41, 53, 57, 60], [48, 60, 64, 67], [43, 55, 59, 62]
    ];
    const bar = Math.floor(step / 8) % 4;
    const chord = chords[bar];
    const s = step % 8;
    if (s === 0 || s === 4) {
      this.bass(chord[0] - 12, 0.36, when);
      this.kick(when);
    }
    if (s === 2 || s === 6) this.snare(when);
    if (s % 2 === 1) this.hat(when, 0.035);
    if (s % 2 === 0) {
      const n = chord[(s / 2 + bar) % 4] + 12;
      this.arp(n, when, 0.18);
    }
    if (s === 0) {
      this.pad(chord.slice(1), when, 1.85);
    }
  }

  bass(freq, dur, when) {
    const t = when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    const f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.value = 440 * 2 ** ((freq - 69) / 12);
    f.type = 'lowpass'; f.frequency.setValueAtTime(420, t); f.frequency.exponentialRampToValueAtTime(120, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(this.musicGain);
    o.start(t); o.stop(t + dur + 0.02);
  }

  arp(midi, when, dur) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.042, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    o.connect(g); g.connect(this.musicGain);
    o.start(when); o.stop(when + dur + 0.02);
  }

  pad(notes, when, dur) {
    notes.forEach((midi, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(0.018, when + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1000;
      o.connect(f); f.connect(g); g.connect(this.musicGain);
      o.start(when); o.stop(when + dur + 0.02);
    });
  }

  kick(when) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(135, when); o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
    g.gain.setValueAtTime(0.16, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.14);
    o.connect(g); g.connect(this.musicGain);
    o.start(when); o.stop(when + 0.16);
  }

  snare(when) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.065, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.12);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(when); src.stop(when + 0.14);
  }

  hat(when, vol) {
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuffer;
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 6500;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    src.connect(f); f.connect(g); g.connect(this.musicGain);
    src.start(when); src.stop(when + 0.04);
  }
}

const audio = new AudioEngine();

/* ------------------------------------------------------------------ */
/* World generation                                                    */
/* ------------------------------------------------------------------ */

const world = {
  buildings: [],
  blocks: [],
  trees: [],
  lamps: [],
  beachProps: [],
  roadNames: {
    v: ['HARBOR DR', 'ALTA ST', 'STRAWBERRY AVE', 'POWER ST', 'VINEWOOD BLVD', 'LAS LAGUNAS BLVD', 'CARCER WAY', 'ELGIN AVE', 'OCEAN DR', 'DOCK ST'],
    h: ['NORTH CONCOURSE', 'VINEWOOD BLVD', 'ALTA ST', 'COUGAR AVE', 'STRAWBERRY AVE', 'LITTLE SEOUL ST', 'LA MESA AVE', 'VESPUCCI BLVD', 'OCEAN DR']
  }
};

const specialBlocks = new Map();
specialBlocks.set('2,4', 'safehouse');
specialBlocks.set('7,5', 'police');
specialBlocks.set('3,3', 'hospital');
specialBlocks.set('1,2', 'ammu');
specialBlocks.set('5,5', 'paynspray');
specialBlocks.set('4,1', 'compound');

function blockBounds(i, j) {
  const l = ROAD_X[i] + halfRoad(i) + 7;
  const r = ROAD_X[i + 1] - halfRoad(i + 1) - 7;
  const t = ROAD_Y[j] + halfRoad(j) + 7;
  const b = ROAD_Y[j + 1] - halfRoad(j + 1) - 7;
  return { x: l, y: t, w: r - l, h: b - t };
}

const BUILDING_COLORS = ['#4b5159', '#5d6268', '#74736d', '#8a7866', '#6c777c', '#9a9285', '#75605a', '#59656b', '#7f6654', '#a0927b'];
const ROOF_COLORS = ['#34383e', '#3e4248', '#4a4c4d', '#5d5147', '#4e575b', '#6f695f', '#53453f', '#3e474c', '#5b4a3c', '#746a59'];

function addBuilding(x, y, w, h, opts = {}) {
  const hgt = opts.hgt ?? mapRandom();
  const color = opts.color || BUILDING_COLORS[Math.floor(mapRandom() * BUILDING_COLORS.length)];
  const roof = opts.roof || ROOF_COLORS[Math.floor(mapRandom() * ROOF_COLORS.length)];
  const b = {
    x, y, w, h,
    color, roof,
    hgt,
    shadowX: 5 + hgt * 9,
    shadowY: 7 + hgt * 13,
    detail: Math.floor(mapRandom() * 7),
    special: opts.special || null,
    sign: opts.sign || null,
    acs: [],
    vents: [],
  };
  if (w > 55 && h > 45) {
    const count = Math.floor(mapRandom() * 3) + (hgt > 0.65 ? 1 : 0);
    for (let i = 0; i < count; i++) {
      b.acs.push({
        x: x + 12 + mapRandom() * (w - 44),
        y: y + 12 + mapRandom() * (h - 42),
        w: 13 + mapRandom() * 15,
        h: 9 + mapRandom() * 11,
        rot: mapRandom() > 0.65 ? Math.PI / 2 : 0
      });
    }
    if (hgt > 0.7 && w > 110 && h > 100 && mapRandom() > 0.7) {
      b.helipad = { x: x + w * 0.5, y: y + h * 0.5, r: Math.min(w, h) * 0.16 };
    }
  }
  world.buildings.push(b);
  return b;
}

function addTree(x, y, type = 'round', size = 1) {
  world.trees.push({ x, y, type, size, seed: mapRandom() * 100 });
}

function addLamp(x, y) {
  world.lamps.push({ x, y, phase: mapRandom() * TAU });
}

function generateWorld() {
  // Special landmark blocks
  for (let i = 0; i < ROAD_X.length - 1; i++) {
    for (let j = 0; j < ROAD_Y.length - 1; j++) {
      const bounds = blockBounds(i, j);
      const kind = specialBlocks.get(`${i},${j}`) || null;
      const region = blockRegion(bounds.x + bounds.w / 2, bounds.y + bounds.h / 2);
      world.blocks.push({ ...bounds, i, j, region, kind, park: false, parking: false });
    }
  }

  // central park + scattered parks / parking lots
  const parkKeys = new Set(['5,3', '0,5', '8,1', '1,6', '6,0']);
  for (const block of world.blocks) {
    if (block.kind) { buildSpecial(block); continue; }
    if (parkKeys.has(`${block.i},${block.j}`) || (block.region !== 'downtown' && mapRandom() < 0.065)) {
      block.park = true;
      buildPark(block);
      continue;
    }
    if (block.region !== 'downtown' && mapRandom() < 0.07) {
      block.parking = true;
      buildParking(block);
      continue;
    }
    buildBlockBuildings(block);
  }

  // edge buildings, so the map doesn't look unfinished
  for (let y = 40; y < LAND_BOTTOM - 120; y += 120) {
    if (mapRandom() < 0.18) continue;
    const w = 80 + mapRandom() * 90;
    addBuilding(20 + mapRandom() * 30, y, w, 92 + mapRandom() * 30, { hgt: mapRandom() * 0.6 });
    addBuilding(WORLD_W - 20 - w - mapRandom() * 30, y + 20, w, 92 + mapRandom() * 30, { hgt: mapRandom() * 0.6 });
  }
  for (let x = 280; x < WORLD_W - 280; x += 140) {
    if (mapRandom() < 0.3) continue;
    const w = 105 + mapRandom() * 80;
    addBuilding(x, 18, w, 90 + mapRandom() * 45, { hgt: mapRandom() * 0.5 });
  }

  // Beach dressing
  for (let i = 0; i < 46; i++) {
    const x = 110 + mapRandom() * (WORLD_W - 220);
    const y = BEACH_TOP + 55 + mapRandom() * 250;
    const r = mapRandom();
    if (r < 0.38) addTree(x, y, 'palm', 0.85 + mapRandom() * 0.5);
    else world.beachProps.push({ type: r < 0.72 ? 'umbrella' : 'towel', x, y, hue: Math.floor(mapRandom() * 5), rot: mapRandom() * TAU });
  }

  // Street trees + lamps along major roads
  for (let i = 0; i < ROAD_X.length; i++) {
    for (let j = 0; j < ROAD_Y.length; j++) {
      const x = ROAD_X[i];
      const y = ROAD_Y[j];
      const off = halfRoad(i) + 27;
      if (i % 2 === 0) {
        addLamp(x + off, y + 64);
        addLamp(x - off, y - 64);
      }
      if (mapRandom() < 0.45) addTree(x + off + 20, y + 120 + mapRandom() * 80, 'round', 0.7 + mapRandom() * 0.3);
    }
  }

  // Park trees
  for (const block of world.blocks) {
    if (!block.park) continue;
    for (let i = 0; i < 9; i++) {
      const x = block.x + 30 + mapRandom() * (block.w - 60);
      const y = block.y + 30 + mapRandom() * (block.h - 60);
      addTree(x, y, mapRandom() > 0.7 ? 'palm' : 'round', 0.75 + mapRandom() * 0.55);
    }
  }
}

function blockRegion(x, y) {
  if (y > 3700) return 'beach';
  if (x > 3540 && y < 1780) return 'hills';
  if (x > 1560 && x < 3360 && y < 1540) return 'downtown';
  if (x < 1020 && y > 2750) return 'industrial';
  return 'city';
}

function buildBlockBuildings(block) {
  const { x, y, w, h, region } = block;
  const pad = 18;
  const x0 = x + pad, y0 = y + pad, ww = w - pad * 2, hh = h - pad * 2;
  const roll = mapRandom();

  if (region === 'downtown') {
    if (roll < 0.72) {
      const inset = 8 + mapRandom() * 20;
      addBuilding(x0 + inset, y0 + inset, ww - inset * 2, hh - inset * 2, {
        hgt: 2.4 + mapRandom() * 3.2,
        color: choice(['#4b5661', '#59636e', '#3f4b56', '#6a7278']),
        roof: choice(['#323a43', '#3d444b', '#474e54']),
      });
      if (mapRandom() > 0.45) addTree(x0 + 6, y0 + 6, 'round', 0.55);
    } else {
      addBuilding(x0, y0, ww * 0.62, hh, { hgt: 2 + mapRandom() * 2.8 });
      addBuilding(x0 + ww * 0.66, y0 + hh * 0.18, ww * 0.34, hh * 0.82, { hgt: 1 + mapRandom() * 1.8 });
    }
    return;
  }

  if (region === 'hills') {
    if (roll < 0.55) {
      const bw = ww * (0.55 + mapRandom() * 0.2);
      const bh = hh * (0.42 + mapRandom() * 0.16);
      addBuilding(x0 + (ww - bw) / 2, y0 + (hh - bh) / 2, bw, bh, {
        hgt: 0.3 + mapRandom() * 0.35, color: '#8b7c68', roof: '#5f5549'
      });
      addTree(x0 + 8, y0 + hh - 25, 'palm', 0.9 + mapRandom() * 0.4);
      addTree(x0 + ww - 18, y0 + 18, 'round', 0.8);
    } else {
      addBuilding(x0, y0 + hh * 0.18, ww * 0.58, hh * 0.7, { hgt: 0.4 });
      addTree(x0 + ww * 0.7, y0 + hh * 0.55, 'palm', 1.05);
      addTree(x0 + ww * 0.45, y0 + hh * 0.8, 'round', 0.65);
    }
    return;
  }

  if (region === 'industrial') {
    if (roll < 0.5) {
      addBuilding(x0, y0, ww, hh * 0.55, { hgt: 0.15, color: '#6d716e', roof: '#4b504d' });
      addBuilding(x0 + ww * 0.1, y0 + hh * 0.64, ww * 0.35, hh * 0.25, { hgt: 0.1, color: '#777b75', roof: '#515651' });
    } else {
      addBuilding(x0, y0, ww * 0.52, hh, { hgt: 0.25, color: '#72736d', roof: '#4d504b' });
      addBuilding(x0 + ww * 0.6, y0, ww * 0.4, hh * 0.5, { hgt: 0.2, color: '#676d6a', roof: '#444b47' });
    }
    return;
  }

  if (region === 'beach') {
    addBuilding(x0, y0 + hh * 0.22, ww * 0.7, hh * 0.66, {
      hgt: 0.3 + mapRandom() * 0.5,
      color: choice(['#a78f73', '#98846f', '#b29b7d', '#8f8172']),
      roof: choice(['#6f5f50', '#786754', '#66594e'])
    });
    addTree(x0 + ww - 12, y0 + 15, 'palm', 0.9 + mapRandom() * 0.45);
    return;
  }

  if (roll < 0.34) {
    addBuilding(x0, y0, ww, hh * (0.55 + mapRandom() * 0.12), { hgt: 0.45 + mapRandom() * 0.7 });
    if (hh > 240) addBuilding(x0 + ww * 0.12, y0 + hh * 0.65, ww * 0.72, hh * 0.22, { hgt: 0.3 });
  } else if (roll < 0.68) {
    addBuilding(x0, y0, ww * (0.44 + mapRandom() * 0.08), hh, { hgt: 0.35 + mapRandom() * 0.9 });
    addBuilding(x0 + ww * 0.52, y0 + hh * 0.13, ww * 0.48, hh * 0.87, { hgt: 0.3 + mapRandom() * 0.8 });
  } else {
    const splitX = ww * (0.46 + mapRandom() * 0.08);
    const splitY = hh * (0.42 + mapRandom() * 0.16);
    addBuilding(x0, y0, splitX - 6, splitY - 6, { hgt: 0.4 + mapRandom() * 0.7 });
    addBuilding(x0 + splitX + 6, y0, ww - splitX - 6, splitY - 6, { hgt: 0.3 + mapRandom() * 0.8 });
    addBuilding(x0, y0 + splitY + 6, splitX - 6, hh - splitY - 6, { hgt: 0.4 + mapRandom() * 0.9 });
    addBuilding(x0 + splitX + 6, y0 + splitY + 6, ww - splitX - 6, hh - splitY - 6, { hgt: 0.35 + mapRandom() * 0.8 });
  }
}

function buildPark(block) {
  const { x, y, w, h } = block;
  addTree(x + w * 0.25, y + h * 0.35, 'round', 0.9);
  addTree(x + w * 0.68, y + h * 0.22, 'palm', 0.9);
  addTree(x + w * 0.74, y + h * 0.72, 'round', 0.7);
}

function buildParking(block) {
  const { x, y, w, h } = block;
  world.beachProps.push({ type: 'parking', x, y, w, h });
}

function buildSpecial(block) {
  const { x, y, w, h, kind } = block;
  if (kind === 'safehouse') {
    addBuilding(x + 36, y + 26, 214, 140, { hgt: 0.35, color: '#87745e', roof: '#5b4c3d', special: 'safehouse', sign: 'SAFEHOUSE' });
    addBuilding(x + 34, y + 214, 116, 82, { hgt: 0.2, color: '#6f675b', roof: '#4b4841', special: 'garage', sign: 'GARAGE' });
    addTree(x + w - 35, y + 30, 'palm', 0.85);
    addTree(x + w - 50, y + h - 28, 'round', 0.7);
  } else if (kind === 'police') {
    addBuilding(x + 34, y + 28, 218, 132, { hgt: 0.55, color: '#465768', roof: '#2d3c4b', special: 'police', sign: 'LSPD' });
    addBuilding(x + 270, y + 35, 80, 80, { hgt: 0.25, color: '#58616a', roof: '#3c4349' });
    addTree(x + w - 35, y + h - 32, 'round', 0.8);
    for (let i = 0; i < 4; i++) {
      world.beachProps.push({ type: 'parkline', x: x + 55 + i * 42, y: y + 238, w: 20, h: 55 });
    }
  } else if (kind === 'hospital') {
    addBuilding(x + 45, y + 35, 250, 180, { hgt: 0.7, color: '#b5b3a9', roof: '#797b76', special: 'hospital', sign: 'ST. ROSE' });
    addTree(x + w - 45, y + h - 35, 'palm', 0.85);
    addTree(x + 30, y + h - 32, 'round', 0.65);
  } else if (kind === 'ammu') {
    addBuilding(x + 55, y + 42, 190, 115, { hgt: 0.25, color: '#5d5345', roof: '#3c3730', special: 'ammu', sign: 'AMMU-NATION' });
    addBuilding(x + 62, y + 184, 100, 74, { hgt: 0.18, color: '#4d4b45', roof: '#33322f' });
    addTree(x + w - 35, y + 30, 'palm', 0.8);
  } else if (kind === 'paynspray') {
    addBuilding(x + 42, y + 34, 235, 120, { hgt: 0.25, color: '#6d6658', roof: '#47433a', special: 'paynspray', sign: "PAY 'N' SPRAY" });
    addBuilding(x + 70, y + 180, 195, 100, { hgt: 0.15, color: '#5c5950', roof: '#3b3a34', special: 'spraybay' });
    addTree(x + w - 32, y + 30, 'round', 0.7);
  } else if (kind === 'compound') {
    addBuilding(x + 44, y + 35, 250, 115, { hgt: 0.45, color: '#796a58', roof: '#514638', special: 'compound', sign: 'MARCO' });
    addBuilding(x + 35, y + 235, 80, 70, { hgt: 0.2, color: '#625d55', roof: '#3e3b37' });
    addBuilding(x + 255, y + 235, 60, 70, { hgt: 0.2, color: '#625d55', roof: '#3e3b37' });
    addTree(x + w - 34, y + h - 30, 'palm', 1.05);
    addTree(x + 30, y + h - 32, 'round', 0.85);
    addTree(x + w - 36, y + 30, 'palm', 0.8);
  }
}

/* ------------------------------------------------------------------ */
/* Static world rendering                                              */
/* ------------------------------------------------------------------ */

const camera = { x: 2400, y: 2400, zoom: 1, targetZoom: 1, shake: 0, titleAngle: 0 };
let viewW = 1280, viewH = 720, dpr = 1;
let gameTime = 0;
let clockHours = 18.6;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  viewW = window.innerWidth;
  viewH = window.innerHeight;
  canvas.width = Math.floor(viewW * dpr);
  canvas.height = Math.floor(viewH * dpr);
  canvas.style.width = viewW + 'px';
  canvas.style.height = viewH + 'px';
  radarCanvas.width = 420;
  radarCanvas.height = 420;
}
window.addEventListener('resize', resize);

function inView(x, y, w = 0, h = 0, pad = 160) {
  const hw = viewW / 2 / camera.zoom + pad;
  const hh = viewH / 2 / camera.zoom + pad;
  return x + w > camera.x - hw && x < camera.x + hw && y + h > camera.y - hh && y < camera.y + hh;
}

function drawWorld(c) {
  // Ocean
  const water = c.createLinearGradient(0, 0, 0, WORLD_H);
  water.addColorStop(0, '#0a3445');
  water.addColorStop(0.72, '#0b4255');
  water.addColorStop(1, '#062b3b');
  c.fillStyle = water;
  c.fillRect(0, 0, WORLD_W, WORLD_H);

  // Animated wave lines
  c.save();
  c.strokeStyle = 'rgba(157, 226, 230, 0.10)';
  c.lineWidth = 2;
  const waveTop = LAND_BOTTOM - 30;
  for (let y = waveTop; y < WORLD_H; y += 38) {
    const wobble = Math.sin(gameTime * 0.45 + y * 0.014) * 12;
    c.beginPath();
    for (let x = 0; x <= WORLD_W; x += 80) {
      const yy = y + Math.sin(x * 0.006 + gameTime * 0.7 + y) * 5;
      if (x === 0) c.moveTo(x, yy); else c.lineTo(x, yy);
    }
    c.stroke();
    c.strokeStyle = 'rgba(157, 226, 230, 0.045)';
    c.beginPath();
    c.moveTo(0, y + 18 + wobble);
    c.lineTo(WORLD_W, y + 18 + wobble);
    c.stroke();
    c.strokeStyle = 'rgba(157, 226, 230, 0.10)';
  }
  c.restore();

  // Land base
  c.fillStyle = '#5b5d5b';
  c.fillRect(0, 0, WORLD_W, LAND_BOTTOM);

  // Beach
  c.save();
  const sand = c.createLinearGradient(0, BEACH_TOP, 0, LAND_BOTTOM);
  sand.addColorStop(0, '#c6b17f');
  sand.addColorStop(0.55, '#d8c692');
  sand.addColorStop(1, '#b9a476');
  c.fillStyle = sand;
  c.beginPath();
  c.moveTo(0, BEACH_TOP);
  for (let x = 0; x <= WORLD_W; x += 80) {
    c.lineTo(x, BEACH_TOP + Math.sin(x * 0.006 + 1.2) * 7);
  }
  c.lineTo(WORLD_W, LAND_BOTTOM);
  c.lineTo(0, LAND_BOTTOM);
  c.closePath();
  c.fill();

  // wet sand edge
  c.fillStyle = 'rgba(116, 146, 138, 0.45)';
  c.fillRect(0, LAND_BOTTOM - 30, WORLD_W, 30);
  c.fillStyle = 'rgba(238, 231, 204, 0.34)';
  for (let x = 0; x < WORLD_W; x += 55) {
    c.beginPath();
    c.ellipse(x + Math.sin(x) * 9, LAND_BOTTOM - 18 + Math.sin(x * 0.2) * 4, 30, 3, 0, 0, TAU);
    c.fill();
  }
  c.restore();

  // Boardwalk
  c.fillStyle = '#77634d';
  c.fillRect(0, BEACH_TOP - 22, WORLD_W, 26);
  c.fillStyle = '#9a7e5d';
  for (let x = 0; x < WORLD_W; x += 28) c.fillRect(x, BEACH_TOP - 22, 2, 26);
  c.fillStyle = 'rgba(0,0,0,0.18)';
  c.fillRect(0, BEACH_TOP + 4, WORLD_W, 3);

  // Pier
  drawPier(c);

  // Blocks / sidewalks
  for (const b of world.blocks) {
    if (!inView(b.x, b.y, b.w, b.h, 80)) continue;
    drawBlockBase(c, b);
  }

  // Roads
  drawRoads(c);

  // Beach props
  for (const p of world.beachProps) {
    if (!inView(p.x, p.y, 60, 60, 80)) continue;
    drawBeachProp(c, p);
  }

  // Parking lot markings
  for (const b of world.blocks) {
    if (!b.parking || !inView(b.x, b.y, b.w, b.h, 80)) continue;
    drawParkingLot(c, b);
  }

  // Skid/blood/scorch decals
  drawDecals(c);

  // Trees (behind buildings if north, but top-down style reads fine)
  for (const t of world.trees) {
    if (!inView(t.x, t.y, 70, 70, 100)) continue;
    drawTree(c, t);
  }

  // Buildings
  for (const b of world.buildings) {
    if (!inView(b.x, b.y, b.w, b.h, 140)) continue;
    drawBuilding(c, b);
  }

  // Lamps
  for (const l of world.lamps) {
    if (!inView(l.x, l.y, 20, 20, 100)) continue;
    drawLamp(c, l);
  }
}

function drawPier(c) {
  const px = 2700, pw = 290, py = BEACH_TOP + 34, ph = 590;
  c.save();
  c.fillStyle = 'rgba(0,0,0,0.22)';
  c.fillRect(px + 12, py + 12, pw, ph);
  c.fillStyle = '#8c6d4c';
  c.fillRect(px, py, pw, ph);
  c.fillStyle = '#a18059';
  for (let y = py; y < py + ph; y += 24) c.fillRect(px, y, pw, 2);
  for (let x = px + 20; x < px + pw; x += 34) c.fillRect(x, py, 2, ph);
  c.fillStyle = '#5c4a36';
  for (let x = px + 12; x < px + pw; x += 45) {
    c.fillRect(x, py + ph - 26, 8, 26);
  }
  // rails
  c.strokeStyle = 'rgba(56,42,29,0.75)'; c.lineWidth = 4;
  c.beginPath(); c.moveTo(px + 4, py); c.lineTo(px + 4, py + ph - 30); c.stroke();
  c.beginPath(); c.moveTo(px + pw - 4, py); c.lineTo(px + pw - 4, py + ph - 30); c.stroke();
  // end building
  c.fillStyle = '#4e5a58';
  c.fillRect(px + pw / 2 - 55, py + ph - 80, 110, 58);
  c.fillStyle = '#323b3a';
  c.fillRect(px + pw / 2 - 45, py + ph - 70, 90, 35);
  c.fillStyle = '#d9b56a';
  c.font = 'bold 10px Arial'; c.textAlign = 'center';
  c.fillText('VESPUCCI PIER', px + pw / 2, py + ph - 87);
  c.restore();
}

function drawBlockBase(c, b) {
  if (b.park) {
    c.fillStyle = '#59694f';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = 'rgba(110, 135, 86, 0.55)';
    c.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
    c.strokeStyle = 'rgba(206, 195, 158, 0.42)'; c.lineWidth = 10;
    c.beginPath();
    c.moveTo(b.x + 18, b.y + b.h - 28);
    c.bezierCurveTo(b.x + b.w * 0.2, b.y + b.h * 0.55, b.x + b.w * 0.7, b.y + b.h * 0.7, b.x + b.w - 20, b.y + 28);
    c.stroke();
  } else {
    c.fillStyle = b.region === 'hills' ? '#69715b' : b.region === 'beach' ? '#a89b7d' : '#8f908b';
    c.fillRect(b.x, b.y, b.w, b.h);
    c.fillStyle = 'rgba(255,255,255,0.055)';
    c.fillRect(b.x + 4, b.y + 4, b.w - 8, 5);
    c.fillStyle = 'rgba(0,0,0,0.12)';
    c.fillRect(b.x, b.y + b.h - 6, b.w, 6);
    c.strokeStyle = 'rgba(38, 39, 40, 0.35)';
    c.lineWidth = 1;
    c.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
    // pavement seams
    c.strokeStyle = 'rgba(55,56,56,0.16)';
    c.beginPath();
    c.moveTo(b.x + 10, b.y + 10); c.lineTo(b.x + 10, b.y + b.h - 10);
    c.moveTo(b.x + b.w - 10, b.y + 10); c.lineTo(b.x + b.w - 10, b.y + b.h - 10);
    c.stroke();
  }
}

function drawRoads(c) {
  // asphalt strips
  for (let i = 0; i < ROAD_X.length; i++) {
    const x = ROAD_X[i], w = roadWidth(i);
    c.fillStyle = i % 2 === 0 ? '#303238' : '#34363b';
    c.fillRect(x - w / 2, 0, w, BEACH_TOP + 3);
    c.fillStyle = 'rgba(255,255,255,0.035)';
    c.fillRect(x - w / 2 + 2, 0, 2, BEACH_TOP);
    c.fillRect(x + w / 2 - 4, 0, 2, BEACH_TOP);
  }
  for (let j = 0; j < ROAD_Y.length; j++) {
    const y = ROAD_Y[j], w = roadWidth(j);
    c.fillStyle = j % 2 === 0 ? '#303238' : '#34363b';
    c.fillRect(0, y - w / 2, WORLD_W, w);
    c.fillStyle = 'rgba(255,255,255,0.035)';
    c.fillRect(0, y - w / 2 + 2, WORLD_W, 2);
    c.fillRect(0, y + w / 2 - 4, WORLD_W, 2);
  }

  // Intersections get a darker polish
  for (let i = 0; i < ROAD_X.length; i++) {
    for (let j = 0; j < ROAD_Y.length; j++) {
      const x = ROAD_X[i], y = ROAD_Y[j];
      if (!inView(x, y, 140, 140, 40)) continue;
      c.fillStyle = 'rgba(14, 16, 20, 0.10)';
      c.fillRect(x - halfRoad(i), y - halfRoad(j), roadWidth(i), roadWidth(j));
    }
  }

  // Lane markings between intersections
  c.save();
  for (let i = 0; i < ROAD_X.length; i++) {
    const x = ROAD_X[i], w = roadWidth(i);
    for (let j = 0; j < ROAD_Y.length - 1; j++) {
      const ya = ROAD_Y[j] + halfRoad(j) + 17;
      const yb = ROAD_Y[j + 1] - halfRoad(j + 1) - 17;
      if (yb - ya < 20) continue;
      if (!inView(x, (ya + yb) / 2, 20, yb - ya, 20)) continue;
      if (i % 2 === 0) {
        c.strokeStyle = 'rgba(228, 197, 85, 0.7)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(x - 3, ya); c.lineTo(x - 3, yb); c.moveTo(x + 3, ya); c.lineTo(x + 3, yb); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1.5;
        c.setLineDash([14, 17]);
        c.beginPath(); c.moveTo(x - w / 4, ya); c.lineTo(x - w / 4, yb); c.moveTo(x + w / 4, ya); c.lineTo(x + w / 4, yb); c.stroke();
        c.setLineDash([]);
      } else {
        c.strokeStyle = 'rgba(236, 229, 202, 0.44)'; c.lineWidth = 2;
        c.setLineDash([12, 18]);
        c.beginPath(); c.moveTo(x, ya); c.lineTo(x, yb); c.stroke();
        c.setLineDash([]);
      }
    }
  }
  for (let j = 0; j < ROAD_Y.length; j++) {
    const y = ROAD_Y[j], w = roadWidth(j);
    for (let i = 0; i < ROAD_X.length - 1; i++) {
      const xa = ROAD_X[i] + halfRoad(i) + 17;
      const xb = ROAD_X[i + 1] - halfRoad(i + 1) - 17;
      if (xb - xa < 20) continue;
      if (!inView((xa + xb) / 2, y, xb - xa, 20, 20)) continue;
      if (j % 2 === 0) {
        c.strokeStyle = 'rgba(228, 197, 85, 0.7)'; c.lineWidth = 2;
        c.beginPath(); c.moveTo(xa, y - 3); c.lineTo(xb, y - 3); c.moveTo(xa, y + 3); c.lineTo(xb, y + 3); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.28)'; c.lineWidth = 1.5;
        c.setLineDash([14, 17]);
        c.beginPath(); c.moveTo(xa, y - w / 4); c.lineTo(xb, y - w / 4); c.moveTo(xa, y + w / 4); c.lineTo(xb, y + w / 4); c.stroke();
        c.setLineDash([]);
      } else {
        c.strokeStyle = 'rgba(236, 229, 202, 0.44)'; c.lineWidth = 2;
        c.setLineDash([12, 18]);
        c.beginPath(); c.moveTo(xa, y); c.lineTo(xb, y); c.stroke();
        c.setLineDash([]);
      }
    }
  }
  c.restore();

  // Crosswalks
  for (let i = 0; i < ROAD_X.length; i++) {
    for (let j = 0; j < ROAD_Y.length; j++) {
      const x = ROAD_X[i], y = ROAD_Y[j];
      if (!inView(x, y, 180, 180, 30)) continue;
      const hw = halfRoad(i), hh = halfRoad(j);
      c.save();
      c.fillStyle = 'rgba(238, 236, 220, 0.55)';
      // left/right approaches
      for (let k = -3; k <= 3; k++) {
        if (Math.abs(k) > (hh - 12) / 8) continue;
        c.fillRect(x - hw - 26, y + k * 8 - 2.5, 19, 4);
        c.fillRect(x + hw + 7, y + k * 8 - 2.5, 19, 4);
      }
      // top/bottom approaches
      for (let k = -3; k <= 3; k++) {
        if (Math.abs(k) > (hw - 12) / 8) continue;
        c.fillRect(x + k * 8 - 2.5, y - hh - 26, 4, 19);
        c.fillRect(x + k * 8 - 2.5, y + hh + 7, 4, 19);
      }
      c.restore();
    }
  }

  // Road names
  c.save();
  c.fillStyle = 'rgba(245, 242, 226, 0.22)';
  c.font = 'bold 9px Arial';
  c.textAlign = 'center';
  for (let j = 0; j < ROAD_Y.length; j++) {
    const y = ROAD_Y[j];
    if (!inView(ROAD_X[4], y, 800, 20, 50)) continue;
    c.fillText(world.roadNames.h[j] || '', ROAD_X[4], y - 7);
  }
  for (let i = 0; i < ROAD_X.length; i++) {
    const x = ROAD_X[i];
    if (!inView(x, ROAD_Y[4], 20, 800, 50)) continue;
    c.save();
    c.translate(x + 12, ROAD_Y[4]);
    c.rotate(-Math.PI / 2);
    c.fillText(world.roadNames.v[i] || '', 0, 0);
    c.restore();
  }
  c.restore();
}

function drawParkingLot(c, b) {
  c.fillStyle = '#46474a';
  c.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
  c.strokeStyle = 'rgba(235, 230, 204, 0.35)'; c.lineWidth = 2;
  for (let x = b.x + 28; x < b.x + b.w - 20; x += 38) {
    c.beginPath(); c.moveTo(x, b.y + 22); c.lineTo(x, b.y + b.h - 22); c.stroke();
  }
}

function drawBeachProp(c, p) {
  if (p.type === 'parking' || p.type === 'parkline') return;
  if (p.type === 'umbrella') {
    const colors = ['#e45e5e', '#f2c84b', '#4fb3c7', '#e38fc3', '#f0ede1'];
    c.save();
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    c.beginPath(); c.ellipse(8, 9, 20, 16, 0, 0, TAU); c.fill();
    c.fillStyle = colors[p.hue];
    c.beginPath(); c.arc(0, 0, 19, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, 19, 0, Math.PI); c.fill();
    c.fillStyle = '#7f6244'; c.fillRect(-1.5, 0, 3, 22);
    c.restore();
  } else if (p.type === 'towel') {
    c.save();
    c.translate(p.x, p.y); c.rotate(p.rot);
    c.fillStyle = ['#cf5959', '#4c9fb2', '#d5b44e', '#d77fa5', '#e5e0cc'][p.hue];
    c.fillRect(-15, -9, 30, 18);
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.fillRect(-15, -2, 30, 3);
    c.restore();
  }
}

function drawTree(c, t) {
  const s = t.size;
  c.save();
  c.translate(t.x, t.y);
  c.fillStyle = 'rgba(0,0,0,0.20)';
  c.beginPath(); c.ellipse(8 * s, 11 * s, 17 * s, 12 * s, 0.4, 0, TAU); c.fill();
  if (t.type === 'palm') {
    c.strokeStyle = '#765a39'; c.lineWidth = 3.2 * s;
    c.beginPath(); c.moveTo(0, 6); c.quadraticCurveTo(2 * s, -8 * s, 3 * s, -23 * s); c.stroke();
    c.fillStyle = '#35643c';
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + t.seed;
      c.beginPath();
      c.ellipse(Math.cos(a) * 10 * s + 3 * s, Math.sin(a) * 8 * s - 21 * s, 16 * s, 4.5 * s, a, 0, TAU);
      c.fill();
    }
    c.fillStyle = '#477d48';
    c.beginPath(); c.arc(3 * s, -21 * s, 5 * s, 0, TAU); c.fill();
  } else {
    c.fillStyle = '#4b3828'; c.fillRect(-2 * s, -4 * s, 4 * s, 10 * s);
    const r = 13 * s;
    c.fillStyle = '#3f5f3b';
    c.beginPath(); c.arc(-5 * s, -8 * s, r, 0, TAU); c.fill();
    c.fillStyle = '#4f7445';
    c.beginPath(); c.arc(5 * s, -10 * s, r * 0.82, 0, TAU); c.fill();
    c.fillStyle = '#5f8450';
    c.beginPath(); c.arc(0, -17 * s, r * 0.65, 0, TAU); c.fill();
  }
  c.restore();
}

function drawLamp(c, l) {
  c.save();
  c.translate(l.x, l.y);
  c.fillStyle = 'rgba(0,0,0,0.2)';
  c.beginPath(); c.ellipse(5, 7, 7, 4, 0, 0, TAU); c.fill();
  c.strokeStyle = '#373a3c'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(0, 5); c.lineTo(0, -19); c.lineTo(6, -22); c.stroke();
  c.fillStyle = '#f5e4a1';
  c.beginPath(); c.arc(7, -22, 3, 0, TAU); c.fill();
  c.restore();
}

function drawBuilding(c, b) {
  const shadowOffX = b.shadowX;
  const shadowOffY = b.shadowY;
  c.save();
  c.fillStyle = 'rgba(8, 11, 16, 0.25)';
  roundRect(c, b.x + shadowOffX, b.y + shadowOffY, b.w, b.h, 4);
  c.fill();

  c.fillStyle = b.color;
  roundRect(c, b.x, b.y, b.w, b.h, 3);
  c.fill();
  c.strokeStyle = 'rgba(20, 22, 26, 0.75)';
  c.lineWidth = 1.5;
  c.stroke();

  // roof panel
  const inset = 5 + Math.min(b.hgt, 3) * 1.4;
  c.fillStyle = b.roof;
  roundRect(c, b.x + inset, b.y + inset, b.w - inset * 2, b.h - inset * 2, 2);
  c.fill();
  c.strokeStyle = 'rgba(255,255,255,0.08)';
  c.lineWidth = 1;
  c.stroke();

  // roof highlights / seams
  if (b.w > 90 && b.h > 70) {
    c.strokeStyle = 'rgba(255,255,255,0.075)';
    c.beginPath();
    c.moveTo(b.x + b.w * 0.28, b.y + inset + 3);
    c.lineTo(b.x + b.w * 0.28, b.y + b.h - inset - 3);
    c.moveTo(b.x + b.w * 0.72, b.y + inset + 3);
    c.lineTo(b.x + b.w * 0.72, b.y + b.h - inset - 3);
    c.stroke();
  }

  // AC units / vents
  for (const a of b.acs) {
    c.save();
    c.translate(a.x + a.w / 2, a.y + a.h / 2);
    c.rotate(a.rot);
    c.fillStyle = 'rgba(0,0,0,0.28)';
    c.fillRect(-a.w / 2 + 2, -a.h / 2 + 2, a.w, a.h);
    c.fillStyle = '#737a7b';
    c.fillRect(-a.w / 2, -a.h / 2, a.w, a.h);
    c.strokeStyle = 'rgba(20,20,22,0.5)';
    c.lineWidth = 1;
    c.strokeRect(-a.w / 2 + 1, -a.h / 2 + 1, a.w - 2, a.h - 2);
    c.strokeStyle = 'rgba(255,255,255,0.12)';
    for (let x = -a.w / 2 + 4; x < a.w / 2 - 3; x += 4) {
      c.beginPath(); c.moveTo(x, -a.h / 2 + 3); c.lineTo(x, a.h / 2 - 3); c.stroke();
    }
    c.restore();
  }

  if (b.helipad) {
    c.strokeStyle = 'rgba(240, 240, 230, 0.28)'; c.lineWidth = 2;
    c.beginPath(); c.arc(b.helipad.x, b.helipad.y, b.helipad.r, 0, TAU); c.stroke();
    c.fillStyle = 'rgba(240,240,230,0.28)';
    c.font = 'bold 14px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('H', b.helipad.x, b.helipad.y + 1);
  }

  if (b.sign) {
    c.save();
    c.fillStyle = b.special === 'police' ? '#a9d6ff' : b.special === 'hospital' ? '#ffb3b3' : b.special === 'ammu' ? '#ffd45e' : b.special === 'paynspray' ? '#ffdf5c' : '#f1e7cc';
    c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.globalAlpha = 0.85;
    c.fillText(b.sign, b.x + b.w / 2, b.y + b.h * 0.5);
    c.restore();
  }
  c.restore();
}

function drawDecals(c) {
  for (const d of decals) {
    if (!inView(d.x, d.y, 20, 20, 50)) continue;
    c.save();
    c.globalAlpha = d.alpha * Math.min(1, d.life / 3);
    c.fillStyle = d.color;
    if (d.type === 'skid') {
      c.translate(d.x, d.y); c.rotate(d.rot);
      c.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    } else if (d.type === 'blood') {
      c.beginPath();
      c.ellipse(d.x, d.y, d.r, d.r * 0.62, d.rot, 0, TAU);
      c.fill();
      c.globalAlpha *= 0.6;
      c.beginPath(); c.arc(d.x + d.r * 1.2, d.y + d.r * 0.4, d.r * 0.35, 0, TAU); c.fill();
    } else {
      c.beginPath(); c.arc(d.x, d.y, d.r, 0, TAU); c.fill();
    }
    c.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Game state                                                          */
/* ------------------------------------------------------------------ */

const vehicles = [];
const people = [];
const bullets = [];
const particles = [];
const decals = [];
const floatingTexts = [];
const pickups = [];
let nextVehicleId = 1;
let nextPersonId = 1;
let saveData = null;

const state = {
  mode: 'title',
  money: 1250,
  health: 100,
  armor: 0,
  wanted: 0,
  prevWanted: 0,
  heat: 0,
  lastCrime: -999,
  missionIndex: 0,
  activeMission: null,
  kills: 0,
  crashes: 0,
  weapon: 'pistol',
  weapons: {
    pistol: { mag: 12, reserve: 72, max: 12, name: 'PISTOL', rate: 0.19, damage: 34, reload: 1.05, icon: '▰' },
    smg: { mag: 0, reserve: 0, max: 30, name: 'MICRO SMG', rate: 0.075, damage: 21, reload: 1.55, icon: '▰▰' }
  },
  smgUnlocked: false,
  hurtFlash: 0,
  lastDamage: -99,
  regenTimer: 0,
  alertTimer: 0,
  interaction: null,
  touchFire: false,
  touchSprint: false,
  firing: false,
  mouseDown: false,
  pausedFrom: 'playing',
  lastHudUpdate: 0,
  introShown: false,
  copsSpawnTimer: 0,
  district: '',
  camShake: 0,
  missionToastTimer: 0,
  gameStarted: false,
  freeRoam: false,
};

const player = {
  x: 1430, y: 2570,
  angle: -Math.PI / 2,
  aimAngle: -Math.PI / 2,
  moveAngle: -Math.PI / 2,
  speed: 0,
  step: 0,
  fireCooldown: 0,
  reloadTimer: 0,
  invuln: 0,
  vehicle: null,
  onFoot: true,
  lastX: 1430,
  lastY: 2570,
  hitPushX: 0,
  hitPushY: 0,
};

const LANDMARKS = {
  spawn: { x: 1320, y: 2570 },
  safehouse: { x: 1430, y: 2540 },
  garage: { x: 1462, y: 2492 },
  hospital: { x: 1900, y: 2100 },
  ammu: { x: 960, y: 1550 },
  paynspray: { x: 2880, y: 3010 },
  police: { x: 3740, y: 3050 },
  pier: { x: 2845, y: 4150 },
  beach: { x: 2450, y: 4150 },
  compound: { x: 2400, y: 1240 },
  van: { x: 3808, y: 2968 },
  targetCar: { x: 1210, y: 2440 },
};

const VEHICLE_TYPES = {
  sedan: { name: 'INGOT', len: 55, wid: 27, max: 375, accel: 265, brake: 430, handling: 2.25, mass: 1 },
  sports: { name: 'SULTAN', len: 57, wid: 28, max: 505, accel: 365, brake: 490, handling: 2.65, mass: 0.9 },
  muscle: { name: 'DOMINATOR', len: 59, wid: 30, max: 470, accel: 390, brake: 420, handling: 2.35, mass: 1.05 },
  compact: { name: 'BLISTA', len: 49, wid: 26, max: 350, accel: 250, brake: 420, handling: 2.5, mass: 0.8 },
  van: { name: 'SPEEDO', len: 68, wid: 33, max: 300, accel: 185, brake: 330, handling: 1.9, mass: 1.5 },
  police: { name: 'POLICE CRUISER', len: 58, wid: 30, max: 465, accel: 340, brake: 470, handling: 2.5, mass: 1.1 },
  truck: { name: 'MULE', len: 78, wid: 37, max: 270, accel: 170, brake: 300, handling: 1.8, mass: 1.8 },
};

const CAR_COLORS = ['#d6d2c2', '#9da4a8', '#b4453c', '#3e6682', '#2f343a', '#d9b650', '#526b45', '#8b5a76', '#c7c4ba', '#54443c', '#5a7d91'];

function spawnVehicle(opts) {
  const typeKey = opts.type || choice(['sedan', 'sedan', 'sports', 'muscle', 'compact', 'van']);
  const type = VEHICLE_TYPES[typeKey] || VEHICLE_TYPES.sedan;
  const v = {
    id: nextVehicleId++,
    typeKey, ...type,
    x: opts.x, y: opts.y,
    angle: opts.angle ?? 0,
    speed: 0,
    steer: 0,
    color: opts.color || choice(CAR_COLORS),
    health: opts.health ?? 100,
    maxHealth: opts.health ?? 100,
    ai: opts.ai || 'parked',
    driver: opts.driver || null,
    missionTag: opts.missionTag || null,
    isTarget: !!opts.isTarget,
    exploded: false,
    fireTime: 0,
    smokeTime: 0,
    brakeLight: 0,
    skid: 0,
    siren: opts.ai === 'cop' ? Math.random() * TAU : 0,
    gi: opts.gi ?? 0,
    gj: opts.gj ?? 0,
    dir: opts.dir ?? 0,
    ti: opts.ti ?? 0,
    tj: opts.tj ?? 0,
    targetX: opts.x,
    targetY: opts.y,
    cruise: opts.cruise || rand(115, 175),
    stuck: 0,
    born: gameTime,
  };
  if (v.ai === 'traffic') assignTrafficTarget(v, true);
  vehicles.push(v);
  return v;
}

const DIRS = [
  { x: 1, y: 0, a: 0 },
  { x: 0, y: 1, a: Math.PI / 2 },
  { x: -1, y: 0, a: Math.PI },
  { x: 0, y: -1, a: -Math.PI / 2 },
];

function laneOffsetForDir(dir) {
  if (dir === 0) return { x: 0, y: 18 };
  if (dir === 2) return { x: 0, y: -18 };
  if (dir === 1) return { x: -18, y: 0 };
  return { x: 18, y: 0 };
}

function chooseTrafficDir(v, initial = false) {
  const options = [0, 1, 2, 3].filter(d => {
    if (!initial && d === (v.dir + 2) % 4) return false;
    if (d === 0 && v.gi >= ROAD_X.length - 1) return false;
    if (d === 2 && v.gi <= 0) return false;
    if (d === 1 && v.gj >= ROAD_Y.length - 1) return false;
    if (d === 3 && v.gj <= 0) return false;
    return true;
  });
  if (!options.length) return (v.dir + 2) % 4;
  if (!initial && options.includes(v.dir) && Math.random() < 0.48) return v.dir;
  return choice(options);
}

function assignTrafficTarget(v, initial = false) {
  v.dir = chooseTrafficDir(v, initial);
  const d = DIRS[v.dir];
  v.ti = clamp(v.gi + d.x, 0, ROAD_X.length - 1);
  v.tj = clamp(v.gj + d.y, 0, ROAD_Y.length - 1);
  const off = laneOffsetForDir(v.dir);
  v.targetX = ROAD_X[v.ti] + off.x;
  v.targetY = ROAD_Y[v.tj] + off.y;
  v.angle = Math.atan2(v.targetY - v.y, v.targetX - v.x);
}

function spawnTrafficCar(minDist = 450, maxDist = 1500) {
  for (let attempt = 0; attempt < 24; attempt++) {
    const gi = randInt(1, ROAD_X.length - 2);
    const gj = randInt(1, ROAD_Y.length - 2);
    const d = randInt(0, 3);
    const off = laneOffsetForDir(d);
    const x = ROAD_X[gi] + off.x;
    const y = ROAD_Y[gj] + off.y;
    const pd = dist(x, y, player.x, player.y);
    if (pd < minDist || pd > maxDist) continue;
    const typeKey = choice(['sedan', 'sedan', 'sedan', 'compact', 'sports', 'muscle', 'van', 'truck']);
    const v = spawnVehicle({ x, y, type: typeKey, ai: 'traffic', gi, gj, dir: d });
    v.ti = clamp(gi + DIRS[d].x, 0, ROAD_X.length - 1);
    v.tj = clamp(gj + DIRS[d].y, 0, ROAD_Y.length - 1);
    const off2 = laneOffsetForDir(d);
    v.targetX = ROAD_X[v.ti] + off2.x;
    v.targetY = ROAD_Y[v.tj] + off2.y;
    v.angle = DIRS[d].a;
    return v;
  }
  return null;
}

function spawnParkedCars() {
  spawnVehicle({ x: 1400, y: 2680, angle: 0, type: 'compact', color: '#5a7d91' });
  spawnVehicle({ x: 600, y: 2080, angle: Math.PI / 2, type: 'sedan', color: '#b4453c' });
  spawnVehicle({ x: 3300, y: 1320, angle: 0, type: 'muscle', color: '#d9b650' });
  spawnVehicle({ x: 2350, y: 3320, angle: Math.PI, type: 'sedan', color: '#d6d2c2' });
  spawnVehicle({ x: 4400, y: 2350, angle: Math.PI / 2, type: 'van', color: '#526b45' });
  spawnVehicle({ x: 900, y: 4200, angle: 0, type: 'compact', color: '#8b5a76' });
  spawnVehicle({ x: 3020, y: 4000, angle: Math.PI, type: 'sports', color: '#3e6682' });
}

function spawnPerson(faction, x, y, opts = {}) {
  const base = {
    civilian: { health: 34, speed: 78, armed: false, color: choice(['#b5a99a', '#7f96a8', '#8d6d6d', '#c4b47b', '#697b70', '#a56d86']) },
    cop: { health: 88, speed: 145, armed: true, color: '#30415a' },
    gang: { health: 68, speed: 128, armed: true, color: '#6d252b' },
    boss: { health: 340, speed: 112, armed: true, color: '#e0d5b8' }
  }[faction] || { health: 35, speed: 80, armed: false, color: '#999' };
  const p = {
    id: nextPersonId++,
    faction,
    x, y,
    angle: rand(0, TAU),
    aimAngle: 0,
    speed: 0,
    health: opts.health ?? base.health,
    maxHealth: opts.health ?? base.health,
    walkSpeed: opts.speed ?? base.speed,
    armed: opts.armed ?? base.armed,
    color: opts.color || base.color,
    shirt: opts.shirt || base.color,
    missionTag: opts.missionTag || null,
    boss: faction === 'boss',
    hostile: faction === 'cop' || faction === 'gang' || faction === 'boss' || !!opts.hostile,
    alert: !!opts.alert,
    dead: false,
    deadTimer: 0,
    hitFlash: 0,
    shootTimer: rand(0.3, 1.2),
    targetX: x + rand(-80, 80),
    targetY: y + rand(-80, 80),
    wanderTimer: rand(1, 4),
    fleeTimer: 0,
    step: rand(0, TAU),
    scale: faction === 'boss' ? 1.35 : 1,
    name: opts.name || null,
    missionTarget: !!opts.missionTarget,
    moneyDrop: opts.moneyDrop ?? (faction === 'civilian' ? randInt(8, 48) : 0),
    lastHitBy: opts.lastHitBy || null,
  };
  people.push(p);
  return p;
}

/* ------------------------------------------------------------------ */
/* Physics helpers                                                     */
/* ------------------------------------------------------------------ */

function collidesBuilding(x, y, r) {
  for (const b of world.buildings) {
    if (x + r < b.x || x - r > b.x + b.w || y + r < b.y || y - r > b.y + b.h) continue;
    if (circleRect(x, y, r, b.x, b.y, b.w, b.h)) return b;
  }
  return null;
}

function moveWithWalls(ent, dx, dy, r) {
  const nx = ent.x + dx;
  if (!collidesBuilding(nx, ent.y, r)) ent.x = nx;
  else ent.blocked = true;
  const ny = ent.y + dy;
  if (!collidesBuilding(ent.x, ny, r)) ent.y = ny;
  else ent.blocked = true;
  ent.x = clamp(ent.x, 60, WORLD_W - 60);
  ent.y = clamp(ent.y, 60, LAND_BOTTOM - 32);
}

function lineBlocked(x1, y1, x2, y2) {
  for (const b of world.buildings) {
    if (segRect(x1, y1, x2, y2, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 })) return true;
  }
  return false;
}

function terrainAt(x, y) {
  if (y > BEACH_TOP) return 'sand';
  return 'road';
}

function addDecal(type, x, y, opts = {}) {
  decals.push({
    type, x, y,
    r: opts.r || 9,
    w: opts.w || 18,
    h: opts.h || 5,
    rot: opts.rot || 0,
    color: opts.color || (type === 'blood' ? '#4d0f12' : '#141414'),
    alpha: opts.alpha ?? 0.55,
    life: opts.life ?? 25,
  });
  if (decals.length > 260) decals.shift();
}

function spawnParticle(x, y, opts = {}) {
  particles.push({
    x, y,
    vx: opts.vx ?? rand(-40, 40),
    vy: opts.vy ?? rand(-40, 40),
    life: opts.life ?? 0.5,
    maxLife: opts.life ?? 0.5,
    size: opts.size ?? 2,
    color: opts.color ?? '#fff',
    type: opts.type || 'spark',
    gravity: opts.gravity ?? 0,
    drag: opts.drag ?? 0.9,
    rot: opts.rot ?? 0,
    spin: opts.spin ?? 0,
  });
  if (particles.length > 600) particles.shift();
}

function burst(x, y, count, opts = {}) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, TAU);
    const s = rand(opts.minSpeed ?? 20, opts.maxSpeed ?? 120);
    spawnParticle(x, y, {
      vx: Math.cos(a) * s, vy: Math.sin(a) * s,
      life: rand(opts.minLife ?? 0.2, opts.maxLife ?? 0.7),
      size: rand(opts.minSize ?? 1, opts.maxSize ?? 3),
      color: opts.color || choice(['#ffd27a', '#ffae43', '#ff6b32']),
      type: opts.type || 'spark',
      gravity: opts.gravity ?? 0,
      drag: opts.drag ?? 0.92,
    });
  }
}

function floatText(x, y, text, color = '#fff', size = 11) {
  floatingTexts.push({ x, y, text, color, size, life: 1.2, maxLife: 1.2 });
}

function screenToWorld(sx, sy) {
  return {
    x: camera.x + (sx - viewW / 2) / camera.zoom,
    y: camera.y + (sy - viewH / 2) / camera.zoom,
  };
}

/* ------------------------------------------------------------------ */
/* Vehicles                                                            */
/* ------------------------------------------------------------------ */

function drawVehicle(c, v) {
  if (!inView(v.x, v.y, 100, 100, 100)) return;
  const L = v.len, W = v.wid;
  c.save();
  c.translate(v.x, v.y);
  c.rotate(v.angle);

  // shadow
  c.fillStyle = 'rgba(0,0,0,0.26)';
  roundRect(c, -L / 2 + 5, -W / 2 + 7, L, W, 8);
  c.fill();

  // wheels
  c.fillStyle = '#17181b';
  const wheelW = 8, wheelH = 5.5;
  c.fillRect(-L * 0.32, -W / 2 - 2, wheelW, wheelH);
  c.fillRect(-L * 0.32, W / 2 - wheelH + 2, wheelW, wheelH);
  c.fillRect(L * 0.2, -W / 2 - 2, wheelW, wheelH);
  c.fillRect(L * 0.2, W / 2 - wheelH + 2, wheelW, wheelH);

  // body
  const grad = c.createLinearGradient(0, -W / 2, 0, W / 2);
  grad.addColorStop(0, shade(v.color, 20));
  grad.addColorStop(0.45, v.color);
  grad.addColorStop(1, shade(v.color, -28));
  c.fillStyle = v.exploded ? '#262321' : grad;
  roundRect(c, -L / 2, -W / 2, L, W, 7);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.55)';
  c.lineWidth = 1.2;
  c.stroke();

  if (!v.exploded) {
    // windshield + roof
    c.fillStyle = 'rgba(18, 29, 38, 0.88)';
    roundRect(c, L * 0.08, -W / 2 + 4, L * 0.21, W - 8, 3);
    c.fill();
    c.fillStyle = shade(v.color, -12);
    roundRect(c, -L * 0.22, -W / 2 + 4, L * 0.27, W - 8, 3);
    c.fill();
    c.fillStyle = 'rgba(21, 32, 40, 0.8)';
    roundRect(c, -L * 0.34, -W / 2 + 5, L * 0.1, W - 10, 2);
    c.fill();

    // roof stripe / details
    if (v.typeKey === 'police') {
      c.fillStyle = '#e9e8df';
      roundRect(c, -L / 2 + 2, -W / 2 + 2, L * 0.24, W - 4, 4); c.fill();
      c.fillStyle = '#17191d';
      roundRect(c, -L * 0.13, -W / 2 + 2, L * 0.18, W - 4, 2); c.fill();
      // light bar
      const flash = Math.sin(gameTime * 11) > 0;
      c.fillStyle = flash ? '#ff3b35' : '#3b6bff';
      c.fillRect(-2, -W / 2 - 4, 4, W + 8);
      c.shadowColor = flash ? '#ff3b35' : '#3b6bff';
      c.shadowBlur = 12;
      c.fillRect(-1, -W / 2 - 5, 2, W + 10);
      c.shadowBlur = 0;
    } else if (v.typeKey === 'sports' || v.typeKey === 'muscle') {
      c.fillStyle = 'rgba(255,255,255,0.2)';
      c.fillRect(-L * 0.35, -1.5, L * 0.68, 3);
    } else if (v.typeKey === 'van' || v.typeKey === 'truck') {
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(-L * 0.38, -W / 2 + 3, L * 0.5, W - 6);
    }

    // lights
    c.fillStyle = 'rgba(255, 244, 196, 0.92)';
    c.fillRect(L / 2 - 3, -W / 2 + 4, 2.5, 5);
    c.fillRect(L / 2 - 3, W / 2 - 9, 2.5, 5);
    c.fillStyle = v.brakeLight > 0 ? '#ff4039' : 'rgba(132, 35, 34, 0.9)';
    c.fillRect(-L / 2 + 1, -W / 2 + 4, 2.5, 5);
    c.fillRect(-L / 2 + 1, W / 2 - 9, 2.5, 5);
  } else {
    // burnt shell
    c.fillStyle = 'rgba(20,18,17,0.9)';
    roundRect(c, -L / 2 + 5, -W / 2 + 5, L - 10, W - 10, 5); c.fill();
    c.strokeStyle = '#0f0e0d'; c.lineWidth = 1.5; c.stroke();
  }
  c.restore();
}

function shade(hex, amt) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = clamp((n >> 16) + amt, 0, 255);
  const g = clamp(((n >> 8) & 255) + amt, 0, 255);
  const b = clamp((n & 255) + amt, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function updateVehicle(v, dt) {
  if (v.exploded) {
    v.speed *= 0.9;
    v.fireTime += dt;
    if (v.fireTime < 3 && Math.random() < dt * 18) {
      spawnParticle(v.x + rand(-15, 15), v.y + rand(-8, 8), {
        vx: rand(-10, 10), vy: rand(-35, -10), life: rand(0.3, 0.8),
        size: rand(2, 5), color: choice(['#ff7d30', '#ffc04e', '#6a6864']), type: 'smoke', drag: 0.94
      });
    }
    return;
  }

  if (v.ai === 'player') {
    updatePlayerVehicle(v, dt);
  } else if (v.ai === 'traffic') {
    updateTrafficVehicle(v, dt);
  } else if (v.ai === 'cop') {
    updateCopVehicle(v, dt);
  }

  if (v.health <= 0 && !v.exploded) explodeVehicle(v);

  // smoke / fire effects
  if (v.health < 38 && Math.random() < dt * 14) {
    spawnParticle(v.x + rand(-v.len * 0.3, v.len * 0.3), v.y + rand(-v.wid * 0.3, v.wid * 0.3), {
      vx: rand(-12, 12), vy: rand(-30, -8), life: rand(0.4, 1.1),
      size: rand(2, 6), color: v.health < 18 ? '#3b3733' : '#77736b', type: 'smoke', drag: 0.96
    });
  }
  if (v.health < 17 && Math.random() < dt * 20) {
    spawnParticle(v.x + rand(-12, 12), v.y + rand(-8, 8), {
      vx: rand(-15, 15), vy: rand(-45, -10), life: rand(0.2, 0.55),
      size: rand(1.5, 4), color: choice(['#ff8b2d', '#ffd05a']), type: 'spark'
    });
  }
}

function updatePlayerVehicle(v, dt) {
  const throttle = isTouch ? -state.touchMove.y : (keys['KeyW'] || keys['ArrowUp'] ? 1 : 0) - (keys['KeyS'] || keys['ArrowDown'] ? 1 : 0);
  const steerInput = isTouch ? state.touchMove.x : (keys['KeyD'] || keys['ArrowRight'] ? 1 : 0) - (keys['KeyA'] || keys['ArrowLeft'] ? 1 : 0);
  const handbrake = keys['Space'] || state.touchSprint;
  const onSand = terrainAt(v.x, v.y) === 'sand';
  const max = v.max * (onSand ? 0.58 : 1);
  const accel = v.accel * (onSand ? 0.62 : 1);

  if (throttle > 0) {
    v.speed += accel * dt * (1 - Math.max(0, v.speed) / (max + 60));
  } else if (throttle < 0) {
    if (v.speed > 10) v.speed -= v.brake * dt;
    else v.speed -= accel * 0.55 * dt;
  } else {
    v.speed *= Math.pow(0.18, dt);
  }

  if (handbrake) v.speed *= Math.pow(0.08, dt);
  if (v.speed > max) v.speed = lerp(v.speed, max, dt * 2.2);
  if (v.speed < -max * 0.42) v.speed = -max * 0.42;

  const speedFactor = clamp(Math.abs(v.speed) / 110, 0, 1);
  const turn = steerInput * v.handling * speedFactor * (handbrake ? 1.55 : 1) * (v.speed < 0 ? -1 : 1);
  v.angle += turn * dt;
  v.steer = steerInput;
  v.brakeLight = throttle < 0 || handbrake ? 1 : 0;

  const oldX = v.x, oldY = v.y;
  const dx = Math.cos(v.angle) * v.speed * dt;
  const dy = Math.sin(v.angle) * v.speed * dt;
  const carR = Math.min(v.wid * 0.55, 18);
  v.blocked = false;
  moveWithWalls(v, dx, dy, carR);
  if (v.blocked) {
    if (Math.abs(v.speed) > 100) {
      state.camShake = Math.max(state.camShake, 0.35);
      state.crashes++;
      audio.hit();
      v.health -= Math.abs(v.speed) * 0.045;
      burst(v.x + Math.cos(v.angle) * v.len * 0.45, v.y + Math.sin(v.angle) * v.len * 0.45, 5, { color: '#ffc76b', maxSpeed: 100 });
    }
    v.speed *= -0.12;
  }

  // tire skids
  if ((handbrake || Math.abs(turn) > 0.7) && Math.abs(v.speed) > 130) {
    v.skid -= dt;
    if (v.skid <= 0) {
      v.skid = 0.035;
      const side = v.wid * 0.3;
      const bx = v.x - Math.cos(v.angle) * v.len * 0.28;
      const by = v.y - Math.sin(v.angle) * v.len * 0.28;
      addDecal('skid', bx + Math.cos(v.angle + Math.PI / 2) * side, by + Math.sin(v.angle + Math.PI / 2) * side, {
        w: 15, h: 4, rot: v.angle, color: '#171719', alpha: 0.22, life: 18
      });
      addDecal('skid', bx - Math.cos(v.angle + Math.PI / 2) * side, by - Math.sin(v.angle + Math.PI / 2) * side, {
        w: 15, h: 4, rot: v.angle, color: '#171719', alpha: 0.22, life: 18
      });
    }
  }

  // player car collisions with peds
  if (Math.abs(v.speed) > 90) {
    for (const p of people) {
      if (p.dead) continue;
      if (dist2(v.x, v.y, p.x, p.y) < (v.wid * 0.62 + 8) ** 2) {
        damagePerson(p, 180, v.speed > 0 ? v.angle : v.angle + Math.PI, 'player');
        v.speed *= 0.9;
      }
    }
  }

  // traffic collision
  for (const other of vehicles) {
    if (other === v || other.exploded) continue;
    const rr = (v.wid + other.wid) * 0.42;
    if (dist2(v.x, v.y, other.x, other.y) < rr * rr) {
      const d = Math.max(1, dist(v.x, v.y, other.x, other.y));
      const push = (rr - d) * 0.5;
      const nx = (v.x - other.x) / d, ny = (v.y - other.y) / d;
      v.x += nx * push; v.y += ny * push;
      if (other.ai !== 'player') {
        other.x -= nx * push * 0.5; other.y -= ny * push * 0.5;
        other.health -= Math.abs(v.speed) * 0.012;
        if (Math.abs(v.speed) > 180) {
          v.health -= Math.abs(v.speed) * 0.008;
          state.crashes++;
          audio.hit();
          burst((v.x + other.x) / 2, (v.y + other.y) / 2, 4, { color: '#ffcf73', maxSpeed: 90 });
        }
      }
      v.speed *= 0.82;
    }
  }

  // sand dust
  if (onSand && Math.abs(v.speed) > 80 && Math.random() < dt * 18) {
    spawnParticle(v.x - Math.cos(v.angle) * 20, v.y - Math.sin(v.angle) * 20, {
      vx: rand(-20, 20), vy: rand(-20, 20), life: 0.5, size: rand(2, 5), color: '#c4b07d', type: 'smoke', drag: 0.9
    });
  }

  audio.updateEngine(v.speed, throttle);
}

function updateTrafficVehicle(v, dt) {
  v.speed = lerp(v.speed, v.cruise, dt * 1.6);
  const tx = v.targetX, ty = v.targetY;
  const d = dist(v.x, v.y, tx, ty);
  if (d < 18) {
    v.gi = v.ti; v.gj = v.tj;
    assignTrafficTarget(v);
  }
  const desired = Math.atan2(v.targetY - v.y, v.targetX - v.x);
  v.angle = angleLerp(v.angle, desired, dt * 4);
  v.x += Math.cos(v.angle) * v.speed * dt;
  v.y += Math.sin(v.angle) * v.speed * dt;

  // avoid driving through buildings (in case a turn clips a corner)
  if (collidesBuilding(v.x, v.y, 14)) {
    v.x -= Math.cos(v.angle) * v.speed * dt;
    v.y -= Math.sin(v.angle) * v.speed * dt;
    v.gi = v.ti; v.gj = v.tj;
    assignTrafficTarget(v);
  }

  // Player gets clipped by traffic
  if (!player.vehicle && player.invuln <= 0 && Math.abs(v.speed) > 100) {
    if (dist2(v.x, v.y, player.x, player.y) < (v.wid * 0.7 + 8) ** 2) {
      hurtPlayer(9, v.angle);
      player.hitPushX = Math.cos(v.angle) * 180;
      player.hitPushY = Math.sin(v.angle) * 180;
    }
  }
}

function updateCopVehicle(v, dt) {
  const target = player.vehicle || player;
  const d = dist(v.x, v.y, target.x, target.y);
  const desired = Math.atan2(target.y - v.y, target.x - v.x);
  v.angle = angleLerp(v.angle, desired, dt * (2.4 + state.wanted * 0.25));
  const max = 260 + state.wanted * 34;
  const accel = 260 + state.wanted * 24;
  if (d > 90) v.speed = lerp(v.speed, max, dt * 1.2);
  else v.speed = lerp(v.speed, max * 0.3, dt * 2);
  v.speed = Math.min(v.speed, max);
  v.blocked = false;
  moveWithWalls(v, Math.cos(v.angle) * v.speed * dt, Math.sin(v.angle) * v.speed * dt, 16);
  if (v.blocked) {
    v.speed *= 0.55;
    v.angle += (Math.random() - 0.5) * 0.7;
    v.stuck += dt;
  } else v.stuck = Math.max(0, v.stuck - dt);
  if (v.stuck > 2.2) {
    const spot = randomRoadPointNear(player.x, player.y, 500, 900);
    v.x = spot.x; v.y = spot.y; v.stuck = 0; v.speed = 0;
  }

  v.siren += dt * 8;
  // ramming damage
  if (d < 55) {
    if (player.vehicle) {
      player.vehicle.health -= 22 * dt;
      state.camShake = Math.max(state.camShake, 0.2);
    } else if (player.invuln <= 0) {
      hurtPlayer(12, v.angle);
    }
  }
  // shots from the cruiser
  if (state.wanted >= 2 && d < 480 && v.shootTimer === undefined) v.shootTimer = rand(0.8, 1.6);
  if (state.wanted >= 2) {
    v.shootTimer = (v.shootTimer ?? 0) - dt;
    if (v.shootTimer <= 0 && d < 480 && !lineBlocked(v.x, v.y, target.x, target.y)) {
      v.shootTimer = rand(1.1, 1.8);
      const a = Math.atan2(target.y - v.y, target.x - v.x) + rand(-0.11, 0.11);
      spawnBullet(v.x + Math.cos(a) * 30, v.y + Math.sin(a) * 30, a, 1500, 6, 'cop');
      spawnParticle(v.x + Math.cos(a) * 32, v.y + Math.sin(a) * 32, { vx: 0, vy: 0, life: 0.08, size: 5, color: '#ffdf8a' });
      audio.shoot();
    }
  }
  if (v.health <= 0 && !v.exploded) explodeVehicle(v);
}

function explodeVehicle(v) {
  if (v.exploded) return;
  v.exploded = true;
  v.health = 0;
  v.speed = 0;
  v.fireTime = 0;
  state.camShake = Math.max(state.camShake, 1.1);
  audio.explosion();
  addDecal('scorch', v.x, v.y, { r: v.len * 0.62, color: '#131211', alpha: 0.5, life: 30 });
  for (let i = 0; i < 36; i++) {
    const a = rand(0, TAU), s = rand(30, 260);
    spawnParticle(v.x, v.y, {
      vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 1.1),
      size: rand(2, 7), color: choice(['#ffef9e', '#ffb43d', '#ff5a21', '#6c6962']),
      type: i % 3 === 0 ? 'smoke' : 'spark', drag: 0.9
    });
  }
  addHeat(24);
  // splash damage
  const r = 125;
  if (dist(v.x, v.y, player.x, player.y) < r) hurtPlayer(70, Math.atan2(player.y - v.y, player.x - v.x));
  if (player.vehicle === v) {
    hurtPlayer(200, 0);
    player.vehicle = null;
    player.onFoot = true;
    player.x = v.x + 42;
    player.y = v.y + 18;
    audio.stopEngine();
  }
  for (const p of people) {
    if (!p.dead && dist(v.x, v.y, p.x, p.y) < r) damagePerson(p, 120, Math.atan2(p.y - v.y, p.x - v.x), 'player');
  }
  for (const other of vehicles) {
    if (other !== v && !other.exploded && dist(v.x, v.y, other.x, other.y) < r * 0.9) {
      other.health -= 85;
      other.speed += rand(-50, 50);
    }
  }
  if (state.activeMission && state.activeMission.targetVehicle === v) {
    failMission('The target vehicle went up in flames.');
  }
  if (v.ai === 'cop') addHeat(14);
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

function updatePerson(p, dt) {
  if (p.dead) {
    p.deadTimer += dt;
    if (p.deadTimer > 28 && !p.missionTarget) {
      p.remove = true;
    }
    return;
  }
  p.hitFlash = Math.max(0, p.hitFlash - dt * 4);
  p.shootTimer -= dt;

  const target = player.vehicle || player;
  const d = dist(p.x, p.y, target.x, target.y);
  const los = !lineBlocked(p.x, p.y, target.x, target.y);

  if (p.faction === 'civilian') {
    if (state.wanted > 0 && d < 340) p.fleeTimer = 3.5;
    if (state.alertTimer > 0 && d < 380) p.fleeTimer = Math.max(p.fleeTimer, 2);
    if (p.fleeTimer > 0) {
      p.fleeTimer -= dt;
      const a = Math.atan2(p.y - target.y, p.x - target.x);
      const sp = p.walkSpeed * 1.65;
      moveWithWalls(p, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt, 8);
      p.angle = a;
      p.step += dt * 13;
    } else {
      p.wanderTimer -= dt;
      if (p.wanderTimer <= 0 || dist(p.x, p.y, p.targetX, p.targetY) < 10) {
        p.wanderTimer = rand(2, 5.5);
        p.targetX = clamp(p.x + rand(-120, 120), 70, WORLD_W - 70);
        p.targetY = clamp(p.y + rand(-120, 120), 70, LAND_BOTTOM - 60);
      }
      const a = Math.atan2(p.targetY - p.y, p.targetX - p.x);
      const sp = p.walkSpeed;
      moveWithWalls(p, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt, 7);
      p.angle = angleLerp(p.angle, a, dt * 4);
      p.step += dt * 7;
    }
    return;
  }

  // Hostiles: cops, gang, boss
  const active = p.faction === 'cop' ? (state.wanted > 0 || p.alert) : (p.alert || d < 620 || p.missionTarget);
  if (!active) {
    p.step += dt * 2;
    return;
  }
  p.aimAngle = Math.atan2(target.y - p.y, target.x - p.x);
  const preferred = p.faction === 'cop' ? 210 : 250;
  if (d > preferred && los) {
    const a = p.aimAngle;
    const sp = p.walkSpeed;
    moveWithWalls(p, Math.cos(a) * sp * dt, Math.sin(a) * sp * dt, 8);
    p.angle = angleLerp(p.angle, a, dt * 6);
    p.step += dt * 9;
  } else if (d < 110 && los) {
    // back up a little
    const a = p.aimAngle + Math.PI;
    moveWithWalls(p, Math.cos(a) * p.walkSpeed * 0.55 * dt, Math.sin(a) * p.walkSpeed * 0.55 * dt, 8);
    p.angle = angleLerp(p.angle, p.aimAngle, dt * 5);
  } else {
    p.angle = angleLerp(p.angle, p.aimAngle, dt * 8);
    p.step += dt * 2;
  }

  if (p.armed && los && d < 500 && p.shootTimer <= 0) {
    const base = p.faction === 'cop' ? 1.05 : p.faction === 'boss' ? 0.75 : 1.3;
    p.shootTimer = base + rand(0, 0.45);
    const spread = p.faction === 'cop' ? 0.075 : p.faction === 'boss' ? 0.05 : 0.13;
    const a = p.aimAngle + rand(-spread, spread);
    const bx = p.x + Math.cos(a) * 18;
    const by = p.y + Math.sin(a) * 18;
    spawnBullet(bx, by, a, 1450, p.faction === 'boss' ? 12 : p.faction === 'cop' ? 8 : 9, p.faction === 'cop' ? 'cop' : 'gang');
    spawnParticle(bx, by, { vx: 0, vy: 0, life: 0.07, size: 4, color: '#ffe19a' });
    audio.shoot();
    state.alertTimer = 4;
  }
}

function damagePerson(p, dmg, angle = 0, source = 'player') {
  if (p.dead) return;
  p.health -= dmg;
  p.hitFlash = 1;
  p.alert = true;
  p.lastHitBy = source;
  burst(p.x, p.y, 4, { color: '#a51c24', maxSpeed: 60, maxLife: 0.35, type: 'blood' });
  addDecal('blood', p.x + rand(-5, 5), p.y + rand(-5, 5), { r: rand(3, 8), rot: rand(0, TAU), color: '#4b0e13', alpha: 0.45 });
  if (p.health <= 0) killPerson(p, angle, source);
}

function killPerson(p, angle, source) {
  if (p.dead) return;
  p.dead = true;
  p.deadTimer = 0;
  p.health = 0;
  state.kills++;
  addDecal('blood', p.x, p.y, { r: rand(11, 20), rot: rand(0, TAU), color: '#430c11', alpha: 0.58, life: 32 });
  burst(p.x, p.y, 10, { color: '#8e1720', maxSpeed: 80, maxLife: 0.5, type: 'blood' });
  audio.hit();
  if (p.faction === 'civilian') {
    addHeat(20);
    if (p.moneyDrop > 0) {
      state.money += p.moneyDrop;
      floatText(p.x, p.y - 15, '+' + fmtMoney(p.moneyDrop), '#a9ff3f', 10);
    }
  } else if (p.faction === 'cop') {
    addHeat(32);
    floatText(p.x, p.y - 18, 'COP DOWN', '#ff5349', 10);
  } else if (p.faction === 'gang') {
    addHeat(10);
  } else if (p.faction === 'boss') {
    addHeat(40);
    floatText(p.x, p.y - 24, 'MARCO DOWN', '#ffd83d', 13);
  }
  if (state.activeMission && p.missionTag === state.activeMission.tag) {
    // kill counting is derived live from mission target refs
    state.activeMission.lastKill = p;
  }
}

function drawPerson(c, p) {
  if (!inView(p.x, p.y, 60, 60, 80)) return;
  c.save();
  c.translate(p.x, p.y);
  if (p.dead) {
    c.rotate(p.angle);
    c.globalAlpha = clamp(1 - p.deadTimer / 32, 0, 1);
    c.fillStyle = 'rgba(0,0,0,0.24)';
    c.beginPath(); c.ellipse(4, 3, 14 * p.scale, 7 * p.scale, 0, 0, TAU); c.fill();
    c.fillStyle = shade(p.shirt, -32);
    roundRect(c, -12 * p.scale, -5 * p.scale, 24 * p.scale, 10 * p.scale, 4); c.fill();
    c.fillStyle = '#3d2c25';
    c.beginPath(); c.arc(11 * p.scale, 0, 4.5 * p.scale, 0, TAU); c.fill();
    c.restore();
    return;
  }

  // shadow
  c.fillStyle = 'rgba(0,0,0,0.24)';
  c.beginPath(); c.ellipse(4, 5, 11 * p.scale, 7 * p.scale, 0, 0, TAU); c.fill();

  c.rotate(p.angle);
  // legs
  const legSwing = Math.sin(p.step) * 4;
  c.strokeStyle = p.faction === 'cop' ? '#1e2838' : p.faction === 'gang' ? '#282228' : '#34343a';
  c.lineWidth = 4.2 * p.scale;
  c.beginPath();
  c.moveTo(-4 * p.scale, -3 * p.scale); c.lineTo(-9 * p.scale, -4 * p.scale + legSwing);
  c.moveTo(-4 * p.scale, 3 * p.scale); c.lineTo(-9 * p.scale, 4 * p.scale - legSwing);
  c.stroke();
  // torso
  c.fillStyle = p.hitFlash > 0 ? '#f0eee2' : p.shirt;
  roundRect(c, -5 * p.scale, -7 * p.scale, 13 * p.scale, 14 * p.scale, 5 * p.scale);
  c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.35)'; c.lineWidth = 1; c.stroke();
  // arms / gun
  c.strokeStyle = shade(p.shirt, -22);
  c.lineWidth = 3.4 * p.scale;
  c.beginPath();
  c.moveTo(2 * p.scale, -6 * p.scale); c.lineTo(8 * p.scale, -7 * p.scale);
  c.moveTo(2 * p.scale, 6 * p.scale); c.lineTo(8 * p.scale, 7 * p.scale);
  c.stroke();
  if (p.armed) {
    c.fillStyle = '#191a1d';
    c.fillRect(7 * p.scale, -2.2 * p.scale, 10 * p.scale, 4 * p.scale);
    c.fillStyle = '#3b3d42';
    c.fillRect(7 * p.scale, -2.2 * p.scale, 4 * p.scale, 1.2 * p.scale);
  }
  // head
  c.fillStyle = p.faction === 'cop' ? '#d4a27a' : p.faction === 'boss' ? '#c99770' : '#b57f58';
  c.beginPath(); c.arc(1.5 * p.scale, 0, 5.2 * p.scale, 0, TAU); c.fill();
  // hair / cap
  c.fillStyle = p.faction === 'cop' ? '#172234' : p.faction === 'gang' ? '#1a1416' : '#2e241f';
  c.beginPath(); c.arc(-0.6 * p.scale, 0, 4.2 * p.scale, Math.PI * 0.5, Math.PI * 1.5); c.fill();
  if (p.faction === 'cop') {
    c.fillStyle = '#e4c94d';
    c.beginPath(); c.arc(-1.5 * p.scale, -3 * p.scale, 1.3, 0, TAU); c.fill();
  }
  if (p.boss) {
    c.fillStyle = '#ffd83d';
    c.fillRect(-2, -9, 4, 3);
  }
  c.restore();

  // health bar for hostile / damaged
  if ((p.hostile && !p.dead && (state.wanted > 0 || p.health < p.maxHealth)) || (p.health < p.maxHealth && p.health > 0)) {
    const w = 32 * p.scale;
    const y = p.y - 24 * p.scale;
    c.fillStyle = 'rgba(0,0,0,0.62)';
    c.fillRect(p.x - w / 2, y, w, 3.5);
    c.fillStyle = p.faction === 'cop' ? '#55d9ff' : p.faction === 'boss' ? '#ffd83d' : '#ff5349';
    c.fillRect(p.x - w / 2, y, w * clamp(p.health / p.maxHealth, 0, 1), 3.5);
  }
  if (p.name && !p.dead) {
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.font = 'bold 7px Arial'; c.textAlign = 'center';
    c.fillText(p.name, p.x, p.y - 29 * p.scale);
  }
}

/* ------------------------------------------------------------------ */
/* Bullets / particles / pickups                                       */
/* ------------------------------------------------------------------ */

function spawnBullet(x, y, angle, speed, damage, owner) {
  bullets.push({
    x, y, px: x, py: y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    life: 1.15,
    damage,
    owner,
    color: owner === 'player' ? '#ffe5a0' : '#ffb28b'
  });
  if (bullets.length > 220) bullets.shift();
}

function updateBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x; b.py = b.y;
    const steps = 3;
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      b.x += b.vx * dt / steps;
      b.y += b.vy * dt / steps;
      b.life -= dt / steps;

      if (b.x < 20 || b.x > WORLD_W - 20 || b.y < 20 || b.y > LAND_BOTTOM - 10) { hit = true; break; }
      if (collidesBuilding(b.x, b.y, 2)) {
        hit = true;
        burst(b.x, b.y, 3, { color: '#d8d3bd', maxSpeed: 50, maxLife: 0.2 });
        break;
      }

      if (b.owner === 'player') {
        let hitPerson = null;
        for (const p of people) {
          if (p.dead) continue;
          if (dist2(b.x, b.y, p.x, p.y) < (10 * p.scale + 3) ** 2) { hitPerson = p; break; }
        }
        if (hitPerson) {
          damagePerson(hitPerson, b.damage, Math.atan2(b.vy, b.vx), 'player');
          spawnParticle(b.x, b.y, { vx: 0, vy: 0, life: 0.1, size: 5, color: '#c21f2b', type: 'blood' });
          hit = true;
          break;
        }
        for (const v of vehicles) {
          if (v === player.vehicle || v.exploded) continue;
          if (dist2(b.x, b.y, v.x, v.y) < (v.wid * 0.58 + 2) ** 2) {
            v.health -= b.damage * 0.75;
            burst(b.x, b.y, 4, { color: '#ffd27a', maxSpeed: 80 });
            audio.hit();
            if (v.ai === 'cop') addHeat(5);
            hit = true;
            break;
          }
        }
      } else {
        if (!player.vehicle && dist2(b.x, b.y, player.x, player.y) < 14 ** 2) {
          hurtPlayer(b.damage, Math.atan2(b.vy, b.vx));
          hit = true;
          break;
        }
        if (player.vehicle && dist2(b.x, b.y, player.vehicle.x, player.vehicle.y) < (player.vehicle.wid * 0.6 + 2) ** 2) {
          player.vehicle.health -= b.damage * 0.7;
          if (Math.random() < 0.25) hurtPlayer(1, Math.atan2(b.vy, b.vx));
          burst(b.x, b.y, 3, { color: '#ffd27a', maxSpeed: 60 });
          hit = true;
          break;
        }
      }
    }
    if (hit || b.life <= 0) bullets.splice(i, 1);
  }
}

function drawBullets(c) {
  c.save();
  c.lineCap = 'round';
  for (const b of bullets) {
    c.strokeStyle = b.color;
    c.globalAlpha = 0.8;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(b.px, b.py);
    c.lineTo(b.x, b.y);
    c.stroke();
    c.globalAlpha = 1;
    c.fillStyle = '#fff7d0';
    c.beginPath(); c.arc(b.x, b.y, 1.6, 0, TAU); c.fill();
  }
  c.restore();
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.gravity * dt;
    const drag = Math.pow(p.drag, dt * 60);
    p.vx *= drag; p.vy *= drag;
    p.rot += p.spin * dt;
  }
}

function drawParticles(c) {
  c.save();
  for (const p of particles) {
    const a = clamp(p.life / p.maxLife, 0, 1);
    c.globalAlpha = p.type === 'smoke' ? a * 0.55 : a;
    c.fillStyle = p.color;
    if (p.type === 'smoke') {
      c.beginPath();
      c.arc(p.x, p.y, p.size * (1.6 - a * 0.5), 0, TAU);
      c.fill();
    } else if (p.type === 'blood') {
      c.beginPath();
      c.arc(p.x, p.y, p.size, 0, TAU);
      c.fill();
    } else {
      c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  c.restore();
}

function updateFloatingTexts(dt) {
  for (let i = floatingTexts.length - 1; i >= 0; i--) {
    const f = floatingTexts[i];
    f.life -= dt;
    f.y -= 25 * dt;
    if (f.life <= 0) floatingTexts.splice(i, 1);
  }
}

function drawFloatingTexts(c) {
  c.save();
  c.textAlign = 'center';
  for (const f of floatingTexts) {
    c.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
    c.font = `bold ${f.size}px Arial`;
    c.fillStyle = f.color;
    c.strokeStyle = 'rgba(0,0,0,0.7)';
    c.lineWidth = 3;
    c.strokeText(f.text, f.x, f.y);
    c.fillText(f.text, f.x, f.y);
  }
  c.restore();
}

function addPickup(type, x, y, opts = {}) {
  const p = {
    type, x, y,
    active: true,
    respawn: opts.respawn ?? 0,
    timer: 0,
    missionTag: opts.missionTag || null,
    bagId: opts.bagId ?? null,
    phase: rand(0, TAU),
  };
  pickups.push(p);
  return p;
}

function updatePickups(dt) {
  for (const p of pickups) {
    p.phase += dt * 2;
    if (!p.active) {
      p.timer -= dt;
      if (p.timer <= 0 && p.respawn > 0) p.active = true;
      continue;
    }
    if (dist2(p.x, p.y, player.x, player.y) < (p.type === 'bag' ? 42 : 30) ** 2) {
      collectPickup(p);
    }
  }
}

function collectPickup(p) {
  if (!p.active) return;
  if (p.type === 'health') {
    if (state.health >= 100) return;
    state.health = Math.min(100, state.health + 40);
    p.active = false; p.timer = 30;
    audio.pickup();
    floatText(p.x, p.y - 18, '+40 HEALTH', '#a9ff3f', 10);
    toast('HEALTH RESTORED', 'money');
  } else if (p.type === 'armor') {
    if (state.armor >= 100) return;
    state.armor = Math.min(100, state.armor + 50);
    p.active = false; p.timer = 35;
    audio.pickup();
    floatText(p.x, p.y - 18, '+50 ARMOR', '#55d9ff', 10);
    toast('ARMOR PICKED UP', 'blue');
  } else if (p.type === 'ammo') {
    state.weapons.pistol.reserve = Math.min(180, state.weapons.pistol.reserve + 36);
    if (state.smgUnlocked) state.weapons.smg.reserve = Math.min(300, state.weapons.smg.reserve + 60);
    p.active = false; p.timer = 28;
    audio.pickup();
    floatText(p.x, p.y - 18, '+AMMO', '#ffd83d', 10);
    toast('AMMO SCAVENGED', 'gold');
  } else if (p.type === 'bag') {
    p.active = false;
    p.collected = true;
    state.money += 250;
    audio.pickup();
    floatText(p.x, p.y - 20, '+$250', '#a9ff3f', 12);
    if (state.activeMission) state.activeMission.bagsCollected = (state.activeMission.bagsCollected || 0) + 1;
    // Bags attract company.
    if (state.activeMission && state.activeMission.def.id === 'beach-cleanup') {
      for (let i = 0; i < 2; i++) {
        const a = rand(0, TAU);
        spawnPerson('gang', p.x + Math.cos(a) * 90, p.y + Math.sin(a) * 90, {
          missionTag: state.activeMission.tag, alert: true, missionTarget: true, hostile: true
        });
      }
      addHeat(10);
    }
  }
}

function drawPickups(c) {
  for (const p of pickups) {
    if (!p.active) continue;
    if (!inView(p.x, p.y, 80, 80, 50)) continue;
    const bob = Math.sin(p.phase) * 3;
    c.save();
    c.translate(p.x, p.y + bob);
    c.fillStyle = 'rgba(0,0,0,0.22)';
    c.beginPath(); c.ellipse(0, 8 - bob, 14, 6, 0, 0, TAU); c.fill();
    if (p.type === 'health') {
      c.fillStyle = 'rgba(169,255,63,0.15)';
      c.beginPath(); c.arc(0, 0, 20, 0, TAU); c.fill();
      c.fillStyle = '#e8f8dc'; roundRect(c, -8, -8, 16, 16, 3); c.fill();
      c.fillStyle = '#47b91e'; c.fillRect(-2.5, -5.5, 5, 11); c.fillRect(-5.5, -2.5, 11, 5);
    } else if (p.type === 'armor') {
      c.fillStyle = 'rgba(85,217,255,0.15)';
      c.beginPath(); c.arc(0, 0, 20, 0, TAU); c.fill();
      c.fillStyle = '#55d9ff';
      c.beginPath(); c.moveTo(0, -10); c.lineTo(9, -5); c.lineTo(7, 5); c.lineTo(0, 11); c.lineTo(-7, 5); c.lineTo(-9, -5); c.closePath(); c.fill();
      c.fillStyle = '#0c2732'; c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.fillText('A', 0, 3);
    } else if (p.type === 'ammo') {
      c.fillStyle = 'rgba(255,216,61,0.14)';
      c.beginPath(); c.arc(0, 0, 20, 0, TAU); c.fill();
      c.fillStyle = '#3e3f43'; roundRect(c, -9, -6, 18, 12, 2); c.fill();
      c.fillStyle = '#ffd83d'; c.fillRect(-6, -4, 3, 8); c.fillRect(-1, -4, 3, 8); c.fillRect(4, -4, 3, 8);
    } else if (p.type === 'bag') {
      c.fillStyle = 'rgba(255,216,61,0.16)';
      c.beginPath(); c.arc(0, 0, 23, 0, TAU); c.fill();
      c.fillStyle = '#d3b34c';
      roundRect(c, -9, -7, 18, 15, 3); c.fill();
      c.fillStyle = '#f6e7a4'; c.font = 'bold 10px Arial'; c.textAlign = 'center'; c.fillText('$', 0, 4);
      c.strokeStyle = '#6e5821'; c.lineWidth = 1.5;
      c.beginPath(); c.arc(0, -7, 5, Math.PI, 0); c.stroke();
    }
    c.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Player, input, wanted level                                         */
/* ------------------------------------------------------------------ */

const keys = Object.create(null);
const mouse = { x: viewW / 2, y: viewH / 2, worldX: 0, worldY: 0, active: false };
const touchMove = { x: 0, y: 0 };
state.touchMove = touchMove;

function nearestHostile(maxDist = 700) {
  let best = null, bd = maxDist * maxDist;
  for (const p of people) {
    if (p.dead || !p.hostile) continue;
    if (p.faction !== 'cop' && p.faction !== 'gang' && p.faction !== 'boss') continue;
    const d = dist2(player.x, player.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function updatePlayer(dt) {
  player.invuln = Math.max(0, player.invuln - dt);
  player.fireCooldown = Math.max(0, player.fireCooldown - dt);
  state.hurtFlash = Math.max(0, state.hurtFlash - dt * 1.9);
  state.alertTimer = Math.max(0, state.alertTimer - dt);

  // Aiming
  if (isTouch) {
    if (state.touchFire) {
      const t = nearestHostile(760);
      if (t) {
        player.aimAngle = Math.atan2(t.y - player.y, t.x - player.x);
      } else {
        player.aimAngle = player.vehicle ? player.vehicle.angle : player.moveAngle;
      }
    } else if (player.vehicle) {
      player.aimAngle = player.vehicle.angle;
    } else {
      player.aimAngle = player.moveAngle;
    }
  } else {
    const mw = screenToWorld(mouse.x, mouse.y);
    mouse.worldX = mw.x; mouse.worldY = mw.y;
    player.aimAngle = Math.atan2(mw.y - player.y, mw.x - player.x);
  }

  // Weapon timers
  if (player.reloadTimer > 0) {
    player.reloadTimer -= dt;
    if (player.reloadTimer <= 0) finishReload();
  }

  if (player.vehicle) {
    const v = player.vehicle;
    player.x = v.x;
    player.y = v.y;
    player.moveAngle = v.angle;
    if ((state.firing || state.touchFire) && player.reloadTimer <= 0) tryShoot();
  } else {
    let mx = 0, my = 0;
    if (isTouch) {
      mx = touchMove.x;
      my = touchMove.y;
    } else {
      if (keys['KeyA'] || keys['ArrowLeft']) mx -= 1;
      if (keys['KeyD'] || keys['ArrowRight']) mx += 1;
      if (keys['KeyW'] || keys['ArrowUp']) my -= 1;
      if (keys['KeyS'] || keys['ArrowDown']) my += 1;
    }
    const mag = Math.hypot(mx, my);
    if (mag > 0.12) {
      mx /= Math.max(1, mag);
      my /= Math.max(1, mag);
      const sprint = (keys['ShiftLeft'] || keys['ShiftRight'] || state.touchSprint) && !state.touchFire;
      const speed = (sprint ? 305 : 188) * (terrainAt(player.x, player.y) === 'sand' ? 0.78 : 1);
      player.moveAngle = Math.atan2(my, mx);
      player.speed = lerp(player.speed, speed, dt * 9);
      const beforeX = player.x, beforeY = player.y;
      moveWithWalls(player, mx * player.speed * dt, my * player.speed * dt, PLAYER_R);
      player.step += dt * (sprint ? 13 : 8.5);
      if (Math.random() < dt * (sprint ? 13 : 5)) {
        spawnParticle(player.x - mx * 9, player.y - my * 9, {
          vx: rand(-12, 12), vy: rand(-12, 12), life: 0.32,
          size: rand(1, 2.5), color: terrainAt(player.x, player.y) === 'sand' ? '#c7b585' : '#88877f',
          type: 'smoke', drag: 0.88
        });
      }
      if (beforeX === player.x && beforeY === player.y) player.speed *= 0.75;
    } else {
      player.speed = lerp(player.speed, 0, dt * 10);
    }

    // knockback
    if (Math.abs(player.hitPushX) > 1 || Math.abs(player.hitPushY) > 1) {
      moveWithWalls(player, player.hitPushX * dt, player.hitPushY * dt, PLAYER_R);
      player.hitPushX *= Math.pow(0.02, dt);
      player.hitPushY *= Math.pow(0.02, dt);
    }

    // nudge out of parked cars
    for (const v of vehicles) {
      if (v.exploded) continue;
      const rr = v.wid * 0.58 + PLAYER_R - 2;
      if (dist2(player.x, player.y, v.x, v.y) < rr * rr) {
        const d = Math.max(1, dist(player.x, player.y, v.x, v.y));
        const push = (rr - d) * 0.55;
        player.x += (player.x - v.x) / d * push;
        player.y += (player.y - v.y) / d * push;
      }
    }
    player.x = clamp(player.x, 50, WORLD_W - 50);
    player.y = clamp(player.y, 50, LAND_BOTTOM - 34);
  }

  if ((state.firing || state.touchFire) && player.reloadTimer <= 0 && player.fireCooldown <= 0) {
    tryShoot();
  }

  // health regen up to 50
  if (gameTime - state.lastDamage > 5.5 && state.health < 50) {
    state.health = Math.min(50, state.health + dt * 4.2);
  }
}

function tryShoot() {
  const w = state.weapons[state.weapon];
  if (!w) return;
  if (player.reloadTimer > 0) return;
  if (player.fireCooldown > 0) return;
  if (w.mag <= 0) {
    startReload();
    return;
  }
  w.mag--;
  player.fireCooldown = w.rate;
  const inCar = !!player.vehicle;
  const a = player.aimAngle;
  let bx = player.x + Math.cos(a) * (inCar ? player.vehicle.len * 0.42 : 20);
  let by = player.y + Math.sin(a) * (inCar ? player.vehicle.wid * 0.18 : 20);
  if (inCar) {
    bx = player.vehicle.x + Math.cos(a) * (player.vehicle.len * 0.45);
    by = player.vehicle.y + Math.sin(a) * (player.vehicle.len * 0.45);
  }
  spawnBullet(bx, by, a, 1750, w.damage, 'player');
  // muzzle flash
  for (let i = 0; i < 4; i++) {
    spawnParticle(bx, by, {
      vx: Math.cos(a + rand(-0.4, 0.4)) * rand(40, 160),
      vy: Math.sin(a + rand(-0.4, 0.4)) * rand(40, 160),
      life: rand(0.05, 0.13), size: rand(1, 3), color: choice(['#fff4b5', '#ffd168', '#ff9b43'])
    });
  }
  state.camShake = Math.max(state.camShake, state.weapon === 'smg' ? 0.16 : 0.28);
  state.alertTimer = 4;
  addHeat(state.weapon === 'smg' ? 1.2 : 1.8);
  if (state.weapon === 'smg') audio.smg(); else audio.shoot();
}

function startReload() {
  const w = state.weapons[state.weapon];
  if (!w || player.reloadTimer > 0 || w.mag >= w.max || w.reserve <= 0) return;
  player.reloadTimer = w.reload;
  audio.reload();
}

function finishReload() {
  const w = state.weapons[state.weapon];
  if (!w) return;
  const need = w.max - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

function hurtPlayer(dmg, angle = 0) {
  if (state.mode !== 'playing' || player.invuln > 0) return;
  player.invuln = 0.35;
  state.lastDamage = gameTime;
  state.hurtFlash = Math.min(1, state.hurtFlash + 0.7);
  state.camShake = Math.max(state.camShake, 0.55);
  const armorAbsorb = Math.min(state.armor, dmg * 0.62);
  state.armor -= armorAbsorb;
  const real = dmg - armorAbsorb;
  state.health -= real;
  player.hitPushX += Math.cos(angle) * 65;
  player.hitPushY += Math.sin(angle) * 65;
  audio.hit();
  if (state.health <= 0) {
    state.health = 0;
    die('You took one too many hits.');
  }
}

function nearestVehicle(maxDist = 85) {
  let best = null, bd = maxDist * maxDist;
  for (const v of vehicles) {
    if (v.exploded || v === player.vehicle) continue;
    const d = dist2(player.x, player.y, v.x, v.y);
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

function enterVehicle(v) {
  if (!v || v.exploded) return;
  player.vehicle = v;
  player.onFoot = false;
  v.ai = 'player';
  v.driver = 'player';
  v.speed = Math.min(v.speed, 80);
  player.x = v.x; player.y = v.y;
  player.aimAngle = v.angle;
  player.moveAngle = v.angle;
  audio.startEngine();
  if (v.typeKey === 'police') {
    addHeat(18);
    toast('POLICE CRUISER STOLEN', 'warn');
  } else {
    toast(v.name + ' ACQUIRED', 'gold');
  }
  if (state.activeMission) {
    const m = state.activeMission;
    if (m.def.id === 'first-gear' && v === m.targetVehicle && m.step === 0) {
      m.step = 1;
      toast('NOW DELIVER IT TO THE LOCKUP', 'gold');
      floatText(v.x, v.y - 30, 'TARGET ACQUIRED', '#ffd83d', 12);
    } else if (m.def.id === 'evidence-run' && v === m.targetVehicle && m.step === 0) {
      m.step = 1;
      addHeat(56);
      toast('EVIDENCE VAN STOLEN — COPS INBOUND', 'warn');
      showBanner('HEAT IS ON', 'Lose them or make the drop');
    }
  }
  state.firing = false;
  state.mouseDown = false;
}

function exitVehicle() {
  const v = player.vehicle;
  if (!v) return;
  v.ai = 'parked';
  v.driver = null;
  v.speed *= 0.2;
  const side = v.angle + Math.PI / 2;
  let ex = v.x + Math.cos(side) * (v.wid / 2 + 23);
  let ey = v.y + Math.sin(side) * (v.wid / 2 + 23);
  if (collidesBuilding(ex, ey, PLAYER_R)) {
    ex = v.x - Math.cos(side) * (v.wid / 2 + 23);
    ey = v.y - Math.sin(side) * (v.wid / 2 + 23);
  }
  if (collidesBuilding(ex, ey, PLAYER_R)) { ex = v.x; ey = v.y + v.wid / 2 + 26; }
  player.x = clamp(ex, 50, WORLD_W - 50);
  player.y = clamp(ey, 50, LAND_BOTTOM - 34);
  player.vehicle = null;
  player.onFoot = true;
  player.moveAngle = v.angle;
  player.aimAngle = v.angle;
  audio.stopEngine();
  state.firing = false;
}

function addHeat(n) {
  if (state.mode !== 'playing' && state.mode !== 'title') return;
  state.heat = clamp(state.heat + n, 0, 165);
  state.lastCrime = gameTime;
  state.alertTimer = Math.max(state.alertTimer, 3.5);
  const wanted = heatToStars(state.heat);
  if (wanted > state.wanted) {
    state.wanted = wanted;
    updateWantedStars();
    toast('WANTED LEVEL ' + '★'.repeat(wanted), 'warn');
    if (wanted >= 3) state.camShake = Math.max(state.camShake, 0.35);
  }
}

function heatToStars(heat) {
  if (heat <= 18) return 0;
  if (heat <= 38) return 1;
  if (heat <= 62) return 2;
  if (heat <= 90) return 3;
  if (heat <= 125) return 4;
  return 5;
}

function updateWantedStars() {
  const stars = dom.wanted.children;
  for (let i = 0; i < stars.length; i++) {
    stars[i].classList.toggle('on', i < state.wanted);
  }
  dom.wanted.classList.toggle('flash', state.wanted >= 3 && Math.sin(gameTime * 6) > 0);
}

function clearWanted(silent = false) {
  state.heat = 0;
  state.wanted = 0;
  state.lastCrime = -999;
  updateWantedStars();
  for (const v of vehicles) {
    if (v.ai === 'cop') v.remove = true;
  }
  for (const p of people) {
    if (p.faction === 'cop' && !p.missionTag) p.remove = true;
  }
  if (!silent) toast('YOU LOST THE COPS', 'blue');
}

function updateWanted(dt) {
  const stars = heatToStars(state.heat);
  if (stars !== state.wanted) {
    if (stars < state.wanted) toast('HEAT DROPPING', 'blue');
    state.wanted = stars;
    updateWantedStars();
  }
  if (state.heat > 0 && gameTime - state.lastCrime > 10) {
    state.heat = Math.max(0, state.heat - dt * 3.5);
  }
  if (state.heat <= 0 && state.wanted > 0) {
    clearWanted();
  }
  if (state.wanted === 0) return;

  state.copsSpawnTimer -= dt;
  const aliveFoot = people.filter(p => p.faction === 'cop' && !p.dead && !p.missionTag).length;
  const copCars = vehicles.filter(v => v.ai === 'cop' && !v.exploded).length;
  const wantFoot = Math.min(1 + state.wanted, 6);
  const wantCars = state.wanted >= 2 ? Math.min(state.wanted - 1, 3) : 0;
  if (state.copsSpawnTimer <= 0 && (aliveFoot < wantFoot || copCars < wantCars)) {
    state.copsSpawnTimer = 1.3;
    if (aliveFoot < wantFoot) {
      const pt = randomRoadPointNear(player.x, player.y, 560, 1000);
      if (pt) {
        const cop = spawnPerson('cop', pt.x, pt.y, { alert: true });
        cop.aimAngle = rand(0, TAU);
      }
    } else if (copCars < wantCars) {
      const pt = randomRoadPointNear(player.x, player.y, 650, 1150);
      if (pt) {
        spawnVehicle({ x: pt.x, y: pt.y, type: 'police', ai: 'cop', color: '#e9e8df', health: 175, angle: rand(0, TAU) });
      }
    }
  }
}

function randomRoadPointNear(x, y, minD, maxD) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const useX = Math.random() < 0.5;
    if (useX) {
      const i = randInt(0, ROAD_X.length - 1);
      const j = randInt(0, ROAD_Y.length - 1);
      const px = ROAD_X[i] + rand(-halfRoad(i) * 0.55, halfRoad(i) * 0.55);
      const py = ROAD_Y[j] + rand(-halfRoad(j) * 0.55, halfRoad(j) * 0.55);
      const d = dist(px, py, x, y);
      if (d > minD && d < maxD) return { x: px, y: py };
    } else {
      const i = randInt(0, ROAD_X.length - 1);
      const px = ROAD_X[i] + rand(-halfRoad(i) * 0.4, halfRoad(i) * 0.4);
      const py = rand(200, BEACH_TOP - 100);
      const d = dist(px, py, x, y);
      if (d > minD && d < maxD) return { x: px, y: py };
    }
  }
  return null;
}

function randomSidewalkPointNear(x, y, minD = 80, maxD = 900) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const block = choice(world.blocks);
    if (!block) break;
    const edge = randInt(0, 3);
    let px, py;
    if (edge === 0) { px = block.x + rand(10, block.w - 10); py = block.y + rand(5, 16); }
    else if (edge === 1) { px = block.x + rand(10, block.w - 10); py = block.y + block.h - rand(5, 16); }
    else if (edge === 2) { px = block.x + rand(5, 16); py = block.y + rand(10, block.h - 10); }
    else { px = block.x + block.w - rand(5, 16); py = block.y + rand(10, block.h - 10); }
    const d = dist(px, py, x, y);
    if (d < minD || d > maxD) continue;
    if (collidesBuilding(px, py, 10)) continue;
    return { x: px, y: py };
  }
  return null;
}

function updateAmbient(dt) {
  state.ambientTimer = (state.ambientTimer || 0) - dt;
  if (state.ambientTimer > 0) return;
  state.ambientTimer = 0.6;

  for (let i = people.length - 1; i >= 0; i--) {
    const p = people[i];
    if (p.remove) { people.splice(i, 1); continue; }
    if (!p.missionTag && !p.dead && dist2(p.x, p.y, player.x, player.y) > 2400 ** 2) people.splice(i, 1);
  }
  for (let i = vehicles.length - 1; i >= 0; i--) {
    const v = vehicles[i];
    if (v.remove) { vehicles.splice(i, 1); continue; }
    if (v.ai === 'traffic' && dist2(v.x, v.y, player.x, player.y) > 2600 ** 2) vehicles.splice(i, 1);
  }

  const civs = people.filter(p => !p.missionTag && p.faction === 'civilian' && !p.dead).length;
  if (civs < (isTouch ? 15 : 22)) {
    const pt = randomSidewalkPointNear(player.x, player.y, 90, 950);
    if (pt) spawnPerson('civilian', pt.x, pt.y);
  }
  const traffic = vehicles.filter(v => v.ai === 'traffic').length;
  if (traffic < (isTouch ? 9 : 14)) {
    const v = spawnTrafficCar(420, 1500);
    if (v) { /* spawned */ }
  }
}

/* ------------------------------------------------------------------ */
/* Missions                                                            */
/* ------------------------------------------------------------------ */

const MISSION_DEFS = [
  {
    id: 'first-gear', title: 'FIRST GEAR', contact: 'LESTER', where: 'the safehouse',
    location: { x: 1430, y: 2540 }, reward: 750,
    sub: 'A yellow Sultan. A quiet lockup. Easy money.',
    startText: 'Steal the yellow Sultan parked out front.'
  },
  {
    id: 'pier-pressure', title: 'PIER PRESSURE', contact: 'LAMAR', where: 'Vespucci Pier',
    location: { x: 2845, y: 4150 }, reward: 1400,
    sub: 'The Vagos are pushing product on the boardwalk.',
    startText: 'Take out the Vagos at the pier.'
  },
  {
    id: 'evidence-run', title: 'EVIDENCE RUN', contact: 'LESTER', where: 'the LSPD impound',
    location: { x: 3740, y: 3050 }, reward: 2600,
    sub: 'An evidence van is sitting in a police lot. Borrow it.',
    startText: 'Boost the evidence van from the impound lot.'
  },
  {
    id: 'beach-cleanup', title: 'BEACH CLEANUP', contact: 'LAMAR', where: 'Vespucci Beach',
    location: { x: 2450, y: 4150 }, reward: 3800,
    sub: 'Three cash bags are buried in the sand. Finders keepers.',
    startText: 'Collect the three cash bags on the beach.'
  },
  {
    id: 'king-of-the-city', title: 'KING OF THE CITY', contact: 'LESTER', where: 'Marco\'s compound',
    location: { x: 2400, y: 1240 }, reward: 15000,
    sub: 'Marco runs the east side. Take the crown.',
    startText: 'Take out Marco and his crew.'
  }
];

function startMission(index) {
  if (state.activeMission || state.mode !== 'playing' || index >= MISSION_DEFS.length) return;
  clearTimeout(nextJobTimer);
  nextJobTimer = null;
  const def = MISSION_DEFS[index];
  const m = {
    def, index, step: 0, tag: 'm' + index + '_' + Math.floor(gameTime * 1000),
    targetVehicle: null, targets: [], bags: [], bagsCollected: 0, lastKill: null,
    startedAt: gameTime,
  };
  state.activeMission = m;
  state.missionIndex = index;

  if (def.id === 'first-gear') {
    spawnMissionCar(m);
  } else if (def.id === 'pier-pressure') {
    const spots = [
      { x: 2740, y: 4160 }, { x: 2885, y: 4090 }, { x: 2975, y: 4195 },
      { x: 2690, y: 4260 }, { x: 2820, y: 4310 }
    ];
    for (const s of spots) {
      const p = spawnPerson('gang', s.x, s.y, {
        missionTag: m.tag, alert: true, missionTarget: true, hostile: true, color: '#6d252b'
      });
      m.targets.push(p);
    }
    addHeat(8);
  } else if (def.id === 'evidence-run') {
    const v = spawnVehicle({
      x: LANDMARKS.van.x, y: LANDMARKS.van.y, angle: 0, type: 'van',
      color: '#c9c8c0', ai: 'parked', health: 210, missionTag: m.tag, isTarget: true
    });
    v.name = 'EVIDENCE VAN';
    m.targetVehicle = v;
    for (let i = 0; i < 2; i++) {
      const p = spawnPerson('cop', LANDMARKS.van.x + (i ? 75 : -70), LANDMARKS.van.y + (i ? 25 : -30), {
        missionTag: m.tag, alert: true, missionTarget: true, hostile: true
      });
      m.targets.push(p);
    }
  } else if (def.id === 'beach-cleanup') {
    const bagSpots = [
      { x: 1000, y: 4255 }, { x: 2370, y: 4290 }, { x: 3500, y: 4260 }
    ];
    bagSpots.forEach((s, i) => {
      const p = addPickup('bag', s.x, s.y, { missionTag: m.tag, bagId: i });
      m.bags.push(p);
    });
    const guards = [
      { x: 1150, y: 4210 }, { x: 2200, y: 4240 }, { x: 2520, y: 4210 }, { x: 3380, y: 4220 }
    ];
    for (const s of guards) {
      const p = spawnPerson('gang', s.x, s.y, {
        missionTag: m.tag, alert: true, missionTarget: true, hostile: true
      });
      m.targets.push(p);
    }
  } else if (def.id === 'king-of-the-city') {
    const boss = spawnPerson('boss', 2400, 970, {
      missionTag: m.tag, alert: true, missionTarget: true, hostile: true,
      name: 'MARCO', health: 340
    });
    m.targets.push(boss);
    const guards = [
      { x: 2300, y: 970 }, { x: 2500, y: 970 }, { x: 2370, y: 1120 },
      { x: 2430, y: 1120 }, { x: 2400, y: 1130 }
    ];
    for (const s of guards) {
      const p = spawnPerson('gang', s.x, s.y, {
        missionTag: m.tag, alert: true, missionTarget: true, hostile: true
      });
      m.targets.push(p);
    }
    addHeat(12);
  }

  audio.missionStart();
  showBanner(def.title, def.sub);
  toast('MISSION STARTED · ' + def.title, 'gold');
  state.lastCrime = gameTime;
  updateMissionUI(true);
}

function spawnMissionCar(m) {
  for (const v of vehicles) {
    if (v.missionTag === m.tag) v.remove = true;
  }
  const car = spawnVehicle({
    x: LANDMARKS.targetCar.x, y: LANDMARKS.targetCar.y, angle: -Math.PI / 2,
    type: 'sports', color: '#e8c83d', ai: 'parked', health: 160,
    missionTag: m.tag, isTarget: true
  });
  car.name = 'SULTAN';
  m.targetVehicle = car;
  return car;
}

function missionTargetKills(m) {
  if (!m || !m.targets) return 0;
  return m.targets.filter(p => p.dead).length;
}

function getMissionMarker() {
  const m = state.activeMission;
  if (!m) {
    if (state.missionIndex >= MISSION_DEFS.length) return null;
    const d = MISSION_DEFS[state.missionIndex];
    return { x: d.location.x, y: d.location.y, kind: 'start', label: d.title };
  }
  if (m.def.id === 'first-gear') {
    if (m.step === 0 && m.targetVehicle && !m.targetVehicle.exploded) return { x: m.targetVehicle.x, y: m.targetVehicle.y, kind: 'vehicle', label: 'SULTAN' };
    return { x: LANDMARKS.garage.x, y: LANDMARKS.garage.y, kind: 'goto', label: 'LOCKUP' };
  }
  if (m.def.id === 'pier-pressure') {
    const alive = m.targets.filter(p => !p.dead);
    if (alive.length) {
      const p = alive[0];
      return { x: p.x, y: p.y, kind: 'kill', label: 'VAGOS' };
    }
    return { x: LANDMARKS.pier.x, y: LANDMARKS.pier.y, kind: 'goto', label: 'PIER' };
  }
  if (m.def.id === 'evidence-run') {
    if (m.step === 0 && m.targetVehicle && !m.targetVehicle.exploded) return { x: m.targetVehicle.x, y: m.targetVehicle.y, kind: 'vehicle', label: 'EVIDENCE VAN' };
    return { x: LANDMARKS.garage.x, y: LANDMARKS.garage.y, kind: 'goto', label: 'LOCKUP' };
  }
  if (m.def.id === 'beach-cleanup') {
    const bag = m.bags.find(b => b.active);
    if (bag) return { x: bag.x, y: bag.y, kind: 'bag', label: 'CASH' };
    return { x: LANDMARKS.beach.x, y: LANDMARKS.beach.y, kind: 'goto', label: 'BEACH' };
  }
  if (m.def.id === 'king-of-the-city') {
    if (m.step === 0) {
      const alive = m.targets.filter(p => !p.dead);
      if (alive.length) {
        const p = alive.find(x => x.boss) || alive[0];
        return { x: p.x, y: p.y, kind: 'kill', label: p.boss ? 'MARCO' : 'CREW' };
      }
    }
    return { x: LANDMARKS.safehouse.x, y: LANDMARKS.safehouse.y, kind: 'goto', label: 'SAFEHOUSE' };
  }
  return null;
}

function updateMission(dt) {
  const m = state.activeMission;
  if (!m) return;
  const marker = getMissionMarker();
  if (m.def.id === 'first-gear') {
    if (m.step === 0 && m.targetVehicle && player.vehicle === m.targetVehicle) {
      m.step = 1;
      toast('DELIVER IT TO THE LOCKUP', 'gold');
      floatText(player.x, player.y - 30, 'TARGET ACQUIRED', '#ffd83d', 12);
    }
    if (m.step === 1 && m.targetVehicle && player.vehicle === m.targetVehicle) {
      if (dist(m.targetVehicle.x, m.targetVehicle.y, LANDMARKS.garage.x, LANDMARKS.garage.y) < 78 && Math.abs(m.targetVehicle.speed) < 90) {
        completeMission();
      }
    }
  } else if (m.def.id === 'pier-pressure') {
    if (missionTargetKills(m) >= m.targets.length) completeMission();
  } else if (m.def.id === 'evidence-run') {
    if (m.step === 0 && m.targetVehicle && player.vehicle === m.targetVehicle) {
      m.step = 1;
      addHeat(56);
      showBanner('HEAT IS ON', 'Deliver the evidence van to the lockup');
      toast('WANTED LEVEL 2 — SHAKE THE COPS', 'warn');
    }
    if (m.step === 1 && m.targetVehicle && player.vehicle === m.targetVehicle) {
      if (dist(m.targetVehicle.x, m.targetVehicle.y, LANDMARKS.garage.x, LANDMARKS.garage.y) < 82 && Math.abs(m.targetVehicle.speed) < 100) {
        completeMission();
      }
    }
  } else if (m.def.id === 'beach-cleanup') {
    m.bagsCollected = m.bags.filter(b => !b.active).length;
    if (m.bagsCollected >= m.bags.length) completeMission();
  } else if (m.def.id === 'king-of-the-city') {
    if (m.step === 0 && missionTargetKills(m) >= m.targets.length) {
      m.step = 1;
      state.heat = 96;
      state.lastCrime = gameTime;
      state.wanted = heatToStars(state.heat);
      showBanner('THE CITY IS WATCHING', 'Lose the cops and get back to the safehouse');
      toast('WANTED LEVEL 4 — GET OUT OF DOWNTOWN', 'warn');
      addHeat(0);
    }
    if (m.step === 1 && state.wanted === 0) {
      if (dist(player.x, player.y, LANDMARKS.safehouse.x, LANDMARKS.safehouse.y) < 95) {
        completeMission();
      } else {
        // once the heat is gone the safehouse marker guides the player home
        if (m.escapeReady !== true) {
          m.escapeReady = true;
          toast('HEAT LOST — GET TO THE SAFEHOUSE', 'blue');
        }
      }
    }
  }
}

function completeMission() {
  const m = state.activeMission;
  if (!m) return;
  const def = m.def;
  state.money += def.reward;
  state.activeMission = null;
  state.missionIndex = Math.max(state.missionIndex, m.index + 1);
  state.kills = state.kills;
  clearMissionActors(m.tag);
  clearWanted(true);
  audio.missionComplete();
  showBanner('MISSION PASSED', def.title + ' · ' + fmtMoney(def.reward));
  toast('+' + fmtMoney(def.reward) + ' · ' + def.title + ' COMPLETE', 'money');
  floatText(player.x, player.y - 35, '+' + fmtMoney(def.reward), '#a9ff3f', 16);

  if (def.id === 'pier-pressure' && !state.smgUnlocked) {
    state.smgUnlocked = true;
    state.weapons.smg.mag = 30;
    state.weapons.smg.reserve = 120;
    state.weapon = 'smg';
    toast('MICRO SMG UNLOCKED · PRESS Q TO SWITCH', 'gold');
  }
  if (def.id === 'beach-cleanup') {
    state.armor = Math.min(100, state.armor + 50);
    toast('ARMOR PLATE FOUND IN THE SAND', 'blue');
  }

  saveGame();
  if (state.missionIndex >= MISSION_DEFS.length) {
    state.freeRoam = true;
    setTimeout(showEndScreen, 3200);
  } else {
    const next = MISSION_DEFS[state.missionIndex];
    const nextIndex = state.missionIndex;
    clearTimeout(nextJobTimer);
    nextJobTimer = setTimeout(() => {
      nextJobTimer = null;
      if (state.mode === 'playing' && !state.activeMission && state.missionIndex === nextIndex) {
        toast('NEXT JOB · ' + next.title + ' — ' + next.where, 'gold');
      }
    }, 2200);
  }
  updateMissionUI(true);
}

function failMission(reason) {
  const m = state.activeMission;
  if (!m) return;
  clearMissionActors(m.tag);
  state.activeMission = null;
  toast('MISSION FAILED · ' + reason, 'warn');
  showBanner('MISSION FAILED', reason);
  updateMissionUI(true);
}

function clearMissionActors(tag) {
  if (player.vehicle && player.vehicle.missionTag === tag) {
    const v = player.vehicle;
    player.x = v.x;
    player.y = v.y;
    player.vehicle = null;
    player.onFoot = true;
    audio.stopEngine();
  }
  for (let i = people.length - 1; i >= 0; i--) {
    if (people[i].missionTag === tag) people.splice(i, 1);
  }
  for (let i = vehicles.length - 1; i >= 0; i--) {
    if (vehicles[i].missionTag === tag) vehicles.splice(i, 1);
  }
  for (let i = pickups.length - 1; i >= 0; i--) {
    if (pickups[i].missionTag === tag) pickups.splice(i, 1);
  }
}

function die(reason) {
  if (state.mode !== 'playing') return;
  state.mode = 'dead';
  state.activeMission = null;
  audio.stopEngine();
  audio.wasted();
  state.firing = false;
  state.mouseDown = false;
  dom.failKicker.textContent = 'WASTED';
  dom.failTitle.innerHTML = 'THE STREETS<br>WON THIS ROUND.';
  dom.failReason.textContent = reason + ' The city always gets its cut.';
  dom.fail.classList.remove('hidden');
  dom.touch.classList.add('hidden');
  // clean up any active job so it can be retried from its marker
  for (const p of people) {
    if (p.missionTag) p.remove = true;
  }
  for (const v of vehicles) {
    if (v.missionTag) v.remove = true;
  }
  for (const p of pickups) {
    if (p.missionTag) p.active = false;
  }
}

function respawnPlayer() {
  state.mode = 'playing';
  state.health = 100;
  state.armor = 25;
  state.money = Math.floor(state.money * 0.9);
  state.heat = 0;
  state.wanted = 0;
  state.lastDamage = -99;
  state.hurtFlash = 0;
  state.activeMission = null;
  player.vehicle = null;
  player.onFoot = true;
  player.x = LANDMARKS.hospital.x;
  player.y = LANDMARKS.hospital.y;
  player.aimAngle = -Math.PI / 2;
  player.moveAngle = -Math.PI / 2;
  player.hitPushX = 0; player.hitPushY = 0;
  clearWanted(true);
  for (const p of people) if (p.faction === 'cop') p.remove = true;
  for (const v of vehicles) if (v.ai === 'cop') v.remove = true;
  dom.fail.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  if (isTouch) dom.touch.classList.remove('hidden');
  toast('STITCHED UP AT ST. ROSE · -10% CASH', 'warn');
  camera.x = player.x; camera.y = player.y;
  updateMissionUI(true);
}

/* ------------------------------------------------------------------ */
/* Interactions                                                        */
/* ------------------------------------------------------------------ */

function getInteraction() {
  if (state.mode !== 'playing') return null;

  // mission marker
  const marker = getMissionMarker();
  if (!state.activeMission && marker && marker.kind === 'start') {
    if (dist(player.x, player.y, marker.x, marker.y) < 92) {
      return { type: 'mission', label: 'START MISSION · ' + MISSION_DEFS[state.missionIndex].title };
    }
  }

  if (player.vehicle) {
    if (dist(player.x, player.y, LANDMARKS.paynspray.x, LANDMARKS.paynspray.y) < 115 && Math.abs(player.vehicle.speed) < 100) {
      return { type: 'spray', label: 'REPAIR & REPAINT · $300' };
    }
    return { type: 'exit', label: 'EXIT ' + player.vehicle.name };
  }

  // shops / safehouse
  if (dist(player.x, player.y, LANDMARKS.ammu.x, LANDMARKS.ammu.y) < 82) {
    return { type: 'ammo', label: 'BUY AMMO · $200' };
  }
  if (dist(player.x, player.y, LANDMARKS.safehouse.x, LANDMARKS.safehouse.y) < 86) {
    return { type: 'safehouse', label: 'SAVE & HEAL' };
  }

  const v = nearestVehicle(88);
  if (v) {
    if (v.isTarget && state.activeMission) return { type: 'enter', vehicle: v, label: 'STEAL ' + (v.name || v.typeKey.toUpperCase()) };
    return { type: 'enter', vehicle: v, label: 'JACK ' + v.name };
  }
  return null;
}

function interact() {
  if (state.mode === 'title') { startFromTitle(); return; }
  if (state.mode === 'paused') { togglePause(); return; }
  if (state.mode !== 'playing') return;
  const it = state.interaction || getInteraction();
  if (!it) return;
  if (it.type === 'exit') { exitVehicle(); return; }
  if (it.type === 'enter') { enterVehicle(it.vehicle); return; }
  if (it.type === 'mission') {
    startMission(state.missionIndex);
    return;
  }
  if (it.type === 'ammo') {
    if (state.money < 200) { toast('NOT ENOUGH CASH', 'warn'); return; }
    state.money -= 200;
    state.weapons.pistol.reserve = Math.min(240, state.weapons.pistol.reserve + 48);
    if (state.smgUnlocked) state.weapons.smg.reserve = Math.min(360, state.weapons.smg.reserve + 90);
    audio.buy();
    toast('AMMO PURCHASED · -$200', 'gold');
    return;
  }
  if (it.type === 'safehouse') {
    state.health = 100;
    state.armor = Math.max(state.armor, 50);
    saveGame();
    audio.pickup();
    toast('SAFEHOUSE SAVED · HEALTH & ARMOR RESTORED', 'money');
    return;
  }
  if (it.type === 'spray') {
    if (state.money < 300) { toast('NOT ENOUGH CASH', 'warn'); return; }
    state.money -= 300;
    player.vehicle.health = player.vehicle.maxHealth;
    player.vehicle.color = choice(CAR_COLORS);
    clearWanted();
    audio.buy();
    toast('REPAIRED & REPAINTED · -$300', 'money');
    return;
  }
}

/* ------------------------------------------------------------------ */
/* HUD / UI                                                            */
/* ------------------------------------------------------------------ */

let bannerTimer = null;
let nextJobTimer = null;

function toast(text, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.textContent = text;
  dom.toastStack.appendChild(el);
  while (dom.toastStack.children.length > 4) dom.toastStack.firstChild.remove();
  setTimeout(() => el.remove(), 3000);
}

function showBanner(title, sub, kicker) {
  if (!kicker) {
    if (title === 'MISSION PASSED') kicker = 'JOB COMPLETE';
    else if (title === 'MISSION FAILED') kicker = 'JOB FAILED';
    else if (title === 'HEAT IS ON' || title === 'THE CITY IS WATCHING') kicker = 'ALERT';
    else kicker = 'MISSION';
  }
  dom.bannerKicker.textContent = kicker;
  dom.bannerKicker.classList.toggle('danger', title === 'MISSION FAILED');
  dom.bannerTitle.textContent = title;
  dom.bannerSub.textContent = sub || '';
  dom.missionBanner.classList.remove('hidden');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => dom.missionBanner.classList.add('hidden'), 2800);
}

function districtAt(x, y) {
  if (y > BEACH_TOP - 30) return 'VESPUCCI BEACH';
  if (x > 3540 && y < 1780) return 'VINEWOOD HILLS';
  if (x > 1560 && x < 3360 && y < 1540) return 'DOWNTOWN';
  if (x < 1080 && y > 2700) return 'LA MESA';
  if (x > 3200 && y > 2200) return 'EL BURRO HEIGHTS';
  if (x < 1400 && y < 1900) return 'DEL PERRO';
  if (x > 2300 && y > 2400) return 'LITTLE SEOUL';
  return 'STRAWBERRY';
}

function updateClock(dt) {
  clockHours = (18.6 + gameTime * 0.0125) % 24;
}

function formatClock(h) {
  const hh = Math.floor(h);
  const mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function getObjectiveText() {
  const m = state.activeMission;
  if (!m) {
    if (state.missionIndex >= MISSION_DEFS.length) return 'Los Santos is yours. Cause some chaos.';
    const d = MISSION_DEFS[state.missionIndex];
    return 'Meet ' + d.contact + ' at ' + d.where + '.';
  }
  if (m.def.id === 'first-gear') {
    return m.step === 0 ? 'Steal the yellow Sultan parked out front.' : 'Deliver the Sultan to your lockup.';
  }
  if (m.def.id === 'pier-pressure') {
    return 'Take out the Vagos (' + missionTargetKills(m) + '/' + m.targets.length + ').';
  }
  if (m.def.id === 'evidence-run') {
    return m.step === 0 ? 'Boost the evidence van from the impound lot.' : 'Deliver the van to your lockup. Shake the heat.';
  }
  if (m.def.id === 'beach-cleanup') {
    return 'Collect the cash bags (' + m.bagsCollected + '/' + m.bags.length + ').';
  }
  if (m.def.id === 'king-of-the-city') {
    if (m.step === 0) return 'Take out Marco and his crew (' + missionTargetKills(m) + '/' + m.targets.length + ').';
    if (state.wanted > 0) return 'Lose the cops. Wanted level ' + state.wanted + '.';
    return 'Get back to the safehouse.';
  }
  return '';
}

function updateMissionUI(force = false) {
  const m = state.activeMission;
  if (m) {
    dom.missionState.textContent = 'MISSION ACTIVE';
    dom.missionTitle.textContent = m.def.title;
    dom.missionObjective.textContent = getObjectiveText();
  } else if (state.missionIndex >= MISSION_DEFS.length) {
    dom.missionState.textContent = 'FREE ROAM';
    dom.missionTitle.textContent = 'LOS SANTOS IS YOURS';
    dom.missionObjective.textContent = 'The city is yours. Cause some chaos.';
  } else {
    const d = MISSION_DEFS[state.missionIndex];
    dom.missionState.textContent = 'NEXT JOB';
    dom.missionTitle.textContent = d.title;
    dom.missionObjective.textContent = getObjectiveText();
  }
  const marker = getMissionMarker();
  if (marker) {
    const d = Math.round(dist(player.x, player.y, marker.x, marker.y) / 6);
    dom.missionDistance.textContent = (state.activeMission ? 'OBJECTIVE' : 'MEET') + ' · ' + d + 'M';
  } else {
    dom.missionDistance.textContent = '';
  }
}

function updateHUD(dt) {
  const m = state.activeMission;
  dom.health.style.width = clamp(state.health, 0, 100) + '%';
  dom.armor.style.width = clamp(state.armor, 0, 100) + '%';
  dom.cash.textContent = fmtMoney(state.money).replace('$', '');

  updateWantedStars();

  dom.clock.textContent = formatClock(clockHours);
  const district = districtAt(player.x, player.y);
  if (district !== state.district) {
    if (state.district) toast(district, '');
    state.district = district;
    dom.district.textContent = district;
  }

  const w = state.weapons[state.weapon];
  if (w) {
    dom.weaponName.textContent = w.name;
    dom.weaponIcon.textContent = w.icon;
    dom.ammo.textContent = player.reloadTimer > 0 ? '···' : String(w.mag);
    dom.reserve.textContent = String(w.reserve);
  }

  if (player.vehicle) {
    dom.vehicleHud.classList.remove('hidden');
    const v = player.vehicle;
    const mph = Math.round(Math.abs(v.speed) * 0.17);
    dom.speedNumber.textContent = mph;
    dom.speedBar.style.width = clamp(Math.abs(v.speed) / v.max * 100, 0, 100) + '%';
    dom.vehicleName.textContent = v.name;
    dom.radio.textContent = 'NIGHTDRIVE FM · 98.7';
  } else {
    dom.vehicleHud.classList.add('hidden');
  }

  state.interaction = getInteraction();
  if (state.interaction) {
    dom.prompt.classList.remove('hidden');
    dom.promptText.textContent = state.interaction.label;
  } else {
    dom.prompt.classList.add('hidden');
  }
  if (isTouch) {
    const labels = {
      exit: 'EXIT', enter: 'JACK', mission: 'START', ammo: 'BUY', safehouse: 'SAVE', spray: 'SPRAY'
    };
    dom.btnAction.textContent = state.interaction ? (labels[state.interaction.type] || 'USE') : (player.vehicle ? 'EXIT' : 'ENTER');
    dom.btnSprint.textContent = player.vehicle ? 'BRAKE' : 'RUN';
    dom.btnFire.textContent = player.vehicle ? 'DRIVE-BY' : 'FIRE';
  }

  updateMissionUI();
  dom.objectiveArrow.classList.add('hidden');
}

function updatePauseUI() {
  dom.pauseCash.textContent = fmtMoney(state.money);
  dom.pauseMissions.textContent = state.missionIndex + ' / ' + MISSION_DEFS.length;
  dom.pauseWanted.textContent = state.wanted === 0 ? 'CLEAN' : '★'.repeat(state.wanted);
}

function togglePause() {
  if (state.mode === 'playing') {
    state.mode = 'paused';
    updatePauseUI();
    dom.pause.classList.remove('hidden');
    dom.touch.classList.add('hidden');
    state.firing = false;
    state.mouseDown = false;
  } else if (state.mode === 'paused') {
    state.mode = 'playing';
    dom.pause.classList.add('hidden');
    if (isTouch) dom.touch.classList.remove('hidden');
  }
}

function toggleSound() {
  audio.init();
  audio.setEnabled(!audio.enabled);
  dom.soundToggle.classList.toggle('off', !audio.enabled);
  dom.pauseSound.textContent = 'SOUND: ' + (audio.enabled ? 'ON' : 'OFF');
  if (audio.enabled) toast('SOUND ON', '');
  else toast('SOUND OFF', 'warn');
}

/* ------------------------------------------------------------------ */
/* Save / start / end                                                  */
/* ------------------------------------------------------------------ */

function readSave() {
  try {
    const raw = localStorage.getItem('ls2d_save_v1');
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data.missionIndex !== 'number') return null;
    return data;
  } catch { return null; }
}

function saveGame() {
  try {
    const data = {
      version: 1,
      missionIndex: state.missionIndex,
      money: state.money,
      smgUnlocked: state.smgUnlocked,
      weapon: state.weapon,
      weapons: state.weapons,
      armor: state.armor,
      freeRoam: state.freeRoam,
      kills: state.kills,
      crashes: state.crashes,
      savedAt: Date.now(),
    };
    localStorage.setItem('ls2d_save_v1', JSON.stringify(data));
    saveData = data;
  } catch {}
}

function addLandmarkPickups() {
  addPickup('health', 1890, 2085, { respawn: 30 });
  addPickup('armor', 3710, 3005, { respawn: 38 });
  addPickup('ammo', 1015, 1540, { respawn: 32 });
  addPickup('health', 2880, 3020, { respawn: 35 });
  addPickup('armor', 2425, 1145, { respawn: 45 });
}

function clearWorldEntities() {
  vehicles.length = 0;
  people.length = 0;
  bullets.length = 0;
  particles.length = 0;
  decals.length = 0;
  floatingTexts.length = 0;
  pickups.length = 0;
}

function resetPlayerToSpawn() {
  player.x = LANDMARKS.spawn.x;
  player.y = LANDMARKS.spawn.y;
  player.angle = -Math.PI / 2;
  player.aimAngle = -Math.PI / 2;
  player.moveAngle = -Math.PI / 2;
  player.speed = 0;
  player.vehicle = null;
  player.onFoot = true;
  player.invuln = 0;
  player.hitPushX = 0;
  player.hitPushY = 0;
  player.reloadTimer = 0;
  player.fireCooldown = 0;
}

function seedAmbient() {
  for (let i = 0; i < 16; i++) {
    const pt = randomSidewalkPointNear(player.x, player.y, 70, 1050);
    if (pt) spawnPerson('civilian', pt.x, pt.y);
  }
  for (let i = 0; i < 11; i++) spawnTrafficCar(380, 1500);
}

function startNewGame() {
  try { localStorage.removeItem('ls2d_save_v1'); } catch {}
  saveData = null;
  clearTimeout(nextJobTimer);
  nextJobTimer = null;
  clearWorldEntities();
  state.money = 1250;
  state.health = 100;
  state.armor = 0;
  state.wanted = 0;
  state.prevWanted = 0;
  state.heat = 0;
  state.lastCrime = -999;
  state.missionIndex = 0;
  state.activeMission = null;
  state.kills = 0;
  state.crashes = 0;
  state.weapon = 'pistol';
  state.smgUnlocked = false;
  state.weapons = {
    pistol: { mag: 12, reserve: 72, max: 12, name: 'PISTOL', rate: 0.19, damage: 34, reload: 1.05, icon: '▰' },
    smg: { mag: 0, reserve: 0, max: 30, name: 'MICRO SMG', rate: 0.075, damage: 21, reload: 1.55, icon: '▰▰' }
  };
  state.hurtFlash = 0;
  state.lastDamage = -99;
  state.freeRoam = false;
  state.gameStarted = true;
  state.district = '';
  state.copsSpawnTimer = 0;
  resetPlayerToSpawn();
  spawnParkedCars();
  addLandmarkPickups();
  seedAmbient();
  camera.x = player.x; camera.y = player.y;
  camera.zoom = isTouch ? 0.72 : 1.05;
  state.mode = 'playing';
  startMission(0);
  updateMissionUI(true);
  saveData = null;
}

function continueGame() {
  const data = saveData || readSave();
  if (!data) { startNewGame(); return; }
  clearWorldEntities();
  state.money = data.money ?? 1250;
  state.health = 100;
  state.armor = data.armor ?? 0;
  state.wanted = 0;
  state.heat = 0;
  state.lastCrime = -999;
  state.missionIndex = clamp(data.missionIndex ?? 0, 0, MISSION_DEFS.length);
  state.activeMission = null;
  state.kills = data.kills ?? 0;
  state.crashes = data.crashes ?? 0;
  state.smgUnlocked = !!data.smgUnlocked;
  state.weapon = data.weapon === 'smg' && state.smgUnlocked ? 'smg' : 'pistol';
  if (data.weapons) state.weapons = data.weapons;
  state.freeRoam = !!data.freeRoam;
  state.gameStarted = true;
  state.district = '';
  state.copsSpawnTimer = 0;
  resetPlayerToSpawn();
  spawnParkedCars();
  addLandmarkPickups();
  seedAmbient();
  camera.x = player.x; camera.y = player.y;
  camera.zoom = isTouch ? 0.72 : 1.05;
  state.mode = 'playing';
  updateMissionUI(true);
  toast('WELCOME BACK TO LOS SANTOS', 'gold');
  if (state.missionIndex >= MISSION_DEFS.length) toast('FREE ROAM · THE CITY IS YOURS', 'money');
}

function startFromTitle() {
  audio.init();
  if (audio.ctx) audio.ctx.resume();
  audio.setEnabled(audio.enabled);
  dom.title.classList.add('hidden');
  dom.hud.classList.remove('hidden');
  if (isTouch) dom.touch.classList.remove('hidden');
  if (saveData) continueGame();
  else startNewGame();
  setTimeout(() => toast('LOS SANTOS · 18:36', ''), 700);
}

function showEndScreen() {
  if (state.mode === 'dead') return;
  state.mode = 'ended';
  dom.endCash.textContent = fmtMoney(state.money);
  dom.endKills.textContent = String(state.kills);
  dom.endCrashes.textContent = String(state.crashes);
  dom.end.classList.remove('hidden');
  dom.touch.classList.add('hidden');
  state.firing = false;
  audio.stopEngine();
  saveGame();
}

function goToTitle() {
  state.mode = 'title';
  state.firing = false;
  clearTimeout(nextJobTimer);
  nextJobTimer = null;
  audio.stopEngine();
  dom.pause.classList.add('hidden');
  dom.fail.classList.add('hidden');
  dom.end.classList.add('hidden');
  dom.hud.classList.add('hidden');
  dom.touch.classList.add('hidden');
  dom.title.classList.remove('hidden');
  saveData = readSave();
  updateTitleSaveButton();
  resetTitleCamera();
}

function updateTitleSaveButton() {
  if (saveData) {
    dom.start.querySelector('span').textContent = 'CONTINUE THE HUSTLE';
    dom.newGame.classList.remove('hidden');
  } else {
    dom.start.querySelector('span').textContent = 'START THE HUSTLE';
    dom.newGame.classList.add('hidden');
  }
}

/* ------------------------------------------------------------------ */
/* Markers / player rendering                                          */
/* ------------------------------------------------------------------ */

function drawGroundMarkers(c) {
  const marker = getMissionMarker();
  if (marker && inView(marker.x, marker.y, 100, 100, 80)) {
    const pulse = 1 + Math.sin(gameTime * 4) * 0.12;
    c.save();
    c.translate(marker.x, marker.y);
    if (marker.kind === 'start') {
      c.fillStyle = 'rgba(255, 216, 61, 0.13)';
      c.beginPath(); c.arc(0, 0, 42 * pulse, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255, 216, 61, 0.9)';
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(0, 0, 31, 0, TAU); c.stroke();
      c.strokeStyle = 'rgba(255, 216, 61, 0.35)';
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(0, 0, 42 * pulse, 0, TAU); c.stroke();
      c.fillStyle = '#ffd83d';
      c.font = 'bold 21px Impact, Arial Black, sans-serif';
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('M', 0, 1);
    } else if (marker.kind === 'vehicle') {
      c.strokeStyle = 'rgba(255, 216, 61, 0.9)';
      c.lineWidth = 2;
      c.beginPath(); c.arc(0, 0, 31 * pulse, 0, TAU); c.stroke();
      c.fillStyle = 'rgba(255, 216, 61, 0.08)';
      c.beginPath(); c.arc(0, 0, 31, 0, TAU); c.fill();
    } else {
      c.fillStyle = 'rgba(255, 216, 61, 0.1)';
      c.beginPath(); c.arc(0, 0, 45 * pulse, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(255, 216, 61, 0.85)';
      c.lineWidth = 2.5;
      c.beginPath(); c.arc(0, 0, 35, 0, TAU); c.stroke();
      c.strokeStyle = 'rgba(255, 216, 61, 0.28)';
      c.lineWidth = 1.3;
      c.beginPath(); c.arc(0, 0, 47 * pulse, 0, TAU); c.stroke();
      c.fillStyle = '#ffd83d';
      c.font = 'bold 9px Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText('GO', 0, 1);
    }
    c.restore();
  }

  // Pay 'n' Spray / ammu / safehouse ground icons
  drawShopMarker(c, LANDMARKS.paynspray.x, LANDMARKS.paynspray.y, '#ffd83d', 'SPRAY');
  drawShopMarker(c, LANDMARKS.ammu.x, LANDMARKS.ammu.y, '#ffd83d', 'AMMO');
  drawShopMarker(c, LANDMARKS.safehouse.x, LANDMARKS.safehouse.y, '#a9ff3f', 'HOME');
}

function drawShopMarker(c, x, y, color, label) {
  if (!inView(x, y, 60, 60, 60)) return;
  c.save();
  c.globalAlpha = 0.62;
  c.strokeStyle = color; c.lineWidth = 1.2;
  c.beginPath(); c.arc(x, y, 23, 0, TAU); c.stroke();
  c.fillStyle = color; c.font = 'bold 6px Arial'; c.textAlign = 'center';
  c.fillText(label, x, y + 2);
  c.restore();
}

function drawPlayer(c) {
  if (player.vehicle) return;
  const p = player;
  c.save();
  c.translate(p.x, p.y);
  c.fillStyle = 'rgba(0,0,0,0.28)';
  c.beginPath(); c.ellipse(4, 5, 11, 7, 0, 0, TAU); c.fill();
  const glow = c.createRadialGradient(0, 0, 4, 0, 0, 23);
  glow.addColorStop(0, 'rgba(169,255,63,0.13)');
  glow.addColorStop(1, 'rgba(169,255,63,0)');
  c.fillStyle = glow;
  c.beginPath(); c.arc(0, 0, 23, 0, TAU); c.fill();
  c.rotate(p.aimAngle);
  const step = p.speed > 15 ? Math.sin(p.step) * 4.5 : 0;
  c.strokeStyle = '#26383c';
  c.lineWidth = 4.5;
  c.beginPath();
  c.moveTo(-4, -3); c.lineTo(-9, -4 + step);
  c.moveTo(-4, 3); c.lineTo(-9, 4 - step);
  c.stroke();
  c.fillStyle = '#1f6e65';
  roundRect(c, -5, -7.5, 14, 15, 5); c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.4)'; c.lineWidth = 1; c.stroke();
  c.fillStyle = '#7fc4ad';
  c.fillRect(-2, -7.5, 6, 2.5);
  c.strokeStyle = '#2a6a60';
  c.lineWidth = 3.4;
  c.beginPath();
  c.moveTo(2, -6); c.lineTo(9, -6);
  c.moveTo(2, 6); c.lineTo(9, 6);
  c.stroke();
  // weapon
  const w = state.weapon;
  c.fillStyle = '#17181c';
  if (w === 'smg') {
    c.fillRect(8, -2.4, 15, 4.8);
    c.fillStyle = '#3d3e43'; c.fillRect(10, 2.4, 4, 6);
  } else {
    c.fillRect(8, -1.8, 11, 3.6);
  }
  c.fillStyle = '#b57f58';
  c.beginPath(); c.arc(1, 0, 5.4, 0, TAU); c.fill();
  c.fillStyle = '#1e2526';
  c.beginPath(); c.arc(-0.8, 0, 4.5, Math.PI * 0.5, Math.PI * 1.5); c.fill();
  c.fillStyle = '#f0d48b';
  c.beginPath(); c.arc(1, -4, 1.1, 0, TAU); c.fill();
  c.restore();

  // reload ring
  if (player.reloadTimer > 0) {
    const wdef = state.weapons[state.weapon];
    const pct = 1 - player.reloadTimer / wdef.reload;
    c.save();
    c.strokeStyle = 'rgba(255,216,61,0.75)';
    c.lineWidth = 2;
    c.beginPath(); c.arc(p.x, p.y, 22, -Math.PI / 2, -Math.PI / 2 + TAU * pct); c.stroke();
    c.restore();
  }
}

function drawObjectiveArrow(c) {
  const marker = getMissionMarker();
  if (!marker) return;
  const sx = (marker.x - camera.x) * camera.zoom + viewW / 2;
  const sy = (marker.y - camera.y) * camera.zoom + viewH / 2;
  const margin = 48;
  if (sx > margin && sx < viewW - margin && sy > margin && sy < viewH - margin) return;
  const cx = viewW / 2, cy = viewH / 2;
  const dx = sx - cx, dy = sy - cy;
  const angle = Math.atan2(dy, dx);
  const rx = viewW / 2 - 64, ry = viewH / 2 - 64;
  const t = Math.min(Math.abs(rx / (Math.cos(angle) || 0.0001)), Math.abs(ry / (Math.sin(angle) || 0.0001)));
  const ax = cx + Math.cos(angle) * t;
  const ay = cy + Math.sin(angle) * t;
  const d = Math.round(dist(player.x, player.y, marker.x, marker.y) / 6);
  c.save();
  c.translate(ax, ay);
  c.rotate(angle);
  c.fillStyle = 'rgba(255, 216, 61, 0.92)';
  c.shadowColor = 'rgba(0,0,0,0.7)'; c.shadowBlur = 8;
  c.beginPath();
  c.moveTo(13, 0); c.lineTo(-6, -8); c.lineTo(-2, 0); c.lineTo(-6, 8); c.closePath();
  c.fill();
  c.rotate(-angle);
  c.shadowBlur = 0;
  c.fillStyle = 'rgba(255, 216, 61, 0.9)';
  c.font = 'bold 8px Arial'; c.textAlign = 'center';
  c.fillText(d + 'M', 0, 21);
  c.restore();
}

function drawCrosshair(c) {
  if (isTouch) return;
  const x = mouse.x, y = mouse.y;
  c.save();
  c.strokeStyle = 'rgba(255,255,255,0.72)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x - 9, y); c.lineTo(x - 3, y);
  c.moveTo(x + 3, y); c.lineTo(x + 9, y);
  c.moveTo(x, y - 9); c.lineTo(x, y - 3);
  c.moveTo(x, y + 3); c.lineTo(x, y + 9);
  c.stroke();
  c.fillStyle = 'rgba(255,216,61,0.8)';
  c.beginPath(); c.arc(x, y, 1.3, 0, TAU); c.fill();
  c.restore();
}

function drawNightAndLights(c) {
  const sun = Math.sin((clockHours - 6) / 24 * TAU);
  const darkness = clamp((0.08 - sun) * 0.68, 0, 0.64);
  if (darkness > 0.01) {
    c.fillStyle = `rgba(5, 12, 31, ${darkness})`;
    c.fillRect(camera.x - viewW / camera.zoom, camera.y - viewH / camera.zoom, viewW / camera.zoom * 1.2, viewH / camera.zoom * 1.2);
  }
  const dusk = clamp(1 - Math.abs(clockHours - 18.5) / 2.2, 0, 1);
  if (dusk > 0.02) {
    c.fillStyle = `rgba(255, 97, 42, ${dusk * 0.075})`;
    c.fillRect(camera.x - viewW / camera.zoom, camera.y - viewH / camera.zoom, viewW / camera.zoom * 1.2, viewH / camera.zoom * 1.2);
  }

  if (darkness > 0.08) {
    c.save();
    c.globalCompositeOperation = 'lighter';
    for (const l of world.lamps) {
      if (!inView(l.x, l.y, 130, 130, 150)) continue;
      const g = c.createRadialGradient(l.x, l.y, 2, l.x, l.y, 105);
      g.addColorStop(0, `rgba(255, 217, 135, ${0.17 * darkness})`);
      g.addColorStop(1, 'rgba(255, 217, 135, 0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(l.x, l.y, 105, 0, TAU); c.fill();
    }
    for (const v of vehicles) {
      if (v.exploded || !inView(v.x, v.y, 220, 220, 160)) continue;
      const intensity = (v.ai === 'player' ? 0.17 : 0.1) * darkness;
      c.save();
      c.translate(v.x, v.y);
      c.rotate(v.angle);
      const g = c.createLinearGradient(v.len / 2, 0, v.len / 2 + 180, 0);
      g.addColorStop(0, `rgba(255, 241, 190, ${intensity})`);
      g.addColorStop(1, 'rgba(255, 241, 190, 0)');
      c.fillStyle = g;
      c.beginPath();
      c.moveTo(v.len / 2 - 2, -v.wid * 0.32);
      c.lineTo(v.len / 2 + 185, -70);
      c.lineTo(v.len / 2 + 185, 70);
      c.lineTo(v.len / 2 - 2, v.wid * 0.32);
      c.closePath();
      c.fill();
      c.restore();
    }
    c.restore();
  }
}

function drawHurtVignette(c) {
  const low = state.health < 35 && state.mode === 'playing';
  const a = Math.max(state.hurtFlash * 0.34, low ? 0.13 + Math.sin(gameTime * 4) * 0.04 : 0);
  if (a <= 0.01) return;
  const g = c.createRadialGradient(viewW / 2, viewH / 2, Math.min(viewW, viewH) * 0.2, viewW / 2, viewH / 2, Math.max(viewW, viewH) * 0.72);
  g.addColorStop(0, 'rgba(150, 5, 12, 0)');
  g.addColorStop(0.7, `rgba(150, 5, 12, ${a * 0.4})`);
  g.addColorStop(1, `rgba(120, 0, 7, ${a})`);
  c.fillStyle = g;
  c.fillRect(0, 0, viewW, viewH);
}

/* ------------------------------------------------------------------ */
/* Radar                                                               */
/* ------------------------------------------------------------------ */

function drawRadar() {
  const size = 420;
  const cx = size / 2, cy = size / 2;
  const range = 920;
  const scale = size / (range * 2);
  const px = player.x, py = player.y;
  const wx = (x) => cx + (x - px) * scale;
  const wy = (y) => cy + (y - py) * scale;

  rctx.clearRect(0, 0, size, size);
  rctx.save();
  rctx.beginPath();
  rctx.arc(cx, cy, size / 2 - 3, 0, TAU);
  rctx.clip();

  // base
  rctx.fillStyle = '#0a2029';
  rctx.fillRect(0, 0, size, size);

  // land mass
  rctx.fillStyle = '#1b2522';
  const landY = wy(LAND_BOTTOM);
  if (landY > 0) rctx.fillRect(0, 0, size, Math.min(size, landY));
  // beach
  rctx.fillStyle = '#4e4934';
  const beachY = wy(BEACH_TOP);
  const landBottomY = wy(LAND_BOTTOM);
  if (landBottomY > 0 && beachY < size) {
    rctx.fillRect(0, Math.max(0, beachY), size, Math.max(0, Math.min(size, landBottomY) - Math.max(0, beachY)));
  }

  // blocks
  rctx.fillStyle = '#2b302c';
  for (const b of world.blocks) {
    if (b.x + b.w < px - range || b.x > px + range || b.y + b.h < py - range || b.y > py + range) continue;
    if (b.park) rctx.fillStyle = '#30412d';
    else if (b.region === 'beach') rctx.fillStyle = '#413e30';
    else rctx.fillStyle = '#292e2b';
    rctx.fillRect(wx(b.x), wy(b.y), b.w * scale, b.h * scale);
  }

  // roads
  rctx.fillStyle = '#52565a';
  for (let i = 0; i < ROAD_X.length; i++) {
    if (ROAD_X[i] < px - range - 80 || ROAD_X[i] > px + range + 80) continue;
    const w = roadWidth(i) * scale;
    rctx.fillRect(wx(ROAD_X[i]) - w / 2, 0, w, size);
  }
  for (let j = 0; j < ROAD_Y.length; j++) {
    if (ROAD_Y[j] < py - range - 80 || ROAD_Y[j] > py + range + 80) continue;
    const w = roadWidth(j) * scale;
    rctx.fillRect(0, wy(ROAD_Y[j]) - w / 2, size, w);
  }

  // pier
  rctx.fillStyle = '#5f4c38';
  rctx.fillRect(wx(2700), wy(BEACH_TOP + 30), 290 * scale, 590 * scale);

  // range rings
  rctx.strokeStyle = 'rgba(255,255,255,0.045)';
  rctx.lineWidth = 1;
  rctx.beginPath(); rctx.arc(cx, cy, size * 0.22, 0, TAU); rctx.stroke();
  rctx.beginPath(); rctx.arc(cx, cy, size * 0.4, 0, TAU); rctx.stroke();

  // pickups
  for (const p of pickups) {
    if (!p.active) continue;
    rctx.fillStyle = p.type === 'bag' ? '#ffd83d' : p.type === 'health' ? '#a9ff3f' : p.type === 'armor' ? '#55d9ff' : '#ffd83d';
    rctx.beginPath(); rctx.arc(wx(p.x), wy(p.y), p.type === 'bag' ? 4 : 2.5, 0, TAU); rctx.fill();
  }

  // traffic / cars
  for (const v of vehicles) {
    if (v === player.vehicle || v.exploded) continue;
    const x = wx(v.x), y = wy(v.y);
    if (x < -10 || x > size + 10 || y < -10 || y > size + 10) continue;
    rctx.fillStyle = v.ai === 'cop' ? '#ff5349' : 'rgba(230,229,220,0.62)';
    rctx.fillRect(x - 1.7, y - 1.7, 3.4, 3.4);
  }

  // people
  for (const p of people) {
    if (p.dead) continue;
    const x = wx(p.x), y = wy(p.y);
    if (x < -10 || x > size + 10 || y < -10 || y > size + 10) continue;
    if (p.faction === 'cop') rctx.fillStyle = '#55b9ff';
    else if (p.faction === 'gang' || p.faction === 'boss') rctx.fillStyle = '#ff9b43';
    else continue;
    rctx.beginPath(); rctx.arc(x, y, p.faction === 'boss' ? 4 : 2.6, 0, TAU); rctx.fill();
  }

  // mission marker
  const marker = getMissionMarker();
  if (marker) {
    let x = wx(marker.x), y = wy(marker.y);
    const dx = x - cx, dy = y - cy;
    const dd = Math.hypot(dx, dy);
    if (dd > size / 2 - 26) {
      x = cx + dx / dd * (size / 2 - 26);
      y = cy + dy / dd * (size / 2 - 26);
    }
    const pulse = 4 + Math.sin(gameTime * 5) * 1.6;
    rctx.fillStyle = 'rgba(255,216,61,0.22)';
    rctx.beginPath(); rctx.arc(x, y, pulse + 6, 0, TAU); rctx.fill();
    rctx.fillStyle = '#ffd83d';
    rctx.beginPath(); rctx.arc(x, y, pulse, 0, TAU); rctx.fill();
    rctx.strokeStyle = 'rgba(255,255,255,0.85)';
    rctx.lineWidth = 1.5;
    rctx.beginPath(); rctx.arc(x, y, pulse + 4, 0, TAU); rctx.stroke();
  }

  // player
  rctx.save();
  rctx.translate(cx, cy);
  rctx.rotate(player.aimAngle + Math.PI / 2);
  rctx.fillStyle = '#ffffff';
  rctx.strokeStyle = '#0b0b0e';
  rctx.lineWidth = 2;
  rctx.beginPath();
  rctx.moveTo(0, -8);
  rctx.lineTo(6, 6);
  rctx.lineTo(0, 3.5);
  rctx.lineTo(-6, 6);
  rctx.closePath();
  rctx.fill();
  rctx.stroke();
  rctx.restore();

  rctx.restore();

  // outer edge flash for wanted level
  if (state.wanted > 0) {
    rctx.save();
    rctx.strokeStyle = `rgba(255, 70, 62, ${0.45 + Math.sin(gameTime * 7) * 0.22})`;
    rctx.lineWidth = 5;
    rctx.beginPath(); rctx.arc(cx, cy, size / 2 - 4, 0, TAU); rctx.stroke();
    rctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Camera / render                                                     */
/* ------------------------------------------------------------------ */

function resetTitleCamera() {
  camera.titleAngle = 0.4;
  camera.x = 2620;
  camera.y = 4060;
  camera.zoom = 0.82;
}

function updateTitleCamera(dt) {
  // Slow coastal pan: city blocks up top, Vespucci Beach and the pier below.
  camera.titleAngle += dt * 0.05;
  camera.x = 2620 + Math.sin(camera.titleAngle) * 300;
  camera.y = 4060 + Math.cos(camera.titleAngle * 0.7) * 70;
  camera.zoom = lerp(camera.zoom, 0.82, dt * 1.5);
}

function updateCamera(dt) {
  if (state.mode === 'title') { updateTitleCamera(dt); return; }
  const target = player.vehicle || player;
  let tx = target.x, ty = target.y;
  if (player.vehicle) {
    tx += Math.cos(player.vehicle.angle) * clamp(player.vehicle.speed * 0.3, -80, 120);
    ty += Math.sin(player.vehicle.angle) * clamp(player.vehicle.speed * 0.3, -80, 120);
  } else {
    tx += Math.cos(player.aimAngle) * 34;
    ty += Math.sin(player.aimAngle) * 34;
  }
  const smooth = 1 - Math.exp(-dt * 6.5);
  camera.x = lerp(camera.x, tx, smooth);
  camera.y = lerp(camera.y, ty, smooth);
  const targetZoom = isTouch ? 0.7 : player.vehicle ? 0.94 : 1.06;
  camera.zoom = lerp(camera.zoom, targetZoom, 1 - Math.exp(-dt * 3));
  state.camShake = Math.max(0, state.camShake - dt * 2.5);

  const hw = viewW / 2 / camera.zoom;
  const hh = viewH / 2 / camera.zoom;
  if (WORLD_W > hw * 2) camera.x = clamp(camera.x, hw, WORLD_W - hw);
  else camera.x = WORLD_W / 2;
  if (WORLD_H > hh * 2) camera.y = clamp(camera.y, hh, WORLD_H - hh);
  else camera.y = WORLD_H / 2;
}

function drawMarkerIcon(c) {
  const marker = getMissionMarker();
  if (!marker || !inView(marker.x, marker.y, 100, 100, 80)) return;
  if (marker.kind === 'start') return;
  const bob = Math.sin(gameTime * 3.4) * 4;
  c.save();
  c.translate(marker.x, marker.y - 52 + bob);
  c.fillStyle = 'rgba(255,216,61,0.95)';
  c.strokeStyle = 'rgba(0,0,0,0.45)';
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(0, 7); c.lineTo(7, -2); c.lineTo(3, -2); c.lineTo(3, -9); c.lineTo(-3, -9); c.lineTo(-3, -2); c.lineTo(-7, -2);
  c.closePath();
  c.fill(); c.stroke();
  c.restore();
}

function render() {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, viewW, viewH);

  const shake = state.camShake * 10;
  const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const sy = shake > 0 ? (Math.random() - 0.5) * shake : 0;

  ctx.save();
  ctx.translate(viewW / 2 + sx, viewH / 2 + sy);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);

  drawWorld(ctx);
  drawNightAndLights(ctx);
  drawGroundMarkers(ctx);
  drawPickups(ctx);

  // depth-sorted entities
  const renderables = [];
  for (const v of vehicles) {
    if (v.remove) continue;
    if (!inView(v.x, v.y, 100, 100, 100)) continue;
    renderables.push({ y: v.y, kind: 'vehicle', obj: v });
  }
  for (const p of people) {
    if (p.remove) continue;
    if (!inView(p.x, p.y, 60, 60, 80)) continue;
    renderables.push({ y: p.y, kind: 'person', obj: p });
  }
  if (!player.vehicle && state.mode !== 'title') renderables.push({ y: player.y, kind: 'player', obj: player });
  renderables.sort((a, b) => a.y - b.y);
  for (const r of renderables) {
    if (r.kind === 'vehicle') drawVehicle(ctx, r.obj);
    else if (r.kind === 'person') drawPerson(ctx, r.obj);
    else drawPlayer(ctx);
  }

  drawBullets(ctx);
  drawMarkerIcon(ctx);
  drawParticles(ctx);
  drawFloatingTexts(ctx);
  ctx.restore();

  if (state.mode !== 'title') {
    drawObjectiveArrow(ctx);
    drawCrosshair(ctx);
    drawHurtVignette(ctx);
  }

  drawRadar();
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

let lastFrame = performance.now();

function updateTitle(dt) {
  // The title screen is a living diorama: traffic still runs, people wander.
  for (const v of vehicles) {
    if (v.ai === 'traffic') updateTrafficVehicle(v, dt);
  }
  for (const p of people) {
    if (p.faction === 'civilian') updatePerson(p, dt);
  }
  updateParticles(dt);
  updateFloatingTexts(dt);
  updateTitleCamera(dt);
}

function update(dt) {
  gameTime += dt;
  updateClock(dt);

  if (state.mode === 'title') {
    updateTitle(dt);
    return;
  }
  if (state.mode !== 'playing') {
    updateParticles(dt);
    return;
  }

  updatePlayer(dt);

  for (const v of vehicles) updateVehicle(v, dt);
  for (const p of people) updatePerson(p, dt);
  updateBullets(dt);
  updateParticles(dt);
  updateFloatingTexts(dt);
  updatePickups(dt);
  updateMission(dt);
  updateWanted(dt);
  updateAmbient(dt);
  updateCamera(dt);

  state.alertTimer = Math.max(0, state.alertTimer - dt * 0.2);
  state.camShake = Math.max(0, state.camShake - dt * 2.3);

  // mission actors can fail if the target car disappears
  if (state.activeMission && state.activeMission.targetVehicle && state.activeMission.targetVehicle.remove) {
    failMission('The target vehicle is gone.');
  }

  // player death by vehicle/health
  if (state.health <= 0 && state.mode === 'playing') {
    die('You got flatlined in Los Santos.');
  }

  if (gameTime - state.lastHudUpdate > 0.09) {
    state.lastHudUpdate = gameTime;
    updateHUD(dt);
  }
}

function frame(now) {
  const dt = Math.min(0.034, Math.max(0.001, (now - lastFrame) / 1000));
  lastFrame = now;
  update(dt);
  render();
  audio.updateMusic();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

const gameKeys = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'ShiftLeft', 'ShiftRight', 'KeyE', 'KeyR', 'KeyQ', 'KeyM', 'Escape', 'KeyP', 'Enter'
]);

window.addEventListener('keydown', (e) => {
  if (gameKeys.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys[e.code] = true;
  if (state.mode === 'title' && (e.code === 'Enter' || e.code === 'Space')) {
    startFromTitle();
    return;
  }
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (state.mode === 'playing' || state.mode === 'paused') togglePause();
    return;
  }
  if (e.code === 'KeyM') { toggleSound(); return; }
  if (state.mode !== 'playing') return;
  if (e.code === 'KeyE') interact();
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyQ') {
    if (!state.smgUnlocked) { toast('SMG LOCKED · COMPLETE PIER PRESSURE', 'warn'); return; }
    state.weapon = state.weapon === 'pistol' ? 'smg' : 'pistol';
    toast('WEAPON · ' + state.weapons[state.weapon].name, 'gold');
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

window.addEventListener('blur', () => {
  for (const k in keys) keys[k] = false;
  state.firing = false;
  state.mouseDown = false;
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.active = true;
});
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch') return;
  if (e.button !== 0) return;
  if (state.mode !== 'playing') return;
  audio.init();
  state.firing = true;
  state.mouseDown = true;
  mouse.x = e.clientX; mouse.y = e.clientY;
});
window.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'touch') return;
  state.firing = false;
  state.mouseDown = false;
});
window.addEventListener('pointercancel', () => {
  state.firing = false;
  state.mouseDown = false;
});

// Touch joystick
let joystickPointer = null;

function updateJoystick(e) {
  const rect = dom.joystick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const max = rect.width * 0.36;
  const d = Math.hypot(dx, dy);
  if (d > max) { dx = dx / d * max; dy = dy / d * max; }
  touchMove.x = dx / max;
  touchMove.y = dy / max;
  dom.stick.style.transform = `translate(${dx}px, ${dy}px)`;
}

dom.joystick.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  joystickPointer = e.pointerId;
  dom.joystick.setPointerCapture(e.pointerId);
  updateJoystick(e);
});
dom.joystick.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joystickPointer) return;
  e.preventDefault();
  updateJoystick(e);
});
function endJoystick(e) {
  if (e.pointerId !== joystickPointer) return;
  joystickPointer = null;
  touchMove.x = 0; touchMove.y = 0;
  dom.stick.style.transform = 'translate(0px, 0px)';
}
dom.joystick.addEventListener('pointerup', endJoystick);
dom.joystick.addEventListener('pointercancel', endJoystick);
dom.joystick.addEventListener('lostpointercapture', () => {
  joystickPointer = null; touchMove.x = 0; touchMove.y = 0;
  dom.stick.style.transform = 'translate(0px, 0px)';
});

function bindHold(el, down, up) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    down();
  });
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    up();
  });
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
}

bindHold(dom.btnFire, () => { state.touchFire = true; state.firing = true; }, () => { state.touchFire = false; state.firing = false; });
bindHold(dom.btnSprint, () => { state.touchSprint = true; }, () => { state.touchSprint = false; });
dom.btnAction.addEventListener('pointerdown', (e) => { e.preventDefault(); interact(); });
dom.btnReload.addEventListener('pointerdown', (e) => { e.preventDefault(); startReload(); });
dom.btnPause.addEventListener('pointerdown', (e) => { e.preventDefault(); togglePause(); });

// UI buttons
dom.start.addEventListener('click', startFromTitle);
dom.newGame.addEventListener('click', () => {
  saveData = null;
  startFromTitle();
});
dom.resume.addEventListener('click', togglePause);
dom.pauseSound.addEventListener('click', toggleSound);
dom.pauseRestart.addEventListener('click', () => {
  try { localStorage.removeItem('ls2d_save_v1'); } catch {}
  location.reload();
});
dom.soundToggle.addEventListener('click', toggleSound);
dom.respawn.addEventListener('click', respawnPlayer);
dom.failMenu.addEventListener('click', () => {
  try { localStorage.removeItem('ls2d_save_v1'); } catch {}
  location.reload();
});
dom.freeRoam.addEventListener('click', () => {
  dom.end.classList.add('hidden');
  state.mode = 'playing';
  if (isTouch) dom.touch.classList.remove('hidden');
  toast('FREE ROAM · THE CITY IS YOURS', 'money');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.mode === 'playing') {
    state.mode = 'paused';
    updatePauseUI();
    dom.pause.classList.remove('hidden');
    dom.touch.classList.add('hidden');
    state.firing = false;
    state.mouseDown = false;
  }
});

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

function boot() {
  if (isTouch) document.body.classList.add('touch');
  generateWorld();
  resize();
  resetPlayerToSpawn();
  spawnParkedCars();
  addLandmarkPickups();
  seedAmbient();
  saveData = readSave();
  updateTitleSaveButton();
  resetTitleCamera();
  state.mode = 'title';
  state.district = '';
  updateHUD(0);
  dom.hud.classList.add('hidden');
  dom.touch.classList.add('hidden');
  dom.title.classList.remove('hidden');
  dom.fail.classList.add('hidden');
  dom.end.classList.add('hidden');
  dom.pause.classList.add('hidden');
  dom.missionBanner.classList.add('hidden');
  dom.prompt.classList.add('hidden');
  requestAnimationFrame((t) => {
    lastFrame = t;
    requestAnimationFrame(frame);
  });
}

boot();

// Small read-only-ish debug handle, useful for automated playtesting.
window.__ls = {
  state, player, vehicles, people, camera, world, keys, audio,
  startMission, completeMission, failMission, clearWanted, respawnPlayer,
  getMissionMarker, getInteraction, districtAt,
  teleport(x, y) { player.x = x; player.y = y; if (player.vehicle) { player.vehicle.x = x; player.vehicle.y = y; } },
  giveMoney(n) { state.money += n; },
  setHeat(n) { state.heat = n; state.lastCrime = gameTime; state.wanted = heatToStars(n); },
};
