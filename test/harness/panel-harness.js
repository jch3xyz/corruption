// Panel harness. The panel grew real logic on 2026-08-20 — four sections,
// value fields you can type into, a saved default set, per-row restore, and
// a tooltip layer — so it gets a suite like every other part of the piece.
//
// Tier 1 is the control table and the value helpers as pure functions.
// Tier 2 drives the SHIPPED panel inside an iframe: panel-frame.html fetches
// source/panel/panel.html so the markup under test can never drift from the
// markup that ships, and stubs chrome.storage.local so the harness can read
// exactly what the panel wrote.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/panel.html

import { DEFAULTS } from '../../source/content/params.js';
import {
  DEFS,
  SECTIONS,
  quantize,
  fmtValue,
  fmtNumber,
  decimals,
  defaultFor,
} from '../../source/panel/defs.js';

const status = document.getElementById('status');
let passCount = 0;
let failCount = 0;

function line(text, cls) {
  const div = document.createElement('div');
  if (cls) div.className = cls;
  div.textContent = text;
  status.appendChild(div);
}

function check(name, ok) {
  line(`${ok ? 'PASS' : 'FAIL'}: ${name}`, ok ? 'pass' : 'fail');
  ok ? passCount++ : failCount++;
}

const tier = (name) => line(name, 'tier');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const numeric = DEFS.filter((d) => d.type !== 'toggle' && d.type !== 'select');
const byKey = Object.fromEntries(DEFS.map((d) => [d.key, d]));

// --- Tier 1: the control table and the value helpers -----------------------

function tier1() {
  tier('tier 1 — control table + value helpers (pure)');

  const keys = DEFS.map((d) => d.key);
  check(
    'every stored parameter has a row in the panel',
    Object.keys(DEFAULTS).every((k) => keys.includes(k))
  );
  check(
    'every panel row maps to a real parameter (no orphan rows)',
    keys.every((k) => k in DEFAULTS)
  );
  check('no parameter appears twice', new Set(keys).size === keys.length);

  check(
    'every row carries hover copy',
    DEFS.every((d) => typeof d.tip === 'string' && d.tip.length > 20)
  );
  check(
    'every section carries hover copy',
    SECTIONS.every((s) => typeof s.tip === 'string' && s.tip.length > 20)
  );

  const declared = new Set(SECTIONS.map((s) => s.id));
  check(
    'every row belongs to a declared section, except the master switch',
    DEFS.every((d) => (d.key === 'enabled' ? !d.section : declared.has(d.section)))
  );
  check(
    'no section is empty',
    SECTIONS.every((s) => DEFS.some((d) => d.section === s.id))
  );

  // The defaults have to be reachable by the slider itself, or the field,
  // the knob and storage would disagree the moment anything is restored.
  const offGrid = numeric.filter((d) => quantize(d, DEFAULTS[d.key]) !== DEFAULTS[d.key]);
  check(
    `every numeric default sits on its own slider grid (${offGrid.map((d) => d.key).join(', ') || 'all clean'})`,
    offGrid.length === 0
  );
  check(
    'every numeric default is inside its own min/max',
    numeric.every((d) => DEFAULTS[d.key] >= d.min && DEFAULTS[d.key] <= d.max)
  );

  check(
    'a typed value below range clamps to min',
    numeric.every((d) => quantize(d, d.min - 1e6) === quantize(d, d.min))
  );
  check(
    'a typed value above range clamps to max',
    numeric.every((d) => quantize(d, d.max + 1e6) === quantize(d, d.max))
  );
  check(
    'clamping lands exactly on the limits',
    quantize(byKey.threshold, 99) === 1 &&
      quantize(byKey.threshold, -99) === 0 &&
      quantize(byKey.driftX, -5) === -0.01 &&
      quantize(byKey.maxRes, 99999) === 1920
  );
  check(
    'a typed value snaps to the step grid',
    quantize(byKey.threshold, 0.0449) === 0.04 &&
      quantize(byKey.threshold, 0.0451) === 0.05 &&
      quantize(byKey.maxRes, 500) === 480 &&
      quantize(byKey.flowScale, 2.4) === 2.5
  );
  check(
    'snapping is idempotent (no float creep on repeat)',
    numeric.every((d) => {
      const once = quantize(d, (d.min + d.max) / 3);
      return quantize(d, once) === once;
    })
  );
  check(
    'no snapped value carries float noise past its own precision',
    numeric.every((d) => {
      const v = quantize(d, (d.min + d.max) / 3);
      return Number(v.toFixed(decimals(d.step))) === v;
    })
  );
  check(
    'values format at their own precision',
    fmtNumber(byKey.driftX, -0.0025) === '-0.0025' &&
      fmtNumber(byKey.decay, 0.81) === '0.810' &&
      fmtNumber(byKey.passes, 64) === '64' &&
      fmtValue(byKey.enabled, true) === 'on' &&
      fmtValue(byKey.flowMode, 'facets') === 'facets'
  );

  check(
    'with no saved set, defaults come from the code',
    DEFS.every((d) => defaultFor(d.key, null) === DEFAULTS[d.key])
  );
  check(
    'a saved set wins over the code defaults',
    defaultFor('threshold', { threshold: 0.42 }) === 0.42
  );
  check(
    'a partial saved set still falls through per key',
    defaultFor('decay', { threshold: 0.42 }) === DEFAULTS.decay
  );
  check(
    'a saved false/0 is honoured, not treated as absent',
    defaultFor('enabled', { enabled: false }) === false &&
      defaultFor('threshold', { threshold: 0 }) === 0
  );

  // The panel's own preferences must not leak into the effect parameters —
  // content scripts filter on `key in DEFAULTS`, and these are not knobs.
  check(
    'panel-only keys stay out of the parameter set',
    !('userDefaults' in DEFAULTS) && !('tooltips' in DEFAULTS) && !('midiMap' in DEFAULTS)
  );
}

