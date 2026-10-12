// Control panel. chrome.storage.local is the single source of truth: the
// panel writes (throttled), every content script subscribes via onChanged.
// Outside the extension (dev preview, panel harness) a local shim stands in
// for storage so the UI is testable in a plain tab.
//
// Eight storage keys live OUTSIDE params.js DEFAULTS on purpose, so the
// content scripts (which filter on `key in DEFAULTS`) never see them:
// `midiMap`, `presets` (slots A/B/C), `presetBase` (the last-loaded or
// last-saved preset, which a row double-click returns to), `tooltips`,
// `engineOpen` ({video, audio}: whether each section's engine group is
// unfolded), `panelHome` ('window' | 'strip' | 'side': where the panel
// opens, design review M9; the window by default), `stripOpen` (whether the bottom strip is
// expanded; written by the strip in the page, never by this file) and
// `panelBounds` ({width, height, left, top}: where the panel window was
// last left; written by the service worker, never by this file). A legacy
// `userDefaults` (the old "set defaults" snapshot) migrates into slot A on
// boot and is removed.

import { DEFAULTS } from '../content/params.js';
import {
  SECTIONS,
  GROUPS,
  DEFS,
  PADS,
  ROW_HINT,
  TRIGGER_HINT,
  NUM_HINT,
  quantize,
  fmtValue,
  fmtNumber,
  toView,
  fromView,
  defaultFor,
  PRESET_SLOTS,
  PRESET_EXCLUDED,
  PANEL_HOME,
  PANEL_HOMES,
} from './defs.js';
import { initMIDI } from './midi.js';

// Layout (design review M9; round 4b): the layout follows the shape of the
// page, not where it lives. The same markup serves three homes — the popup
// window, Chrome's side panel and the in-page strip — and two layouts: the
// default column, and the MIXER (data-layout='mixer'), which panel.css lays
// out horizontally: the global block as a left cluster, the effect groups
// as columns that scroll sideways. paintLayout() below picks between them.
//
// HOSTED: the strip's iframe (`panel.html?layout=strip`). Always the mixer;
// it alone shows the fold button and posts `toggle`/`ready` up to the strip.
const HOSTED = new URLSearchParams(location.search).get('layout') === 'strip';
// Every other home is the mixer only while it is wide: at least 900 px and
// twice as wide as tall. The side panel (narrow) and the window at its
// opening 400 × 720 get the column; a window dragged wide gets the mixer.
const MIXER = window.matchMedia('(min-width: 900px) and (min-aspect-ratio: 2/1)');
// The strip's rail: the same page in a frame too short for anything but one
// line (panel.css lays it out as a row; hover help is suppressed). Only
// meaningful when HOSTED.
const RAIL = window.matchMedia('(max-height: 60px)');

const defByKey = Object.fromEntries(DEFS.map((d) => [d.key, d]));
const isNumeric = (def) => def.type !== 'toggle' && def.type !== 'select' && def.type !== 'trigger';
// A numeric input holds the VIEW (defs.js toView: an inverted def shows
// max − (v − min)); this reads it back in the stored sense.
const storedOf = (key) => fromView(defByKey[key], Number(inputs[key].value));

// The feedback shaping knobs are live only while video feedback is on
// (images are one-shot stills; there is no image feedback).
// motionGate lives here: it judges motion via the alpha trail, which only
// exists where a composite runs — without a feedback mode it has nothing
// to read. temperature is NOT here: it bites in straight sort too. The
// clear timings (resetMinS/resetMaxS) sit in the engine since the handles
// round but still answer to the feedback switch, as do the blend and its
// amount (design review M5): they shape only the composite. So does the
// clear-buffer trigger (`keyframe`, round 8): it clears a trail that does
// not exist while feedback is off.
const FEEDBACK_SHARED = ['decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS', 'motionGate', 'feedbackBlend', 'feedbackMix', 'keyframe'];

// Audio rows gray out when the audio master toggle is off; the smear rows
// additionally require their own toggles.
const AUDIO_ONLY = [
  'audioMix',
  'audioBody',
  'audioDirect',
  'audioBodyMix',
  'audioFollow',
  'audioCombDamp',
  'audioFeedback',
  'audioFbDecay',
  'audioFbReturn',
  'audioFbWobble',
  'audioFbClear',
  'audioFbClearS',
  'audioFbClearMinS',
  'audioFbClearMaxS',
  'audioMaxTaps',
  'audioSustain',
  'audioDrive',
  'audioExciter',
];
const AUDIO_FB_ONLY = [
  'audioFbDecay',
  'audioFbReturn',
  'audioFbWobble',
  'audioFbClear',
  'audioFbClearS',
  'audioFbClearMinS',
  'audioFbClearMaxS',
];
// These need fb clear on too.
const AUDIO_FB_CLEAR_ONLY = ['audioFbClearS', 'audioFbClearMinS', 'audioFbClearMaxS'];
// The comb's loop lowpass means nothing while the modal bank is selected.
const AUDIO_COMB_ONLY = ['audioCombDamp'];
const AUDIO_TRIGGERS = ['audioEnabled', 'audioFeedback', 'audioFbClear', 'audioBody'];

// The sort knobs shape video and images alike; with both mediums off they
// have nothing to act on. The feedback group is video only (round 3, item 7).
// These gate by key, not by group: since the handles round the flow shape
// knobs sit in the engine and `streak` (ribbons) in sort, and each still
// answers to the medium (and the flow shape to flow, FLOW_ONLY). The other
// engine rows (passes, max res, max videos) are not gated row by row; the
// engine group hides with the mediums.
const SORT_KEYS = ['threshold', 'flowAmount', 'temperature', 'streak', 'flowMode', 'flowScale', 'flowSpeed'];
const FEEDBACK_KEYS = ['feedbackVideo', ...FEEDBACK_SHARED];
const MEDIUM_TRIGGERS = ['video', 'images', 'feedbackVideo', 'flowAmount'];

// The flow shape knobs only mean anything while flow amount is above zero.
// They live in the folded engine, so with flow at 0 they are hidden twice:
// by the fold and by this gate (data-gate="flow").
const FLOW_ONLY = ['flowMode', 'flowScale', 'flowSpeed'];

// A gated row is HIDDEN, not greyed (John, 2026-10-11: "if controls are
// greyed out contingent on a different toggle being on, then those controls
// shouldn't be visible at all until the toggle is on"). The switch that
// gates a group stays in view as its header, so switching it on unfolds the
// knobs beneath it — progressive disclosure, the gesture the engine folds
// already use. When a whole section's medium is off, the section keeps its
// header and says, in one line, which chip brings it back. The strings
// below are those section notes; the per-row "needs …" captions of finding
// 9 went with the greying.
const GATE = {
  video: 'video',
  medium: 'video or images',
  feedback: 'feedback',
  flow: 'flow',
  audio: 'audio',
  smear: 'smear',
  clear: 'clear',
  comb: 'comb',
};
const SECTION_OFF = {
  medium: 'off — switch video or images on above',
  audio: 'off — switch audio on above',
};

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const shim = { data: { ...DEFAULTS }, listeners: [] };

const store = {
  async get(defaults) {
    if (hasChrome) return chrome.storage.local.get(defaults);
    const out = { ...defaults };
    for (const k of Object.keys(defaults)) {
      if (k in shim.data) out[k] = shim.data[k];
    }
    return out;
  },
  set(values) {
    if (hasChrome) return chrome.storage.local.set(values);
    const changes = {};
    for (const [k, v] of Object.entries(values)) {
      shim.data[k] = v;
      changes[k] = { newValue: v };
    }
    for (const fn of shim.listeners) fn(changes);
  },
  async remove(key) {
    if (hasChrome) {
      if (chrome.storage.local.remove) return chrome.storage.local.remove(key);
      return chrome.storage.local.set({ [key]: null });
    }
    delete shim.data[key];
    for (const fn of shim.listeners) fn({ [key]: { newValue: undefined } });
  },
  onChanged(fn) {
    if (hasChrome) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') fn(changes);
      });
    } else {
      shim.listeners.push(fn);
    }
  },
};

// --- Build the UI ---

const controls = document.getElementById('controls');
// The global block above the first divider (redesigned 2026-10-12, design
// review M1/M2/M3/M7): the A/B, the four medium chips, then the presets.
const globals = document.getElementById('globals');
// `inputs[key]` holds each parameter's state: a real <input>/<select> for a
// section row, a plain { checked } holder for the global toggles that have
// no row (enabled, video, images). Extra views of the same key — the A/B
// face, the chips — register a renderer and are redrawn on every setUI.
const inputs = {};
const valueEls = {};
const learnEls = {};
const rowEls = {};
const sectionEls = {}; // section id → { head, note }
const groupEls = {}; // `${section}.${group}` → { wrap, head }
const renderers = {};
const onRender = (key, fn) => (renderers[key] ??= []).push(fn);

