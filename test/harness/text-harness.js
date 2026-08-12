// Text-mode harness. Tier 1 checks the scramble grammar as a pure function,
// tier 2 drives the module page-wide against a synthetic document, tier 3
// asserts the registry actually calls it on the sweep and on the toggles.
// All pure DOM — no rVFC, no GL, no AudioContext — so unlike the visual
// suite this one is deterministic and immune to pane visibility.
//
// Assertions are structural invariants: conservation of every glyph, the
// integrity of word shape, reversibility, and the exclusions that keep the
// page functional (form values, live CSS, editable text).
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/text.html

import {
  TextScramble,
  qualifies,
  scramble,
} from '../../source/content/text-scramble.js';
import { Registry } from '../../source/content/registry.js';
import { DEFAULTS } from '../../source/content/params.js';

const status = document.getElementById('status');
const stage = document.getElementById('stage');
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

const TITLES = [
  'The Last Hour of Analog Television Broadcast',
  'Field Recording: Rain on a Corrugated Roof',
  'How the Compression Artifact Became a Style',
  'Nine Minutes Inside a Decommissioned Server Hall',
];

const glyphs = (s) => [...s].sort().join('');
const words = (s) => s.match(/[\p{L}\p{M}]+/gu) ?? [];
// Everything that is not a letter, with its position — the barrier map.
const barriers = (s) =>
  [...s].map((c, i) => (/[\p{L}\p{M}]/u.test(c) ? null : `${i}:${c}`)).filter(Boolean).join('|');

// The module ignores the harness's own UI via [data-deflection] on our
// status/stage wrappers' ancestors? No — the harness IS the page here, so
// tier 2 sandboxes what the module may touch by marking everything outside
// the stage as aria-hidden instead. See buildPage().

// --- Tier 1: the grammar as a pure function --------------------------------

function tier1() {
  const samples = [...TITLES, 'Café Society at 3:15 · Berlin', 'BROADCAST 🌐 SIGNAL TEST'];
  const results = samples.map((s) => ({ from: s, to: scramble(s) }));

  check(
    'every glyph is conserved — nothing added, nothing lost',
    results.every((r) => glyphs(r.from) === glyphs(r.to))
  );
  check(
    'letters never cross a barrier (each word keeps its own letters)',
    results.every((r) => {
      const a = words(r.from);
      const b = words(r.to);
      return a.length === b.length && a.every((w, i) => glyphs(w) === glyphs(b[i]));
    })
  );
  check(
    'word count and word lengths are unchanged',
    results.every((r) => {
      const a = words(r.from);
      const b = words(r.to);
      return a.every((w, i) => w.length === b[i].length);
    })
  );
  check(
    'spaces, punctuation, digits and emoji stay exactly where they were',
    results.every((r) => barriers(r.from) === barriers(r.to))
  );
  check('the text actually changes', results.every((r) => r.to !== r.from));
  check(
    'unscramblable words are left alone',
    scramble('I a aaa ooo 12:04 ●') === 'I a aaa ooo 12:04 ●'
  );
  check(
    'a combining accent travels with its base letter',
    (() => {
      const out = scramble('née Ångström overflowing');
      return glyphs(out) === glyphs('née Ångström overflowing') && !/^\p{M}/u.test(out);
    })()
  );
  check(
    'textMin is the only gate: long prose yes, short labels no',
    qualifies('The Last Hour of Analog Television', 12) &&
      !qualifies('Subscribe', 12) &&
      qualifies('Subscribe', 5) &&
      !qualifies('12:04 · 1.2 / 60 %', 12) // letterless runs never qualify
      // (a lone unit letter like "1.2M" does qualify — harmless, since
      // single letters between barriers cannot be rearranged anyway)
  );
}

// --- Tier 2: the module against a page -------------------------------------

