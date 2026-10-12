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
// Sectionless keys: the global block's own controls — the A/B and the four
// chips, which since 2026-10-11 are the only face of all four mediums.
const GLOBAL_KEYS = ['enabled', 'video', 'images', 'textScramble', 'audioEnabled'];
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
  audio: {
    loose: [],
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
    'every row belongs to a declared section, except the global block (A/B and the four chips)',
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
    'panelHome offers strip · window · side, defaults to the strip (John, 2026-10-11), and its tip says when a change applies',
    PANEL_HOME.key === 'panelHome' &&
      PANEL_HOMES.join() === 'strip,window,side' &&
      PANEL_HOME.default === 'strip' &&
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
      'it offers the three homes, strip first and selected',
      !!sel && [...sel.options].map((o) => o.value).join() === 'strip,window,side' && sel.value === 'strip'
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
    sel.value = 'window';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await sleep(40);
    check('choosing a home stores it as panelHome', store.panelHome === 'window');
    win.chrome.storage.local.set({ panelHome: 'side' });
    await sleep(40);
    check('a panelHome change from elsewhere is followed', sel.value === 'side');
    win.chrome.storage.local.set({ panelHome: 'nonsense' });
    await sleep(40);
    check('an unknown stored home reads as the strip', sel.value === 'strip');
    sel.value = 'strip';
    sel.dispatchEvent(new win.Event('change', { bubbles: true }));
    await sleep(40);
    check('and the strip can be chosen back', store.panelHome === 'strip');
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
    'no section carries a master row: the chips are the masters, the body group follows the Audio header directly',
    !row('audioEnabled') && !row('textScramble') && !$('#section-text') &&
      $('#section-audio').nextElementSibling?.dataset.group === 'body'
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
  // A gated engine row (comb damp under a modal body, the clear timings
  // with clear off) stays hidden however the engine folds.
  const live = (keys) => keys.filter((k) => !row(k).hidden);
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
      live(ENGINE_KEYS.video).every((k) => shown(row(k))) &&
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
      live(ENGINE_KEYS.audio).every((k) => shown(row(k))) && live(ENGINE_KEYS.audio).length >= 3 &&
      ENGINE_KEYS.video.every((k) => !shown(row(k)))
  );
  win.chrome.storage.local.set({ engineOpen: { video: true, audio: true } });
  await sleep(60);
  check(
    'an engineOpen change from elsewhere (the other panel window) is followed',
    text(engineHead('video')) === 'engine ▾' && live(ENGINE_KEYS.video).every((k) => shown(row(k)))
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
    'with no MIDI device every ⊙ is hidden — the rows’, the A/B’s and the four chips’ — and the (hidden) status reads "no device"',
    !doc.body.classList.contains('midi-device') &&
      learns.length === DEFS.filter((d) => d.section).length + 1 + CHIP_KEYS.length &&
      CHIP_KEYS.every((k) => !!chip(k).querySelector('.learn')) &&
      learns.every((el) => !shown(el)) &&
      /no device|unavailable|denied/i.test($('#midi-status').textContent)
  );
  check(
    'with no MIDI device the whole MIDI block is out of sight (keyboard and mouse are the primary mode)',
    !shown($('.midi')) && !shown($('#midi-status')) && !shown($('.midi .midi-hint'))
  );
  doc.body.classList.add('midi-device');
  await sleep(30);
  check('a connected device brings the MIDI block and its learn instruction into view', shown($('.midi')) && shown($('.midi .midi-hint')) && shown($('#midi-status')));
  check(
    'a connected device (the midi-device class) brings every visible row’s ⊙ back',
    learns.filter((el) => shown(el.closest('.row, .ab-row, .chip'))).every((el) => shown(el)) &&
      shown($('.ab-row .learn')) && CHIP_KEYS.every((k) => shown(chip(k).querySelector('.learn')))
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
  check(
    'the text chip has no section to jump to: its caption is a plain label, not a link',
    chip('textScramble').querySelector('.chip-name').tagName !== 'BUTTON' &&
      win.getComputedStyle(chip('textScramble').querySelector('.chip-name')).cursor !== 'pointer' &&
      chip('audioEnabled').querySelector('.chip-name').tagName === 'BUTTON'
  );
  win.chrome.storage.local.set({ textScramble: false, audioEnabled: false });
  await sleep(60);
  check(
    'a text or audio change from elsewhere (the shortcut, the other panel) reaches the chips',
    !chip('textScramble').classList.contains('on') && !chip('audioEnabled').classList.contains('on')
  );
  win.chrome.storage.local.set({ textScramble: true, audioEnabled: true });
  await sleep(60);
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

  const landing = { audioEnabled: 'section-audio', images: 'group-video-sort' };
  for (const key of ['audioEnabled', 'images']) {
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
    // The header reaches the top when there is enough below it to scroll;
    // otherwise the scroller goes as far as it can and the header is in view.
    const scroller = $('#scroll');
    const scrolledOut = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1;
    check(
      `clicking the ${key} chip's caption scrolls ${landing[key]} into view and flashes it when it lands`,
      top >= -2 && (top < 40 || (scrolledOut && top < win.innerHeight)) && flashed
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

  // -- tooltips: a bubble beside the hovered control (2026-10-11), nothing at rest --
  const tip = $('#tooltip');
  const sc = $('#scroll');
  $('#scroll').scrollTo(0, 0);
  fire($('#controls'), 'mouseover');
  await sleep(300);
  check(
    'at rest no help shows: the bubble is hidden and the scroller runs to the panel’s bottom edge',
    tip.hidden && Math.abs(sc.getBoundingClientRect().bottom - win.innerHeight) <= 0.5 && !$('.tips-off')
  );
  const geometry = () => ({
    sh: sc.scrollHeight,
    ch: sc.clientHeight,
    st: sc.scrollTop,
    tops: [...doc.querySelectorAll('.row')].map((r) => r.offsetTop).join(),
  });
  const restGeom = geometry();
  const inside = (r) => r.left >= 0 && r.top >= 0 && r.right <= win.innerWidth + 0.5 && r.bottom <= win.innerHeight + 0.5;
  const beside = (bubble, host) => bubble.bottom <= host.top + 1 || bubble.top >= host.bottom - 1;

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
    'the bubble sits beside the hovered row — above or below it, never over it — inside the panel, at most 340 px wide',
    (() => {
      const b = tip.getBoundingClientRect();
      const r = row('threshold').getBoundingClientRect();
      return win.getComputedStyle(tip).position === 'fixed' && inside(b) && beside(b, r) && b.width <= 340.5 &&
        tip.scrollHeight <= tip.clientHeight + 1;
    })()
  );
  {
    const g = geometry();
    check(
      'the bubble is an overlay: the scroller’s scrollHeight, height, scroll position and every row’s offsetTop are unchanged',
      g.sh === restGeom.sh && g.ch === restGeom.ch && g.st === restGeom.st && g.tops === restGeom.tops
    );
  }
  check(
    'the bubble ignores the pointer, so appearing beside the hovered row cannot steal its hover',
    win.getComputedStyle(tip).pointerEvents === 'none'
  );
  {
    // Every tip has to fit a bubble that can stand beside a row in the
    // shortest home (the strip, ~200 px): render each one into the bubble
    // exactly as the panel does (tip, hint, key) and measure it.
    const clip = tipsThatClip(doc);
    check(`every tip fits the bubble’s budget, 340 × ${TIP_MAX_H} (${clip.join(', ') || 'all fit'})`, clip.length === 0);
  }

  fire($('#controls'), 'mouseover');
  await sleep(300);
  check('leaving the row hides the bubble: nothing at rest', tip.hidden);

  fire(field('passes'), 'mouseover');
  await sleep(420);
  check(
    'the value field explains that typed values clamp',
    !tip.hidden && tip.textContent.toLowerCase().includes('clamp')
  );
  fire($('#controls'), 'mouseover');
  await sleep(300);

  const toggle = $('#tooltips');
  check('tooltips default to on', toggle.checked);
  toggle.checked = false;
  toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(60);
  fire($('#controls'), 'mouseover');
  fire(row('decay'), 'mouseover');
  await sleep(420);
  check('turning tooltips off suppresses the next one', tip.hidden);
  check('the tooltip preference persists', store.tooltips === false);
  toggle.checked = true;
  toggle.dispatchEvent(new win.Event('change', { bubbles: true }));
  await sleep(60);
  fire($('#controls'), 'mouseover');
  await sleep(300);

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
  const setChip = async (k, on) => {
    if (chip(k).classList.contains('on') !== on) chip(k).querySelector('.chip-toggle').click();
    await sleep(60);
  };
  const groupShown = (sec, gid) => shown(doc.querySelector(`#controls .group[data-section="${sec}"][data-group="${gid}"]`));
  const offNote = (sec) => doc.querySelector(`#section-${sec} .off-note`);
  await setChip('audioEnabled', false);
  check(
    'audio off: the section hides every group and row, disables the fields, and says which chip brings it back',
    !shown(row('audioSustain')) && !shown(row('audioMix')) && !shown(row('audioDirect')) &&
      slider('audioSustain').disabled && field('audioSustain').disabled &&
      ['body', 'smear', 'engine'].every((g) => !groupShown('audio', g)) &&
      shown(offNote('audio')) && text(offNote('audio')) === 'off — switch audio on above' &&
      shown($('#section-audio h2'))
  );
  await setChip('audioEnabled', true);
  check(
    'audio on: the groups and rows return and the note goes',
    shown(row('audioSustain')) && !field('audioSustain').disabled &&
      ['body', 'smear'].every((g) => groupShown('audio', g)) && !shown(offNote('audio'))
  );

  // -- gated rows are hidden, not greyed (2026-10-11); the gating switch stays as the header --
  const gateSays = (k, words) =>
    !shown(row(k)) && row(k).hidden && row(k).dataset.gate === words && row(k).querySelector('input, select').disabled;
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
    'at rest, comb damp (modal body) and the clear timings (clear off) are out of sight, each recording its gate',
    gateSays('audioCombDamp', 'comb') && gateSays('audioFbClearS', 'clear') && gateSays('audioFbClearMaxS', 'clear')
  );
  check('a live row is shown, enabled and carries no gate', shown(row('decay')) && !row('decay').hidden && !('gate' in row('decay').dataset) && !slider('decay').disabled);
  await setToggle('feedbackVideo', false);
  check(
    'feedback off: every feedback knob hides, motion gate included, and the feedback switch stays as the header',
    ['motionGate', 'decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'].every((k) => gateSays(k, 'feedback')) &&
      shown(row('feedbackVideo')) && groupShown('video', 'feedback')
  );
  await setToggle('feedbackVideo', true);
  check('feedback on: the knobs unfold beneath the switch', ['motionGate', 'decay', 'resetMaxS'].every((k) => shown(row(k))));
  type('flowAmount', '0');
  field('flowAmount').blur();
  await sleep(60);
  check('flow at 0: the flow shape knobs hide; flow itself stays', ['flowMode', 'flowScale', 'flowSpeed'].every((k) => gateSays(k, 'flow')) && shown(row('flowAmount')));
  fire(row('flowAmount'), 'dblclick');
  await sleep(60);
  check('flow back up: the shape knobs return', ['flowMode', 'flowScale', 'flowSpeed'].every((k) => shown(row(k))));
  await setToggle('audioFeedback', false);
  check('smear off: tail, return, wobble and smear clear hide; the smear switch stays', ['audioFbDecay', 'audioFbReturn', 'audioFbWobble', 'audioFbClear'].every((k) => gateSays(k, 'smear')) && shown(row('audioFeedback')));
  await setToggle('audioFeedback', true);
  await setSelect('audioBody', 'comb');
  await setToggle('audioFbClear', true);
  check('comb and smear clear on: those rows appear', shown(row('audioCombDamp')) && shown(row('audioFbClearS')) && shown(row('audioFbClearMaxS')));
  await setChip('audioEnabled', false);
  check('audio off: the outermost switch is the one recorded ("audio")', gateSays('audioCombDamp', 'audio') && gateSays('audioFbClearS', 'audio') && gateSays('audioSustain', 'audio'));
  await setChip('audioEnabled', true);
  await setToggle('audioFbClear', false);
  await setSelect('audioBody', 'modal');

  // Round 3, item 7: the Video rows name the medium switch that would wake them.
  const SORT = ['threshold', 'flowAmount', 'flowMode', 'flowScale', 'flowSpeed', 'temperature'];
  const FEEDBACK = ['feedbackVideo', 'motionGate', 'decay', 'driftX', 'driftY', 'resetMinS', 'resetMaxS'];
  chip('video').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video off: the whole feedback group hides, its switch included; sort still serves images and the Video header stays',
    FEEDBACK.every((k) => gateSays(k, 'video')) && !groupShown('video', 'feedback') &&
      SORT.every((k) => shown(row(k))) && groupShown('video', 'sort') && !shown(offNote('video'))
  );
  chip('images').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video and images both off: every Video group hides and the section says which chips bring it back',
    SORT.every((k) => gateSays(k, 'video or images')) &&
      ['sort', 'feedback', 'engine'].every((g) => !groupShown('video', g)) &&
      shown(offNote('video')) && text(offNote('video')) === 'off — switch video or images on above' &&
      shown($('#section-video h2'))
  );
  chip('video').querySelector('.chip-toggle').click();
  await sleep(60);
  check(
    'video back on (images still off): sort and feedback return, the note goes',
    [...SORT, ...FEEDBACK].every((k) => shown(row(k))) && !shown(offNote('video'))
  );
  chip('images').querySelector('.chip-toggle').click();
  await sleep(60);
  check('the medium gates hand every row back', store.video === true && store.images === true && shown(row('threshold')) && !row('threshold').hidden);

  // -- the panel never invents parameters --
  const strays = Object.keys(store).filter(
    (k) => !(k in DEFAULTS) && !PANEL_ONLY.includes(k)
  );
  check(`the panel writes no key the content scripts do not know (${strays.join(', ') || 'none'})`, strays.length === 0);
}