function buildRow(def) {
  if (def.type === 'trigger') return buildTriggerRow(def);
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.key = def.key;
  row.dataset.tip = def.tip;
  row.dataset.hint = ROW_HINT;
  row.dataset.param = def.key; // the tooltip's last line: the key, for John and the MIDI sheet

  const label = document.createElement('label');
  label.textContent = def.label;

  let input;
  if (def.type === 'toggle') {
    input = document.createElement('input');
    input.type = 'checkbox';
  } else if (def.type === 'select') {
    input = document.createElement('select');
    for (const opt of def.options) {
      const o = document.createElement('option');
      o.value = opt;
      o.textContent = opt;
      input.appendChild(o);
    }
  } else {
    input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
  }
  // The control cell is the input itself. (Threshold used to carry
  // "more · less" captions at its slider ends; John removed them 2026-10-12:
  // confusing for anyone who knows what a threshold is.)
  const knob = input;
  knob.classList.add('knob');
  input.addEventListener('input', () => {
    const v =
      def.type === 'toggle'
        ? input.checked
        : def.type === 'select'
          ? input.value
          : quantize(def, fromView(def, Number(input.value)));
    queueWrite(def.key, v);
    writeValueCell(def, v);
    for (const fn of renderers[def.key] ?? []) fn(v); // e.g. the medium chip
    syncFor(def.key);
  });

  // The value cell is a real field for anything numeric: type a number and
  // the knob follows it, out-of-range clamps to the limit (John, 2026-08-20).
  let value;
  if (isNumeric(def)) {
    value = document.createElement('input');
    value.type = 'text';
    value.className = 'value num';
    value.inputMode = 'decimal';
    value.spellcheck = false;
    value.dataset.tip = def.tip;
    value.dataset.hint = NUM_HINT;
    value.dataset.param = def.key;
    attachNumberField(def, value, input);
  } else {
    value = document.createElement('span');
    value.className = 'value';
  }

  const learn = document.createElement('button');
  learn.className = 'learn';
  learn.textContent = '⊙';
  learn.addEventListener('click', () => armLearn(def.key));

  // Double-click the row to restore this one parameter — the alternative to
  // all-or-nothing (John, 2026-08-20). The number field is excluded so that
  // double-clicking inside it still selects the text, and the slider is
  // excluded so two quick nudges of its thumb never reset the row (finding 8).
  row.addEventListener('dblclick', (e) => {
    if (e.target === value && isNumeric(def)) return;
    if (e.target === input && input.type === 'range') return;
    resetParam(def.key);
  });

  row.append(label, knob, value, learn);
  row.addEventListener('animationend', () => row.classList.remove('flash'));
  inputs[def.key] = input;
  valueEls[def.key] = value;
  learnEls[def.key] = learn;
  rowEls[def.key] = row;
  return row;
}

// --- Triggers (round 8): a button that fires, not a value that is set ---
// The key stores a counter; a click (or a MIDI CC rising through 64) writes
// counter + 1, and every content script that sees it larger than the last
// one it answered acts once (`keyframe`: every video job wipes its trail on
// its next tick). The knob cell is the button, the value cell stays empty,
// and inputs[key] is a plain holder ({ value, button }) that setUI keeps
// level with storage, so the next click counts from the stored value even
// when another panel fired last. Presets neither capture nor load it
// (PRESET_EXCLUDED) and a double-click does nothing: there is nothing to
// put back.
function buildTriggerRow(def) {
  const row = document.createElement('div');
  row.className = 'row trigger-row';
  row.dataset.key = def.key;
  row.dataset.tip = def.tip;
  row.dataset.hint = TRIGGER_HINT;
  row.dataset.param = def.key;

  const label = document.createElement('label');
  label.textContent = def.label;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn knob trigger';
  button.textContent = 'clear';
  button.dataset.tip = def.tip;
  button.dataset.hint = TRIGGER_HINT;
  button.dataset.param = def.key;
  button.addEventListener('click', () => fireTrigger(def.key));

  const value = document.createElement('span');
  value.className = 'value';

  const learn = document.createElement('button');
  learn.className = 'learn';
  learn.textContent = '⊙';
  learn.addEventListener('click', () => armLearn(def.key));

  row.append(label, button, value, learn);
  row.addEventListener('animationend', () => row.classList.remove('flash'));
  inputs[def.key] = { value: 0, button };
  valueEls[def.key] = value;
  learnEls[def.key] = learn;
  rowEls[def.key] = row;
  return row;
}

function fireTrigger(key) {
  const n = (Number(inputs[key].value) || 0) + 1;
  queueWrite(key, n);
  setUI(key, n);
  flashRow(key); // the only sign it fired: the trail itself is on the page
}

// --- Pads (handles round, 2026-10-12): two keys played as one 2-D surface ---
// One row stands in for both keys' rows. Each key keeps a hidden range
// input as its state holder (inputs[key], holding the view like any
// slider), and the row element is registered as rowEls for both, so setUI,
// currentValues, presets, MIDI, resetParam, setGated and the storage
// subscriber treat the pair exactly as two sliders. The value cell holds
// one small typed field per key (x above y), the learn cell one ⊙ per key.
// The dot repaints from the holders whenever either key renders.
const PAD_HINT =
  'Drag the point; focused, arrows nudge it (shift ×10). Double-click the name or the pad to put both back to the marked preset.';

function buildPadRow(pad) {
  const dx = defByKey[pad.x];
  const dy = defByKey[pad.y];
  const axes = [
    ['x', dx],
    ['y', dy],
  ];
  const row = document.createElement('div');
  row.className = 'row pad-row';
  row.dataset.key = dx.key; // the gate and the first key
  row.dataset.keys = `${dx.key} ${dy.key}`;
  row.dataset.tip = pad.tip;
  row.dataset.hint = ROW_HINT;
  row.dataset.param = `${dx.key} · ${dy.key}`;

  const label = document.createElement('label');
  label.textContent = pad.label;

  const surface = document.createElement('div');
  surface.className = 'pad knob';
  surface.setAttribute('role', 'group');
  surface.setAttribute('aria-label', pad.label);
  surface.tabIndex = 0;
  surface.dataset.tip = pad.tip;
  surface.dataset.hint = PAD_HINT;
  surface.dataset.param = row.dataset.param;
  const dot = document.createElement('span');
  dot.className = 'pad-dot';
  surface.appendChild(dot);

  // Where each axis is in its range, 0..1, from a view value.
  const frac = (def, view) => (view - def.min) / (def.max - def.min);
  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  // The cross marks zero on each axis (the middle, for a symmetric range).
  const zero = (def) => (def.min <= 0 && def.max >= 0 ? frac(def, toView(def, 0)) : 0.5);
  surface.style.setProperty('--zx', `${zero(dx) * 100}%`);
  surface.style.setProperty('--zy', `${(1 - zero(dy)) * 100}%`);

  const holders = {};
  for (const [, def] of axes) {
    const h = document.createElement('input');
    h.type = 'range';
    h.hidden = true;
    h.tabIndex = -1;
    h.min = def.min;
    h.max = def.max;
    h.step = def.step;
    h.dataset.for = def.key;
    surface.appendChild(h);
    holders[def.key] = h;
    inputs[def.key] = h;
  }

  const fields = document.createElement('div');
  fields.className = 'value pad-fields';
  for (const [axis, def] of axes) {
    const wrap = document.createElement('span');
    wrap.className = 'pad-field';
    wrap.dataset.axis = axis;
    const f = document.createElement('input');
    f.type = 'text';
    f.className = 'value num';
    f.inputMode = 'decimal';
    f.spellcheck = false;
    f.setAttribute('aria-label', `${pad.label} ${axis}`);
    f.dataset.tip = def.tip;
    f.dataset.hint = NUM_HINT;
    f.dataset.param = def.key;
    attachNumberField(def, f, holders[def.key]);
    wrap.appendChild(f);
    fields.appendChild(wrap);
    valueEls[def.key] = f;
  }

  const learns = document.createElement('div');
  learns.className = 'pad-learn';
  for (const [, def] of axes) {
    const b = document.createElement('button');
    b.className = 'learn';
    b.textContent = '⊙';
    b.dataset.param = def.key; // the tooltip's key line says which axis
    b.addEventListener('click', () => armLearn(def.key));
    learns.appendChild(b);
    learnEls[def.key] = b;
  }

  const paint = () => {
    const fx = clamp01(frac(dx, Number(holders[dx.key].value)));
    const fy = clamp01(frac(dy, Number(holders[dy.key].value)));
    dot.style.left = `${fx * 100}%`;
    dot.style.top = `${(1 - fy) * 100}%`;
  };
  onRender(dx.key, paint);
  onRender(dy.key, paint);

  // A view value onto one axis: snapped on the stored grid, written, shown.
  const put = (def, view) => {
    const v = quantize(def, fromView(def, view));
    queueWrite(def.key, v);
    setUI(def.key, v);
  };

  // x left → right is min → max; y bottom → top, so up is up. Measured
  // inside the border, where the dot travels.
  const fromPointer = (e) => {
    const r = surface.getBoundingClientRect();
    const fx = clamp01((e.clientX - r.left - surface.clientLeft) / surface.clientWidth);
    const fy = clamp01(1 - (e.clientY - r.top - surface.clientTop) / surface.clientHeight);
    put(dx, dx.min + fx * (dx.max - dx.min));
    put(dy, dy.min + fy * (dy.max - dy.min));
  };
  let dragging = null;
  surface.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dragging !== null) return;
    dragging = e.pointerId;
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {
      // a synthetic or already-gone pointer: the moves still reach the pad
    }
    surface.focus({ preventScroll: true });
    fromPointer(e);
  });
  surface.addEventListener('pointermove', (e) => {
    if (e.pointerId === dragging) fromPointer(e);
  });
  const release = (e) => {
    if (e.pointerId !== dragging) return;
    dragging = null;
    try {
      surface.releasePointerCapture(e.pointerId);
    } catch {
      // never captured
    }
  };
  surface.addEventListener('pointerup', release);
  surface.addEventListener('pointercancel', release);

  // Arrows nudge one step on their own axis (shift ×10).
  const NUDGE = {
    ArrowLeft: [dx, -1],
    ArrowRight: [dx, 1],
    ArrowDown: [dy, -1],
    ArrowUp: [dy, 1],
  };
  surface.addEventListener('keydown', (e) => {
    const nudge = NUDGE[e.key];
    if (!nudge) return;
    e.preventDefault();
    const [def, sign] = nudge;
    const step = (Number(def.step) || 1) * (e.shiftKey ? 10 : 1);
    put(def, Number(holders[def.key].value) + sign * step);
  });

  // Double-click the name or the pad: both keys back to the marked preset.
  // The typed fields keep double-click for selecting their text.
  row.addEventListener('dblclick', (e) => {
    if (e.target.closest('input.value.num, .learn')) return;
    for (const [, def] of axes) resetParam(def.key);
  });

  row.append(label, surface, fields, learns);
  row.addEventListener('animationend', () => row.classList.remove('flash'));
  rowEls[dx.key] = row;
  rowEls[dy.key] = row;
  return row;
}

