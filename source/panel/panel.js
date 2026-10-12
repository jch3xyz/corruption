// Control panel. chrome.storage.local is the single source of truth: the
// panel writes (throttled), every content script subscribes via onChanged.
// Outside the extension (dev preview, panel harness) a local shim stands in
// for storage so the UI is testable in a plain tab.
//
// Four storage keys live OUTSIDE params.js DEFAULTS on purpose, so the
// content scripts (which filter on `key in DEFAULTS`) never see them:
// `midiMap`, `presets` (slots A/B/C), `presetBase` (the last-loaded preset,
// which a row double-click returns to) and `tooltips`. A legacy
// `userDefaults` (the old "set defaults" snapshot) migrates into slot A on
// boot and is removed.

import { DEFAULTS } from '../content/params.js';
import {
  SECTIONS,
  DEFS,
  ROW_HINT,
  NUM_HINT,
  quantize,
  fmtValue,
  fmtNumber,
  defaultFor,
  PRESET_SLOTS,
  PRESET_EXCLUDED,
} from './defs.js';
import { initMIDI } from './midi.js';

const defByKey = Object.fromEntries(DEFS.map((d) => [d.key, d]));
const isNumeric = (def) => def.type !== 'toggle' && def.type !== 'select';

// The feedback shaping knobs are live only while video feedback is on
// (images are one-shot stills; there is no image feedback).
// motionGate lives here: it judges motion via the alpha trail, which only
// exists where a composite runs — without a feedback mode it has nothing
// to read. temperature is NOT here: it bites in straight sort too.
const FEEDBACK_SHARED = ['decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS', 'motionGate'];

