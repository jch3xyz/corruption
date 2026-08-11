// Control panel. chrome.storage.local is the single source of truth: the
// panel writes (throttled), every content script subscribes via onChanged.
// Outside the extension (dev preview) a local shim stands in for storage so
// the UI is testable in a plain tab.

import { DEFAULTS } from '../content/params.js';
import { initMIDI } from './midi.js';

const DEFS = [
  { key: 'enabled', label: 'enabled', type: 'toggle' },
  { key: 'feedback', label: 'feedback', type: 'toggle' },
  { key: 'threshold', label: 'threshold', min: 0, max: 1, step: 0.01 },
  { key: 'passes', label: 'sort passes', min: 0, max: 64, step: 1 },
  { key: 'streak', label: 'streak', min: 1, max: 256, step: 1 },
  { key: 'decay', label: 'decay', min: 0.8, max: 0.999, step: 0.001 },
  { key: 'driftX', label: 'drift x', min: -0.01, max: 0.01, step: 0.0005 },
  { key: 'driftY', label: 'drift y', min: -0.01, max: 0.01, step: 0.0005 },
  { key: 'resetMinS', label: 'reset min s', min: 1, max: 30, step: 1 },
  { key: 'resetMaxS', label: 'reset max s', min: 2, max: 60, step: 1 },
  { key: 'maxRes', label: 'max res', min: 480, max: 1920, step: 160 },
];

// These only shape the effect while feedback is on; gray them out otherwise.
const FEEDBACK_ONLY = ['decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'];

const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
const shim = { data: { ...DEFAULTS }, listeners: [] };

const store = {
  async get(defaults) {
    if (hasChrome) return chrome.storage.local.get(defaults);
    return { ...defaults, ...shim.data };
  },
  set(values) {
    if (hasChrome) return chrome.storage.local.set(values);
    Object.assign(shim.data, values);
  },
  onChanged(fn) {
    if (hasChrome) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local') fn(changes);
      });
    }
  },
};

// --- Build the UI ---

const controls = document.getElementById('controls');
const inputs = {};
const valueEls = {};
const learnEls = {};

const fmt = (def, v) =>
  def.type === 'toggle' ? (v ? 'on' : 'off') : Number(v).toFixed(decimals(def.step));
const decimals = (step) => {
  const s = String(step ?? 1);
  return s.includes('.') ? s.split('.')[1].length : 0;
};

for (const def of DEFS) {
  const row = document.createElement('div');
  row.className = 'row';

  const label = document.createElement('label');
  label.textContent = def.label;

  let input;
  if (def.type === 'toggle') {
    input = document.createElement('input');
    input.type = 'checkbox';
  } else {
    input = document.createElement('input');
    input.type = 'range';
    input.min = def.min;
    input.max = def.max;
    input.step = def.step;
  }
  input.addEventListener('input', () => {
    const v = def.type === 'toggle' ? input.checked : Number(input.value);
    queueWrite(def.key, v);
    valueEls[def.key].textContent = fmt(def, v);
    if (def.key === 'feedback') syncFeedbackUI(input.checked);
  });

  const value = document.createElement('span');
  value.className = 'value';

  const learn = document.createElement('button');
  learn.className = 'learn';
  learn.textContent = '⊙';
  learn.title = 'MIDI learn';
  learn.addEventListener('click', () => armLearn(def.key));

  row.append(label, input, value, learn);
  controls.appendChild(row);
  inputs[def.key] = input;
  valueEls[def.key] = value;
  learnEls[def.key] = learn;
}

function setUI(key, v) {
  const def = DEFS.find((d) => d.key === key);
  if (!def) return;
  if (def.type === 'toggle') inputs[key].checked = !!v;
  else inputs[key].value = v;
  valueEls[key].textContent = fmt(def, v);
  if (key === 'feedback') syncFeedbackUI(!!v);
}

function syncFeedbackUI(on) {
  for (const key of FEEDBACK_ONLY) {
    inputs[key].disabled = !on;
    inputs[key].closest('.row').classList.toggle('inert', !on);
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

// --- Hydrate, subscribe, defaults ---

const current = await store.get(DEFAULTS);
for (const def of DEFS) setUI(def.key, current[def.key]);

store.onChanged((changes) => {
  for (const [key, { newValue }] of Object.entries(changes)) {
    if (key in inputs) setUI(key, newValue);
  }
});

document.getElementById('defaults').addEventListener('click', () => {
  const values = {};
  for (const def of DEFS) values[def.key] = DEFAULTS[def.key];
  store.set(values);
  for (const def of DEFS) setUI(def.key, DEFAULTS[def.key]);
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
    const def = DEFS.find((d) => d.key === key);
    if (!def) return;
    let v;
    if (def.type === 'toggle') {
      v = value >= 64;
    } else {
      v = def.min + (value / 127) * (def.max - def.min);
      if (def.step >= 1) v = Math.round(v);
    }
    queueWrite(key, v);
    setUI(key, v);
  },
});
