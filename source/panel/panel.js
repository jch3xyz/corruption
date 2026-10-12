// Control panel. chrome.storage.local is the single source of truth: the
// panel writes (throttled), every content script subscribes via onChanged.
// Outside the extension (dev preview, panel harness) a local shim stands in
// for storage so the UI is testable in a plain tab.
//
// Three storage keys live OUTSIDE params.js DEFAULTS on purpose, so the
// content scripts (which filter on `key in DEFAULTS`) never see them:
// `midiMap`, `userDefaults` (John's "set defaults" snapshot) and `tooltips`.

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
// The global block above the first divider: the master switch, the
// tooltips switch, and the defaults buttons (John, 2026-08-20).
const globals = document.getElementById('globals');
const inputs = {};
const valueEls = {};
const learnEls = {};
const rowEls = {};

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
  head.dataset.section = section.id;
  head.dataset.tip = section.tip;
  const title = document.createElement('h2');
  title.textContent = section.title;
  head.appendChild(title);
  return head;
}

// The tooltips switch is panel furniture rather than a parameter of the
// piece — but it belongs with `enabled` in the de facto global block at the
// top (John, 2026-08-20), not tucked into the footer.
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

// `enabled` carries no section — it is the master switch for all three, so
// it goes in the global block rather than inside any one of them.
{
  const bySection = new Map(SECTIONS.map((s) => [s.id, []]));
  const loose = [];
  for (const def of DEFS) {
    const bucket = def.section ? bySection.get(def.section) : null;
    if (def.section && !bucket) console.warn('[panel] unknown section', def.section, def.key);
    (bucket ?? loose).push(def);
  }
  for (const def of loose) globals.appendChild(buildRow(def));
  globals.appendChild(buildTooltipRow());
  for (const section of SECTIONS) {
    controls.appendChild(buildSection(section));
    for (const def of bySection.get(section.id)) controls.appendChild(buildRow(def));
  }
}

function writeValueCell(def, v) {
  const el = valueEls[def.key];
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

// --- Defaults: John's saved set first, the code DEFAULTS behind it ---

let userDefaults = (await store.get({ userDefaults: null })).userDefaults ?? null;

function currentValues() {
  const out = {};
  for (const def of DEFS) {
    const input = inputs[def.key];
    out[def.key] =
      def.type === 'toggle' ? input.checked : def.type === 'select' ? input.value : Number(input.value);
  }
  return out;
}

function resetParam(key) {
  const v = defaultFor(key, userDefaults);
  if (v === undefined) return;
  queueWrite(key, v);
  setUI(key, v);
  const row = rowEls[key];
  row.classList.remove('flash');
  void row.offsetWidth; // restart the animation on a repeat double-click
  row.classList.add('flash');
}

const btnRestore = document.getElementById('defaults');
const btnSet = document.getElementById('setdefaults');
const btnClear = document.getElementById('cleardefaults');

function refreshDefaultsUI() {
  const saved = !!userDefaults;
  btnClear.hidden = !saved;
  btnRestore.dataset.tip = saved
    ? 'Put every parameter back to your saved defaults — the set you captured with "set defaults".'
    : 'Put every parameter back to the built-in defaults compiled into the extension.';
}

function flash(button, text) {
  const original = button.textContent;
  button.textContent = text;
  button.classList.add('done');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('done');
  }, 900);
}

btnRestore.addEventListener('click', () => {
  const values = {};
  for (const def of DEFS) values[def.key] = defaultFor(def.key, userDefaults);
  store.set(values);
  for (const def of DEFS) setUI(def.key, values[def.key]);
});

// Capture the room's settings without a recompile (John, 2026-08-20): the
// live panel becomes the default set, which "restore defaults" and every
// double-click then return to.
btnSet.addEventListener('click', () => {
  userDefaults = currentValues();
  store.set({ userDefaults });
  refreshDefaultsUI();
  flash(btnSet, 'saved');
});

btnClear.addEventListener('click', () => {
  userDefaults = null;
  store.set({ userDefaults: null });
  refreshDefaultsUI();
  flash(btnClear, 'cleared');
});

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
refreshDefaultsUI();
setTooltips(tooltipsOn);

store.onChanged((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key === 'userDefaults') {
      userDefaults = newValue ?? null;
      refreshDefaultsUI();
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