// Audio rows gray out when the audio master toggle is off; the smear rows
// additionally require their own toggles.
const AUDIO_ONLY = [
  'audioMix',
  'audioBody',
  'audioDirect',
  'audioBodyMix',
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

// The text mode's reach only means anything while the mode is on.
const TEXT_ONLY = ['textMin'];

// The flow shape knobs only mean anything while flow amount is above zero.
const FLOW_ONLY = ['flowMode', 'flowScale', 'flowSpeed'];

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
const renderers = {};
const onRender = (key, fn) => (renderers[key] ??= []).push(fn);

function buildRow(def) {
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.key = def.key;
  row.dataset.tip = def.tip;
  row.dataset.hint = ROW_HINT;

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
  input.addEventListener('input', () => {
    const v =
      def.type === 'toggle'
        ? input.checked
        : def.type === 'select'
          ? input.value
          : Number(input.value);
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
  // double-clicking inside it still selects the text.
  row.addEventListener('dblclick', (e) => {
    if (e.target === value && isNumeric(def)) return;
    resetParam(def.key);
  });

  row.append(label, input, value, learn);
  inputs[def.key] = input;
  valueEls[def.key] = value;
  learnEls[def.key] = learn;
  rowEls[def.key] = row;
  return row;
}

function buildSection(section) {
  const head = document.createElement('div');
  head.className = 'section';
  head.id = `section-${section.id}`; // jump target for the medium chips
  head.tabIndex = -1;
  head.dataset.section = section.id;
  head.dataset.tip = section.tip;
  const title = document.createElement('h2');
  title.textContent = section.title;
  head.appendChild(title);
  return head;
}

// The tooltips switch is panel furniture rather than a parameter of the
// piece. It sat in the global block until the 2026-10-12 redesign gave that
// block to the A/B, the mediums and the presets; it now lives at the bottom
// beside the MIDI block, as a small row.
function buildTooltipRow() {
  const row = document.createElement('div');
  row.className = 'row pref';
  row.dataset.tip =
    'Show these explanations on hover, anywhere in the panel. Off silences them entirely.';
  row.dataset.hint =
    'A panel preference, not a parameter of the piece — it never reaches the page.';

  const label = document.createElement('label');
  label.textContent = 'tooltips';
  label.htmlFor = 'tooltips';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = 'tooltips';

  const value = document.createElement('span');
  value.className = 'value';
  value.id = 'tooltips-value';

  row.append(label, input, value, document.createElement('span'));
  return row;
}

// --- The A/B (M1): one large button bound to `enabled` ---
// Click latches. Press and hold (> HOLD_MS) bypasses momentarily: the piece
// flips while held and comes back on release, so a stranger can hold to see
// the original and let go to return. Keyboard Space/Enter latch (they arrive
// as a click with detail 0; mouse clicks are handled by the pointer path).
const HOLD_MS = 250;

function buildAB(def) {
  const wrap = document.createElement('div');
  wrap.className = 'ab-row';

  const ab = document.createElement('button');
  ab.className = 'ab';
  ab.id = 'ab';
  ab.dataset.key = def.key;
  ab.dataset.tip = def.tip;
  ab.dataset.hint = 'Click: latch. Hold: compare, release to come back.';
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

  let held = false;
  onRender(def.key, (on) => {
    ab.classList.toggle('on', on);
    ab.classList.toggle('held', held);
    ab.setAttribute('aria-pressed', String(on));
    state.textContent = on ? 'ON' : 'OFF';
    say.textContent = held
      ? on
        ? '— holding: bending · let go to return'
        : '— holding: page untouched · let go to return'
      : on
        ? '— bending the page'
        : '— page untouched';
    globals.classList.toggle('master-off', !on);
  });

  const setEnabled = (v) => {
    queueWrite(def.key, v);
    setUI(def.key, v);
  };

  let timer = 0;
  let pointer = null;
  let heldFrom = null;
  ab.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pointer !== null) return;
    pointer = e.pointerId;
    timer = setTimeout(() => {
      timer = 0;
      held = true;
      heldFrom = inputs[def.key].checked;
      setEnabled(!heldFrom);
    }, HOLD_MS);
  });
  const release = (latch) => (e) => {
    if (pointer === null || e.pointerId !== pointer) return;
    pointer = null;
    if (held) {
      held = false;
      setEnabled(heldFrom); // back to exactly where the hold began
    } else if (timer) {
      clearTimeout(timer);
      timer = 0;
      if (latch) setEnabled(!inputs[def.key].checked);
    }
  };
  ab.addEventListener('pointerup', release(true));
  ab.addEventListener('pointercancel', release(false));
  ab.addEventListener('pointerleave', release(false));
  ab.addEventListener('click', (e) => {
    if (e.detail === 0) setEnabled(!inputs[def.key].checked); // keyboard
  });
  ab.addEventListener('contextmenu', (e) => e.preventDefault()); // long-press on touch

  wrap.append(ab, learn);
  return wrap;
}

// --- The four medium chips (M7): video · images · text · audio ---
// The pill toggles its key; the caption above it jumps to the section that
// shapes that medium. text and audio drive the existing section masters —
// their rows stay canonical, the chips are the fast path.
const CHIPS = [
  { key: 'video', label: 'video', section: 'video' },
  { key: 'images', label: 'images', section: 'video' },
  { key: 'textScramble', label: 'text', section: 'text' },
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

    const name = document.createElement('button');
    name.className = 'chip-name';
    name.textContent = `${chip.label} ↓`;
    const sectionTitle = SECTIONS.find((s) => s.id === chip.section)?.title ?? chip.section;
    name.dataset.tip = `Jump to the ${sectionTitle} section, where ${chip.label} is shaped.`;
    name.addEventListener('click', () => {
      const head = document.getElementById(`section-${chip.section}`);
      head?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      head?.focus({ preventScroll: true });
    });

    const pill = document.createElement('button');
    pill.className = 'chip-toggle';
    pill.dataset.tip = def.tip;
    pill.dataset.hint = 'Click to switch this medium on or off. The big switch above still governs all four.';
    pill.addEventListener('click', () => {
      const v = !inputs[chip.key].checked;
      queueWrite(chip.key, v);
      setUI(chip.key, v);
    });

    // video and images have no section row: the chip is their only face.
    if (!def.section) {
      inputs[chip.key] = { checked: true };
      rowEls[chip.key] = cell;
    }
    onRender(chip.key, (on) => {
      cell.classList.toggle('on', on);
      pill.setAttribute('aria-pressed', String(on));
      pill.textContent = on ? 'on' : 'off';
    });

    cell.append(name, pill);
    strip.appendChild(cell);
  }
  return strip;
}

