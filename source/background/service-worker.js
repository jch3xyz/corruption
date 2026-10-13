// Module service worker. Opens the control panel (toolbar icon or
// Ctrl+Shift+P) and toggles the effect (Ctrl+Shift+D). The panel is an
// extension page — Web MIDI permission is per-origin, so granting it once
// there persists in the kiosk profile.
//
// Where the panel opens is the stored preference `panelHome` (design review
// M9; John chose the strip 2026-10-11, then the window 2026-10-12 once the
// window answered to its own shape):
//   'window' — its own popup window (every fallback), reopened at the size
//              and place it was last left (panelBounds, below). The default.
//   'strip'  — a horizontal strip the content script puts along the bottom
//              of the page (source/content/strip.js): a one-line rail at
//              rest, the mixer when unfolded;
//   'side'   — Chrome's side panel, docked in the browser window (Chrome
//              114+; same extension origin, so the MIDI grant should carry).
// A change applies on the next open. Every side-panel and strip call is
// guarded: a Chrome without the API, a page with no content script
// (chrome://, the Web Store), or a strip that failed to mount all fall
// through to the window, so the panel is always reachable.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[DEFLECTION] installed', reason);
});

const HOMES = ['window', 'side', 'strip'];
const DEFAULT_HOME = 'window';
let panelHome = DEFAULT_HOME;
let homeKnown = false;

function setHome(value) {
  panelHome = HOMES.includes(value) ? value : DEFAULT_HOME;
  homeKnown = true;
  // With the side panel chosen, Chrome itself opens it on a toolbar click
  // (and action.onClicked stops firing); otherwise the click comes to us.
  // Chrome keeps this behaviour across worker restarts.
  try {
    chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: panelHome === 'side' })?.catch?.(() => {});
  } catch {
    // no side panel API: the click handler below covers every home
  }
}

const homeLoaded = chrome.storage.local
  .get({ panelHome: DEFAULT_HOME })
  .then(({ panelHome: h }) => setHome(h))
  .catch(() => setHome(DEFAULT_HOME));

try {
  chrome.sidePanel?.setOptions?.({ path: 'panel/panel.html', enabled: true })?.catch?.(() => {});
} catch {
  // Chrome before 114: no side panel, the window serves
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'panelHome' in changes) setHome(changes.panelHome.newValue);
});

// sidePanel.open() only works inside the user gesture, so callers start it
// synchronously from the event — no await before it. Resolves true when the
// side panel opened.
function openSide(tab) {
  try {
    if (!chrome.sidePanel?.open || tab?.windowId === undefined) return Promise.resolve(false);
    return chrome.sidePanel.open({ windowId: tab.windowId }).then(
      () => true,
      (err) => {
        console.warn('[DEFLECTION] side panel', err);
        return false;
      }
    );
  } catch (err) {
    console.warn('[DEFLECTION] side panel', err);
    return Promise.resolve(false);
  }
}

// Ask the tab's top-frame content script to fold/unfold its strip. True only
// if the strip answered that it is on the page.
async function toggleStrip(tab) {
  if (tab?.id === undefined) return false;
  try {
    const reply = await chrome.tabs.sendMessage(
      tab.id,
      { type: 'deflection:strip', op: 'toggle' },
      { frameId: 0 }
    );
    return reply?.ok === true;
  } catch {
    return false; // no content script on this page
  }
}

async function activeTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tab ?? null;
  } catch {
    return null;
  }
}

// The one way in. `sideAttempt` is the side-panel promise the event handler
// already started inside the gesture, when the home was known to be 'side'.
async function openPanel(tab, sideAttempt = null) {
  try {
    if (sideAttempt) {
      if (await sideAttempt) return;
    } else {
      if (!homeKnown) await homeLoaded;
      tab = tab ?? (await activeTab());
      // The worker woke on this very event: the gesture is probably spent,
      // but the attempt costs nothing and the window catches a refusal.
      if (panelHome === 'side' && (await openSide(tab))) return;
      if (panelHome === 'strip' && (await toggleStrip(tab))) return;
    }
  } catch (err) {
    console.warn('[DEFLECTION] panel home', err);
  }
  await openWindow();
}