// --- Tier 3: the other homes' layouts (design review M9) --------------------
// The same shipped panel in the shapes the homes give it: the strip
// unfolded (panel.html?layout=strip, 1280 × 208), the strip at rest (the
// rail, 1280 × 28) and Chrome's side panel at its narrowest (~320 px wide).

// Render every tip into the bubble exactly as the panel does (tip, hint,
// key) and list the ones that exceed the bubble's budget: 340 px wide (the
// stylesheet's cap) by TIP_MAX_H tall, the most that can stand beside a row
// in the shortest home.
const TIP_MAX_H = 150;
function tipsThatClip(d) {
  const tip = d.getElementById('tooltip');
  const saved = [...tip.childNodes];
  const savedHidden = tip.hidden;
  const savedClass = tip.className;
  tip.hidden = false;
  tip.className = '';
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
    const r = tip.getBoundingClientRect();
    if (r.width > 340.5 || r.height > TIP_MAX_H || tip.scrollHeight > tip.clientHeight + 1) {
      overflow.push(`${host.dataset.param || host.dataset.pref || host.id || host.className || host.tagName} ${Math.round(r.height)}px`);
    }
  }
  tip.replaceChildren(...saved);
  tip.className = savedClass;
  tip.hidden = savedHidden;
  return overflow;
}