// The row a def renders as: its own, or — for a pad's keys — the pad's,
// built once where the pad's first key sits; the second key gets null.
const builtPads = new Set();
function rowFor(def) {
  if (!def.pad) return buildRow(def);
  const pad = PADS[def.pad];
  if (!pad || (pad.x !== def.key && pad.y !== def.key)) {
    console.warn('[panel] unknown pad', def.pad, def.key);
    return buildRow(def); // never lose a row to a typo
  }
  if (builtPads.has(def.pad)) return null;
  builtPads.add(def.pad);
  return buildPadRow(pad);
}

function buildSection(section) {
  const head = document.createElement('div');
  head.className = 'section';
  head.id = `section-${section.id}`; // jump target for the medium chips
  head.tabIndex = -1;
  head.dataset.section = section.id;
  head.dataset.tip = section.tip;
  head.addEventListener('animationend', () => head.classList.remove('flash'));
  const title = document.createElement('h2');
  title.textContent = section.title;
  head.appendChild(title);
  // One line, shown only while this section's medium is switched off: which
  // chip brings it back. Its rows are hidden meanwhile.
  const note = document.createElement('p');
  note.className = 'off-note';
  note.hidden = true;
  note.dataset.tip = `This section’s knobs are out of sight while its medium is off. Switch it on with the chip above and they return.`;
  head.appendChild(note);
  sectionEls[section.id] = { head, note };
  if (section.id === 'audio') {
    // What is passing through the body in the tab being looked at (finding
    // 7): silence should never be a mystery. Filled by the stats plumbing
    // below; empty wherever that plumbing is unavailable.
    const status = document.createElement('p');
    status.className = 'status';
    status.id = 'audio-status';
    status.dataset.tip =
      'What the sound process is doing in the tab you are looking at: how many sources are passing through the body right now. Paused sources, and ones the browser will not let the piece reach, play untouched.';
    head.appendChild(status);
  }
  return head;
}

// A group inside a section: a small caption, then its rows. An engine group
// folds away behind a disclosure; its rows stay in the DOM (hidden), so
// presets, MIDI and storage reach them exactly as before.
const engineGroups = {}; // section id → { head, rows }

function buildGroup(group, defs) {
  const wrap = document.createElement('div');
  wrap.className = 'group';
  wrap.dataset.group = group.id;
  wrap.dataset.section = group.section;

  let head;
  if (group.collapsible) {
    head = document.createElement('button');
    head.type = 'button';
    head.className = 'group-head disclosure';
    head.setAttribute('aria-expanded', 'false');
    head.addEventListener('click', () => {
      setEngineOpen(group.section, head.getAttribute('aria-expanded') !== 'true', true);
    });
  } else {
    head = document.createElement('div');
    head.className = 'group-head';
    head.textContent = group.title;
  }
  head.id = `group-${group.section}-${group.id}`; // jump target (images → sort)
  if (!group.collapsible) head.tabIndex = -1; // focusable by the jump, not by Tab
  head.addEventListener('animationend', () => head.classList.remove('flash'));
  head.dataset.tip = group.tip;

  const rows = document.createElement('div');
  rows.className = 'group-rows';
  if (group.collapsible) {
    // In the mixer the disclosure moves up into the section header (so a
    // folded engine costs no column; paintLayout), and this caption heads
    // the rows' own column when they are unfolded. Hidden in the column.
    const cap = document.createElement('div');
    cap.className = 'group-cap';
    cap.textContent = group.title;
    cap.dataset.tip = group.tip;
    rows.appendChild(cap);
  }
  for (const def of defs) {
    const r = rowFor(def);
    if (r) rows.appendChild(r);
  }
  wrap.append(head, rows);
  wrap.classList.toggle('engine', !!group.collapsible);
  groupEls[`${group.section}.${group.id}`] = { wrap, head };

  if (group.collapsible) {
    engineGroups[group.section] = { head, rows, title: group.title };
    paintEngine(group.section, false);
  }
  return wrap;
}

function paintEngine(sectionId, open) {
  const g = engineGroups[sectionId];
  if (!g) return;
  g.head.textContent = `${g.title} ${open ? '▾' : '▸'}`;
  g.head.setAttribute('aria-expanded', String(open));
  g.head.dataset.hint = open ? 'Click to fold the engine away.' : 'Click to unfold the engine.';
  g.rows.hidden = !open;
}

// The tooltips switch is panel furniture rather than a parameter of the
// piece. It sat in the global block until the 2026-10-12 redesign gave that
// block to the A/B, the mediums and the presets; it now lives at the bottom
// beside the MIDI block, as a small row.
function buildTooltipRow() {
  const row = document.createElement('div');
  row.className = 'row pref';
  row.dataset.tip =
    'Show these explanations in a bubble when you hover a control. Off silences them entirely.';
  row.dataset.hint =
    'A panel preference, not a parameter of the piece — it never reaches the page.';

  const label = document.createElement('label');
  label.textContent = 'tooltips';
  label.htmlFor = 'tooltips';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'tooltips';
  input.className = 'knob';

  const value = document.createElement('span');
  value.className = 'value';
  value.id = 'tooltips-value';

  row.append(label, input, value, document.createElement('span'));
  return row;
}

// Where the panel lives (M9): the second panel preference, beside tooltips.
// It writes `panelHome` and nothing else; the service worker and the content
// script act on it the next time the panel is opened.
function buildPanelHomeRow() {
  const row = document.createElement('div');
  row.className = 'row pref';
  row.dataset.pref = PANEL_HOME.key;
  row.dataset.tip = PANEL_HOME.tip;
  row.dataset.hint = PANEL_HOME.hint;

  const label = document.createElement('label');
  label.textContent = PANEL_HOME.label;
  label.htmlFor = PANEL_HOME.key;

  const input = document.createElement('select');
  input.id = PANEL_HOME.key;
  input.className = 'knob';
  for (const [value, text] of PANEL_HOME.options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    input.appendChild(o);
  }
  input.value = PANEL_HOME.default;

  row.append(label, input, document.createElement('span'), document.createElement('span'));
  return row;
}

// MIDI on demand (round 8): the strip's frame lives inside whatever page is
// open, and that page's permissions policy answers a MIDI request — so
// asking at boot drew a console violation or a prompt from every site. In
// the strip the request waits for this button; the window and the side
// panel are extension pages of their own and still ask at boot, so the
// button exists only when HOSTED. Wired up beside the MIDI plumbing below.
function buildMidiButton() {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = 'midi-connect';
  b.className = 'btn subtle';
  b.textContent = 'MIDI…';
  b.dataset.tip =
    'Connect a MIDI controller to this strip. Asked for only when you click, because the page hosting the strip decides whether a frame may use MIDI.';
  b.hidden = !HOSTED;
  return b;
}

