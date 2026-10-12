// Strip harness (design review M9; the default home since 2026-10-11).
// Mounts the in-page strip from source/content/strip.js on a mock video
// page with hostile CSS, with no extension around it: the strip's iframe
// loads the shipped source/panel/panel.html?layout=strip, which runs on
// panel.js's own storage shim. Checks the housing — the 28 px rail at rest,
// the 208 px mixer when open, isolation from page CSS, fold/unfold by the
// panel's button, keyboard and message, focus, fullscreen, tab visibility —
// and the failure path: a panel that never boots takes the strip down and
// leaves the page exactly as it was.
//
// Run: python3 test/serve.py  →  http://localhost:8437/test/harness/strip.html

import { mountStrip, RAIL_HEIGHT, STRIP_HEIGHT } from '../../source/content/strip.js';

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

  tier('tier 1 — the housing, at rest: the rail');
  const opened = [];
  const strip = mountStrip({ src: SRC, open: false, onOpenChange: (o) => opened.push(o) });
  check('the strip mounts', !!strip);
  const host = strip.host;
  const bar = strip.root.querySelector('.bar');
  check(
    'one <deflection-strip> host, on <html> (not <body>), behind a closed shadow root',
    document.querySelectorAll('deflection-strip').length === 1 &&
      host.parentElement === document.documentElement &&
      host.shadowRoot === null
  );
  check('mounting again hands back the same strip', mountStrip({ src: SRC }) === strip);
  check('no tab anywhere: the rail is the panel itself', !strip.root.querySelector('.tab'));
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
  check('at rest the strip is not open, and the iframe is already there (the rail is the panel at 28 px)', !strip.open && !!strip.frame);
  if (!strip.frame) throw new Error('no iframe: the page reports itself hidden (a background or hidden tab) — run in a visible tab or node test/headless.mjs strip');
  const rr = bar.getBoundingClientRect();
  check(
    `at rest it is one rail, ${RAIL_HEIGHT} px tall, full width, at the bottom edge`,
    Math.abs(rr.height - RAIL_HEIGHT) < 1 &&
      Math.abs(rr.bottom - innerHeight) < 1 &&
      Math.abs(rr.width - document.documentElement.clientWidth) < 1 &&
      getComputedStyle(strip.frame).display === 'block'
  );
  check(
    'above the rail, the page under the strip’s footprint is still the page',
    document.elementFromPoint(innerWidth / 2, innerHeight - RAIL_HEIGHT - 20) !== host &&
      document.elementFromPoint(40, innerHeight - RAIL_HEIGHT - 4) !== host
  );
  check('on the rail, the strip is on top of the page (and its fixed footer)', document.elementFromPoint(innerWidth / 2, innerHeight - 10) === host);
  check('the iframe is the shipped panel in strip layout, allowed MIDI, out of the page’s tab order', strip.frame.getAttribute('src') === SRC && strip.frame.allow === 'midi' && strip.frame.tabIndex === -1);
  check('mounting did not take the page’s focus', document.activeElement === input);
  check('the panel inside boots and says so', await until(() => strip.ready));
  const pd = () => strip.frame.contentDocument;
  await until(() => pd()?.getElementById('strip-fold') && pd().getElementById('ab'), 4000);
  {
    const d = pd();
    const fold = d.getElementById('strip-fold');
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.top >= -0.5 && r.bottom <= strip.frame.clientHeight + 0.5;
    };
    check(
      'the rail shows the A/B, the four chips, the presets and the fold button, and hides the sections',
      inView(d.getElementById('ab')) && inView(d.querySelector('.chips')) && inView(d.getElementById('presets')) &&
        inView(fold) && d.getElementById('controls').getClientRects().length === 0
    );
    check('the fold button offers to unfold (▴)', fold.textContent === '▴' && fold.getAttribute('aria-expanded') === 'false');
    check('nothing inside the rail overflows it', d.documentElement.scrollHeight <= strip.frame.clientHeight && d.documentElement.scrollWidth <= strip.frame.clientWidth);
  }

  tier('tier 2 — unfolded: the mixer');
  pd().getElementById('strip-fold').click();
  check('the panel’s fold button unfolds the strip and reports the change', await until(() => strip.open, 1500) && opened.join() === 'true');
  const br = bar.getBoundingClientRect();
  check(
    `unfolded, the strip is full width, ${STRIP_HEIGHT} px tall, at the bottom`,
    Math.abs(br.height - STRIP_HEIGHT) < 1 &&
      Math.abs(br.bottom - innerHeight) < 1 &&
      Math.abs(br.width - document.documentElement.clientWidth) < 1
  );
  check('the same iframe serves both heights (no reload)', !!strip.frame && strip.ready && pd().getElementById('ab') !== null);
  check('unfolding did not move the page’s focus', document.activeElement === input);
  await sleep(150);
  {
    const d = pd();
    await until(() => d.querySelectorAll('#controls .section').length >= 2, 3000);
    const heads = [...d.querySelectorAll('#controls .section')].map((h) => h.getBoundingClientRect());
    check(
      'inside, the panel is the mixer: sections side by side',
      d.documentElement.dataset.layout === 'mixer' &&
        heads.length >= 2 && // Video and Audio (Text went with its slider, 2026-10-11)
        heads.every((r, i) => i === 0 || (r.left > heads[i - 1].right && Math.abs(r.top - heads[0].top) < 2))
    );
    check('the fold button now offers to fold (▾)', await until(() => d.getElementById('strip-fold').textContent === '▾', 1500));
    check(
      'inside, nothing overflows the strip',
      d.documentElement.scrollWidth <= strip.frame.clientWidth &&
        d.documentElement.scrollHeight <= strip.frame.clientHeight
    );
  }

  tier('tier 3 — folding');
  const e1 = keyP();
  check('Ctrl+Shift+P on the page folds it to the rail (and the page never sees the key)', !strip.open && !!strip.frame && e1.defaultPrevented && Math.abs(bar.getBoundingClientRect().height - RAIL_HEIGHT) < 1);
  check('folded, the page keeps its focus', document.activeElement === input);
  keyP();
  check('Ctrl+Shift+P again unfolds it', strip.open && !!strip.frame);
  await sleep(200);
  // Ctrl+Shift+P inside the panel (no Chrome command bound) is passed up.
  const inner = strip.frame.contentWindow;
  inner.document.dispatchEvent(
    new inner.KeyboardEvent('keydown', { key: 'P', code: 'KeyP', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })
  );
  check('Ctrl+Shift+P inside the panel folds it too', await until(() => !strip.open, 1500));
  keyP();
  await until(() => strip.open);
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
  check('a hidden tab runs no panel (the iframe is dropped, the strip stays as it was)', !strip.frame && strip.open);
  setVisibility('visible');
  check('the tab coming back rebuilds it', !!strip.frame);
  strip.setOpen(false);
  setVisibility('hidden');
  check('the rail too: a hidden tab drops its frame', !strip.frame && !strip.open);
  setVisibility('visible');
  check('and gets it back', !!strip.frame);
  strip.setOpen(true);
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
