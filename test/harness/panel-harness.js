// Panel harness. The panel grew real logic on 2026-08-20 — sections,
// value fields you can type into, a saved default set, per-row restore, and
// a tooltip layer — so it gets a suite like every other part of the piece.
//
// Tier 1 is the control table and the value helpers as pure functions.
// Tier 2 drives the SHIPPED panel inside an iframe: panel-frame.html fetches
// source/panel/panel.html so the markup under test can never drift from the
// markup that ships, and stubs chrome.storage.local so the harness can read
// exactly what the panel wrote.
//
// 2026-10-12: the global block was redesigned (design review M1/M2/M3/M7):
// title + subtitle + shortcuts, a large A/B with hold-to-bypass, four medium
// chips, and presets (immutable original, slots A/B/C behind a save mode,
// undo after every load). The old "set defaults" snapshot migrates to A.
//
// 2026-10-12, later (M4/M8 + round-1 findings 6–10): Video and Audio regroup
// into effect / effect / engine with the engine folded away (`engineOpen`),
// labels in the player's vocabulary (keys unchanged), an audio status line,
// gate captions on inert rows, ⊙ hidden until a MIDI device appears, the
// slider out of the row double-click, clamp flashes, and the tooltip moved
// to a fixed strip under the scroller.
//
// Round 3 (three heuristic reviewers): the A/B latches on any press under
// 600 ms and only a longer hold is a momentary compare; "original" is now
// "default", under a PRESETS caption, with the base marked by a dot; the
// strip rests at one line and grows over the rows on hover without moving
// them; mix leads the audio body and dry moved to the engine; save mode
// says "replace A" and a save-over can be undone; the chips land and flash;
// the Video rows name the medium switch that would wake them.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/panel.html

import { DEFAULTS } from '../../source/content/params.js';
import {
  DEFS,
  SECTIONS,
  GROUPS,
  quantize,
  fmtValue,
  fmtNumber,
  decimals,
  defaultFor,
  PRESET_SLOTS,
  PRESET_EXCLUDED,
  PANEL_HOME,
  PANEL_HOMES,
} from '../../source/panel/defs.js';

// Keys the panel may store that are NOT parameters: panel furniture and the
// preset store. Excluded from "every stored key has a row". `panelHome` is
// where the panel opens (M9); `stripOpen` is written by the in-page strip.
const PANEL_ONLY = ['tooltips', 'midiMap', 'presets', 'presetBase', 'engineOpen', 'panelHome', 'stripOpen'];
// Sectionless rows: the global block's own controls.
const GLOBAL_KEYS = ['enabled', 'video', 'images'];
// The chips, in order, and the key each one drives.
const CHIP_KEYS = ['video', 'images', 'textScramble', 'audioEnabled'];

// The regrouped sections (design review M4/M8), in render order: rows that
// sit above the groups, then each group's rows. Key → the player's label.
const LAYOUT = {
  video: {
    loose: [],
    groups: [
      ['sort', ['threshold', 'flowAmount', 'flowMode', 'flowScale', 'flowSpeed', 'temperature']],
      ['feedback', ['feedbackVideo', 'motionGate', 'decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS']],
      ['engine', ['passes', 'streak', 'maxRes', 'maxVideos']],
    ],
  },
  text: { loose: ['textScramble', 'textMin'], groups: [] },
  audio: {
    loose: ['audioEnabled'],
    groups: [
      ['body', ['audioMix', 'audioBodyMix', 'audioBody', 'audioSustain', 'audioDrive']],
      ['smear', ['audioFeedback', 'audioFbDecay', 'audioFbReturn', 'audioFbWobble']],
      [
        'engine',
        ['audioDirect', 'audioMaxTaps', 'audioExciter', 'audioCombDamp', 'audioFbClear', 'audioFbClearS', 'audioFbClearMinS', 'audioFbClearMaxS'],
      ],
    ],
  },
};
const LABELS = {
  threshold: 'threshold', flowAmount: 'flow', flowMode: 'flow mode', flowScale: 'flow scale',
  flowSpeed: 'flow speed', temperature: 'jitter',
  feedbackVideo: 'feedback', motionGate: 'motion gate', decay: 'decay', driftX: 'drift x',
  driftY: 'drift y', resetMinS: 'clear min s', resetMaxS: 'clear max s',
  passes: 'sort passes', streak: 'streak', maxRes: 'max res', maxVideos: 'max videos',
  audioEnabled: 'audio',
  audioBodyMix: 'body amount', audioBody: 'body type', audioSustain: 'ring time',
  audioDrive: 'drive', audioDirect: 'dry',
  audioFeedback: 'smear', audioFbDecay: 'tail', audioFbReturn: 'return', audioFbWobble: 'wobble',
  audioMix: 'mix', audioMaxTaps: 'max sources', audioExciter: 'exciter',
  audioCombDamp: 'comb damp', audioFbClear: 'smear clear', audioFbClearS: 'clear fade s',
  audioFbClearMinS: 'clear min s', audioFbClearMaxS: 'clear max s',
};
// Changelog has no place in hover copy (finding 6).
const CHANGELOG = /since the detangle|until 20\d\d|pre-20\d\d|old synth|the old behaviour|20\d\d-\d\d-\d\d/i;

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