// --- Tier 2: the shipped panel, live ---------------------------------------

const frame = document.getElementById('frame');
let win;
let doc;
let store;

const $ = (sel) => doc.querySelector(sel);
const row = (key) => doc.querySelector(`.row[data-key="${key}"]`);
const slider = (key) => row(key).querySelector('input[type=range]');
const field = (key) => row(key).querySelector('input.value.num');

function type(key, text) {
  const el = field(key);
  el.focus();
  el.value = text;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
  return el;
}

function press(el, k, opts = {}) {
  el.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, ...opts }));
}

function fire(el, type_, opts = {}) {
  el.dispatchEvent(new win.MouseEvent(type_, { bubbles: true, ...opts }));
}

async function tier2() {
  tier('tier 2 — the shipped panel, live in an iframe');

  // -- sections --
  const heads = [...doc.querySelectorAll('#controls .section')];
  check(
    'the four sections render in order',
    heads.map((h) => h.querySelector('h2').textContent).join(',') ===
      SECTIONS.map((s) => s.title).join(',')
  );
  check(
    'each section is a divider line with a left-aligned title',
    heads.every((h) => {
      const cs = win.getComputedStyle(h);
      const title = win.getComputedStyle(h.querySelector('h2'));
      return (
        parseFloat(cs.borderTopWidth) > 0 &&
        cs.borderTopStyle === 'solid' &&
        title.textAlign === 'left'
      );
    })
  );

  // Walk the rendered order: every row must sit under its own section, so
  // nothing is scattered between them.
  let currentSection = null;
  const misplaced = [];
  const strayBeforeFirstDivider = [];
  for (const el of $('#controls').children) {
    if (el.classList.contains('section')) {
      currentSection = el.dataset.section;
      continue;
    }
    const key = el.dataset.key;
    if (!currentSection) strayBeforeFirstDivider.push(key ?? el.className);
    const want = byKey[key]?.section ?? null;
    if (want !== currentSection) misplaced.push(key);
  }
  check(
    `every parameter renders under its own section (${misplaced.join(', ') || 'none scattered'})`,
    misplaced.length === 0
  );
  check(
    `nothing sits between the first divider and the top of the sections (${strayBeforeFirstDivider.join(', ') || 'clean'})`,
    strayBeforeFirstDivider.length === 0
  );

  // The global block above the first divider: master switch, tooltips
  // switch, defaults buttons — in that order, and nothing else.
  const globals = [...$('#globals').children];
  check(
    'the global block is the master switch then the tooltips switch',
    globals.length === 2 &&
      globals[0].dataset.key === 'enabled' &&
      globals[1].classList.contains('pref')
  );
  check(
    'the tooltips switch lines up with the parameter row above it',
    win.getComputedStyle(globals[1]).gridTemplateColumns ===
      win.getComputedStyle(globals[0]).gridTemplateColumns
  );
  check(
    'the defaults buttons close the global block, above every divider',
    (() => {
      const body = [...doc.body.children];
      const g = body.indexOf($('#globals'));
      const f = body.indexOf($('#defaults').closest('.footer'));
      const c = body.indexOf($('#controls'));
      return g < f && f < c;
    })()
  );
  check(
    'every parameter in the table reached the DOM',
    DEFS.every((d) => !!row(d.key))
  );

  // -- typed values --
  type('threshold', '0.42');
  await sleep(90);
  check('typing a number moves the knob', Number(slider('threshold').value) === 0.42);
  check('typing a number reaches storage', store.threshold === 0.42);

  type('threshold', '9');
  await sleep(90);
  check(
    'typing above the range clamps to max in field, knob and storage',
    Number(slider('threshold').value) === 1 && store.threshold === 1
  );
  press(field('threshold'), 'Enter');
  check('Enter settles the field text at the step precision', field('threshold').value === '1.00');

  type('driftX', '-99');
  await sleep(90);
  check(
    'typing below the range clamps to min (negative ranges included)',
    Number(slider('driftX').value) === -0.01 && store.driftX === -0.01
  );

  type('flowScale', '2.4');
  press(field('flowScale'), 'Enter');
  await sleep(90);
  check(
    'a typed off-grid value snaps to the step',
    field('flowScale').value === '2.5' && store.flowScale === 2.5
  );

  type('passes', '30');
  press(field('passes'), 'ArrowUp');
  await sleep(90);
  check(
    'arrow up steps the field by one step',
    field('passes').value === '31' && store.passes === 31
  );
  press(field('passes'), 'ArrowDown', { shiftKey: true });
  await sleep(90);
  check('shift+arrow steps by ten', field('passes').value === '21' && store.passes === 21);

  field('passes').blur();

  // -- per-parameter restore --
  type('decay', '0.9');
  await sleep(90);
  fire(row('decay'), 'dblclick');
  await sleep(90);
  check(
    'double-clicking a row restores that parameter to its default',
    store.decay === DEFAULTS.decay &&
      Number(slider('decay').value) === DEFAULTS.decay &&
      field('decay').value === fmtNumber(byKey.decay, DEFAULTS.decay)
  );
  check(
    'and only that parameter — its neighbours are untouched',
    store.threshold === 1 && store.passes === 21
  );
  check('the restored row acknowledges the double-click', row('decay').classList.contains('flash'));

  // A focused field must still show news that arrived from elsewhere —
  // MIDI, a restore, the other panel window — not the number under the caret.
  type('streak', '77');
  await sleep(90);
  win.chrome.storage.local.set({ streak: 128 });
  await sleep(60);
  check(
    'a focused value field follows a change that came from elsewhere',
    field('streak').value === '128' && Number(slider('streak').value) === 128
  );
  field('streak').blur();

  const before = field('threshold').value;
  fire(field('threshold'), 'dblclick');
  await sleep(60);
  check(
    'double-clicking inside a value field does not reset it (text stays selectable)',
    field('threshold').value === before && store.threshold === 1
  );

  // -- saved defaults --
  const btnSet = $('#setdefaults');
  const btnRestore = $('#defaults');
  const btnClear = $('#cleardefaults');

  check('"clear saved" stays hidden until a set has been saved', btnClear.hidden);

  btnSet.click();
  await sleep(60);
  check(
    '"set defaults" captures every live value',
    !!store.userDefaults &&
      store.userDefaults.threshold === 1 &&
      store.userDefaults.passes === 21 &&
      Object.keys(store.userDefaults).length === DEFS.length
  );
  check('"clear saved" appears once a set exists', !btnClear.hidden);

  type('threshold', '0.2');
  await sleep(90);
  btnRestore.click();
  await sleep(90);
  check(
    '"restore defaults" comes back to the saved set, not the code defaults',
    store.threshold === 1 &&
      Number(slider('threshold').value) === 1 &&
      field('threshold').value === '1.00'
  );

  type('threshold', '0.2');
  await sleep(90);
  fire(row('threshold'), 'dblclick');
  await sleep(90);
  check('a double-click restores to the saved value too', store.threshold === 1);

  btnClear.click();
  await sleep(60);
  check(
    '"clear saved" drops the saved set and hides itself',
    store.userDefaults === null && btnClear.hidden
  );
  btnRestore.click();
  await sleep(90);
  check(
    'with the saved set cleared, restore goes back to the code defaults',
    store.threshold === DEFAULTS.threshold && store.passes === DEFAULTS.passes
  );

  // -- tooltips --
  const tip = $('#tooltip');
  fire(row('threshold'), 'mouseover');
  await sleep(420);
  check(
    'hovering a row shows that row’s explanation',
    !tip.hidden && tip.textContent.includes(byKey.threshold.tip.slice(0, 40))
  );
  check(
    'the tooltip names the gesture the row cannot show',
    tip.textContent.toLowerCase().includes('double-click')
  );
  check(
    'the tooltip stays inside the panel window',
    (() => {
      const r = tip.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= win.innerWidth + 1;
    })()
  );

  fire($('#controls'), 'mouseover');
  await sleep(60);
  check('leaving the row hides it again', tip.hidden);

  fire(field('passes'), 'mouseover');
  await sleep(420);
  check(
    'the value field explains that typed values clamp',
    !tip.hidden && tip.textContent.toLowerCase().includes('clamp')
  );

  const toggle = $('#tooltips');
  check('tooltips default to on', toggle.checked);
  toggle.checked = false;
  toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(60);
  check('turning tooltips off hides the current one', tip.hidden);
  fire($('#controls'), 'mouseover');
  fire(row('decay'), 'mouseover');
  await sleep(420);
  check('and suppresses the next one', tip.hidden);
  check('the tooltip preference persists', store.tooltips === false);
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(60);

  // -- everything explains itself --
  const bare = [];
  for (const el of doc.querySelectorAll(
    'h1, .section, .row, .row input.value.num, .learn, .btn, .midi h2, #midi-status, .midi .hint'
  )) {
    if (el.hidden) continue;
    if (!el.dataset.tip || el.dataset.tip.length < 20) bare.push(el.className || el.tagName);
  }
  check(`every control in the panel carries hover copy (${bare.join(', ') || 'all covered'})`, bare.length === 0);

  // -- gating survived the rebuild --
  const audioToggle = row('audioEnabled').querySelector('input');
  audioToggle.checked = false;
  audioToggle.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(60);
  check(
    'the audio master still greys out its section, value fields included',
    row('audioSustain').classList.contains('inert') &&
      slider('audioSustain').disabled &&
      field('audioSustain').disabled
  );
  audioToggle.checked = true;
  audioToggle.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(60);
  check(
    'and hands them back',
    !row('audioSustain').classList.contains('inert') && !field('audioSustain').disabled
  );

  // -- the panel never invents parameters --
  const strays = Object.keys(store).filter(
    (k) => !(k in DEFAULTS) && !['userDefaults', 'tooltips', 'midiMap'].includes(k)
  );
  check(`the panel writes no key the content scripts do not know (${strays.join(', ') || 'none'})`, strays.length === 0);
}

// --- run --------------------------------------------------------------------

(async () => {
  status.innerHTML = '';
  try {
    tier1();
  } catch (e) {
    check(`tier 1 crashed (${e.message})`, false);
  }
  try {
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const poll = () => {
        try {
          if (frame.contentWindow?.__panelReady) return resolve();
        } catch (e) {
          return reject(e);
        }
        if (Date.now() > deadline) return reject(new Error('panel frame never booted'));
        setTimeout(poll, 50);
      };
      poll();
    });
    win = frame.contentWindow;
    doc = win.document;
    store = win.__store;
    await tier2();
  } catch (e) {
    check(`tier 2 crashed (${e.message})`, false);
  }
  const done = document.createElement('div');
  done.id = 'done';
  done.textContent = `COMPLETE: ${passCount} passed, ${failCount} failed`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
})();
