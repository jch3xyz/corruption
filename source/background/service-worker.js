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