{
  const bySection = new Map(SECTIONS.map((s) => [s.id, []]));
  const loose = [];
  for (const def of DEFS) {
    const bucket = def.section ? bySection.get(def.section) : null;
    if (def.section && !bucket) console.warn('[panel] unknown section', def.section, def.key);
    (bucket ?? loose).push(def);
  }
  // Sectionless rows are the global block's: the A/B plus the chips. Any
  // other sectionless key would have no face, so it is flagged loudly.
  const chipKeys = new Set(CHIPS.map((c) => c.key));
  for (const def of loose) {
    if (def.key !== 'enabled' && !chipKeys.has(def.key)) {
      console.warn('[panel] sectionless param with no global control', def.key);
    }
  }
  globals.appendChild(buildAB(defByKey.enabled));
  for (const section of SECTIONS) {
    controls.appendChild(buildSection(section));
    for (const def of bySection.get(section.id)) controls.appendChild(buildRow(def));
  }
  globals.appendChild(buildChips()); // after the rows: text/audio chips read their defs
  document.getElementById('prefs').appendChild(buildTooltipRow());
}

function writeValueCell(def, v) {
  const el = valueEls[def.key];
  if (!el) return; // a global toggle with no value cell — its renderer draws it
  if (!isNumeric(def)) {
    el.textContent = fmtValue(def, v);
    return;
  }
  // Don't reformat a half-typed number under the caret — but a value that
  // arrived from somewhere else (MIDI, restore, the other panel window) is
  // news, and a focused field must not sit there showing the old one.
  const typed = parseFloat(el.value);
  const mine = Number.isFinite(typed) && quantize(def, typed) === v;
  if (document.activeElement === el && mine) return;
  el.value = fmtNumber(def, v);
}

