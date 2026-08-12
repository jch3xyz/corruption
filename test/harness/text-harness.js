// Text-mode harness. Tier 1 drives the TextSwap module against a synthetic
// page (cards with media, chrome without); tier 2 asserts the registry
// actually calls it on the sweep and on the toggles. Both tiers are pure DOM
// — no rVFC, no GL, no AudioContext — so unlike the visual suite this one is
// immune to pane visibility and runs deterministically anywhere.
//
// Assertions are structural invariants: conservation of the page's text,
// reversibility, and the containment of the effect to media captions.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/text.html

import { TextSwap, qualifies, bucketOf } from '../../source/content/text-swap.js';
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

const MEDIUM = [
  'The Last Hour of Analog Television Broadcast',
  'Field Recording: Rain on a Corrugated Roof',
  'How the Compression Artifact Became a Style',
  'Nine Minutes Inside a Decommissioned Server Hall',
  'A Complete History of the Test Pattern',
  'Why Every Feed Looks the Same Now',
];
const SHORT = [
  'Rain on the Roof',
  'Test Pattern Loop',
  'Server Hall Tour',
  'Analog Sign Off',
];
const TITLES = [...MEDIUM, ...SHORT];
const STACKED = 'A Tile That Plays Before You Reach It';
const ABANDONED = 'The Film That Refused To Be Sorted';

// A card the module can read: one medium, a title, and metadata it must not
// touch. Whitespace around the title mimics a framework-rendered text node.
function makeCard(title, i, extra = '') {
  const card = document.createElement('div');
  card.className = 'card';
  card.innerHTML = `
    <div class="thumb"><img alt="" width="240" height="135">${extra}</div>
    <div class="meta">
      <a class="title" href="/watch?v=${i}">\n      ${title}\n    </a>
      <span class="stats">247,891 views · 2 days ago</span>
      <span class="dur">12:04</span>
    </div>`;
  return card;
}

// The text node inside a title anchor (the node the module actually writes).
const titleNode = (el) => el.firstChild;
const shown = (node) => node.nodeValue.trim();
const sorted = (arr) => [...arr].sort();
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

function buildPage() {
  stage.innerHTML = `
    <nav>
      <a class="nav-link" href="/">Browse the whole library</a>
      <button class="nav-button">Subscribe to this channel</button>
      <form role="search"><input id="search" value="documentary archive"></form>
    </nav>
    <div class="grid"></div>
    <div class="card textonly">
      <p class="loose">An essay with no media in its card at all</p>
    </div>`;
  const grid = stage.querySelector('.grid');
  TITLES.forEach((t, i) => grid.appendChild(makeCard(t, i)));

  // A feed tile in the Instagram shape: a preview <video> stacked over its
  // own thumbnail. Two tracked media, one card — the climb must not stop.
  const stacked = makeCard(STACKED, TITLES.length, '<video class="preview"></video>');
  stacked.classList.add('stacked');
  grid.appendChild(stacked);

  // Media the pipeline gave up on (DRM, unrecoverable taint) is simply absent
  // from the tracked set: its picture is real, so its caption stays real.
  const abandoned = makeCard(ABANDONED, TITLES.length + 1);
  abandoned.classList.add('abandoned');
  grid.appendChild(abandoned);

  const media = new Set([
    ...grid.querySelectorAll('.card:not(.abandoned) img'),
    ...grid.querySelectorAll('video'),
  ]);
  const cards = [...grid.querySelectorAll('.card:not(.abandoned)')];
  return {
    media,
    titles: cards.map((c) => titleNode(c.querySelector('.title'))),
    abandonedNode: titleNode(abandoned.querySelector('.title')),
  };
}