const defsSection = (key) => byKey[key].section;

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
    'every row belongs to a declared section, except the global block (A/B, video, images)',
    DEFS.every((d) => (GLOBAL_KEYS.includes(d.key) ? !d.section : declared.has(d.section)))
  );
  check(
    'the per-medium switches exist as on-by-default toggles',
    DEFAULTS.video === true &&
      DEFAULTS.images === true &&
      byKey.video?.type === 'toggle' &&
      byKey.images?.type === 'toggle'
  );
  check(
    'every grouped row names a group declared for its own section',
    DEFS.filter((d) => d.group).every((d) => GROUPS.some((g) => g.section === d.section && g.id === d.group))
  );
  check(
    'every group carries hover copy, and only the engines fold away',
    GROUPS.every((g) => typeof g.tip === 'string' && g.tip.length > 20) &&
      GROUPS.filter((g) => g.collapsible).map((g) => `${g.section}.${g.id}`).join() === 'video.engine,audio.engine'
  );
  {
    const wantOrder = Object.entries(LAYOUT).flatMap(([, l]) => [...l.loose, ...l.groups.flatMap(([, keys]) => keys)]);
    const haveOrder = DEFS.filter((d) => d.section).map((d) => d.key);
    check('the control table lists every section row in the stated group order', haveOrder.join() === wantOrder.join());
    const wantGroups = Object.values(LAYOUT).flatMap((l) => [
      ...l.loose.map((k) => [k, undefined]),
      ...l.groups.flatMap(([g, keys]) => keys.map((k) => [k, g])),
    ]);
    const wrongGroup = wantGroups.filter(([k, g]) => byKey[k]?.group !== g).map(([k]) => k);
    check(`every row sits in its stated group (${wrongGroup.join(', ') || 'all'})`, wrongGroup.length === 0);
  }
  {
    const wrong = Object.entries(LABELS).filter(([k, l]) => byKey[k]?.label !== l).map(([k]) => k);
    check(`Video and Audio rows carry the player’s labels (${wrong.join(', ') || 'all'})`, wrong.length === 0);
  }
  check(
    'the labels are the stranger’s, not the machine’s (no fb, taps, direct, temperature, sustain)',
    DEFS.every((d) => !/\bfb\b|taps|direct|temperature|sustain|body mix|audio mix/.test(d.label))
  );
  {
    const dated = DEFS.filter((d) => CHANGELOG.test(d.tip)).map((d) => d.key);
    check(`no tip carries changelog (${dated.join(', ') || 'clean'})`, dated.length === 0);
  }
  check(
    'the tips the review named lead with what you see or hear',
    byKey.threshold.tip.startsWith('Lower = more of the picture is sorted. 0 tears everything but true black; 1 leaves it untouched. The most expressive knob.') &&
      byKey.temperature.tip.startsWith('Random swaps on top of the sort. 0 = clean ribbons; up = grain and shimmer.') &&
      byKey.motionGate.tip.startsWith('Only moving parts get sorted. 0 = everything; 1 = only what moves. A wet/dry for motion.') &&
      byKey.audioBodyMix.tip.startsWith('How much of the resonant body you hear against the source. 0 = source only, 2 = all body.') &&
      byKey.audioDirect.tip.startsWith('The untouched source mixed back in. Up = intelligible again, which defeats the piece; kept for comparison.') &&
      byKey.audioMix.tip.startsWith('Wet/dry for the whole sound. 0 = the sound exactly as transmitted, 1 = all apparatus.')
  );
  check('threshold shows its direction at the slider ends (more · less)', byKey.threshold.ends?.join() === 'more,less');
  check(
    'presets are three slots and never capture the A/B',
    PRESET_SLOTS.join() === 'A,B,C' && PRESET_EXCLUDED.includes('enabled')
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
    'with "default" as the base, defaults come from the code',
    DEFS.every((d) => defaultFor(d.key, null) === DEFAULTS[d.key])
  );
  check(
    'a base preset wins over the code defaults',
    defaultFor('threshold', { threshold: 0.42 }) === 0.42
  );
  check(
    'a partial base preset still falls through per key',
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
    !('userDefaults' in DEFAULTS) && PANEL_ONLY.every((k) => !(k in DEFAULTS))
  );
  check(
    'panelHome is a panel preference: not a parameter, no row in the table, excluded from the row check',
    !('panelHome' in DEFAULTS) &&
      !('stripOpen' in DEFAULTS) &&
      PANEL_ONLY.includes('panelHome') &&
      !DEFS.some((d) => d.key === 'panelHome' || d.key === 'stripOpen')
  );
  check(
    'panelHome offers window · side · strip, defaults to the window, and its tip says when a change applies',
    PANEL_HOME.key === 'panelHome' &&
      PANEL_HOMES.join() === 'window,side,strip' &&
      PANEL_HOME.default === 'window' &&
      PANEL_HOME.tip.length > 20 &&
      /next time/i.test(PANEL_HOME.tip)
  );
  check(
    '"every stored key has a row" ignores the preset store and panel prefs',
    Object.keys({ ...DEFAULTS, ...Object.fromEntries(PANEL_ONLY.map((k) => [k, 1])) })
      .filter((k) => !PANEL_ONLY.includes(k))
      .every((k) => DEFS.some((d) => d.key === k))
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

function pointer(el, type_, opts = {}) {
  el.dispatchEvent(
    new win.PointerEvent(type_, { bubbles: true, pointerId: 1, button: 0, isPrimary: true, ...opts })
  );
}

const chip = (key) => doc.querySelector(`.chip[data-key="${key}"]`);
const text = (el) => el.textContent.trim();

async function bootFrame(src, w = 400, h = 720) {
  const f = document.createElement('iframe');
  // content-box: the panel inside gets exactly w × h.
  f.style.cssText = `width:${w}px;height:${h}px;border:1px solid #2e2e36;margin-left:8px;box-sizing:content-box`;
  f.src = src;
  document.getElementById('stage').appendChild(f);
  const deadline = Date.now() + 8000;
  while (!f.contentWindow?.__panelReady) {
    if (Date.now() > deadline) throw new Error(`${src} never booted`);
    await sleep(50);
  }
  return f;
}

async function tier2() {
  tier('tier 2 — the shipped panel, live in an iframe');

  // -- sections --
  const heads = [...doc.querySelectorAll('#controls .section')];
  check(
    'the sections render in order',
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
  for (const el of $('#controls').querySelectorAll('.section, .row')) {
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

  // The global block above the first divider (2026-10-12): title line, the
  // A/B, the four medium chips — then the preset row and its note — and
  // nothing else; the tooltips switch moved down beside MIDI.
  const globals = [...$('#globals').children];
  check(
    'the global block is the A/B then the four medium chips',
    globals.length === 2 &&
      globals[0].classList.contains('ab-row') &&
      globals[1].classList.contains('chips')
  );
  check(
    'the title line names the piece, says what it does, and shows both shortcuts',
    text($('h1')) === 'CORRUPTION' &&
      $('.masthead .lede')?.textContent.includes('Switch it off') &&
      /Ctrl\+Shift\+D\s+on\/off/.test($('#keys').textContent) &&
      /Ctrl\+Shift\+P\s+this panel/.test($('#keys').textContent)
  );
  const ab = $('#ab');
  check(
    'the A/B is one full-width button bound to enabled, with its MIDI learn beside it',
    ab?.tagName === 'BUTTON' &&
      ab.dataset.key === 'enabled' &&
      ab.getBoundingClientRect().width > 0.8 * $('#globals').getBoundingClientRect().width &&
      !!$('.ab-row .learn')
  );
  check(
    'the A/B dominates: taller than any other control in the panel',
    (() => {
      const h = ab.getBoundingClientRect().height;
      return [...doc.querySelectorAll('.btn, .chip-toggle, .row')].every(
        (el) => el.getBoundingClientRect().height * 1.6 < h
      );
    })()
  );
  check(
    'the A/B reads ON in yellow at rest',
    ab.classList.contains('on') &&
      text(ab).startsWith('ON') &&
      win.getComputedStyle(ab).backgroundColor === 'rgb(232, 232, 100)'
  );
  check(
    'the chips are video · images · text · audio, each bound to its key',
    [...doc.querySelectorAll('.chips .chip')].map((c) => c.dataset.key).join() === CHIP_KEYS.join() &&
      [...doc.querySelectorAll('.chip-name')].map((c) => text(c).replace(/\W+$/, '')).join() ===
        'video,images,text,audio'
  );
  check(
    'every chip shows itself on at rest (filled)',
    CHIP_KEYS.every((k) => chip(k).classList.contains('on'))
  );
  check(
    'the presets close the global block, above every divider',
    (() => {
      const body = [...$('#globals').parentElement.children];
      const g = body.indexOf($('#globals'));
      const p = body.indexOf($('#presets'));
      const n = body.indexOf($('#persist-note'));
      const c = body.indexOf($('#controls'));
      return g < p && p < n && n < c;
    })()
  );
  check(
    'the preset row is default · A · B · C · save…, and nothing else shows',
    [...$('#presets').children].filter((b) => !b.hidden).map(text).join() === 'default,A,B,C,save…'
  );
  check(
    'the row carries a small muted PRESETS caption, styled like the group captions',
    (() => {
      const cap = $('#presets-head');
      if (!cap || cap.nextElementSibling !== $('#presets')) return false;
      const a = win.getComputedStyle(cap);
      const b = win.getComputedStyle(doc.querySelector('#controls div.group-head'));
      return text(cap) === 'presets' && a.textTransform === 'uppercase' && a.fontSize === b.fontSize && a.color === b.color;
    })()
  );
  check(
    'the base preset is marked by a small dot, not a pressed look: no button in the row differs in fill or edge',
    (() => {
      const base = $('#preset-default');
      const dot = win.getComputedStyle(base, '::before');
      const cs = win.getComputedStyle(base);
      const plain = win.getComputedStyle($('#preset-save'));
      return (
        base.classList.contains('base') &&
        dot.content !== 'none' && dot.backgroundColor === 'rgb(232, 232, 100)' && parseFloat(dot.width) <= 6 &&
        cs.boxShadow === 'none' &&
        cs.backgroundColor === plain.backgroundColor &&
        cs.borderTopColor === plain.borderTopColor
      );
    })()
  );
  check(
    'one line says changes persist and presets are snapshots',
    /kept automatically/.test($('#persist-note').textContent) &&
      /snapshots/.test($('#persist-note').textContent)
  );
  check(
    'the old defaults buttons are gone',
    !$('#defaults') && !$('#setdefaults') && !$('#cleardefaults')
  );
  const prefRow = $('#prefs .row.pref');
  check(
    'the tooltips switch sits at the bottom, after the MIDI block',
    !!prefRow &&
      !!$('#tooltips') &&
      (doc.querySelector('.midi').compareDocumentPosition(prefRow) & win.Node.DOCUMENT_POSITION_FOLLOWING) !== 0
  );
  check(
    'the tooltips switch lines up with the parameter rows',
    win.getComputedStyle(prefRow).gridTemplateColumns ===
      win.getComputedStyle(row('threshold')).gridTemplateColumns
  );
  // -- where the panel lives (M9): the second pref, beside tooltips --
  {
    const homeRow = $('#prefs .row.pref[data-pref="panelHome"]');
    const sel = homeRow?.querySelector('select');
    check(
      'the "panel lives in" row sits in the prefs block, right after tooltips',
      !!homeRow && homeRow.previousElementSibling === prefRow && text(homeRow.querySelector('label')) === 'panel lives in'
    );
    check(
      'it offers the three homes, window first and selected',
      !!sel && [...sel.options].map((o) => o.value).join() === 'window,side,strip' && sel.value === 'window'
    );
    check(
      'it carries a tip that says a change applies on the next open',
      homeRow?.dataset.tip?.length > 20 && /next time/i.test(homeRow.dataset.tip)
    );
    check(
      'it lines up with the tooltips switch and the parameter rows',
      win.getComputedStyle(homeRow).gridTemplateColumns === win.getComputedStyle(row('threshold')).gridTemplateColumns
    );
    check('choosing nothing writes nothing', !('panelHome' in store));
    sel.value = 'strip';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await sleep(40);
    check('choosing a home stores it as panelHome', store.panelHome === 'strip');
    win.chrome.storage.local.set({ panelHome: 'side' });
    await sleep(40);
    check('a panelHome change from elsewhere is followed', sel.value === 'side');
    win.chrome.storage.local.set({ panelHome: 'nonsense' });
    await sleep(40);
    check('an unknown stored home reads as the window', sel.value === 'window');
    sel.value = 'window';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await sleep(40);
    check('and the window can be chosen back', store.panelHome === 'window');
  }
  check(
    'every section header is a jump target',
    SECTIONS.every((sec) => doc.getElementById(`section-${sec.id}`)?.classList.contains('section'))
  );
  check(
    'every parameter with a section reached the DOM as a row',
    DEFS.filter((d) => d.section).every((d) => !!row(d.key))
  );
  check(
    'nothing in the panel overflows its 400 px window',
    doc.documentElement.scrollWidth <= win.innerWidth && $('#scroll').scrollWidth <= $('#scroll').clientWidth
  );

  // -- groups (M4/M8) --
  {
    const misgrouped = [];
    for (const [sectionId, l] of Object.entries(LAYOUT)) {
      const head = doc.getElementById(`section-${sectionId}`);
      // Rows between this header and the next, in document order.
      const rowsAfter = [...doc.querySelectorAll('#controls .section, #controls .row')];
      const from = rowsAfter.indexOf(head);
      const until = rowsAfter.findIndex((el, i) => i > from && el.classList.contains('section'));
      const inSection = rowsAfter.slice(from + 1, until < 0 ? undefined : until).map((r) => r.dataset.key);
      const want = [...l.loose, ...l.groups.flatMap(([, keys]) => keys)];
      if (inSection.join() !== want.join()) misgrouped.push(`${sectionId} order`);
      const loose = inSection.filter((k) => !row(k).closest('.group'));
      if (loose.join() !== l.loose.join()) misgrouped.push(`${sectionId} loose rows`);
      const groupEls = [...doc.querySelectorAll(`#controls .group[data-section="${sectionId}"]`)];
      if (groupEls.map((g) => g.dataset.group).join() !== l.groups.map(([g]) => g).join()) {
        misgrouped.push(`${sectionId} groups`);
      }
      for (const [gid, keys] of l.groups) {
        const g = groupEls.find((el) => el.dataset.group === gid);
        const have = g ? [...g.querySelectorAll('.row')].map((r) => r.dataset.key) : [];
        if (have.join() !== keys.join()) misgrouped.push(`${sectionId}.${gid}`);
      }
    }
    check(
      `every row renders inside its group, in the stated order (${misgrouped.join(', ') || 'all in place'})`,
      misgrouped.length === 0
    );
  }
  check(
    'each group shows a small caption: sort · feedback · engine, body · smear · engine',
    [...doc.querySelectorAll('#controls .group-head')].map((h) => text(h).replace(/\s*[▸▾]$/, '')).join() ===
      'sort,feedback,engine,body,smear,engine'
  );
  check(
    'the rendered labels are the player’s',
    Object.entries(LABELS).every(([k, l]) => text(row(k).querySelector('label')) === l)
  );
  check(
    'the audio master stays first in its section, above the groups',
    (() => {
      const head = $('#section-audio');
      const next = head.nextElementSibling;
      return next?.dataset.key === 'audioEnabled' && next.nextElementSibling?.classList.contains('group');
    })()
  );
  check(
    'threshold shows "more" and "less" at its slider ends without hovering',
    (() => {
      const caps = [...row('threshold').querySelectorAll('.cap')];
      const r = slider('threshold').getBoundingClientRect();
      return (
        caps.map(text).join() === 'more,less' &&
        caps[0].getBoundingClientRect().right <= r.left + 1 &&
        caps[1].getBoundingClientRect().left >= r.right - 1 &&
        caps.every((c) => c.getBoundingClientRect().width > 0)
      );
    })()
  );

  const engineHead = (sec) => doc.querySelector(`#controls .group[data-section="${sec}"][data-group="engine"] .group-head`);
  const ENGINE_KEYS = {
    video: LAYOUT.video.groups.find(([g]) => g === 'engine')[1],
    audio: LAYOUT.audio.groups.find(([g]) => g === 'engine')[1],
  };
  const shown = (el) => !!el && el.getClientRects().length > 0;
  check(
    'both engine groups start folded, labelled "engine ▸"',
    ['video', 'audio'].every(
      (sec) => text(engineHead(sec)) === 'engine ▸' && engineHead(sec).getAttribute('aria-expanded') === 'false'
    )
  );
  check(
    'folded engine rows still exist in the DOM (so every param keeps its row), just out of sight',
    ['video', 'audio'].every((sec) => ENGINE_KEYS[sec].every((k) => !!row(k) && !shown(row(k))))
  );
  check('a folded engine writes nothing on boot', !('engineOpen' in store));
  engineHead('video').click();
  await sleep(60);
  check(
    'clicking the disclosure unfolds the video engine and says so (▾)',
    text(engineHead('video')) === 'engine ▾' &&
      ENGINE_KEYS.video.every((k) => shown(row(k))) &&
      ENGINE_KEYS.audio.every((k) => !shown(row(k)))
  );
  check(
    'the open state persists as engineOpen {video, audio}',
    store.engineOpen?.video === true && store.engineOpen?.audio === false
  );
  engineHead('audio').click();
  await sleep(60);
  engineHead('video').click();
  await sleep(60);
  check(
    'each engine folds and unfolds on its own, and storage follows',
    store.engineOpen?.video === false &&
      store.engineOpen?.audio === true &&
      ENGINE_KEYS.audio.every((k) => shown(row(k))) &&
      ENGINE_KEYS.video.every((k) => !shown(row(k)))
  );
  win.chrome.storage.local.set({ engineOpen: { video: true, audio: true } });
  await sleep(60);
  check(
    'an engineOpen change from elsewhere (the other panel window) is followed',
    text(engineHead('video')) === 'engine ▾' && ENGINE_KEYS.video.every((k) => shown(row(k)))
  );

  // -- the audio status line --
  check(
    'the audio status line sits under the Audio header, and is empty without chrome.runtime',
    !win.chrome.runtime &&
      $('#section-audio #audio-status') !== null &&
      $('#audio-status').textContent === '' &&
      !shown($('#audio-status'))
  );

  // -- MIDI learn hidden until a device is present --
  const learns = [...doc.querySelectorAll('.learn')];
  check(
    'with no MIDI device every ⊙ is hidden, the A/B’s too, and the status says "no device"',
    !doc.body.classList.contains('midi-device') &&
      learns.length === DEFS.filter((d) => d.section).length + 1 &&
      learns.every((el) => !shown(el)) &&
      /no device|unavailable|denied/i.test($('#midi-status').textContent)
  );
  check(
    'with no MIDI device the "click a param’s ⊙" instruction is hidden too',
    !shown($('.midi .midi-hint')) && shown($('#midi-status'))
  );
  doc.body.classList.add('midi-device');
  await sleep(30);
  check('a connected device shows the learn instruction', shown($('.midi .midi-hint')));
  check(
    'a connected device (the midi-device class) brings every visible row’s ⊙ back',
    learns.filter((el) => shown(el.closest('.row, .ab-row'))).every((el) => shown(el)) &&
      shown($('.ab-row .learn'))
  );
  check(
    'and the tooltips switch still lines up with the rows in that layout',
    win.getComputedStyle($('#prefs .row.pref')).gridTemplateColumns ===
      win.getComputedStyle(row('threshold')).gridTemplateColumns
  );
  doc.body.classList.remove('midi-device');
  await sleep(30);

  // -- the A/B --
  ab.click(); // keyboard-style activation (detail 0): Space/Enter
  await sleep(90);
  check(
    'clicking the A/B latches the piece off, and it says so',
    store.enabled === false && !ab.classList.contains('on') && text(ab).startsWith('OFF') &&
      text(ab).includes('untouched')
  );
  ab.click();
  await sleep(90);
  check('clicking again latches it back on', store.enabled === true && ab.classList.contains('on'));

  pointer(ab, 'pointerdown');
  await sleep(60);
  pointer(ab, 'pointerup');
  await sleep(90);
  check('a quick press-and-release latches too', store.enabled === false);
  ab.click();
  await sleep(90);

  // Round 3: a slow deliberate click (under LATCH_MS = 600) still latches,
  // even though the flip already showed under the finger.
  pointer(ab, 'pointerdown');
  await sleep(400);
  const slowFlipped = store.enabled === false;
  pointer(ab, 'pointerup');
  await sleep(90);
  check(
    'a slow 400 ms press latches: the piece stays off after release, with no "holding" face',
    slowFlipped && store.enabled === false && !ab.classList.contains('held') && text(ab).startsWith('OFF')
  );
  ab.click();
  await sleep(90);

  pointer(ab, 'pointerdown');
  await sleep(900);
  check(
    'held past 600 ms it is a compare: the piece is off while held and the face says "holding … let go"',
    store.enabled === false && ab.classList.contains('held') && text(ab).includes('holding') && text(ab).includes('let go')
  );
  pointer(ab, 'pointerup');
  await sleep(90);
  check(
    'release after a 900 ms hold comes back — no latch',
    store.enabled === true && ab.classList.contains('on') && !ab.classList.contains('held')
  );

  pointer(ab, 'pointerdown');
  await sleep(900);
  pointer(ab, 'pointerleave');
  await sleep(90);
  check('dragging off the A/B mid-hold also comes back', store.enabled === true && !ab.classList.contains('held'));

  pointer(ab, 'pointerdown');
  await sleep(400);
  pointer(ab, 'pointerleave');
  await sleep(90);
  check('dragging off before the latch decides changes nothing', store.enabled === true);

  ab.click(); // latched off: a hold now bypasses the other way
  await sleep(90);
  pointer(ab, 'pointerdown');
  await sleep(900);
  const heldOn = store.enabled === true;
  pointer(ab, 'pointercancel');
  await sleep(90);
  check('held from OFF it shows the piece, and cancel returns to OFF', heldOn && store.enabled === false);
  ab.click();
  await sleep(90);

  // -- the four chips --
  for (const key of CHIP_KEYS) {
    chip(key).querySelector('.chip-toggle').click();
    await sleep(90);
    const off = store[key] === false && !chip(key).classList.contains('on');
    chip(key).querySelector('.chip-toggle').click();
    await sleep(90);
    check(
      `the ${key} chip writes ${key} off and back on`,
      off && store[key] === true && chip(key).classList.contains('on')
    );
  }
  chip('textScramble').querySelector('.chip-toggle').click();
  await sleep(90);
  check(
    'the text chip and the canonical text row are one control',
    !row('textScramble').querySelector('input').checked && row('textMin').classList.contains('inert')
  );
  const textRow = row('textScramble').querySelector('input');
  textRow.checked = true;
  textRow.dispatchEvent(new win.Event('input', { bubbles: true }));
  await sleep(90);
  check(
    'and the row drives the chip back',
    store.textScramble === true && chip('textScramble').classList.contains('on')
  );
  check(
    'the A/B governs the chips: they dim while the piece is off',
    await (async () => {
      ab.click();
      await sleep(90);
      const dim = parseFloat(win.getComputedStyle($('.chips')).opacity) < 1;
      ab.click();
      await sleep(90);
      return dim && store.enabled === true;
    })()
  );

  check(
    'while the piece is OFF a chip still switches, and the strip says "switch ON to see it"',
    await (async () => {
      ab.click();
      await sleep(90);
      chip('video').querySelector('.chip-toggle').click();
      await sleep(60);
      const said = $('#tooltip').classList.contains('say') && text($('#tooltip')) === 'switch ON to see it';
      const switched = store.video === false;
      chip('video').querySelector('.chip-toggle').click();
      await sleep(60);
      ab.click();
      await sleep(90);
      return said && switched && store.video === true && store.enabled === true;
    })()
  );
  check(
    'a chip caption reads as a link: pointer cursor, underlined on hover',
    win.getComputedStyle($('.chip-name')).cursor === 'pointer' &&
      [...doc.styleSheets].some((sh) =>
        [...sh.cssRules].some((r) => r.selectorText === '.chip-name:hover' && /underline/.test(r.style.textDecoration || r.style.textDecorationLine))
      )
  );

  const landing = { textScramble: 'section-text', audioEnabled: 'section-audio', images: 'group-video-sort' };
  for (const key of ['textScramble', 'audioEnabled', 'images']) {
    $('#scroll').scrollTo(0, 0);
    await sleep(60);
    chip(key).querySelector('.chip-name').click();
    const head = doc.getElementById(landing[key]);
    let top = Infinity;
    let flashed = false;
    for (let i = 0; i < 50; i++) {
      await sleep(30);
      top = head.getBoundingClientRect().top;
      flashed ||= head.classList.contains('flash');
      if (flashed && Math.abs(top) < 40) break;
    }
    check(
      `clicking the ${key} chip's caption scrolls ${landing[key]} into view and flashes it when it lands`,
      top >= -2 && top < 40 && flashed
    );
    if (key === 'images') {
      check(
        'the images jump lands on the SORT caption, and the strip says "images are shaped by SORT"',
        head.classList.contains('group-head') && /^sort$/i.test(text(head)) && text($('#tooltip')) === 'images are shaped by SORT'
      );
    }
  }
  $('#scroll').scrollTo(0, 0);
  await sleep(60);

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

  // Finding 8: two quick clicks on a slider thumb are a nudge, not a reset.
  fire(slider('threshold'), 'dblclick');
  await sleep(60);
  check('double-clicking on a slider does not reset the row', store.threshold === 1);
  fire(row('threshold').querySelector('label'), 'dblclick');
  await sleep(60);
  check('double-clicking the label still does', store.threshold === DEFAULTS.threshold);
  type('threshold', '1');
  field('threshold').blur();
  await sleep(60);

  // Typed values that clamp flash the row; in-range ones do not.
  await sleep(600); // let earlier flashes finish
  type('flowSpeed', '0.05');
  await sleep(60);
  const quietInRange = !row('flowSpeed').classList.contains('flash');
  type('flowScale', '99');
  await sleep(60);
  check(
    'a typed value that clamps flashes its row (and an in-range one does not)',
    quietInRange && row('flowScale').classList.contains('flash') && store.flowScale === 12
  );
  press(field('flowScale'), 'Enter');
  await sleep(600);
  check('the clamp flash clears itself', !row('flowScale').classList.contains('flash'));
  fire(row('flowScale'), 'dblclick');
  fire(row('flowSpeed'), 'dblclick');
  await sleep(60);

  // -- presets --
  const btnDefault = $('#preset-default');
  const slot = (x) => $(`#presets .slot[data-slot="${x}"]`);
  const btnSave = $('#preset-save');
  const btnCancel = $('#preset-cancel');
  const btnUndo = $('#preset-undo');

  type('threshold', '0.42');
  type('passes', '30');
  field('passes').blur();
  await sleep(90);

  check('every slot starts empty and looks it', PRESET_SLOTS.every((x) => slot(x).classList.contains('empty')));
  slot('A').click();
  await sleep(60);
  check(
    'clicking an empty slot does nothing but say so',
    store.threshold === 0.42 && text(slot('A')) === 'empty' && btnUndo.hidden
  );
  await sleep(900);

  btnSave.click();
  await sleep(30);
  check(
    'save… puts the row in a visible save mode (empty slots read "save → A")',
    $('#presets').classList.contains('saving') &&
      text(slot('A')) === 'save → A' &&
      text(slot('C')) === 'save → C' &&
      !btnCancel.hidden &&
      btnSave.hidden
  );
  press(doc.body, 'Escape');
  await sleep(30);
  check(
    'Escape cancels save mode, and the save button flashes "cancelled"',
    !$('#presets').classList.contains('saving') && text(slot('A')) === 'A' && !btnSave.hidden && text(btnSave) === 'cancelled'
  );
  await sleep(950);
  check('the "cancelled" flash clears itself', text(btnSave) === 'save…');

  btnSave.click();
  await sleep(30);
  pointer($('#controls'), 'pointerdown');
  await sleep(30);
  check(
    'a click elsewhere cancels save mode, also flashing "cancelled"',
    !$('#presets').classList.contains('saving') && text(btnSave) === 'cancelled'
  );
  await sleep(950);

  btnSave.click();
  await sleep(30);
  btnCancel.click();
  await sleep(30);
  check('Cancel cancels save mode, and nothing was written', !$('#presets').classList.contains('saving') && !store.presets);

  btnSave.click();
  await sleep(30);
  slot('A').click();
  await sleep(60);
  check(
    'save mode then a slot writes presets.A with every parameter but the A/B',
    !!store.presets?.A &&
      store.presets.A.threshold === 0.42 &&
      store.presets.A.passes === 30 &&
      !('enabled' in store.presets.A) &&
      Object.keys(store.presets.A).length === DEFS.length - PRESET_EXCLUDED.length &&
      store.presets.B === null
  );
  check(
    'the slot flashes "saved to A" and the row is back in load mode',
    text(slot('A')) === 'saved to A' && !$('#presets').classList.contains('saving') && !btnSave.hidden
  );
  check(
    'saving marks the slot as the base (and saving to an empty slot offers no undo)',
    store.presetBase === 'A' && slot('A').classList.contains('base') && !btnDefault.classList.contains('base') && btnUndo.hidden
  );
  await sleep(900);
  check('a saved slot no longer looks empty', !slot('A').classList.contains('empty'));

  // Saving over a filled slot: "replace A", and undo gives the old A back.
  type('threshold', '0.55');
  field('threshold').blur();
  await sleep(60);
  btnSave.click();
  await sleep(30);
  check(
    'in save mode a filled slot reads "replace A", an empty one "save → B"',
    text(slot('A')) === 'replace A' && text(slot('B')) === 'save → B' && /replace/i.test(slot('A').dataset.tip)
  );
  check(
    'save-mode labels fit their buttons, and the row does not overflow',
    [...$('#presets').children].filter((b) => !b.hidden).every((b) => b.scrollWidth <= b.clientWidth + 1) &&
      $('#presets').scrollWidth <= $('#presets').clientWidth + 1
  );
  slot('A').click();
  await sleep(60);
  check(
    'saving over A writes the new values and offers undo',
    store.presets.A.threshold === 0.55 && !btnUndo.hidden && /before you saved over it/.test(btnUndo.dataset.tip)
  );
  btnUndo.click();
  await sleep(90);
  check(
    'undo after a save-over puts A’s old contents back and leaves the knobs alone',
    store.presets.A.threshold === 0.42 && store.presets.A.passes === 30 && store.threshold === 0.55 &&
      Number(slider('threshold').value) === 0.55 && btnUndo.hidden && store.presetBase === 'A'
  );
  await sleep(900);

  // default: every row back to DEFAULTS, the A/B left where it is
  type('threshold', '0.7');
  field('threshold').blur();
  ab.click();
  await sleep(90);
  btnDefault.click();
  await sleep(90);
  const notRestored = DEFS.filter(
    (d) => !PRESET_EXCLUDED.includes(d.key) && store[d.key] !== DEFAULTS[d.key]
  ).map((d) => d.key);
  check(
    `"default" restores every row to the compiled defaults (${notRestored.join(', ') || 'all'})`,
    notRestored.length === 0 &&
      Number(slider('threshold').value) === DEFAULTS.threshold &&
      field('passes').value === fmtNumber(byKey.passes, DEFAULTS.passes)
  );
  check('"default" leaves the A/B alone', store.enabled === false);
  check('"default" flashes "restored" and offers undo', text(btnDefault) === 'restored' && !btnUndo.hidden);
  check(
    'with the piece OFF, the A/B face says "switch ON to see it", then lets go of it',
    await (async () => {
      const said = text(ab).includes('switch ON to see it') && ab.classList.contains('nudge');
      await sleep(1600);
      return said && !text(ab).includes('switch ON') && text(ab).includes('page untouched');
    })()
  );
  check('the base is default, and it is marked', store.presetBase === 'default' && btnDefault.classList.contains('base'));
  ab.click();
  await sleep(90);
  check('with the piece ON, a load leaves the A/B face alone', !text(ab).includes('switch ON'));
  // (the undo window is still open: 10 s from the restore)

  btnUndo.click();
  await sleep(90);
  check(
    'undo after a restore reinstates the values and the base from before it',
    store.threshold === 0.7 && store.passes === 30 && Number(slider('threshold').value) === 0.7 && btnUndo.hidden &&
      store.presetBase === 'A'
  );

  btnDefault.click();
  await sleep(90);
  type('threshold', '0.7');
  field('threshold').blur();
  await sleep(60);
  slot('A').click();
  await sleep(90);
  check(
    'loading A restores its values, flashes "loaded", offers undo',
    store.threshold === 0.42 && store.passes === 30 && text(slot('A')) === 'loaded' && !btnUndo.hidden
  );
  check(
    'the base follows the load, and A is marked as the base',
    store.presetBase === 'A' && slot('A').classList.contains('base') && !btnDefault.classList.contains('base')
  );
  check('A’s tooltip says it is the base', /base/i.test(slot('A').dataset.hint));
  btnUndo.click();
  await sleep(90);
  check(
    'undo after a load reinstates the previous values and the previous base',
    store.threshold === 0.7 && store.presetBase === 'default' && btnDefault.classList.contains('base')
  );

  slot('A').click();
  await sleep(90);
  type('threshold', '0.9');
  field('threshold').blur();
  await sleep(90);
  fire(row('threshold'), 'dblclick');
  await sleep(90);
  check('a row double-click returns to the base preset (A)', store.threshold === 0.42);

  btnDefault.click();
  await sleep(90);
  type('threshold', '0.9');
  field('threshold').blur();
  await sleep(90);
  fire(row('threshold'), 'dblclick');
  await sleep(90);
  check('with default as the base, a double-click returns to the code default', store.threshold === DEFAULTS.threshold);

  slot('A').click(); // a fresh undo window, then let it lapse
  await sleep(90);
  const undoShown = !btnUndo.hidden;
  await sleep(10200);
  check('undo is offered for ten seconds, then withdrawn', undoShown && btnUndo.hidden);
  btnDefault.click();
  await sleep(90);

  // -- a base stored before the rename ("original") reads as default --
  {
    const seed = { presetBase: 'original', presets: { A: { threshold: 0.3 }, B: null, C: null } };
    const f = await bootFrame(`./panel-frame.html?seed=${encodeURIComponent(JSON.stringify(seed))}`);
    const wd = f.contentWindow.document;
    check(
      'a stored presetBase of "original" (from before the rename) marks default as the base',
      wd.getElementById('preset-default').classList.contains('base') &&
        !wd.querySelector('.slot[data-slot="A"]').classList.contains('base')
    );
    f.remove();
  }

  // -- migration: a legacy userDefaults becomes slot A and the base --
  {
    const legacy = { ...DEFAULTS, threshold: 0.33, passes: 12 };
    const seed = {
      userDefaults: legacy,
      threshold: 0.6,
      presets: { A: null, B: { threshold: 0.21 }, C: null },
      engineOpen: { audio: true },
    };
    const f = await bootFrame(`./panel-frame.html?midi=1&seed=${encodeURIComponent(JSON.stringify(seed))}`);
    const w = f.contentWindow;
    const s2 = w.__store;
    check(
      'a legacy userDefaults migrates into slot A on boot, and becomes the base',
      s2.presets?.A?.threshold === 0.33 && s2.presets.A.passes === 12 && s2.presetBase === 'A'
    );
    check('the legacy key is removed', !('userDefaults' in s2));
    check('the migration leaves other slots alone', s2.presets.B?.threshold === 0.21);
    {
      const wd = w.document;
      for (let i = 0; i < 20 && !wd.body.classList.contains('midi-device'); i++) await sleep(50);
      const vis = (el) => !!el && el.getClientRects().length > 0;
      check(
        'with a (stubbed) controller connected, the panel shows the ⊙ column and names the device',
        wd.body.classList.contains('midi-device') &&
          vis(wd.querySelector('.row[data-key="threshold"] .learn')) &&
          vis(wd.querySelector('.ab-row .learn')) &&
          wd.getElementById('midi-status').textContent === 'harness controller'
      );
    }
    check(
      'a stored engineOpen is honoured on boot (audio open, video still folded)',
      w.document.querySelector('.group[data-section="audio"][data-group="engine"] .group-rows').hidden === false &&
        w.document.querySelector('.group[data-section="video"][data-group="engine"] .group-rows').hidden === true
    );
    check(
      'migration loads nothing: the live values stay as stored',
      s2.threshold === 0.6 &&
        w.document.querySelector('.row[data-key="threshold"] input[type=range]').value === '0.6'
    );
    const r2 = w.document.querySelector('.row[data-key="threshold"]');
    r2.dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }));
    await sleep(90);
    check(
      'after migration a double-click returns to the old saved value',
      s2.threshold === 0.33 && w.document.querySelector('.slot[data-slot="A"]').classList.contains('base')
    );
    f.remove();
  }

  // -- tooltips: the help strip (round 3: one line at rest, an overlay on hover) --
  const tip = $('#tooltip');
  const sc = $('#scroll');
  $('#scroll').scrollTo(0, 0);
  fire($('#controls'), 'mouseover');
  await sleep(300);
  check(
    'at rest the strip is one line (~40 px) carrying the legend',
    !tip.hidden && tip.classList.contains('idle') &&
      Math.abs(tip.getBoundingClientRect().height - 40) <= 2 &&
      text(tip) === 'Hover to read a knob · double-click a name to reset it' &&
      tip.firstElementChild.scrollWidth <= tip.firstElementChild.clientWidth + 1
  );
  check(
    'the strip is full width and pinned to the panel’s bottom edge',
    (() => {
      const r = tip.getBoundingClientRect();
      return Math.abs(r.bottom - win.innerHeight) <= 1 && r.left <= 0.5 && Math.abs(r.width - win.innerWidth) <= 1;
    })()
  );
  check(
    'at rest the strip covers no row: the scroller ends where the idle strip begins',
    !sc.contains(tip) &&
      ['auto', 'scroll'].includes(win.getComputedStyle(sc).overflowY) &&
      Math.abs(sc.getBoundingClientRect().bottom - tip.getBoundingClientRect().top) <= 0.5
  );
  const geometry = () => ({
    sh: sc.scrollHeight,
    ch: sc.clientHeight,
    st: sc.scrollTop,
    tops: [...doc.querySelectorAll('.row')].map((r) => r.offsetTop).join(),
  });
  const restGeom = geometry();

  fire(row('threshold'), 'mouseover');
  await sleep(520);
  check(
    'hovering a row shows that row’s explanation',
    !tip.hidden && tip.textContent.includes(byKey.threshold.tip.slice(0, 40))
  );
  check(
    'the tooltip names the gesture the row cannot show',
    tip.textContent.toLowerCase().includes('double-click')
  );
  check(
    'the tip’s last line is the internal key, muted',
    tip.lastElementChild?.classList.contains('key') && text(tip.lastElementChild) === 'key: threshold'
  );
  check(
    'on hover the strip grows to fit (at most 136 px), still pinned to the bottom, over the scroller',
    (() => {
      const r = tip.getBoundingClientRect();
      return (
        tip.classList.contains('open') && r.height > 44 && r.height <= 136.5 &&
        Math.abs(r.bottom - win.innerHeight) <= 1 && r.top < sc.getBoundingClientRect().bottom &&
        tip.scrollHeight <= tip.clientHeight + 1
      );
    })()
  );
  {
    const g = geometry();
    check(
      'the grown strip is an overlay: the scroller’s scrollHeight, height, scroll position and every row’s offsetTop are unchanged',
      g.sh === restGeom.sh && g.ch === restGeom.ch && g.st === restGeom.st && g.tops === restGeom.tops
    );
  }
  check(
    'the strip ignores the pointer, so growing over the hovered row cannot steal its hover',
    win.getComputedStyle(tip).pointerEvents === 'none'
  );
  check(
    'the strip animates its height (~120 ms)',
    /height/.test(win.getComputedStyle(tip).transitionProperty) &&
      Math.abs(parseFloat(win.getComputedStyle(tip).transitionDuration) - 0.12) < 0.03
  );
  {
    // Every tip has to fit the grown strip: render each one into it exactly
    // as the panel does (tip, hint, key) at natural height and look for
    // overflow past the 136 px cap.
    const saved = [...tip.childNodes];
    const savedClass = tip.className;
    const savedHeight = tip.style.height;
    tip.className = 'open';
    tip.style.height = 'auto';
    const overflow = [];
    for (const host of doc.querySelectorAll('[data-tip]')) {
      tip.textContent = '';
      const body = doc.createElement('div');
      body.textContent = host.dataset.tip;
      tip.appendChild(body);
      for (const [cls, t] of [['hint', host.dataset.hint], ['key', host.dataset.param && `key: ${host.dataset.param}`]]) {
        if (!t) continue;
        const p = doc.createElement('p');
        p.className = cls;
        p.textContent = t;
        tip.appendChild(p);
      }
      if (tip.scrollHeight > tip.clientHeight + 1) overflow.push(host.dataset.param || host.id || host.className || host.tagName);
    }
    tip.replaceChildren(...saved);
    tip.className = savedClass;
    tip.style.height = savedHeight;
    check(`every tip fits the strip without clipping (${overflow.join(', ') || 'all fit'})`, overflow.length === 0);
  }

  fire($('#controls'), 'mouseover');
  await sleep(300);
  check(
    'leaving the row returns the strip to its one-line resting legend (the two hidden gestures)',
    !tip.hidden && tip.classList.contains('idle') && /double-click/i.test(tip.textContent) && /hover/i.test(tip.textContent) &&
      Math.abs(tip.getBoundingClientRect().height - 40) <= 2
  );

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
  check(
    'turning tooltips off removes the strip and gives its line back to the scroller',
    tip.hidden && Math.abs(sc.getBoundingClientRect().bottom - win.innerHeight) <= 0.5
  );
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
    'h1, .lede, .keys, .ab, .chip-name, .chip-toggle, #persist-note, .section, .row, .row input.value.num, .learn, .btn, .midi h2, #midi-status, .midi .hint, .group-head, #audio-status'
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

  // -- inert rows say why (finding 9) --
  const gateOf = (k) => row(k).querySelector('.gate');
  const gateSays = (k, words) => {
    const g = gateOf(k);
    return row(k).classList.contains('inert') && shown(g) && text(g) === words &&
      win.getComputedStyle(row(k).querySelector('.knob')).visibility === 'hidden';
  };
  const setToggle = async (k, on) => {
    const el = row(k).querySelector('input');
    el.checked = on;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(60);
  };
  const setSelect = async (k, v) => {
    const el = row(k).querySelector('select');
    el.value = v;
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
    await sleep(60);
  };
  check(
    'at rest, comb damp says "comb only" and the clear timings say "needs clear"',
    gateSays('audioCombDamp', 'comb only') && gateSays('audioFbClearS', 'needs clear') && gateSays('audioFbClearMaxS', 'needs clear')
  );
  check(
    'a live row carries no caption',
    !row('decay').classList.contains('inert') && !shown(gateOf('decay')) && text(gateOf('decay')) === ''
  );
  await setToggle('feedbackVideo', false);
  check(
    'feedback off: every feedback knob says "needs feedback", motion gate included',
    ['motionGate', 'decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'].every((k) => gateSays(k, 'needs feedback'))
  );
  await setToggle('feedbackVideo', true);
  type('flowAmount', '0');
  field('flowAmount').blur();
  await sleep(60);
  check('flow at 0: the flow shape knobs say "needs flow"', ['flowMode', 'flowScale', 'flowSpeed'].every((k) => gateSays(k, 'needs flow')));
  fire(row('flowAmount'), 'dblclick');
  await sleep(60);
  await setToggle('audioFeedback', false);
  check('smear off: tail, return, wobble and smear clear say "needs smear"', ['audioFbDecay', 'audioFbReturn', 'audioFbWobble', 'audioFbClear'].every((k) => gateSays(k, 'needs smear')));
  await setToggle('audioFeedback', true);
  await setSelect('audioBody', 'comb');
  await setToggle('audioFbClear', true);
  check('comb and smear clear on: those rows wake and lose their captions', !row('audioCombDamp').classList.contains('inert') && !shown(gateOf('audioFbClearS')));
  await setToggle('audioEnabled', false);
  check('audio off: the outermost switch is the one named ("needs audio")', gateSays('audioCombDamp', 'needs audio') && gateSays('audioFbClearS', 'needs audio') && gateSays('audioSustain', 'needs audio'));
  await setToggle('audioEnabled', true);
  await setToggle('audioFbClear', false);
  await setSelect('audioBody', 'modal');
  chip('textScramble').querySelector('.chip-toggle').click();
  await sleep(60);
  check('text off: text min says "needs text"', gateSays('textMin', 'needs text'));
  chip('textScramble').querySelector('.chip-toggle').click();
  await sleep(60);

  // Round 3, item 7: the Video rows name the medium switch that would wake them.
  const SORT = ['threshold', 'flowAmount', 'flowMode', 'flowScale', 'flowSpeed', 'temperature'];
  const FEEDBACK = ['feedbackVideo', 'motionGate', 'decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'];
  chip('video').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video off: every feedback row, its switch included, says "needs video"; sort still serves images',
    FEEDBACK.every((k) => gateSays(k, 'needs video')) && SORT.every((k) => !row(k).classList.contains('inert'))
  );
  chip('images').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video and images both off: every sort row says "needs video or images"',
    SORT.every((k) => gateSays(k, 'needs video or images'))
  );
  chip('video').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video back on (images still off): sort and feedback wake',
    [...SORT, ...FEEDBACK].every((k) => !row(k).classList.contains('inert'))
  );
  chip('images').querySelector('.chip-toggle').click();
  await sleep(60);
  check('the medium gates hand every row back', store.video === true && store.images === true && !row('threshold').classList.contains('inert'));

  // -- the panel never invents parameters --
  const strays = Object.keys(store).filter(
    (k) => !(k in DEFAULTS) && !PANEL_ONLY.includes(k)
  );
  check(`the panel writes no key the content scripts do not know (${strays.join(', ') || 'none'})`, strays.length === 0);
}

