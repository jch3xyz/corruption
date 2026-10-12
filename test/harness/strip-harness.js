// Strip harness (design review M9, candidate B). Mounts the in-page strip
// from source/content/strip.js on a mock video page with hostile CSS, with
// no extension around it: the strip's iframe loads the shipped
// source/panel/panel.html?layout=strip, which runs on panel.js's own
// storage shim. Checks the housing — geometry, isolation from page CSS,
// collapse/expand by tab, keyboard and message, focus, fullscreen, tab
// visibility — and the failure path: a panel that never boots takes the
// strip down and leaves the page exactly as it was.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/strip.html

import { mountStrip } from '../../source/content/strip.js';

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
const SRC = '../../source/panel/panel.html?layout=strip';

async function until(fn, ms = 8000) {
  const deadline = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > deadline) return false;
    await sleep(40);
  }
  return true;
}

// What "the page" is, for the untouched checks: everything but the strip.
function pageSnapshot() {
  return JSON.stringify({
    html: document.documentElement.getAttribute('style'),
    body: document.body.getAttribute('style'),
    bodyKids: document.body.children.length,
    htmlKids: [...document.documentElement.children].filter((e) => e.tagName !== 'DEFLECTION-STRIP').length,
    scroll: [scrollX, scrollY],
  });
}

function keyP(target = window) {
  const e = new KeyboardEvent('keydown', {
    key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
  });
  target.dispatchEvent(e);
  return e;
}

function setFullscreen(el) {
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  document.dispatchEvent(new Event('fullscreenchange'));
}

function setVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

