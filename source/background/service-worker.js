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