async function tier3() {
  tier('tier 3 — the strip and side-panel layouts (M9)');

  // -- the strip, unfolded: panel.html?layout=strip at 1280 × 208 --
  {
    const f = await bootFrame('./panel-frame.html?layout=strip', 1280, 208);
    const w = f.contentWindow;
    const d = w.document;
    const q = (s) => d.querySelector(s);
    const rect = (el) => el.getBoundingClientRect();
    const vis = (el) => !!el && el.getClientRects().length > 0;
    check('the frame really is 1280 × 208', w.innerWidth === 1280 && w.innerHeight === 208);
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
    const cr = rect(c);
    const groupHead = (sec, g) => q(`#controls .group[data-section="${sec}"][data-group="${g}"] .group-head`);
    // In the strip a folded engine's disclosure lives in the section header.
    const engineBtn = (sec) => q(`#section-${sec} .group-head.disclosure`);
    check(
      'a folded engine costs no column: its disclosure sits in the section header line, beside the title',
      ['video', 'audio'].every((sec) => vis(engineBtn(sec)) && Math.abs(rect(engineBtn(sec)).top - rect(q(`#section-${sec} h2`)).top) < 6)
    );
    check(
      'the four effect groups — sort · feedback · body · smear — are all in view with no sideways scroll',
      c.scrollWidth <= c.clientWidth + 1 && c.scrollLeft === 0 &&
        [['video', 'sort'], ['video', 'feedback'], ['audio', 'body'], ['audio', 'smear']].every(([sec, g]) => {
          const r = rect(groupHead(sec, g));
          return vis(groupHead(sec, g)) && r.left >= cr.left - 1 && r.right <= cr.right + 1;
        })
    );
    check(
      'each effect group is its own column: feedback right of sort, smear right of body, body right of feedback',
      rect(groupHead('video', 'feedback')).left > rect(groupHead('video', 'sort')).right &&
        rect(groupHead('audio', 'body')).left > rect(groupHead('video', 'feedback')).right &&
        rect(groupHead('audio', 'smear')).left > rect(groupHead('audio', 'body')).right
    );
    check(
      'the lane never scrolls vertically, and every visible row fits its height (no row cut off)',
      c.scrollHeight <= c.clientHeight + 1 &&
        [...c.querySelectorAll('.section, .row, .group-head')].filter(vis).every((el) => rect(el).top >= cr.top - 1 && rect(el).bottom <= cr.bottom + 1)
    );
    check(
      'the Audio header and its status line share the column top without colliding with the body caption',
      rect(groupHead('audio', 'body')).top >= rect(q('#section-audio')).bottom - 1
    );
    check(
      'the global block is a cluster at the left: A/B, the mediums, the presets and the prefs, all in view',
      ['#ab', '.chips', '#presets', '#prefs'].every((s) => {
        const r = rect(q(s));
        return r.width > 0 && r.right <= cr.left && r.top >= 0 && r.bottom <= w.innerHeight;
      }) && !!q('#panelHome') && rect(q('#panelHome')).width > 0 && q('.midi').getClientRects().length === 0
    );
    const fold = q('#strip-fold');
    check(
      'the fold button shows in the strip’s top-right corner, offering to fold (▾)',
      vis(fold) && fold.textContent === '▾' && rect(fold).right <= w.innerWidth && rect(fold).top < 30 && rect(fold).left > w.innerWidth - 60
    );
    check('no help column: the bubble is hidden at rest in the strip too', q('#tooltip').hidden);
    // Hovering a row in the strip puts the bubble beside it, inside the frame.
    q('.row[data-key="decay"]').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(420);
    {
      const tipR = rect(q('#tooltip'));
      const rowR = rect(q('.row[data-key="decay"]'));
      check(
        'in the strip a hovered row’s bubble stays inside the frame and beside the row',
        !q('#tooltip').hidden && tipR.top >= 0 && tipR.bottom <= w.innerHeight + 0.5 && tipR.left >= 0 && tipR.right <= w.innerWidth + 0.5 &&
          (tipR.bottom <= rowR.top + 1 || tipR.top >= rowR.bottom - 1)
      );
    }
    c.dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(320);
    // The chip captions still jump; with everything in view that is a flash, not a scroll.
    d.querySelector('.chip[data-key="audioEnabled"] .chip-name').click();
    let flashed = false;
    for (let i = 0; i < 40 && !flashed; i++) {
      await sleep(30);
      flashed = d.getElementById('section-audio').classList.contains('flash');
    }
    check('the audio chip’s caption lands on Audio (already in view, so it flashes rather than scrolls)', c.scrollLeft === 0 && flashed);
    engineBtn('video').click();
    await sleep(60);
    check(
      'an unfolded engine adds a captioned column, not height',
      c.scrollHeight <= c.clientHeight + 1 &&
        d.documentElement.scrollHeight <= w.innerHeight &&
        vis(q('#controls .group.engine[data-section="video"] .group-cap')) &&
        ['passes', 'maxVideos'].every((k) => {
          const r = d.querySelector(`.row[data-key="${k}"]`).getBoundingClientRect();
          return r.height > 0 && r.bottom <= cr.bottom + 1;
        })
    );
    engineBtn('video').click();
    await sleep(60);
    // Gates hide rows in the strip too, and the column closes up.
    const fbToggle = d.querySelector('.row[data-key="feedbackVideo"] input');
    fbToggle.checked = false;
    fbToggle.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(60);
    check(
      'feedback off in the strip: its column is the switch alone',
      vis(d.querySelector('.row[data-key="feedbackVideo"]')) && !vis(d.querySelector('.row[data-key="decay"]')) &&
        c.scrollHeight <= c.clientHeight + 1
    );
    fbToggle.checked = true;
    fbToggle.dispatchEvent(new w.Event('input', { bubbles: true }));
    await sleep(60);
    f.remove();
  }

  // -- the strip at rest: the rail, 1280 × 28 --
  {
    const f = await bootFrame('./panel-frame.html?layout=strip', 1280, 28);
    const w = f.contentWindow;
    const d = w.document;
    const q = (s) => d.querySelector(s);
    const rect = (el) => el.getBoundingClientRect();
    const vis = (el) => !!el && el.getClientRects().length > 0;
    check('the frame really is 1280 × 28', w.innerWidth === 1280 && w.innerHeight === 28);
    const parts = ['#ab', '.chip[data-key="video"] .chip-toggle', '.chip[data-key="audioEnabled"] .chip-toggle', '#preset-default', '#preset-save', '#strip-fold'];
    check(
      'the rail is one line: the A/B, the four chips, the presets and the fold button, all in view and vertically aligned',
      parts.every((s) => vis(q(s)) && rect(q(s)).top >= -0.5 && rect(q(s)).bottom <= w.innerHeight + 0.5) &&
        (() => {
          const mids = parts.map((s) => (rect(q(s)).top + rect(q(s)).bottom) / 2);
          return Math.max(...mids) - Math.min(...mids) <= 4;
        })()
    );
    check(
      'the rail hides the sections, the prefs, the MIDI block and the A/B’s caption',
      !vis(q('#controls')) && !vis(q('#prefs')) && !vis(q('.midi')) && !vis(q('.ab .ab-say'))
    );
    check('the fold button offers to unfold (▴) at the rail’s right end', q('#strip-fold').textContent === '▴' && rect(q('#strip-fold')).left > w.innerWidth - 60);
    check('nothing overflows the rail', d.documentElement.scrollWidth <= w.innerWidth && d.documentElement.scrollHeight <= w.innerHeight);
    q('#ab').dispatchEvent(new w.MouseEvent('mouseover', { bubbles: true }));
    await sleep(420);
    check('no hover help in the rail: there is no room for a bubble', q('#tooltip').hidden);
    // The A/B still works at 22 px.
    q('#ab').click();
    await sleep(90);
    check('the rail’s A/B latches', w.__store.enabled === false && !q('#ab').classList.contains('on'));
    q('#ab').click();
    await sleep(90);
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
    check(`at ${width} px every tip fits the bubble’s budget (${clip.join(', ') || 'all fit'})`, clip.length === 0);
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