// --- The A/B (M1): one large button bound to `enabled` ---
// Round 3 (all three reviewers): a press shorter than LATCH_MS latches, so a
// slow, deliberate click never ends where it started. Only a press held past
// LATCH_MS is a momentary compare: the face says "holding", and release
// returns to exactly where the press began (as do pointer-leave and cancel).
// The flip itself shows under the finger at HOLD_MS, so a compare does not
// wait the full LATCH_MS to be seen; a release between the two keeps it, and
// that is the latch. Keyboard Space/Enter latch (they arrive as a click with
// detail 0; mouse clicks are handled by the pointer path).
const HOLD_MS = 250;
const LATCH_MS = 600;
const NUDGE_MS = 1500;
// Set by buildAB: a short message on the A/B's face (round 3, item 5d).
let nudgeAB = () => {};

function buildAB(def) {
  const wrap = document.createElement('div');
  wrap.className = 'ab-row';

  const ab = document.createElement('button');
  ab.className = 'ab';
  ab.id = 'ab';
  ab.dataset.key = def.key;
  ab.dataset.tip = def.tip;
  const state = document.createElement('span');
  state.className = 'ab-state';
  const say = document.createElement('span');
  say.className = 'ab-say';
  ab.append(state, say);

  const learn = document.createElement('button');
  learn.className = 'learn';
  learn.textContent = '⊙';
  learn.addEventListener('click', () => armLearn(def.key));

  inputs[def.key] = { checked: true };
  rowEls[def.key] = ab;
  learnEls[def.key] = learn;

  let held = false; // past LATCH_MS: the "holding" face
  let nudge = null; // a transient line on the face
  let nudgeTimer = 0;
  const paint = (on) => {
    ab.classList.toggle('on', on);
    ab.classList.toggle('held', held);
    ab.classList.toggle('nudge', !!nudge && !held);
    ab.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'ON' : 'OFF';
    say.textContent = held
      ? on
        ? '— holding: bending · let go to return'
        : '— holding: page untouched · let go to return'
      : nudge
        ? `— ${nudge}`
        : on
          ? '— bending the page'
          : '— page untouched';
    globals.classList.toggle('master-off', !on);
  };
  onRender(def.key, paint);
  nudgeAB = (text) => {
    clearTimeout(nudgeTimer);
    nudge = text;
    paint(inputs[def.key].checked);
    nudgeTimer = setTimeout(() => {
      nudge = null;
      paint(inputs[def.key].checked);
    }, NUDGE_MS);
  };

  const setEnabled = (v) => {
    queueWrite(def.key, v);
    setUI(def.key, v);
  };

  let flipTimer = 0;
  let holdTimer = 0;
  let pointer = null;
  let downAt = 0;
  let from = null; // the state the press began in
  let flipped = false;
  const clearTimers = () => {
    clearTimeout(flipTimer);
    clearTimeout(holdTimer);
    flipTimer = holdTimer = 0;
  };
  ab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    downAt = performance.now();
    from = inputs[def.key].checked;
    flipped = false;
    flipTimer = setTimeout(() => {
      flipTimer = 0;
      flipped = true;
      setEnabled(!from);
    }, HOLD_MS);
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      held = true;
      paint(inputs[def.key].checked);
    }, LATCH_MS);
  });
  ab.addEventListener('pointerup', (e) => {
    if (pointer === null || e.pointerId !== pointer) return;
    pointer = null;
    clearTimers();
    const wasHeld = held || performance.now() - downAt >= LATCH_MS;
    held = false;
    if (wasHeld) setEnabled(from); // a compare: back to exactly where it began
    else setEnabled(!from); // a press, however slow: latch
  });
  const abandon = (e) => {
    if (pointer === null || e.pointerId !== pointer) return;
    pointer = null;
    clearTimers();
    const wasFlipped = flipped || held;
    held = false;
    if (wasFlipped) setEnabled(from); // dragged off or cancelled: nothing changes
  };
  ab.addEventListener('pointercancel', abandon);
  ab.addEventListener('pointerleave', abandon);
  ab.addEventListener('click', (e) => {
    if (e.detail === 0) setEnabled(!inputs[def.key].checked); // keyboard
  });
  ab.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press on touch

  wrap.append(ab, learn);
  return wrap;
}

// --- The four medium chips (M7): video · images · text · audio ---
// The pill toggles its key; the caption above it jumps to the section that
// shapes that medium. Since 2026-10-11 the chips are the ONLY face of all
// four keys: text has no knobs (an on/off effect, its slider retired), so
// its caption is a plain label and there is no Text section; audio's
// master row went the same way, the chip being the master.
// `target` overrides the landing: images land on the SORT caption (the only
// knobs that shape them), with `say` in the help strip (round 3, item 6).
const CHIPS = [
  { key: 'video', label: 'video', section: 'video' },
  { key: 'images', label: 'images', section: 'video', target: 'group-video-sort', say: 'images are shaped by SORT' },
  { key: 'textScramble', label: 'text' },
  { key: 'audioEnabled', label: 'audio', section: 'audio' },
];

function buildChips() {
  const strip = document.createElement('div');
  strip.className = 'chips';
  for (const chip of CHIPS) {
    const def = defByKey[chip.key];
    const cell = document.createElement('div');
    cell.className = 'chip';
    cell.dataset.key = chip.key;

    // A medium with knobs gets a caption that jumps to them; one without
    // (text) gets a plain label — nothing to jump to.
    let name;
    if (chip.section) {
      name = document.createElement('button');
      name.textContent = `${chip.label} ↓`;
      const sectionTitle = SECTIONS.find((s) => s.id === chip.section)?.title ?? chip.section;
      name.dataset.tip = chip.target
        ? `Jump to the sort knobs in the ${sectionTitle} section: they are what shape ${chip.label}.`
        : `Jump to the ${sectionTitle} section, where ${chip.label} is shaped.`;
      name.addEventListener('click', () => {
        const head = document.getElementById(chip.target ?? `section-${chip.section}`);
        if (!head) return;
        head.scrollIntoView({ block: 'start', behavior: 'smooth' });
        head.focus({ preventScroll: true });
        whenLanded(() => flashEl(head));
        if (chip.say) say(chip.say, name);
      });
    } else {
      name = document.createElement('span');
      name.textContent = chip.label;
      name.dataset.tip = `${chip.label[0].toUpperCase()}${chip.label.slice(1)} has no knobs: the switch below is the whole control.`;
    }
    name.className = 'chip-name';

    const pill = document.createElement('button');
    pill.className = 'chip-toggle';
    pill.dataset.tip = def.tip;
    pill.dataset.hint = 'Click to switch this medium on or off. The big switch above still governs all four.';
    pill.addEventListener('click', () => {
      const v = !inputs[chip.key].checked;
      queueWrite(chip.key, v);
      setUI(chip.key, v);
      // The switch works while the piece is off, but shows nothing: say so.
      if (!inputs.enabled.checked) say('switch ON to see it', pill);
    });

    // The chip is its key's only face (no row anywhere), so it holds the
    // state and carries the MIDI learn for that key — shown, like every ⊙,
    // only while a controller is connected.
    inputs[chip.key] = { checked: true };
    rowEls[chip.key] = cell;
    const learn = document.createElement('button');
    learn.className = 'learn';
    learn.textContent = '⊙';
    learn.addEventListener('click', () => armLearn(chip.key));
    learnEls[chip.key] = learn;
    onRender(chip.key, (on) => {
      cell.classList.toggle('on', on);
      pill.setAttribute('aria-pressed', String(on));
      pill.textContent = on ? 'on' : 'off';
    });

    cell.append(name, pill, learn);
    strip.appendChild(cell);
  }
  return strip;
}

// A jump has landed when the scroller stops (scrollend), or at once if
// there was nothing to scroll; the timeout covers both.
function whenLanded(fn) {
  const scroller = document.getElementById('scroll');
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    scroller.removeEventListener('scrollend', go);
    fn();
  };
  scroller.addEventListener('scrollend', go);
  setTimeout(go, 900);
}

// The landed header acknowledges the jump with the row flash.
function flashEl(el) {
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');
}

