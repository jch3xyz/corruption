// Module service worker. Opens the control panel (toolbar icon or
// Ctrl+Shift+P) and toggles the effect (Ctrl+Shift+D). The panel is an
// extension page in a popup window — Web MIDI permission is per-origin, so
// granting it once there persists in the kiosk profile.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[DEFLECTION] installed', reason);
});

let panelWindowId = null;

async function openPanel() {
  if (panelWindowId !== null) {
    try {
      await chrome.windows.update(panelWindowId, { focused: true });
      return;
    } catch {
      panelWindowId = null; // window is gone; fall through and create
    }
  }
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('panel/panel.html'),
    type: 'popup',
    width: 400,
    height: 720,
  });
  panelWindowId = win.id;
}

chrome.windows.onRemoved.addListener((id) => {
  if (id === panelWindowId) panelWindowId = null;
});

async function toggleEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !enabled });
  console.log('[DEFLECTION] enabled →', !enabled);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-effect') toggleEnabled();
  if (command === 'open-panel') openPanel();
});

chrome.action.onClicked.addListener(() => openPanel());

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
