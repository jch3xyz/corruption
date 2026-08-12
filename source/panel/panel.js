// Control panel. chrome.storage.local is the single source of truth: the
// panel writes (throttled), every content script subscribes via onChanged.
// Outside the extension (dev preview) a local shim stands in for storage so
// the UI is testable in a plain tab.

import { DEFAULTS } from '../content/params.js';
import { initMIDI } from './midi.js';

const DEFS = [
  { key: 'enabled', label: 'enabled', type: 'toggle' },
  { key: 'feedbackVideo', label: 'video feedback', type: 'toggle' },
  { key: 'feedbackImage', label: 'image feedback', type: 'toggle' },
  { key: 'threshold', label: 'threshold', min: 0, max: 1, step: 0.01 },
  { key: 'passes', label: 'sort passes', min: 0, max: 64, step: 1 },
  { key: 'streak', label: 'streak', min: 1, max: 256, step: 1 },
  { key: 'decay', label: 'decay', min: 0.8, max: 0.999, step: 0.001 },
  { key: 'driftX', label: 'drift x', min: -0.01, max: 0.01, step: 0.0005 },
  { key: 'driftY', label: 'drift y', min: -0.01, max: 0.01, step: 0.0005 },
  { key: 'resetMinS', label: 'reset min s', min: 1, max: 30, step: 1 },
  { key: 'resetMaxS', label: 'reset max s', min: 2, max: 60, step: 1 },
  { key: 'maxRes', label: 'max res', min: 480, max: 1920, step: 160 },
  { key: 'maxVideos', label: 'max videos', min: 1, max: 16, step: 1 },
  { key: 'imageFps', label: 'image fps', min: 1, max: 30, step: 1 },
  { key: 'imageAnimCap', label: 'image anim cap', min: 0, max: 24, step: 1 },
  { key: 'textScramble', label: 'text scramble', type: 'toggle' },
  { key: 'textMin', label: 'text min chars', min: 1, max: 40, step: 1 },
  { key: 'audioEnabled', label: 'audio', type: 'toggle' },
  { key: 'audioMix', label: 'audio mix', min: 0, max: 1, step: 0.01 },
  { key: 'audioFeedback', label: 'audio fb', type: 'toggle' },
  { key: 'audioFbDecay', label: 'fb decay', min: 0.8, max: 0.999, step: 0.001 },
  { key: 'audioFbWobble', label: 'fb wobble', min: 0, max: 0.4, step: 0.005 },
  { key: 'audioFbClear', label: 'fb clear', type: 'toggle' },
  { key: 'audioFbClearS', label: 'fb clear s', min: 0, max: 4, step: 0.1 },
  { key: 'audioFbClearMinS', label: 'fb clear min s', min: 1, max: 30, step: 1 },
  { key: 'audioFbClearMaxS', label: 'fb clear max s', min: 2, max: 60, step: 1 },
  { key: 'audioMaxTaps', label: 'max taps', min: 1, max: 8, step: 1 },
  { key: 'audioSustain', label: 'sustain s', min: 2, max: 12, step: 0.5 },
  { key: 'audioDrive', label: 'drive', min: 0, max: 1, step: 0.01 },
  { key: 'audioExciter', label: 'exciter', type: 'select', options: ['gated', 'continuous'] },
];

// The shaping knobs are shared by both feedback modes: live while either
// toggle is on. The image-animation knobs belong to image feedback alone
// (straight-sort stills are static, so the ticker params are moot).
const FEEDBACK_SHARED = ['decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'];
const IMAGE_FEEDBACK_ONLY = ['imageFps', 'imageAnimCap'];

// Audio rows gray out when the audio master toggle is off; the smear rows
// additionally require their own toggles.
const AUDIO_ONLY = [
  'audioMix',
  'audioFeedback',
  'audioFbDecay',
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
  'audioFbWobble',
  'audioFbClear',
  'audioFbClearS',
  'audioFbClearMinS',
  'audioFbClearMaxS',
];
// These need fb clear on too.
const AUDIO_FB_CLEAR_ONLY = ['audioFbClearS', 'audioFbClearMinS', 'audioFbClearMaxS'];

// The text mode's reach only means anything while the mode is on.
const TEXT_ONLY = ['textMin'];

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

const fmt = (def, v) => {
  if (def.type === 'toggle') return v ? 'on' : 'off';
  if (def.type === 'select') return String(v);
  return Number(v).toFixed(decimals(def.step));
};
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
    valueEls[def.key].textContent = fmt(def, v);
    if (def.key === 'feedbackVideo' || def.key === 'feedbackImage') syncFeedbackUI();
    if (def.key === 'textScramble') syncTextUI(input.checked);
    if (['audioEnabled', 'audioFeedback', 'audioFbClear'].includes(def.key)) syncAudioUI();
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
  if (key === 'feedbackVideo' || key === 'feedbackImage') syncFeedbackUI();
  if (key === 'textScramble') syncTextUI(!!v);
  if (['audioEnabled', 'audioFeedback', 'audioFbClear'].includes(key)) syncAudioUI();
}

function syncFeedbackUI() {
  const video = inputs.feedbackVideo.checked;
  const image = inputs.feedbackImage.checked;
  for (const key of FEEDBACK_SHARED) {
    const inert = !video && !image;
    inputs[key].disabled = inert;
    inputs[key].closest('.row').classList.toggle('inert', inert);
  }
  for (const key of IMAGE_FEEDBACK_ONLY) {
    inputs[key].disabled = !image;
    inputs[key].closest('.row').classList.toggle('inert', !image);
  }
}

function syncTextUI(on) {
  for (const key of TEXT_ONLY) {
    inputs[key].disabled = !on;
    inputs[key].closest('.row').classList.toggle('inert', !on);
  }
}

function syncAudioUI() {
  const on = inputs.audioEnabled.checked;
  const fbOn = inputs.audioFeedback.checked;
  const clearOn = inputs.audioFbClear.checked;
  for (const key of AUDIO_ONLY) {
    const inert =
      !on ||
      (AUDIO_FB_ONLY.includes(key) && !fbOn) ||
      (AUDIO_FB_CLEAR_ONLY.includes(key) && !clearOn);
    inputs[key].disabled = inert;
    inputs[key].closest('.row').classList.toggle('inert', inert);
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
    } else if (def.type === 'select') {
      v = def.options[Math.round((value / 127) * (def.options.length - 1))];
    } else {
      v = def.min + (value / 127) * (def.max - def.min);
      if (def.step >= 1) v = Math.round(v);
    }
    queueWrite(key, v);
    setUI(key, v);
  },
});