{
  const bySection = new Map(SECTIONS.map((s) => [s.id, []]));
  const loose = [];
  for (const def of DEFS) {
    const bucket = def.section ? bySection.get(def.section) : null;
    if (def.section && !bucket) console.warn('[panel] unknown section', def.section, def.key);
    (bucket ?? loose).push(def);
  }
  // Sectionless keys are the global block's: the A/B plus the four chips.
  // Any other sectionless key would have no face, so it is flagged loudly.
  const chipKeys = new Set(CHIPS.map((c) => c.key));
  for (const def of loose) {
    if (def.key !== 'enabled' && !chipKeys.has(def.key)) {
      console.warn('[panel] sectionless param with no global control', def.key);
    }
  }
  globals.appendChild(buildAB(defByKey.enabled));
  for (const section of SECTIONS) {
    controls.appendChild(buildSection(section));
    const defs = bySection.get(section.id);
    // Ungrouped rows (none at present) come first, then each group in
    // GROUPS order with its rows in DEFS order.
    for (const def of defs.filter((d) => !d.group)) {
      const r = rowFor(def);
      if (r) controls.appendChild(r);
    }
    for (const group of GROUPS.filter((g) => g.section === section.id)) {
      const members = defs.filter((d) => d.group === group.id);
      if (members.length) controls.appendChild(buildGroup(group, members));
    }
    for (const def of defs.filter(
      (d) => d.group && !GROUPS.some((g) => g.section === section.id && g.id === d.group)
    )) {
      console.warn('[panel] unknown group', def.group, def.key);
      const r = rowFor(def); // never lose a row to a typo
      if (r) controls.appendChild(r);
    }
  }
  globals.appendChild(buildChips());
  document.getElementById('prefs').append(buildTooltipRow(), buildPanelHomeRow(), buildMidiButton());
}

// Column or mixer, painted now and again whenever the page changes shape (a
// window dragged wide or tall). Besides the attribute panel.css keys on, the
// one structural difference: in the mixer each engine's disclosure sits in
// its section header after the h2, so a folded engine costs no column; in
// the column it heads its own group again. setGroupShown hides the head
// wherever it lives, so the move needs nothing else.
function paintLayout() {
  const mixer = HOSTED || MIXER.matches;
  if (mixer) document.documentElement.dataset.layout = 'mixer';
  else delete document.documentElement.dataset.layout;
  for (const [id, g] of Object.entries(engineGroups)) {
    if (mixer) sectionEls[id]?.head.querySelector('h2')?.after(g.head);
    else groupEls[`${id}.engine`]?.wrap.prepend(g.head);
  }
}
paintLayout();
MIXER.addEventListener('change', paintLayout);

function writeValueCell(def, v) {
  const el = valueEls[def.key];
  if (!el) return; // a global toggle with no value cell — its renderer draws it
  if (!isNumeric(def)) {
    el.textContent = fmtValue(def, v);
    return;
  }
  // Don't reformat a half-typed number under the caret — but a value that
  // arrived from somewhere else (MIDI, restore, the other panel window) is
  // news, and a focused field must not sit there showing the old one. `v`
  // is stored; the field holds the view, so the typed text is compared in
  // the stored sense.
  const typed = parseFloat(el.value);
  const mine = Number.isFinite(typed) && quantize(def, fromView(def, typed)) === v;
  if (document.activeElement === el && mine) return;
  el.value = fmtNumber(def, toView(def, v));
}

// The field speaks the view (what the player reads); storage the stored
// sense. `slider` is the input holding this key's view — the row's range,
// or a pad's hidden one. commit takes a typed view number, returns the view
// it settled on.
function attachNumberField(def, el, slider) {
  const commit = (n) => {
    const v = quantize(def, fromView(def, n));
    // A value that had to clamp says so (finding 8): the row flashes. The
    // view spans the same min..max as the stored sense.
    if (n < Number(def.min) || n > Number(def.max)) flashRow(def.key);
    slider.value = toView(def, v);
    queueWrite(def.key, v);
    for (const fn of renderers[def.key] ?? []) fn(v); // e.g. the drift pad's dot
    syncFor(def.key);
    return toView(def, v);
  };
  const normalise = () => {
    const n = parseFloat(el.value);
    el.value = fmtNumber(def, Number.isFinite(n) ? commit(n) : Number(slider.value));
  };
  el.addEventListener('input', () => {
    const n = parseFloat(el.value);
    if (Number.isFinite(n)) commit(n); // the knob follows the typing, live
  });
  el.addEventListener('change', normalise); // blur or Enter: settle the text
  el.addEventListener('focus', () => el.select());
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      normalise();
      el.blur();
    } else if (e.key === 'Escape') {
      el.value = fmtNumber(def, Number(slider.value));
      el.blur();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = (Number(def.step) || 1) * (e.shiftKey ? 10 : 1);
      const typed = parseFloat(el.value);
      const base = Number.isFinite(typed) ? typed : Number(slider.value);
      el.value = fmtNumber(def, commit(base + (e.key === 'ArrowUp' ? step : -step)));
    }
  });
}

function setUI(key, v) {
  const def = defByKey[key];
  if (def === undefined || v === undefined) return;
  if (def.type === 'trigger') {
    inputs[key].value = Number(v) || 0; // the counter; nothing to paint
    return;
  }
  if (def.type === 'toggle') {
    inputs[key].checked = !!v;
  } else if (def.type === 'select') {
    inputs[key].value = v;
  } else {
    // Snap to the slider's own grid so field, knob and storage agree; the
    // knob shows the view.
    v = quantize(def, Number(v));
    inputs[key].value = toView(def, v);
  }
  writeValueCell(def, v);
  for (const fn of renderers[key] ?? []) fn(def.type === 'toggle' ? !!v : v);
  syncFor(key);
}

function syncFor(key) {
  if (MEDIUM_TRIGGERS.includes(key)) syncVideoUI();
  else if (AUDIO_TRIGGERS.includes(key)) syncAudioUI();
}

// `gate` is null for a live row, or the GATE name of the switch that is
// off. A gated row is hidden (and disabled, so nothing can reach it by
// keyboard either); `data-gate` records why, for the harness and for anyone
// reading the DOM.
function setGated(key, gate) {
  const gated = !!gate;
  inputs[key].disabled = gated;
  if (inputs[key].button) inputs[key].button.disabled = gated; // a trigger's face
  const value = valueEls[key];
  if (value.tagName === 'INPUT') value.disabled = gated;
  const row = rowEls[key];
  row.hidden = gated;
  if (gated) row.dataset.gate = gate;
  else delete row.dataset.gate;
}

// A group whose every row is gated hides its caption too; a section whose
// medium is off hides its groups and shows the one-line note instead.
function setGroupShown(sectionId, groupId, shown) {
  const g = groupEls[`${sectionId}.${groupId}`];
  if (!g) return;
  g.wrap.hidden = !shown;
  g.head.hidden = !shown; // the disclosure may live in the section header (strip)
}

function setSectionOff(sectionId, note) {
  const s = sectionEls[sectionId];
  if (!s) return;
  s.note.textContent = note || '';
  s.note.hidden = !note;
  s.head.classList.toggle('off', !!note);
}

// The Video section's gating, outermost switch first: the mediums (the
// `video`/`images` chips), then feedback, then flow.
function syncVideoUI() {
  const video = inputs.video.checked;
  const anyMedium = video || inputs.images.checked;
  const fbOn = inputs.feedbackVideo.checked;
  const flowOn = storedOf('flowAmount') > 0;
  for (const key of SORT_KEYS) {
    setGated(key, !anyMedium ? GATE.medium : FLOW_ONLY.includes(key) && !flowOn ? GATE.flow : null);
  }
  for (const key of FEEDBACK_KEYS) {
    setGated(key, !video ? GATE.video : key !== 'feedbackVideo' && !fbOn ? GATE.feedback : null);
  }
  setGroupShown('video', 'sort', anyMedium);
  setGroupShown('video', 'feedback', video);
  setGroupShown('video', 'engine', anyMedium);
  setSectionOff('video', anyMedium ? null : SECTION_OFF.medium);
}

function syncAudioUI() {
  const on = inputs.audioEnabled.checked;
  const fbOn = inputs.audioFeedback.checked;
  const clearOn = inputs.audioFbClear.checked;
  const comb = inputs.audioBody.value === 'comb';
  for (const key of AUDIO_ONLY) {
    // The outermost switch that is off is the one recorded.
    setGated(
      key,
      !on
        ? GATE.audio
        : AUDIO_FB_ONLY.includes(key) && !fbOn
          ? GATE.smear
          : AUDIO_FB_CLEAR_ONLY.includes(key) && !clearOn
            ? GATE.clear
            : AUDIO_COMB_ONLY.includes(key) && !comb
              ? GATE.comb
              : null,
    );
  }
  for (const id of ['body', 'smear', 'engine']) setGroupShown('audio', id, on);
  setSectionOff('audio', on ? null : SECTION_OFF.audio);
}

// --- Throttled writes (~30 Hz) so knob sweeps don't flood storage ---

const pending = {};
let flushTimer = 0;

function queueWrite(key, value) {
  pending[key] = value;
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = 0;
      const batch = { ...pending };
      for (const k of Object.keys(pending)) delete pending[k];
      store.set(batch);
    }, 33);
  }
}