const startSide = (tab) => (homeKnown && panelHome === 'side' ? openSide(tab) : null);

// The panel window's size and place are remembered (round 4b): the panel's
// layout follows its shape (panel.js: at least 900 px wide and 2:1 is the
// mixer, anything else the column), so the player drags the window wide for
// the mixer or tall for the column, puts it where it belongs (a second
// screen, for the performer), and it comes back the same on the next open.
// `panelBounds` = {width, height, left, top} in chrome.storage.local, panel
// furniture outside DEFAULTS. A missing or bad value opens the old 400 × 720.
const WINDOW_DEFAULT = { width: 400, height: 720 };
const BOUNDS_SAVE_MS = 400;

function validBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const { width, height, left, top } = b;
  if (![width, height, left, top].every(Number.isInteger)) return null;
  if (width < 320 || height < 200) return null;
  return { width, height, left, top };
}

// The worker sleeps after ~30 s idle and forgets this id; the session
// store (cleared when the browser closes, like the window) keeps it, so a
// drag long after the open is still recognised as the panel's, and a
// second open focuses the window instead of making another.
let panelWindowId = null;
const rememberWindow = (id) => {
  panelWindowId = id;
  try {
    chrome.storage.session?.set?.({ panelWindowId: id })?.catch?.(() => {});
  } catch {
    // no session storage: the id lives as long as this worker
  }
};
const windowKnown = (async () => {
  try {
    const got = await chrome.storage.session?.get?.('panelWindowId');
    if (panelWindowId === null && Number.isInteger(got?.panelWindowId)) panelWindowId = got.panelWindowId;
  } catch {
    // unknown: the next open makes a window
  }
})();

async function openWindow() {
  await windowKnown;
  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch {
      rememberWindow(null); // window is gone; fall through and create
    }
  }
  const base = { url: chrome.runtime.getURL('panel/panel.html'), type: 'popup' };
  let bounds = null;
  try {
    bounds = validBounds((await chrome.storage.local.get('panelBounds')).panelBounds);
  } catch {
    // unreadable: open at the default size
  }
  let win;
  try {
    win = await chrome.windows.create({ ...base, ...(bounds ?? WINDOW_DEFAULT) });
  } catch (err) {
    // A remembered place Chrome refuses (a screen since unplugged, say)
    // must never cost the panel: open at the default size instead.
    if (!bounds) throw err;
    console.warn('[DEFLECTION] remembered panel bounds refused', err);
    win = await chrome.windows.create({ ...base, ...WINDOW_DEFAULT });
  }
  rememberWindow(win.id);
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWindowId) rememberWindow(null);
});

// Debounced: a drag fires this many times; only where it settles is kept.
// Maximised, minimised and fullscreen are not shapes to come back to.
let boundsTimer = null;
chrome.windows.onBoundsChanged?.addListener(async (win) => {
  await windowKnown;
  if (win.id !== panelWindowId || (win.state && win.state !== 'normal')) return;
  const bounds = validBounds(win);
  if (!bounds) return;
  clearTimeout(boundsTimer);
  boundsTimer = setTimeout(() => {
    chrome.storage.local.set({ panelBounds: bounds }).catch(() => {});
  }, BOUNDS_SAVE_MS);
});

async function toggleEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !enabled });
  console.log('[DEFLECTION] enabled →', !enabled);
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-effect') toggleEnabled();
  if (command === 'open-panel') openPanel(tab, startSide(tab));
});

// Fires for 'window' and 'strip' — and for 'side' only when Chrome could not
// take the click itself (no side panel API, or the behaviour not yet set).
chrome.action.onClicked.addListener((tab) => openPanel(tab, startSide(tab)));

// The seam outside the panel (design review finding 1 / M1): the toolbar
// icon says whether the piece is on. Badge "ON" in the A/B's yellow, blank
// when off; the hover title says the same in words. Nothing in-page — a
// first-run mark is John's call and deliberately absent.
const BADGE_YELLOW = '#e8e864';
const TITLE_BASE = 'CORRUPTION — click to play, Ctrl+Shift+D on/off';