function buildPage() {
  stage.innerHTML = `
    <nav>
      <a class="nav-link" href="/">Browse the whole library of recordings</a>
      <a class="nav-short" href="/">Home</a>
      <button class="nav-button">Subscribe to this excellent channel</button>
    </nav>
    <form role="search"><input id="search" value="documentary archive"><\/form>
    <textarea id="comment">A comment the visitor is still typing</textarea>
    <div id="editor" contenteditable="true">Editable words the site might save</div>
    <style id="livecss">.card { color: rgb(200, 200, 208); }</style>
    <div class="grid"></div>
    <p class="prose">An essay paragraph with no media anywhere near it, which
      the page-wide mode should dissolve exactly like a caption.</p>
    <span class="short">OK</span>`;
  const grid = stage.querySelector('.grid');
  for (const [i, t] of TITLES.entries()) {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <img alt="" width="240" height="135">
      <a class="title" href="/watch?v=${i}">\n      ${t}\n    </a>
      <span class="stats">247,891 views · 2 days ago</span>`;
    grid.appendChild(card);
  }

  // The module walks document.body; fence it into the stage by hiding the
  // harness's own chrome the same way sites hide decorative text.
  document.querySelector('h3').setAttribute('aria-hidden', 'true');
  document.querySelector('p').setAttribute('aria-hidden', 'true');
  status.setAttribute('aria-hidden', 'true');

  return {
    titles: [...stage.querySelectorAll('.title')].map((a) => a.firstChild),
    prose: stage.querySelector('.prose').firstChild,
  };
}

function tier2() {
  const { titles, prose } = buildPage();
  const originals = titles.map((n) => n.nodeValue);
  const proseOriginal = prose.nodeValue;
  const params = { ...DEFAULTS, enabled: true, textScramble: true, textMin: 12 };
  const ts = new TextScramble(params);

  // The registry's observer options exactly: if a write here produced a
  // childList record, discovery would re-scan on every pass and could loop.
  const mo = new MutationObserver(() => {});
  mo.observe(document.body, { childList: true, subtree: true });

  ts.update();
  const structural = mo.takeRecords();
  mo.disconnect();

  check(
    'captions scrambled',
    titles.every((n, i) => n.nodeValue !== originals[i])
  );
  check('prose far from any media scrambled too (page-wide)', prose.nodeValue !== proseOriginal);
  check(
    'long navigation text scrambled too — reach is textMin, not card',
    stage.querySelector('.nav-link').textContent !== 'Browse the whole library of recordings' &&
      stage.querySelector('.nav-button').textContent !== 'Subscribe to this excellent channel'
  );
  check(
    'every scrambled run conserves its own glyphs',
    titles.every((n, i) => glyphs(n.nodeValue) === glyphs(originals[i])) &&
      glyphs(prose.nodeValue) === glyphs(proseOriginal)
  );
  check(
    'no word borrows letters from another word',
    titles.every((n, i) => {
      const a = words(originals[i]);
      const b = words(n.nodeValue);
      return a.length === b.length && a.every((w, j) => glyphs(w) === glyphs(b[j]));
    })
  );
  check('no structural mutation — character data only', structural.length === 0);
  check(
    'surrounding whitespace preserved',
    titles.every((n) => /^\n {6}/.test(n.nodeValue) && /\n {4}$/.test(n.nodeValue))
  );

  // --- the exclusions that keep the page functional ---
  check(
    'short labels survive at textMin 12',
    stage.querySelector('.nav-short').textContent === 'Home' &&
      stage.querySelector('.short').textContent === 'OK'
  );
  check(
    'sub-25%-digit metadata is eligible, digits stay put',
    barriers(stage.querySelector('.stats').textContent) ===
      barriers('247,891 views · 2 days ago')
  );
  check(
    'form values untouched (search still works)',
    stage.querySelector('#search').value === 'documentary archive' &&
      stage.querySelector('#comment').value === 'A comment the visitor is still typing'
  );
  check(
    'contenteditable untouched (visitor data)',
    stage.querySelector('#editor').textContent === 'Editable words the site might save'
  );
  check(
    'live CSS untouched (scrambling style breaks layout, not rendering)',
    stage.querySelector('#livecss').textContent === '.card { color: rgb(200, 200, 208); }' &&
      getComputedStyle(stage.querySelector('.card')).color === 'rgb(200, 200, 208)'
  );
  check(
    'links still point where they did',
    [...stage.querySelectorAll('.title')].every((a, i) => a.getAttribute('href') === `/watch?v=${i}`)
  );

  // --- stability: text must not churn on every sweep ---
  const settled = titles.map((n) => n.nodeValue);
  ts.update();
  ts.update();
  check('re-running the sweep does not re-scramble', titles.every((n, i) => n.nodeValue === settled[i]));

  // --- text arriving later (infinite scroll) ---
  const late = document.createElement('p');
  late.className = 'late';
  late.textContent = 'An Evening of Uninterrupted Colour Bars';
  stage.appendChild(late);
  const lateNode = late.firstChild;
  ts.update();
  check(
    'text arriving later dissolves on the next sweep',
    lateNode.nodeValue !== 'An Evening of Uninterrupted Colour Bars' &&
      glyphs(lateNode.nodeValue) === glyphs('An Evening of Uninterrupted Colour Bars')
  );

  // --- the toggles are inert ---
  const frozen = titles.map((n) => n.nodeValue);
  const off = document.createElement('p');
  off.textContent = 'The Signal That Outlived Its Station';
  stage.appendChild(off);
  params.textScramble = false;
  ts.update();
  check('textScramble off is a no-op', off.textContent === 'The Signal That Outlived Its Station');
  params.textScramble = true;
  params.enabled = false;
  ts.update();
  check('the master switch stops it too', off.textContent === 'The Signal That Outlived Its Station');
  params.enabled = true;
  check('already-scrambled text did not move meanwhile', titles.every((n, i) => n.nodeValue === frozen[i]));

  // --- a site re-rendering a node we hold must never be clobbered ---
  const SITE = 'A caption the site rewrote after we scrambled it';
  titles[0].nodeValue = SITE;
  ts.update();
  ts.restoreAll();
  check('stale text is never written back over live content', titles[0].nodeValue === SITE);

  // --- reversibility (the kill switch's other half) ---
  check(
    'restore puts every caption and paragraph back',
    titles.slice(1).every((n, i) => n.nodeValue === originals[i + 1]) &&
      prose.nodeValue === proseOriginal &&
      lateNode.nodeValue === 'An Evening of Uninterrupted Colour Bars'
  );
  check('no records survive restore', ts.stats().scrambled === 0);

  // un-fence the harness chrome
  document.querySelector('h3').removeAttribute('aria-hidden');
  document.querySelector('p').removeAttribute('aria-hidden');
  status.removeAttribute('aria-hidden');
}

// --- Tier 3: the registry actually drives it -------------------------------

async function tier3() {
  stage.innerHTML = ''; // no media in the document: scan() creates no jobs
  const params = { ...DEFAULTS, enabled: true, textScramble: true };
  const registry = new Registry(params);
  const real = { update: registry.text.update, restoreAll: registry.text.restoreAll };

  let updates = 0;
  let restores = 0;
  registry.text.update = () => updates++;
  registry.text.restoreAll = () => restores++;

  registry.sweep();
  check('the sweep feeds the text mode', updates === 1);

  // Toggle and textMin edits are debounced (the panel drags at ~30 Hz and a
  // pass walks the whole document), so these assertions wait out the 200 ms.
  const settle = () => new Promise((r) => setTimeout(r, 300));

  params.textScramble = false;
  registry.paramsChanged({ textScramble: false });
  await settle();
  check('toggling text scramble off restores (debounced)', restores >= 1);

  params.textScramble = true;
  const beforeToggle = updates;
  registry.paramsChanged({ textScramble: true });
  await settle();
  check('toggling it on applies without waiting for the sweep', updates === beforeToggle + 1);

  const beforeMin = { updates, restores };
  params.textMin = 4;
  registry.paramsChanged({ textMin: 4 });
  registry.paramsChanged({ textMin: 3 });
  registry.paramsChanged({ textMin: 2 });
  await settle();
  check(
    'a textMin drag restores and re-applies once, not per tick',
    restores === beforeMin.restores + 1 && updates === beforeMin.updates + 1
  );

  const priorRestores = restores;
  params.enabled = false;
  registry.paramsChanged({ enabled: false });
  check('the kill switch restores immediately (not debounced)', restores > priorRestores);

  Object.assign(registry.text, real);
  check('text state is reported in stats()', registry.stats().text?.scrambled === 0);
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
    tier2();
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