// --- Tier 3: the other homes' layouts (design review M9) --------------------
// The same shipped panel in the two shapes the new homes give it: the strip
// (panel.html?layout=strip, 1280 × 150) and Chrome's side panel at its
// narrowest (~320 px wide).

// Render every tip into the help area exactly as the panel does and list
// the ones that clip.
function tipsThatClip(d) {
  const tip = d.getElementById('tooltip');
  const saved = [...tip.childNodes];
  const overflow = [];
  for (const host of d.querySelectorAll('[data-tip]')) {
    tip.textContent = '';
    const body = d.createElement('div');
    body.textContent = host.dataset.tip;
    tip.appendChild(body);
    for (const [cls, t] of [['hint', host.dataset.hint], ['key', host.dataset.param && `key: ${host.dataset.param}`]]) {
      if (!t) continue;
      const p = d.createElement('p');
      p.className = cls;
      p.textContent = t;
      tip.appendChild(p);
    }
    if (tip.scrollHeight > tip.clientHeight + 1) overflow.push(host.dataset.param || host.dataset.pref || host.className || host.tagName);
  }
  tip.replaceChildren(...saved);
  return overflow;
}

async function tier3() {
  tier('tier 3 — the strip and side-panel layouts (M9)');

  // -- the strip: panel.html?layout=strip at 1280 × 150 --
  {
    const f = await bootFrame('./panel-frame.html?layout=strip', 1280, 150);
    const w = f.contentWindow;
    const d = w.document;
    const q = (s) => d.querySelector(s);
    const rect = (el) => el.getBoundingClientRect();
    check('the frame really is 1280 × 150', w.innerWidth === 1280 && w.innerHeight === 150);
    check('?layout=strip switches the panel to the strip layout', d.documentElement.dataset.layout === 'strip');
    const heads = SECTIONS.map((s) => d.getElementById(`section-${s.id}`));
    const hr = heads.map(rect);
    check(
      'the sections sit side by side: same top, each one right of the last',
      hr.every((r, i) => i === 0 || (r.left >= hr[i - 1].right && Math.abs(r.top - hr[0].top) < 2))
    );
    check(
      'nothing overflows the strip: the page neither scrolls nor clips',
      d.documentElement.scrollWidth <= w.innerWidth &&
        d.documentElement.scrollHeight <= w.innerHeight &&
        q('#scroll').scrollWidth <= q('#scroll').clientWidth &&
        q('#scroll').scrollHeight <= q('#scroll').clientHeight
    );
    const c = q('#controls');
    check(
      'the sections scroll sideways in their own lane, never vertically',
      ['auto', 'scroll'].includes(w.getComputedStyle(c).overflowX) &&
        c.scrollWidth > c.clientWidth &&
        c.scrollHeight <= c.clientHeight + 1
    );
    const cr = rect(c);
    const inLane = [...c.querySelectorAll('.section, .row, .group-head')].filter((el) => el.getClientRects().length);
    check(
      'every visible row fits the lane’s height (no row cut off at the bottom)',
      inLane.every((el) => rect(el).top >= cr.top - 1 && rect(el).bottom <= cr.bottom + 1)
    );
    check(
      'the global block is a cluster at the left: A/B, the mediums, the presets, all in view',
      ['#ab', '.chips', '#presets'].every((s) => {
        const r = rect(q(s));
        return r.width > 0 && r.right <= cr.left && r.top >= 0 && r.bottom <= w.innerHeight;
      })
    );
    check(
      'MIDI and the panel prefs sit to the right of the lane, in view',
      ['.midi', '#prefs'].every((s) => {
        const r = rect(q(s));
        return r.left >= cr.right && r.bottom <= w.innerHeight;
      }) && !!q('#panelHome') && rect(q('#panelHome')).width > 0
    );
    const tr = rect(q('#tooltip'));
    check(
      'the help copy is a full-height column at the right edge',
      Math.abs(tr.right - w.innerWidth) <= 1 && tr.top <= 0.5 && Math.abs(tr.bottom - w.innerHeight) <= 1
    );
    const clip = tipsThatClip(d);
    check(`every tip fits the strip’s help column (${clip.join(', ') || 'all fit'})`, clip.length === 0);
    // The chip captions still jump: in the strip that is a sideways scroll.
    d.querySelector('.chip[data-key="audioEnabled"] .chip-name').click();
    await sleep(700);
    const ar = rect(d.getElementById('section-audio'));
    check('the audio chip’s caption scrolls the lane sideways to Audio', c.scrollLeft > 0 && ar.left >= cr.left - 2 && ar.left < cr.right);
    d.querySelector('.group[data-section="video"][data-group="engine"] .group-head').click();
    await sleep(60);
    check(
      'an unfolded engine adds columns, not height',
      c.scrollHeight <= c.clientHeight + 1 &&
        d.documentElement.scrollHeight <= w.innerHeight &&
        ['passes', 'maxVideos'].every((k) => {
          const r = d.querySelector(`.row[data-key="${k}"]`).getBoundingClientRect();
          return r.height > 0 && r.bottom <= cr.bottom + 1;
        })
    );
    f.remove();
  }

  // -- the side panel at its narrowest: 320 px --
  for (const width of [320, 360, 420]) {
    const f = await bootFrame('./panel-frame.html', width, 720);
    const w = f.contentWindow;
    const d = w.document;
    const sc = d.getElementById('scroll');
    const fits = () =>
      d.documentElement.scrollWidth <= w.innerWidth &&
      sc.scrollWidth <= sc.clientWidth &&
      [...sc.querySelectorAll('*')].every((el) => {
        if (!el.getClientRects().length) return true;
        const r = el.getBoundingClientRect();
        return r.right <= sc.getBoundingClientRect().right + 0.5;
      });
    const atRest = fits();
    d.getElementById('preset-default').click(); // brings out undo
    await sleep(60);
    d.getElementById('preset-save').click(); // save mode: the widest preset row
    await sleep(60);
    const saving = fits();
    d.getElementById('preset-cancel').click();
    await sleep(40);
    const withUndo = fits() && !d.getElementById('preset-undo').hidden;
    check(`at ${width} px nothing overflows: at rest, in save mode, with undo showing`, atRest && saving && withUndo);
    const clip = tipsThatClip(d);
    check(`at ${width} px every tip fits the help strip (${clip.join(', ') || 'all fit'})`, clip.length === 0);
    f.remove();
  }
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
  try {
    await tier3();
  } catch (e) {
    check(`tier 3 crashed (${e.message})`, false);
  }
  const done = document.createElement('div');
  done.id = 'done';
  done.textContent = `COMPLETE: ${passCount} passed, ${failCount} failed`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
})();