// --- Presets (M2): default, slots A·B·C, save mode, undo ---
// "default" is the compiled DEFAULTS and nothing can redefine it (it was
// labelled "original" until round 3; a stored presetBase of "original" still
// reads as default). The slots are snapshots; clicking one LOADS it. Saving
// is a visible, one-shot mode (save… then a slot), so the room slip —
// meaning to load, pressing save — cannot happen. Every load, every restore
// and every save over a filled slot offers undo for ten seconds. The base —
// the last-loaded or last-saved preset — is where a row double-click returns.

const UNDO_MS = 10000;
const presetRow = document.getElementById('presets');
const btnDefault = document.getElementById('preset-default');
const btnSave = document.getElementById('preset-save');
const btnCancel = document.getElementById('preset-cancel');
const btnUndo = document.getElementById('preset-undo');
const slotEls = Object.fromEntries(
  [...presetRow.querySelectorAll('.slot')].map((el) => [el.dataset.slot, el])
);

const emptyPresets = () => Object.fromEntries(PRESET_SLOTS.map((s) => [s, null]));
const BASE_DEFAULT = 'default';
// A stored base from before the rename ("original") is the same thing.
const readBase = (name) =>
  PRESET_SLOTS.includes(name) ? name : BASE_DEFAULT;

function normalisePresets(p) {
  const out = emptyPresets();
  if (p && typeof p === 'object') {
    for (const s of PRESET_SLOTS) {
      if (p[s] && typeof p[s] === 'object') out[s] = p[s];
    }
  }
  return out;
}

let presets = emptyPresets();
let presetBase = BASE_DEFAULT;
let saveMode = false;
// { kind: 'values', values, base } after a load or restore;
// { kind: 'slot', slot, prev, base } after saving over a filled slot.
let undoSnap = null;
let undoTimer = 0;
const flashing = new Map(); // button → transient label

{
  const stored = await store.get({ presets: null, presetBase: BASE_DEFAULT, userDefaults: null });
  presets = normalisePresets(stored.presets);
  presetBase = readBase(stored.presetBase);
  // Migration: the old single "set defaults" snapshot becomes slot A and the
  // base, so John's room settings are still what a double-click returns to.
  const legacy = stored.userDefaults;
  if (legacy && typeof legacy === 'object') {
    if (!presets.A) {
      presets.A = { ...legacy };
      presetBase = 'A';
      await store.set({ presets, presetBase });
      await store.remove('userDefaults');
    } else {
      console.warn('[panel] legacy userDefaults kept: slot A is already taken');
    }
  }
}

const slotFilled = (s) => !!presets[s];
const baseValues = () =>
  presetBase !== BASE_DEFAULT && slotFilled(presetBase) ? presets[presetBase] : null;

function currentValues() {
  const out = {};
  for (const def of DEFS) {
    const input = inputs[def.key];
    out[def.key] =
      def.type === 'toggle'
        ? input.checked
        : def.type === 'select' || def.type === 'trigger'
          ? input.value
          : storedOf(def.key);
  }
  return out;
}

// What a preset holds: every parameter except the A/B (PRESET_EXCLUDED).
function presetValues() {
  const out = currentValues();
  for (const k of PRESET_EXCLUDED) delete out[k];
  return out;
}

function applyValues(values) {
  const out = {};
  for (const def of DEFS) {
    if (PRESET_EXCLUDED.includes(def.key) || !(def.key in values)) continue;
    out[def.key] = values[def.key];
    delete pending[def.key]; // a queued knob write must not land on top
  }
  store.set(out);
  for (const [k, v] of Object.entries(out)) setUI(k, v);
}

function resetParam(key) {
  if (defByKey[key]?.type === 'trigger') return; // nothing to put back
  const v = defaultFor(key, baseValues());
  if (v === undefined) return;
  queueWrite(key, v);
  setUI(key, v);
  flashRow(key);
}

// The row acknowledges something it did on its own: a restore, a clamp.
function flashRow(key) {
  const row = rowEls[key];
  if (!row) return;
  row.classList.remove('flash');
  void row.offsetWidth; // restart the animation on a repeat
  row.classList.add('flash');
}

function flash(button, text) {
  clearTimeout(button._flashTimer);
  flashing.set(button, text);
  button.classList.add('done');
  renderPresets();
  button._flashTimer = setTimeout(() => {
    flashing.delete(button);
    button.classList.remove('done');
    renderPresets();
  }, 900);
}

const BASE_HINT = 'Marked as the base: double-clicking any row puts it back to this preset’s value.';

const DEFAULT_HINT = 'It can never be overwritten, so this way back always exists. Leaves the on/off switch where it is.';

function renderPresets() {
  presetRow.classList.toggle('saving', saveMode);
  btnDefault.textContent = flashing.get(btnDefault) ?? 'default';
  btnDefault.classList.toggle('base', presetBase === BASE_DEFAULT);
  btnDefault.disabled = saveMode;
  btnDefault.dataset.hint = presetBase === BASE_DEFAULT ? `${BASE_HINT} ${DEFAULT_HINT}` : DEFAULT_HINT;

  for (const s of PRESET_SLOTS) {
    const el = slotEls[s];
    const filled = slotFilled(s);
    el.textContent = flashing.get(el) ?? (saveMode ? (filled ? `replace ${s}` : `save → ${s}`) : s);
    el.classList.toggle('empty', !filled && !saveMode);
    el.classList.toggle('base', presetBase === s && filled);
    if (saveMode) {
      el.dataset.tip = filled
        ? `Replace what ${s} holds with the current settings. Undo puts the old ${s} back for ten seconds.`
        : `Save the current settings into the empty slot ${s}.`;
      el.dataset.hint = 'Saving marks the slot as the base. Escape or a click elsewhere cancels.';
    } else if (filled) {
      el.dataset.tip = `Load preset ${s}: every setting jumps to what was saved here (the on/off switch stays put).`;
      el.dataset.hint =
        presetBase === s ? `${BASE_HINT} Undo appears for ten seconds after a load.` : 'Undo appears for ten seconds afterwards.';
    } else {
      el.dataset.tip = `Slot ${s} is empty. Click save…, then ${s}, to keep the current settings here.`;
      el.dataset.hint = 'Nothing happens when an empty slot is clicked.';
    }
  }
  btnSave.textContent = flashing.get(btnSave) ?? 'save…';
  btnSave.hidden = saveMode;
  btnCancel.hidden = !saveMode;
  btnUndo.hidden = !undoSnap || saveMode;
  btnUndo.dataset.tip =
    undoSnap?.kind === 'slot'
      ? `Put back what ${undoSnap.slot} held before you saved over it — for ten seconds after the save.`
      : 'Put back the settings you had just before that load — for ten seconds after it.';
}

function setSaveMode(on) {
  saveMode = on;
  renderPresets();
}

// Escape or a click elsewhere: leave save mode, and say nothing was saved.
function cancelSave() {
  setSaveMode(false);
  flash(btnSave, 'cancelled');
}

function offerUndo(snap) {
  undoSnap = snap;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => {
    undoSnap = null;
    renderPresets();
  }, UNDO_MS);
  renderPresets();
}

function setBase(name) {
  presetBase = name;
  store.set({ presetBase });
}

function loadPreset(name) {
  const isDefault = name === BASE_DEFAULT;
  const button = isDefault ? btnDefault : slotEls[name];
  if (!isDefault && !slotFilled(name)) {
    flash(button, 'empty');
    return;
  }
  const snap = { kind: 'values', values: presetValues(), base: presetBase };
  const source = isDefault ? null : presets[name];
  const values = {};
  for (const def of DEFS) values[def.key] = defaultFor(def.key, source);
  applyValues(values);
  setBase(name);
  offerUndo(snap);
  flash(button, isDefault ? 'restored' : 'loaded');
  // The load landed, but with the piece off there is nothing to see yet.
  if (!inputs.enabled.checked) nudgeAB('switch ON to see it');
}

function saveTo(slot) {
  const prev = presets[slot];
  const base = presetBase;
  presets = { ...presets, [slot]: presetValues() };
  store.set({ presets });
  setBase(slot); // what you just saved is what a double-click returns to
  setSaveMode(false);
  if (prev) offerUndo({ kind: 'slot', slot, prev, base });
  flash(slotEls[slot], `saved to ${slot}`);
}