function attachNumberField(def, el, slider) {
  const commit = (n) => {
    const v = quantize(def, n);
    slider.value = v;
    queueWrite(def.key, v);
    syncFor(def.key);
    return v;
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
  if (def.type === 'toggle') {
    inputs[key].checked = !!v;
  } else if (def.type === 'select') {
    inputs[key].value = v;
  } else {
    // Snap to the slider's own grid so field, knob and storage agree.
    v = quantize(def, Number(v));
    inputs[key].value = v;
  }
  writeValueCell(def, v);
  for (const fn of renderers[key] ?? []) fn(def.type === 'toggle' ? !!v : v);
  syncFor(key);
}

function syncFor(key) {
  if (key === 'feedbackVideo') syncFeedbackUI();
  else if (key === 'flowAmount') syncFlowUI();
  else if (key === 'textScramble') syncTextUI(inputs.textScramble.checked);
  else if (AUDIO_TRIGGERS.includes(key)) syncAudioUI();
}

function setInert(key, inert) {
  inputs[key].disabled = inert;
  const value = valueEls[key];
  if (value.tagName === 'INPUT') value.disabled = inert;
  rowEls[key].classList.toggle('inert', inert);
}

function syncFeedbackUI() {
  const video = inputs.feedbackVideo.checked;
  for (const key of FEEDBACK_SHARED) setInert(key, !video);
}

function syncFlowUI() {
  const on = Number(inputs.flowAmount.value) > 0;
  for (const key of FLOW_ONLY) setInert(key, !on);
}

function syncTextUI(on) {
  for (const key of TEXT_ONLY) setInert(key, !on);
}

function syncAudioUI() {
  const on = inputs.audioEnabled.checked;
  const fbOn = inputs.audioFeedback.checked;
  const clearOn = inputs.audioFbClear.checked;
  const comb = inputs.audioBody.value === 'comb';
  for (const key of AUDIO_ONLY) {
    setInert(
      key,
      !on ||
        (AUDIO_FB_ONLY.includes(key) && !fbOn) ||
        (AUDIO_FB_CLEAR_ONLY.includes(key) && !clearOn) ||
        (AUDIO_COMB_ONLY.includes(key) && !comb),
    );
  }
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

// --- Presets (M2): original, slots A·B·C, save mode, undo ---
// "original" is the compiled DEFAULTS and nothing can redefine it. The slots
// are snapshots; clicking one LOADS it. Saving is a visible, one-shot mode
// (save… then a slot), so the room slip — meaning to load, pressing save —
// cannot happen. Every load and every restore offers undo for ten seconds.
// The last-loaded preset is the BASE: a row double-click returns there.

const UNDO_MS = 10000;
const presetRow = document.getElementById('presets');
const btnOriginal = document.getElementById('preset-original');
const btnSave = document.getElementById('preset-save');
const btnCancel = document.getElementById('preset-cancel');
const btnUndo = document.getElementById('preset-undo');
const slotEls = Object.fromEntries(
  [...presetRow.querySelectorAll('.slot')].map((el) => [el.dataset.slot, el])
);

const emptyPresets = () => Object.fromEntries(PRESET_SLOTS.map((s) => [s, null]));
const isBase = (name) => name === 'original' || PRESET_SLOTS.includes(name);

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
let presetBase = 'original';
let saveMode = false;
let undoSnap = null;
let undoTimer = 0;
const flashing = new Map(); // button → transient label

{
  const stored = await store.get({ presets: null, presetBase: 'original', userDefaults: null });
  presets = normalisePresets(stored.presets);
  presetBase = isBase(stored.presetBase) ? stored.presetBase : 'original';
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
  presetBase !== 'original' && slotFilled(presetBase) ? presets[presetBase] : null;

function currentValues() {
  const out = {};
  for (const def of DEFS) {
    const input = inputs[def.key];
    out[def.key] =
      def.type === 'toggle' ? input.checked : def.type === 'select' ? input.value : Number(input.value);
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
  const v = defaultFor(key, baseValues());
  if (v === undefined) return;
  queueWrite(key, v);
  setUI(key, v);
  const row = rowEls[key];
  row.classList.remove('flash');
  void row.offsetWidth; // restart the animation on a repeat double-click
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

function renderPresets() {
  presetRow.classList.toggle('saving', saveMode);
  btnOriginal.textContent = flashing.get(btnOriginal) ?? 'original';
  btnOriginal.classList.toggle('base', presetBase === 'original');
  btnOriginal.disabled = saveMode;
  btnOriginal.dataset.hint =
    presetBase === 'original' ? `${BASE_HINT} Undo appears for ten seconds after a restore.` : 'Undo appears for ten seconds afterwards.';

  for (const s of PRESET_SLOTS) {
    const el = slotEls[s];
    const filled = slotFilled(s);
    el.textContent = flashing.get(el) ?? (saveMode ? `save → ${s}` : s);
    el.classList.toggle('empty', !filled && !saveMode);
    el.classList.toggle('base', presetBase === s && filled);
    if (saveMode) {
      el.dataset.tip = filled
        ? `Save the current settings into ${s}, replacing what is there.`
        : `Save the current settings into the empty slot ${s}.`;
      el.dataset.hint = 'Escape or a click elsewhere cancels.';
    } else if (filled) {
      el.dataset.tip = `Load preset ${s}: every setting jumps to what was saved here (the on/off switch stays put).`;
      el.dataset.hint =
        presetBase === s ? `${BASE_HINT} Undo appears for ten seconds after a load.` : 'Undo appears for ten seconds afterwards.';
    } else {
      el.dataset.tip = `Slot ${s} is empty. Click save…, then ${s}, to keep the current settings here.`;
      el.dataset.hint = 'Nothing happens when an empty slot is clicked.';
    }
  }
  btnSave.hidden = saveMode;
  btnCancel.hidden = !saveMode;
  btnUndo.hidden = !undoSnap || saveMode;
}

function setSaveMode(on) {
  saveMode = on;
  renderPresets();
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
  const button = name === 'original' ? btnOriginal : slotEls[name];
  if (name !== 'original' && !slotFilled(name)) {
    flash(button, 'empty');
    return;
  }
  const snap = { values: presetValues(), base: presetBase };
  const source = name === 'original' ? null : presets[name];
  const values = {};
  for (const def of DEFS) values[def.key] = defaultFor(def.key, source);
  applyValues(values);
  setBase(name);
  offerUndo(snap);
  flash(button, name === 'original' ? 'restored' : 'loaded');
}

function saveTo(slot) {
  presets = { ...presets, [slot]: presetValues() };
  store.set({ presets });
  setSaveMode(false);
  flash(slotEls[slot], `saved to ${slot}`);
}

btnOriginal.addEventListener('click', () => {
  if (!saveMode) loadPreset('original');
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
  applyValues(snap.values);
  setBase(snap.base);
  renderPresets();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && saveMode) setSaveMode(false);
});
document.addEventListener(
  'pointerdown',
  (e) => {
    if (saveMode && !presetRow.contains(e.target)) setSaveMode(false);
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

const tipEl = document.getElementById('tooltip');
const tipToggle = document.getElementById('tooltips');
const tipToggleValue = document.getElementById('tooltips-value');
let tooltipsOn = (await store.get({ tooltips: true })).tooltips !== false;
let tipTimer = 0;
let tipHost = null;

function hideTip() {
  clearTimeout(tipTimer);
  tipTimer = 0;
  tipEl.hidden = true;
}

function placeTip(host) {
  tipEl.textContent = '';
  const body = document.createElement('div');
  body.textContent = host.dataset.tip;
  tipEl.appendChild(body);
  if (host.dataset.hint) {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = host.dataset.hint;
    tipEl.appendChild(hint);
  }
  // Measure, then clamp into the (narrow) panel window.
  tipEl.style.left = '0px';
  tipEl.style.top = '0px';
  tipEl.hidden = false;
  const r = host.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(r.left, window.innerWidth - t.width - 8));
  const below = r.bottom + 6;
  const top = below + t.height > window.innerHeight - 8 ? Math.max(8, r.top - t.height - 6) : below;
  tipEl.style.left = `${Math.round(left)}px`;
  tipEl.style.top = `${Math.round(top)}px`;
}

function setTooltips(on) {
  tooltipsOn = on;
  tipToggle.checked = on;
  tipToggleValue.textContent = on ? 'on' : 'off';
  if (!on) hideTip();
}

document.addEventListener('mouseover', (e) => {
  const host = e.target?.closest?.('[data-tip]') ?? null;
  if (host === tipHost) return;
  tipHost = host;
  hideTip();
  if (!tooltipsOn || !host) return;
  tipTimer = setTimeout(() => placeTip(host), 280);
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
      presetBase = isBase(newValue) ? newValue : 'original';
      renderPresets();
    } else if (key === 'tooltips') {
      setTooltips(newValue !== false);
    } else if (key in inputs) {
      setUI(key, newValue);
    }
  }
});

// --- MIDI: CC → param map, persisted; learn-mode per param ---

let midiMap = (await store.get({ midiMap: {} })).midiMap; // { cc: paramKey }
let learnKey = null;

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

initMIDI({
  onStatus(text) {
    document.getElementById('midi-status').textContent = text;
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
    let v;
    if (def.type === 'toggle') {
      v = value >= 64;
    } else if (def.type === 'select') {
      v = def.options[Math.round((value / 127) * (def.options.length - 1))];
    } else {
      v = quantize(def, def.min + (value / 127) * (def.max - def.min));
    }
    queueWrite(key, v);
    setUI(key, v);
  },
});
