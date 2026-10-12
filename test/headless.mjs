#!/usr/bin/env node
// Run one or more harness pages in headless Chrome and print each suite's
// verdict and its failures. No dependencies: Node's built-in WebSocket
// talks to Chrome over the DevTools protocol.
//
//   node test/headless.mjs panel strip text        # with test/serve.py running
//   node test/headless.mjs http://localhost:8437/test/harness/audio.html
//
// Screenshots, for looking at a layout without a visible tab:
//   HARNESS_SHOT_DIR=/tmp/shots HARNESS_VIEWPORT=1280x800 node test/headless.mjs strip
// saves <page>.png after each suite completes. For a page that is not a
// suite (panel-frame.html?layout=strip, say) set HARNESS_NO_SUITE=1 and the
// runner waits HARNESS_WAIT_MS (default 1500) and shoots.
//
// A headless page counts as visible, so the pure-DOM suites (panel, strip,
// text, audio tiers 1–2) run deterministically here. The visual suite
// (index.html) still needs a real, visible tab — rVFC starves otherwise.
//
// Chrome: $CHROME, else Google Chrome in /Applications.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME =
  process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.HARNESS_BASE || 'http://localhost:8437/test/harness/';
const TIMEOUT_MS = Number(process.env.HARNESS_TIMEOUT || 90000);
const SHOT_DIR = process.env.HARNESS_SHOT_DIR || '';
const NO_SUITE = process.env.HARNESS_NO_SUITE === '1';
const WAIT_MS = Number(process.env.HARNESS_WAIT_MS || 1500);
const [VIEW_W, VIEW_H] = (process.env.HARNESS_VIEWPORT || '1400x900').split('x').map(Number);

const pages = process.argv.slice(2);
if (!pages.length) {
  console.error('usage: node test/headless.mjs <panel|strip|text|audio|url> ...');
  process.exit(2);
}
// A bare suite name (panel) becomes its page; anything with an extension or
// a query string is used as written, relative to BASE.
const urls = pages.map((p) => (/^https?:/.test(p) ? p : /[.?]/.test(p) ? `${BASE}${p}` : `${BASE}${p}.html`));

const profile = mkdtempSync(join(tmpdir(), 'corruption-headless-'));
const port = 9222 + Math.floor(Math.random() * 500);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${VIEW_W},${VIEW_H}`,
    'about:blank',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
);
let chromeErr = '';
chrome.stderr.on('data', (d) => (chromeErr += d));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDevtools() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return r.json();
    } catch {
      // not up yet
    }
    await sleep(100);
  }
  throw new Error(`Chrome did not expose DevTools on ${port}\n${chromeErr}`);
}

// A minimal CDP session over one page's websocket.
function session(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && waiting.has(msg.id)) {
      const { resolve, reject } = waiting.get(msg.id);
      waiting.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
    }
  });
  const open = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return {
    open,
    events,
    send(method, params = {}) {
      const myId = ++id;
      ws.send(JSON.stringify({ id: myId, method, params }));
      return new Promise((resolve, reject) => waiting.set(myId, { resolve, reject }));
    },
    close() {
      ws.close();
    },
  };
}

async function runPage(url) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const s = session(target.webSocketDebuggerUrl);
  await s.open;
  await s.send('Runtime.enable');
  await s.send('Page.enable');
  await s.send('Emulation.setDeviceMetricsOverride', { width: VIEW_W, height: VIEW_H, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url });
  const deadline = Date.now() + TIMEOUT_MS;
  const probe = `(() => {
    const done = document.getElementById('done');
    const txt = document.body ? document.body.innerText : '';
    const m = txt.match(/COMPLETE: \\d+ passed, \\d+ failed/);
    if (!done && !m) return null;
    const fails = [...document.querySelectorAll('.fail')].map((e) => e.textContent).filter((t) => !/^COMPLETE/.test(t));
    return JSON.stringify({ verdict: done ? done.textContent : m[0], fails });
  })()`;
  let result = null;
  if (NO_SUITE) {
    await sleep(WAIT_MS);
    result = { verdict: 'no suite: shot only', fails: [] };
  } else {
    while (Date.now() < deadline) {
      const { result: r } = await s.send('Runtime.evaluate', { expression: probe, returnByValue: true });
      if (r.value) {
        result = JSON.parse(r.value);
        break;
      }
      await sleep(250);
    }
  }
  if (SHOT_DIR) {
    await sleep(300);
    const { data } = await s.send('Page.captureScreenshot', { format: 'png' });
    mkdirSync(SHOT_DIR, { recursive: true });
    const name = url.replace(BASE, '').replace(/[^\w.-]+/g, '_') || 'page';
    writeFileSync(join(SHOT_DIR, `${name}.png`), Buffer.from(data, 'base64'));
  }
  const consoleErrors = s.events
    .filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text);
  s.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
  return { url, result, consoleErrors };
}

let failed = false;
try {
  await waitForDevtools();
  for (const url of urls) {
    const { result, consoleErrors } = await runPage(url);
    const name = url.replace(BASE, '');
    if (!result) {
      failed = true;
      console.log(`${name}: TIMEOUT after ${TIMEOUT_MS} ms (no COMPLETE line)`);
    } else {
      console.log(`${name}: ${result.verdict}`);
      for (const f of result.fails) console.log(`  ${f}`);
      if (result.fails.length) failed = true;
    }
    for (const e of consoleErrors) console.log(`  [exception] ${e}`);
  }
} catch (err) {
  failed = true;
  console.error(err.message);
} finally {
  // Let Chrome exit before the profile is removed, or rmSync races its writes.
  const gone = new Promise((r) => chrome.once('exit', r));
  chrome.kill();
  await Promise.race([gone, sleep(3000)]);
  for (let i = 0; i < 5; i++) {
    try {
      rmSync(profile, { recursive: true, force: true });
      break;
    } catch {
      await sleep(200);
    }
  }
}
process.exit(failed ? 1 : 0);