async function run() {
  status.innerHTML = '';
  const before = pageSnapshot();
  const input = document.getElementById('search');
  input.focus();

  tier('tier 1 — the housing, collapsed');
  const opened = [];
  const strip = mountStrip({ src: SRC, open: false, onOpenChange: (o) => opened.push(o) });
  check('the strip mounts', !!strip);
  const host = strip.host;
  const tab = strip.root.querySelector('.tab');
  const bar = strip.root.querySelector('.bar');
  check(
    'one <deflection-strip> host, on <html> (not <body>), behind a closed shadow root',
    document.querySelectorAll('deflection-strip').length === 1 &&
      host.parentElement === document.documentElement &&
      host.shadowRoot === null
  );
  check('mounting again hands back the same strip', mountStrip({ src: SRC }) === strip);
  const hs = getComputedStyle(host);
  check(
    'hostile page CSS cannot move or hide the host (fixed, bottom 0, full width, top of the stack)',
    hs.position === 'fixed' &&
      hs.display === 'block' &&
      hs.opacity === '1' &&
      hs.transform === 'none' &&
      Math.abs(host.getBoundingClientRect().bottom - innerHeight) < 1 &&
      Math.abs(host.getBoundingClientRect().width - document.documentElement.clientWidth) < 1 &&
      hs.zIndex === '2147483647'
  );
  check('collapsed by default: no iframe exists, so nothing in it can take focus', !strip.open && !strip.frame);
  const tr = tab.getBoundingClientRect();
  check(
    'collapsed, it is a thin tab at the bottom edge',
    getComputedStyle(tab).display !== 'none' &&
      tr.height > 10 && tr.height <= 20 &&
      Math.abs(tr.bottom - innerHeight) < 1 &&
      tr.width < 200
  );
  check(
    'collapsed, the page under the strip’s footprint is still the page',
    document.elementFromPoint(innerWidth / 2, innerHeight - 60) !== host &&
      document.elementFromPoint(40, innerHeight - 8) !== host
  );
  check('the tab is out of the page’s tab order', tab.tabIndex === -1);
  const md = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  tab.dispatchEvent(md);
  check('pressing the tab does not take focus (mousedown default prevented)', md.defaultPrevented);
  check('the page keeps its focus', document.activeElement === input);

  tier('tier 2 — expanded');
  tab.click();
  check('clicking the tab expands it and reports the change', strip.open && opened.join() === 'true');
  check('the iframe is the shipped panel in strip layout, allowed MIDI', !!strip.frame && strip.frame.getAttribute('src') === SRC && strip.frame.allow === 'midi');
  const br = bar.getBoundingClientRect();
  check(
    'expanded, the strip is full width, 120–160 px tall, at the bottom',
    br.height >= 120 && br.height <= 160 &&
      Math.abs(br.bottom - innerHeight) < 1 &&
      Math.abs(br.width - document.documentElement.clientWidth) < 1 &&
      getComputedStyle(strip.frame).display === 'block'
  );
  check('the tab rides on the strip’s top edge', Math.abs(tab.getBoundingClientRect().bottom - br.top) < 1);
  check('expanded, the strip is on top of the page (and its fixed footer)', document.elementFromPoint(innerWidth / 2, innerHeight - 20) === host);
  check('opening it did not move the page’s focus', document.activeElement === input);
  check('the panel inside boots and says so', await until(() => strip.ready));
  {
    const pd = strip.frame.contentDocument;
    await until(() => pd.querySelectorAll('#controls .section').length >= 2, 3000);
    const heads = [...pd.querySelectorAll('#controls .section')].map((h) => h.getBoundingClientRect());
    check(
      'inside, the panel is the strip layout: sections side by side',
      pd.documentElement.dataset.layout === 'strip' &&
        heads.length >= 2 && // Video and Audio (Text went with its slider, 2026-10-11)
        heads.every((r, i) => i === 0 || (r.left > heads[i - 1].right && Math.abs(r.top - heads[0].top) < 2))
    );
    check(
      'inside, nothing overflows the strip',
      pd.documentElement.scrollWidth <= strip.frame.clientWidth &&
        pd.documentElement.scrollHeight <= strip.frame.clientHeight
    );
  }

  tier('tier 3 — folding');
  const e1 = keyP();
  check('Ctrl+Shift+P on the page folds it (and the page never sees the key)', !strip.open && !strip.frame && e1.defaultPrevented);
  check('folded, the page keeps its focus', document.activeElement === input);
  keyP();
  check('Ctrl+Shift+P again unfolds it', strip.open && !!strip.frame);
  await until(() => strip.frame.contentDocument?.readyState === 'complete' && strip.frame.contentWindow.document.getElementById('ab'), 4000);
  await sleep(200);
  // Ctrl+Shift+P inside the panel (no Chrome command bound) is passed up.
  const inner = strip.frame.contentWindow;
  inner.document.dispatchEvent(
    new inner.KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
  );
  check('Ctrl+Shift+P inside the panel folds it too', await until(() => !strip.open, 1500));
  keyP();
  await until(() => !!strip.frame);
  window.postMessage({ type: 'deflection:strip', op: 'toggle' }, '*');
  await sleep(120);
  check('a lookalike message from the page itself is ignored', strip.open);
  check('every fold and unfold was reported for storage', opened.join() === 'true,false,true,false,true');

  tier('tier 4 — fullscreen and tab visibility');
  setFullscreen(document.getElementById('vid'));
  check('while anything is fullscreen the strip is hidden', getComputedStyle(host).display === 'none');
  check('hidden, not torn down: the panel keeps running under the video', !!strip.frame && strip.open);
  setFullscreen(null);
  check('leaving fullscreen brings it back', getComputedStyle(host).display === 'block');
  setVisibility('hidden');
  check('a hidden tab runs no panel (the iframe is dropped)', !strip.frame && strip.open);
  setVisibility('visible');
  check('the tab coming back rebuilds it', !!strip.frame);
  delete document.fullscreenElement;
  delete document.visibilityState;

  tier('tier 5 — never break the page');
  strip.destroy();
  check('destroy leaves no trace', document.querySelectorAll('deflection-strip').length === 0);
  check('and the page is as it was before the strip came', pageSnapshot() === before);

  let failedWhy = null;
  const broken = mountStrip({ src: './no-such-panel.html', open: true, readyTimeoutMs: 700, onFail: (w) => (failedWhy = w) });
  check('a strip whose panel never boots mounts at first', !!broken && document.querySelectorAll('deflection-strip').length === 1);
  await sleep(1100);
  check('then takes itself down and says why', document.querySelectorAll('deflection-strip').length === 0 && /did not boot/.test(failedWhy ?? ''));
  check('leaving the page untouched', pageSnapshot() === before);
  check('the page’s focus survived all of it', document.activeElement === input);

  // Leave a live strip for poking at (and for the screenshots).
  input.blur();
  const show = mountStrip({ src: SRC, open: new URLSearchParams(location.search).get('collapsed') !== '1' });
  window.__strip = show;
}

(async () => {
  try {
    await run();
  } catch (e) {
    check(`strip harness crashed (${e.message})`, false);
  }
  const done = document.createElement('div');
  done.id = 'done';
  done.textContent = `COMPLETE: ${passCount} passed, ${failCount} failed`;
  done.className = failCount === 0 ? 'pass' : 'fail';
  status.appendChild(done);
})();