async function refreshBadge(enabled) {
  if (enabled === undefined) {
    ({ enabled = true } = await chrome.storage.local.get('enabled'));
  }
  enabled = enabled !== false;
  try {
    await chrome.action.setBadgeText({ text: enabled ? 'ON' : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_YELLOW });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#131316' });
    }
    await chrome.action.setTitle({
      title: `${TITLE_BASE}\n${enabled ? 'ON — bending every page' : 'OFF — pages untouched'}`,
    });
  } catch (err) {
    console.warn('[DEFLECTION] badge', err);
  }
}

chrome.runtime.onStartup.addListener(() => refreshBadge());
chrome.runtime.onInstalled.addListener(() => refreshBadge());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && 'enabled' in changes) refreshBadge(changes.enabled.newValue);
});
refreshBadge(); // every service-worker wake: the badge can never go stale

// Image-path fallback (route 3): host permissions let the SW fetch what
// page CORS won't allow. MV3 messaging JSON-serializes, so bytes travel as
// a base64 data URL — ugly but universal, and rare (the DNR header rule
// handles most cases as route 2).
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'fetch-image') return;
  (async () => {
    try {
      const resp = await fetch(msg.url, { credentials: 'omit' });
      if (!resp.ok) throw new Error(`http ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > MAX_IMAGE_BYTES) throw new Error('too large');
      const type = resp.headers.get('content-type') || 'image/jpeg';
      const bytes = new Uint8Array(buf);
      let binary = '';
      const CHUNK = 0x8000;
      for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
      }
      sendResponse({ ok: true, dataUrl: `data:${type};base64,${btoa(binary)}` });
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();
  return true; // async response
});

// Audio status for the panel (design review finding 7). Every content
// script frame posts its registry's audio counts — `{type:
// 'deflection:stats', op: 'put', audio: {taps, engaged}}` — on change and
// every ~2 s while it has taps. Kept per tab, per frame, in memory only: a
// worker restart loses it and the next post refills it. The panel asks for
// the active tab's sum (`op: 'get'`) and is pushed changes (`op: 'push'`).
const STATS_TYPE = 'deflection:stats';
const STATS_STALE_MS = 6000; // a frame with taps that stops posting is gone
const tabStats = new Map(); // tabId → Map(frameId → { taps, engaged, at })

function tabAudio(tabId) {
  const frames = tabStats.get(tabId);
  if (!frames) return null;
  const now = Date.now();
  let taps = 0;
  let engaged = 0;
  for (const [frameId, f] of frames) {
    if (f.taps > 0 && now - f.at > STATS_STALE_MS) {
      frames.delete(frameId);
      continue;
    }
    taps += f.taps;
    engaged += f.engaged;
  }
  return { taps, engaged };
}

async function activeTabId() {
  // The panel is its own popup window, so "active" means the active tab of
  // the last-focused normal window — the page the player is looking at.
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return tab?.id ?? null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== STATS_TYPE) return;
  if (msg.op === 'put') {
    const tabId = sender.tab?.id;
    if (tabId === undefined) return;
    const a = msg.audio ?? {};
    let frames = tabStats.get(tabId);
    if (!frames) tabStats.set(tabId, (frames = new Map()));
    frames.set(sender.frameId ?? 0, {
      taps: Number(a.taps) || 0,
      engaged: Number(a.engaged) || 0,
      at: Date.now(),
    });
    chrome.runtime
      .sendMessage({ type: STATS_TYPE, op: 'push', tabId, audio: tabAudio(tabId) })
      .catch(() => {}); // no panel open: nobody to tell
    return;
  }
  if (msg.op === 'get') {
    (async () => {
      let tabId = null;
      try {
        tabId = await activeTabId();
      } catch {
        // no normal window: nothing to report
      }
      sendResponse({ type: STATS_TYPE, tabId, audio: tabId === null ? null : tabAudio(tabId) });
    })();
    return true; // async response
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabStats.delete(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) tabStats.delete(tabId); // navigated away
});