function tier1() {
  // --- what counts as a caption at all ---
  const yes = [...TITLES, STACKED, ABANDONED].every(qualifies);
  const no = ['12:04', '1.2M views', '247,891 views · 2 days ago', 'Subscribe', '2026', '   ']
    .every((s) => !qualifies(s));
  check('captions qualify, metadata and labels do not', yes && no);

  const { media, titles, abandonedNode } = buildPage();
  const originals = titles.map(shown);
  const params = { ...DEFAULTS, enabled: true, textSwap: true };
  const ts = new TextSwap(params);

  // The registry's observer options exactly: if a write here produced a
  // childList record, discovery would re-scan on every swap and could loop.
  const mo = new MutationObserver(() => {});
  mo.observe(stage, { childList: true, subtree: true });

  ts.update(media);
  const structural = mo.takeRecords();
  mo.disconnect();

  const after = titles.map(shown);
  check(
    'every caption swapped, none keeps its own text',
    after.length === originals.length && after.every((t, i) => t !== originals[i])
  );
  check('nothing added, nothing lost (text conserved)', same(after, originals));
  check(
    'every displayed caption is a real caption from another card',
    after.every((t) => originals.includes(t))
  );
  check(
    'swaps stay inside a length class (layout holds)',
    after.every((t, i) => bucketOf(t) === bucketOf(originals[i]))
  );
  check('no structural mutation — character data only', structural.length === 0);
  check(
    'surrounding whitespace preserved',
    titles.every((n) => /^\n {6}/.test(n.nodeValue) && /\n {4}$/.test(n.nodeValue))
  );

  // --- the card boundary ---
  check(
    'a tile stacking video over its thumbnail is still one card',
    shown(titles[titles.length - 1]) !== STACKED
  );
  check('media the pipeline abandoned keeps its real caption', shown(abandonedNode) === ABANDONED);
  check(
    'navigation, buttons and search untouched',
    stage.querySelector('.nav-link').textContent === 'Browse the whole library' &&
      stage.querySelector('.nav-button').textContent === 'Subscribe to this channel' &&
      stage.querySelector('#search').value === 'documentary archive'
  );
  check(
    'a card with no media is untouched',
    stage.querySelector('.loose').textContent === 'An essay with no media in its card at all'
  );
  check(
    'metadata inside a swapped card is untouched',
    [...stage.querySelectorAll('.stats')].every((e) => e.textContent === '247,891 views · 2 days ago') &&
      [...stage.querySelectorAll('.dur')].every((e) => e.textContent === '12:04')
  );
  check(
    'links still point where they did',
    [...stage.querySelectorAll('.title')].every((a, i) => a.getAttribute('href') === `/watch?v=${i}`)
  );

  // --- stability ---
  const settled = titles.map(shown);
  ts.update(media);
  ts.update(media);
  check('re-running the sweep does not re-shuffle', titles.every((n, i) => shown(n) === settled[i]));

  // --- a card arriving later (infinite scroll) trades with the pool ---
  const late = makeCard('An Evening of Uninterrupted Colour Bars', 99);
  stage.querySelector('.grid').appendChild(late);
  const lateNode = titleNode(late.querySelector('.title'));
  const lateOriginal = shown(lateNode);
  media.add(late.querySelector('img'));
  ts.update(media);
  check(
    'a card arriving alone still trades (donor pool)',
    shown(lateNode) !== lateOriginal && originals.includes(shown(lateNode))
  );

  // --- the toggle is inert when off ---
  const frozen = titles.map(shown);
  const off = makeCard('The Signal That Outlived Its Station', 100);
  stage.querySelector('.grid').appendChild(off);
  const offNode = titleNode(off.querySelector('.title'));
  media.add(off.querySelector('img'));
  params.textSwap = false;
  ts.update(media);
  check('textSwap off is a no-op', shown(offNode) === 'The Signal That Outlived Its Station');
  params.textSwap = true;
  params.enabled = false;
  ts.update(media);
  check('the master switch stops it too', shown(offNode) === 'The Signal That Outlived Its Station');
  params.enabled = true;
  check('already-swapped captions did not move meanwhile', titles.every((n, i) => shown(n) === frozen[i]));

  // --- a site re-rendering a node we hold must never be clobbered ---
  const SITE = 'A caption the site rewrote after we swapped it';
  titles[0].nodeValue = SITE;
  ts.update(media);
  ts.restoreAll();
  check('a stale caption is never written back over live content', titles[0].nodeValue === SITE);

  // --- reversibility (the kill switch's other half) ---
  check(
    'restore puts every caption back',
    titles.slice(1).every((n, i) => shown(n) === originals[i + 1])
  );
  check(
    'restore also releases the late arrival',
    shown(lateNode) === lateOriginal && ts.stats().swapped === 0
  );
}

// --- Tier 2: the registry actually drives it -------------------------------

function tier2() {
  stage.innerHTML = ''; // no media in the document: scan() creates no jobs
  const params = { ...DEFAULTS, enabled: true, textSwap: true };
  const registry = new Registry(params);
  const real = { update: registry.text.update, restoreAll: registry.text.restoreAll };

  let updates = 0;
  let restores = 0;
  registry.text.update = () => updates++;
  registry.text.restoreAll = () => restores++;

  registry.sweep();
  check('the sweep feeds the text mode', updates === 1);

  params.textSwap = false;
  registry.paramsChanged({ textSwap: false });
  check('toggling text swap off restores immediately', restores >= 1);

  params.textSwap = true;
  const before = updates;
  registry.paramsChanged({ textSwap: true });
  check('toggling it on applies without waiting for the sweep', updates === before + 1);

  const priorRestores = restores;
  params.enabled = false;
  registry.paramsChanged({ enabled: false });
  check('the kill switch restores the captions', restores > priorRestores);

  Object.assign(registry.text, real);
  check('text state is reported in stats()', registry.stats().text?.swapped === 0);
}

// --- run --------------------------------------------------------------------

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
const done = document.createElement('div');
done.id = 'done';
done.textContent = `COMPLETE: ${passCount} passed, ${failCount} failed`;
done.className = failCount === 0 ? 'pass' : 'fail';
status.appendChild(done);
