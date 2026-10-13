// Statically registered content scripts load as classic scripts, so this
// file's only job is to pull in the real entry point as an ES module.
//
// Two documents may not load extension resources, and the import throws
// "Unsafe attempt to load URL chrome-extension://… from frame with URL …"
// in both (John's Errors page, round 8, on YouTube): a PRERENDERED page —
// YouTube prerenders likely navigations, and content scripts run there —
// and a content-script context INVALIDATED by an extension reload, whose
// chrome.runtime has lost its id. The first waits for activation; the
// second has nothing to boot into and returns quietly.
(async () => {
  if (window.__deflectionBooted) return;
  window.__deflectionBooted = true;

  try {
    if (document.prerendering) {
      await new Promise((resolve) =>
        document.addEventListener('prerenderingchange', resolve, { once: true })
      );
    }
    if (!globalThis.chrome?.runtime?.id) return; // invalidated: the extension reloaded under this page
    await import(chrome.runtime.getURL('content/main.js'));
  } catch (err) {
    // Never let a boot failure surface as a page error.
    console.warn('[DEFLECTION] boot failed', err);
  }
})();
