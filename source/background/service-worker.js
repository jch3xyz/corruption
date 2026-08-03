// Module service worker. Phase 0 responsibilities: install log and the
// enabled-toggle (keyboard command + toolbar icon). Image-fetch fallback
// arrives in Phase 4, panel management in Phase 3.

chrome.runtime.onInstalled.addListener(({ reason }) => {
  console.log('[DEFLECTION] installed', reason);
});

async function toggleEnabled() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !enabled });
  console.log('[DEFLECTION] enabled →', !enabled);
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-effect') toggleEnabled();
  if (command === 'open-panel') {
    // Panel page ships in Phase 3.
    console.log('[DEFLECTION] panel not built yet');
  }
});

chrome.action.onClicked.addListener(() => toggleEnabled());