btnDefault.addEventListener('click', () => {
  if (!saveMode) loadPreset(BASE_DEFAULT);
});
for (const [s, el] of Object.entries(slotEls)) {
  el.addEventListener('click', () => (saveMode ? saveTo(s) : loadPreset(s)));
}
btnSave.addEventListener('click', () => setSaveMode(true));
btnCancel.addEventListener('click', () => setSaveMode(false));
btnUndo.addEventListener('click', () => {
  if (!undoSnap) return;
  const snap = undoSnap;
  undoSnap = null;
  clearTimeout(undoTimer);
  if (snap.kind === 'slot') {
    // Undo a save-over: the slot gets its old contents back; the knobs stay.
    presets = { ...presets, [snap.slot]: snap.prev };
    store.set({ presets });
  } else {
    applyValues(snap.values);
  }
  setBase(snap.base);
  renderPresets();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && saveMode) cancelSave();
});
document.addEventListener(
  'pointerdown',
  (e) => {
    if (saveMode && !presetRow.contains(e.target)) cancelSave();
  },
  true
);

// --- The shortcuts line: the real bindings when Chrome will say ---
// chrome.commands.getAll() reports what the user actually has (they can
// rebind at chrome://extensions/shortcuts); outside the extension the
// manifest's suggested keys stand in; failing both, the hardcoded line in
// panel.html stays.
(async () => {
  const keysEl = document.getElementById('keys');
  const keys = {};
  try {
    if (typeof chrome !== 'undefined' && chrome.commands?.getAll) {
      for (const c of await chrome.commands.getAll()) keys[c.name] = c.shortcut || 'no key set';
    } else {
      const m = await (await fetch(new URL('../manifest.json', import.meta.url))).json();
      for (const [name, c] of Object.entries(m.commands ?? {})) {
        if (c.suggested_key?.default) keys[name] = c.suggested_key.default;
      }
    }
  } catch {
    return;
  }
  if (keys['toggle-effect'] && keys['open-panel']) {
    keysEl.textContent = `${keys['toggle-effect']}  on/off   ·   ${keys['open-panel']}  this panel`;
  }
})();

// --- Tooltips (John, 2026-08-20: everything explains itself on hover) ---
// The copy is a bubble beside the hovered control (2026-10-11, John: the
// help strip and its column took real estate and stayed even with tooltips
// off; in an ideal panel they would be unnecessary). Nothing shows at rest.
// The bubble sits above the control when there is room, else below, and
// is clamped to the viewport; it ignores the pointer so appearing beside
// the hovered row cannot steal the hover. A one-line message (`say`) uses
// the same bubble for a moment, anchored to what was clicked.

const tipEl = document.getElementById('tooltip');
const tipToggle = document.getElementById('tooltips');
const tipToggleValue = document.getElementById('tooltips-value');
const TIP_GAP = 6; // px between the bubble and its anchor
const TIP_MARGIN = 4; // px kept from the viewport's edges
const SAY_MS = 1800;
let tooltipsOn = (await store.get({ tooltips: true })).tooltips !== false;
let tipTimer = 0;
let tipHost = null; // under the pointer
let tipShown = null; // whose tip the bubble is showing (after the delay)
let tipSay = null; // a transient one-line message
let sayAnchor = null; // what the message is about
let sayTimer = 0;

function tipLine(text) {
  const p = document.createElement('div');
  p.textContent = text;
  return p;
}

// Place the bubble beside `anchor`: above if it fits, else below, else
// wherever it fits in the viewport; never off the edges.
function placeTip(anchor) {
  const r = anchor.getBoundingClientRect();
  const w = tipEl.offsetWidth;
  const h = tipEl.offsetHeight;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let top = r.top - h - TIP_GAP;
  if (top < TIP_MARGIN) top = r.bottom + TIP_GAP;
  if (top + h > vh - TIP_MARGIN) top = Math.max(TIP_MARGIN, vh - h - TIP_MARGIN);
  let left = r.left;
  if (left + w > vw - TIP_MARGIN) left = vw - w - TIP_MARGIN;
  if (left < TIP_MARGIN) left = TIP_MARGIN;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function renderTip() {
  const anchor = tipSay ? sayAnchor : tipShown;
  // No bubble in the rail: there is no room beside a 22 px control.
  const show = tooltipsOn && !!anchor && anchor.isConnected && !(HOSTED && RAIL.matches);
  tipEl.hidden = !show;
  if (!show) return;
  tipEl.textContent = '';
  tipEl.classList.toggle('say', !!tipSay);
  if (tipSay) {
    tipEl.appendChild(tipLine(tipSay));
  } else {
    tipEl.appendChild(tipLine(tipShown.dataset.tip));
    if (tipShown.dataset.hint) {
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = tipShown.dataset.hint;
      tipEl.appendChild(hint);
    }
    if (tipShown.dataset.param) {
      const key = document.createElement('p');
      key.className = 'key';
      key.textContent = `key: ${tipShown.dataset.param}`;
      tipEl.appendChild(key);
    }
  }
  placeTip(anchor);
}

function hideTip() {
  clearTimeout(tipTimer);
  tipTimer = 0;
  if (!tipShown) return;
  tipShown = null;
  renderTip();
}

// A short line beside `anchor`: what a click did that the panel cannot
// show. With tooltips off the bubble is gone, so the message goes nowhere.
function say(text, anchor) {
  clearTimeout(sayTimer);
  tipSay = text;
  sayAnchor = anchor ?? sayAnchor;
  renderTip();
  sayTimer = setTimeout(() => {
    tipSay = null;
    renderTip();
  }, SAY_MS);
}

function setTooltips(on) {
  tooltipsOn = on;
  tipToggle.checked = on;
  tipToggleValue.textContent = on ? 'on' : 'off';
  clearTimeout(tipTimer);
  tipShown = null;
  renderTip();
}

document.addEventListener('mouseover', (e) => {
  const host = e.target?.closest?.('[data-tip]') ?? null;
  if (host === tipHost) return;
  tipHost = host;
  hideTip();
  if (!tooltipsOn || !host) return;
  tipTimer = setTimeout(() => {
    tipShown = host;
    renderTip();
  }, 280);
});
document.addEventListener('mouseout', (e) => {
  if (e.relatedTarget) return; // still inside the panel
  tipHost = null;
  hideTip();
});
document.addEventListener('mousedown', hideTip);
document.addEventListener('keydown', hideTip);
document.addEventListener('wheel', hideTip, { passive: true });
window.addEventListener('blur', hideTip);

tipToggle.addEventListener('change', () => {
  setTooltips(tipToggle.checked);
  store.set({ tooltips: tooltipsOn });
});

// --- The engine disclosures (M4/M8): folded by default, remembered ---
// One storage key, `engineOpen` = {video, audio}; panel furniture like
// `tooltips`, outside DEFAULTS.

let engineOpen = { video: false, audio: false };

function normaliseEngineOpen(v) {
  const o = v && typeof v === 'object' ? v : {};
  return { video: o.video === true, audio: o.audio === true };
}

function setEngineOpen(sectionId, open, persist) {
  engineOpen = { ...engineOpen, [sectionId]: open };
  paintEngine(sectionId, open);
  if (persist) store.set({ engineOpen });
}

engineOpen = normaliseEngineOpen((await store.get({ engineOpen: null })).engineOpen);
for (const id of Object.keys(engineGroups)) paintEngine(id, engineOpen[id]);

// --- Where the panel lives (M9) ---
// Read and written here; acted on by the service worker (toolbar icon,
// Ctrl+Shift+P) and the content script (the strip) on the next open.

const homeSelect = document.getElementById(PANEL_HOME.key);
const normaliseHome = (v) => (PANEL_HOMES.includes(v) ? v : PANEL_HOME.default);

homeSelect.value = normaliseHome((await store.get({ [PANEL_HOME.key]: PANEL_HOME.default }))[PANEL_HOME.key]);
homeSelect.addEventListener('change', () => {
  store.set({ [PANEL_HOME.key]: normaliseHome(homeSelect.value) });
});

// In the strip the panel is an iframe inside the page. It tells the strip
// when it has booted (so a strip whose iframe never loads can take itself
// down and leave the page as it was), asks it to grow or fold when the fold
// button is pressed — or, on the rail, when a click lands anywhere that is
// not a control (the title and the gaps count as empty), so the whole bar
// is a target — and passes Ctrl+Shift+P up when the keystroke lands inside
// the panel and no Chrome command claimed it first. Whether the frame is
// the rail or the mixer is read from its own height (RAIL), so no state has
// to travel down.
const foldBtn = document.getElementById('strip-fold');
if (HOSTED) {
  const tell = (op) => {
    try {
      if (window.parent !== window) window.parent.postMessage({ type: 'deflection:strip', op }, '*');
    } catch {
      // no parent to tell: the strip's own timeout covers it
    }
  };
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyP') {
      e.preventDefault();
      tell('toggle');
    }
  });
  // A press that only cancels save mode (see above) does just that. Window
  // capture runs before the document's, so this sees saveMode as it was.
  let cancelling = false;
  window.addEventListener('pointerdown', () => (cancelling = saveMode), true);
  document.addEventListener('click', (e) => {
    const cancelled = cancelling;
    cancelling = false;
    if (RAIL.matches && !cancelled && !e.target.closest('button, input, select, label, .chip, a')) tell('toggle');
  });
  foldBtn.hidden = false;
  // The rail suppresses the hover bubble, so its empty space says what a
  // click does with a plain title instead (only the masthead carries it:
  // the controls keep their own meaning under the pointer).
  const masthead = document.querySelector('.masthead');
  const paintFold = () => {
    const rail = RAIL.matches;
    foldBtn.textContent = rail ? '▴' : '▾';
    foldBtn.setAttribute('aria-expanded', String(!rail));
    foldBtn.dataset.hint = rail ? 'Unfold the mixer.' : 'Fold back to one line.';
    if (rail) masthead.title = 'Click the rail to unfold the mixer (Ctrl+Shift+P)';
    else masthead.removeAttribute('title');
  };
  RAIL.addEventListener('change', paintFold);
  paintFold();
  foldBtn.addEventListener('click', () => tell('toggle'));
  queueMicrotask(() => tell('ready'));
}

