// Statically registered content scripts load as classic scripts, so this
// file's only job is to pull in the real entry point as an ES module.
(() => {
  if (window.__deflectionBooted) return;
  window.__deflectionBooted = true;

  import(chrome.runtime.getURL('content/main.js')).catch((err) => {
    // Never let a boot failure surface as a page error.
    console.warn('[DEFLECTION] boot failed', err);
  });
})();