// --- Hydrate, subscribe ---

const current = await store.get(DEFAULTS);
for (const def of DEFS) setUI(def.key, current[def.key]);
renderPresets();
setTooltips(tooltipsOn);

store.onChanged((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key === 'presets') {
      presets = normalisePresets(newValue);
      renderPresets();
    } else if (key === 'presetBase') {
      presetBase = readBase(newValue);
      renderPresets();
    } else if (key === 'tooltips') {
      setTooltips(newValue !== false);
    } else if (key === PANEL_HOME.key) {
      homeSelect.value = normaliseHome(newValue);
    } else if (key === 'engineOpen') {
      engineOpen = normaliseEngineOpen(newValue);
      for (const id of Object.keys(engineGroups)) paintEngine(id, engineOpen[id]);
    } else if (key in inputs) {
      setUI(key, newValue);
    }
  }
});

// --- MIDI: CC → param map, persisted; learn-mode per param ---

let midiMap = (await store.get({ midiMap: {} })).midiMap; // { cc: paramKey }
let learnKey = null;
// The last CC value seen per trigger key, so a trigger fires once per rise
// through 64 — a held button, or a knob parked high, fires once, not on
// every message it sends.
const lastCC = {};

function armLearn(key) {
  learnKey = learnKey === key ? null : key;
  for (const [k, el] of Object.entries(learnEls)) {
    el.classList.toggle('armed', k === learnKey);
  }
}

function refreshMapped() {
  const mapped = new Set(Object.values(midiMap));
  for (const [k, el] of Object.entries(learnEls)) {
    el.classList.toggle('mapped', mapped.has(k));
    const cc = Object.keys(midiMap).find((c) => midiMap[c] === k);
    el.textContent = cc !== undefined ? cc : '⊙';
    el.dataset.tip =
      cc !== undefined
        ? `MIDI learn — this parameter is bound to CC ${cc}. Click to arm, then move a controller knob to rebind it.`
        : 'MIDI learn: click to arm this parameter, then move a controller knob to bind it. Click again to cancel.';
  }
}
refreshMapped();

// The ⊙ learn buttons stay out of sight until a controller is connected
// (finding 10): `midi-device` on <body> shows them. No Web MIDI, a refused
// permission or zero inputs all leave them hidden; the MIDI block's status
// line says which.
function setMidiDevices(count) {
  document.body.classList.toggle('midi-device', count > 0);
  if (count === 0 && learnKey) armLearn(learnKey); // disarm a learn nobody can answer
}

let midiDevices = 0;
const midiHandlers = {
  onStatus(text) {
    document.getElementById('midi-status').textContent = text;
  },
  onDevices(count) {
    midiDevices = count;
    setMidiDevices(count);
  },
  onCC(cc, value) {
    if (learnKey) {
      // Unmap any previous CC for this param, then bind.
      for (const c of Object.keys(midiMap)) {
        if (midiMap[c] === learnKey) delete midiMap[c];
      }
      midiMap[cc] = learnKey;
      store.set({ midiMap });
      learnKey = null;
      for (const el of Object.values(learnEls)) el.classList.remove('armed');
      refreshMapped();
      return;
    }
    const key = midiMap[cc];
    if (!key) return;
    const def = defByKey[key];
    if (!def) return;
    if (def.type === 'trigger') {
      const was = lastCC[key] ?? 0;
      lastCC[key] = value;
      if (value >= 64 && was < 64) fireTrigger(key);
      return;
    }
    let v;
    if (def.type === 'toggle') {
      v = value >= 64;
    } else if (def.type === 'select') {
      v = def.options[Math.round((value / 127) * (def.options.length - 1))];
    } else {
      // The CC sweeps the VIEW, so turning a controller up is more of what
      // the row shows (amount up = threshold down).
      v = quantize(def, fromView(def, def.min + (value / 127) * (def.max - def.min)));
    }
    queueWrite(key, v);
    setUI(key, v);
  },
};

// One request per panel: the window and side panel ask at boot; the strip's
// frame asks when MIDI… is clicked (buildMidiButton). Granted, the button
// steps aside and the MIDI line takes over once a device is there (a moment
// of "no device" first if none is); refused, it says so and stays, so the
// player can try again on a page that allows it.
let midiAsk = null;
const startMIDI = () => (midiAsk ??= initMIDI(midiHandlers));

if (!HOSTED) {
  startMIDI();
} else {
  const btn = document.getElementById('midi-connect');
  let flashTimer = 0;
  const flashBtn = (text, then) => {
    clearTimeout(flashTimer);
    btn.textContent = text;
    btn.classList.add('done');
    flashTimer = setTimeout(() => {
      btn.textContent = 'MIDI…';
      btn.classList.remove('done');
      then?.();
    }, 900);
  };
  btn.addEventListener('click', async () => {
    if (midiAsk) return; // already asking, or already granted
    const granted = await startMIDI();
    if (!granted) {
      midiAsk = null; // a refusal can be asked again
      flashBtn('refused');
    } else if (midiDevices > 0) {
      btn.hidden = true;
    } else {
      flashBtn('no device', () => (btn.hidden = true));
    }
  });
}

// --- Audio status line (finding 7): what the active tab is processing ---
// Content scripts post `{type: 'deflection:stats', op: 'put', audio}` to the
// service worker, which keeps the latest per tab (summed over frames). The
// panel asks for the active tab's on open and every 2 s (`op: 'get'`), and
// takes the worker's pushes (`op: 'push'`) between asks. Outside the
// extension — the dev preview, the panel harness — there is no runtime, and
// the line stays empty.

const STATS_TYPE = 'deflection:stats';
const audioStatusEl = document.getElementById('audio-status');
const runtime = typeof chrome !== 'undefined' ? chrome.runtime : undefined;
const canAskStats = !!(runtime?.id && runtime.sendMessage && runtime.onMessage);
let statsTabId = null;
let statsAudio = null;
let statsKnown = false;

function renderAudioStatus() {
  if (!audioStatusEl) return;
  if (!canAskStats || !statsKnown) {
    audioStatusEl.textContent = '';
    return;
  }
  const plural = (n, one, many) => (n === 1 ? one : many);
  let text;
  if (!inputs.enabled.checked) text = 'piece off — sound plays untouched';
  else if (!inputs.audioEnabled.checked) text = 'audio off — sound plays untouched';
  else if (!statsAudio || !statsAudio.taps) text = 'nothing on this page to tap';
  else if (statsAudio.engaged > 0) {
    const n = statsAudio.engaged;
    text = `${n} ${plural(n, 'source', 'sources')} through the body`;
  } else {
    const n = statsAudio.taps;
    text = `${n} ${plural(n, 'source', 'sources')} on this page, ${plural(n, 'not', 'none')} reaching the body`;
  }
  audioStatusEl.textContent = text;
}

onRender('enabled', renderAudioStatus);
onRender('audioEnabled', renderAudioStatus);

if (canAskStats) {
  const ask = () => {
    try {
      Promise.resolve(runtime.sendMessage({ type: STATS_TYPE, op: 'get' }))
        .then((reply) => {
          if (!reply || reply.type !== STATS_TYPE) return;
          statsTabId = reply.tabId ?? null;
          statsAudio = reply.audio ?? null;
          statsKnown = true;
          renderAudioStatus();
        })
        .catch(() => {});
    } catch {
      // the extension was reloaded under this window: stay quiet
    }
  };
  try {
    runtime.onMessage.addListener((msg) => {
      if (msg?.type !== STATS_TYPE || msg.op !== 'push') return;
      if (statsTabId === null || msg.tabId !== statsTabId) return;
      statsAudio = msg.audio ?? null;
      statsKnown = true;
      renderAudioStatus();
    });
  } catch {
    // no listener: the 2 s ask still keeps the line current
  }
  ask();
  setInterval(ask, 2000);
}
renderAudioStatus();
