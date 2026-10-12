// The bottom strip (design review M9; John's pick and the default home
// since 2026-10-11): the panel as a mixer strip along the bottom of the
// page. At rest it is a TRANSPORT LINE — one 40 px rail carrying the A/B,
// the four medium chips and the presets at sizes a stranger can hit, so the
// key gesture is always one click away. A click anywhere on the rail that is
// not a control (the panel relays it), the fold button at its right end, the
// CORRUPTION tab standing on its top edge, Ctrl+Shift+P or the toolbar icon
// grows it to the full mixer.
//
// The strip does not re-implement the panel. It hosts the shipped
// panel.html in an iframe with `?layout=strip` (panel.css lays that out
// horizontally, and as the rail when the frame is short), so there is one
// source of truth for every control, tip and gesture. What lives here is
// only the housing:
//
//   - a <deflection-strip> host, fixed to the bottom of the viewport above
//     everything, its geometry set inline with !important so page CSS cannot
//     move it, and a closed shadow root so page CSS cannot reach inside and
//     nothing inside can reach the page;
//   - the two heights (rail and open), toggled by the panel (its fold
//     button, or a click on the rail's empty space: a postMessage up), by
//     the tab, by Ctrl+Shift+P — the Chrome command when it is bound, a page
//     keydown when it is not — and by the service worker;
//   - the tab: a small CORRUPTION ▴/▾ label above the rail's right end, so
//     the strip stands out from the page's own chrome and says what it is.
//     It is pressed, never focused, and is not in the page's tab order;
//   - the iframe is out of the page's tab order and nothing here ever takes
//     focus, so the page's keyboard focus is never stolen; the frame is
//     dropped while the tab is hidden, so only the visible tab runs a panel;
//   - hiding while anything is fullscreen;
//   - a failure path: if the panel never says it booted, or anything here
//     throws, the host is removed and the page is exactly as it was.
//
// Known cost, accepted: the rail covers the bottom 40 px of the page (and
// the tab a small corner above it), the open mixer ~208 px, fixed footers
// included. It does not push the page up — doing that means restyling the
// page (John, 2026-10-12: keep covering). No hover-to-open, on purpose:
// the rail sits where a player's scrubber often is and the pointer crosses
// it constantly.
//
// mountStrip() is pure DOM (the strip harness drives it with no extension
// around it); initStrip() is the chrome.* glue the content script calls.

const MSG = 'deflection:strip';
export const RAIL_HEIGHT = 40;
const TAB_HEIGHT = 20;
export const STRIP_HEIGHT = 208;
const READY_TIMEOUT_MS = 8000;

const HOST_CSS = [
  ['all', 'initial'],
  ['position', 'fixed'],
  ['left', '0'],
  ['right', '0'],
  ['bottom', '0'],
  ['top', 'auto'],
  ['width', 'auto'],
  ['height', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['transform', 'none'],
  ['z-index', '2147483647'],
  ['pointer-events', 'none'],
  ['display', 'block'],
  ['visibility', 'visible'],
  ['opacity', '1'],
];

const SHADOW_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .wrap {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: ${RAIL_HEIGHT}px;
    font: 10px ui-monospace, 'SF Mono', Menlo, monospace;
  }
  .wrap.open { height: ${STRIP_HEIGHT}px; }
  .bar {
    pointer-events: auto;
    position: absolute; inset: 0;
    background: #131316;
    border-top: 1px solid #34343c;
    box-shadow: 0 -6px 18px rgba(0, 0, 0, 0.45);
  }
  /* The tab stands on the rail's top edge (over its border line, so the two
     read as one piece) at the right end, above the fold button. */
  .tab {
    pointer-events: auto;
    position: absolute; right: 18px; bottom: calc(100% - 1px);
    height: ${TAB_HEIGHT}px; margin: 0; padding: 0 10px;
    background: #131316; color: #e8e864;
    border: 1px solid #34343c; border-bottom: none; border-radius: 5px 5px 0 0;
    font: 600 11px ui-monospace, 'SF Mono', Menlo, monospace;
    letter-spacing: 0.2em; line-height: ${TAB_HEIGHT - 1}px;
    cursor: pointer; outline: none;
  }
  .tab:hover { border-color: #8a8a40; }
  iframe { display: block; width: 100%; height: 100%; border: 0; background: #131316; }
`;

// The ONE live strip per document.
let live = null;

// Mount the strip. `src` is the panel URL (…/panel.html?layout=strip).
// Returns a controller, or null if the strip could not be built — in which
// case nothing of it remains in the page.
export function mountStrip({
  src,
  open = false,
  doc = document,
  readyTimeoutMs = READY_TIMEOUT_MS,
  onOpenChange = () => {},
  onFail = () => {},
} = {}) {
  if (live && live.host.isConnected) return live;
  let host = null;
  try {
    host = doc.createElement('deflection-strip');
    for (const [k, v] of HOST_CSS) host.style.setProperty(k, v, 'important');
    const root = host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = SHADOW_CSS;
    const wrap = doc.createElement('div');
    wrap.className = 'wrap';
    const bar = doc.createElement('div');
    bar.className = 'bar';
    const tab = doc.createElement('button');
    tab.className = 'tab';
    tab.type = 'button';
    tab.tabIndex = -1; // never in the page's tab order
    // After the bar, so the bar's shadow does not fall across it.
    wrap.append(bar, tab);
    root.append(style, wrap);

    let isOpen = false;
    let frame = null;
    let ready = false;
    let readyTimer = 0;
    let dead = false;

    const win = doc.defaultView;

    const fail = (why) => {
      if (dead) return;
      console.warn('[DEFLECTION] strip removed:', why);
      ctl.destroy();
      try {
        onFail(why);
      } catch {
        // the caller's problem, not the page's
      }
    };

    // The iframe exists while the tab is visible — rail and open alike, the
    // rail being the panel at RAIL_HEIGHT — and is dropped while the tab is
    // hidden, so no second panel runs. tabindex -1 keeps it, and everything
    // inside it, out of the page's sequential focus order.
    const syncFrame = () => {
      const want = doc.visibilityState !== 'hidden';
      if (want && !frame) {
        frame = doc.createElement('iframe');
        frame.src = src;
        frame.title = 'CORRUPTION controls';
        frame.tabIndex = -1;
        frame.setAttribute('allow', 'midi');
        bar.appendChild(frame);
        if (!ready) {
          clearTimeout(readyTimer);
          readyTimer = setTimeout(() => {
            if (!ready) fail('panel did not boot');
          }, readyTimeoutMs);
        }
      } else if (!want && frame) {
        frame.remove();
        frame = null;
      }
    };

    const paint = () => {
      wrap.classList.toggle('open', isOpen);
      tab.textContent = isOpen ? 'CORRUPTION ▾' : 'CORRUPTION ▴';
      tab.title = isOpen ? 'Fold the controls back to one line (Ctrl+Shift+P)' : 'Unfold the controls (Ctrl+Shift+P)';
      tab.setAttribute('aria-expanded', String(isOpen));
      syncFrame();
    };

    const fullscreenEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
    const syncFullscreen = () => {
      // Hidden, not destroyed: a MIDI controller keeps playing under a
      // fullscreen video.
      host.style.setProperty('display', fullscreenEl() ? 'none' : 'block', 'important');
    };

    const onMessage = (e) => {
      if (!frame || e.source !== frame.contentWindow) return;
      const msg = e.data;
      if (!msg || msg.type !== MSG) return;
      if (msg.op === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
      } else if (msg.op === 'toggle') {
        ctl.toggle();
      }
    };

    // Ctrl+Shift+P from the page itself. Chrome's command takes the key
    // first when it is bound (the default), so this only answers when the
    // player has unbound it — and only while the strip is on the page.
    const onKey = (e) => {
      if (e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyP') {
        e.preventDefault();
        e.stopPropagation();
        ctl.toggle();
      }
    };

    // The tab is pressed, never focused: whatever had focus keeps it.
    tab.addEventListener('mousedown', (e) => e.preventDefault());
    tab.addEventListener('click', () => ctl.toggle());

    const ctl = {
      host,
      root,
      get open() {
        return isOpen;
      },
      get frame() {
        return frame;
      },
      get ready() {
        return ready;
      },
      setOpen(next, notify = true) {
        if (dead) return;
        next = !!next;
        if (next === isOpen) return;
        isOpen = next;
        paint();
        if (notify) {
          try {
            onOpenChange(isOpen);
          } catch {
            // storage gone (extension reloaded): the strip still works here
          }
        }
      },
      toggle() {
        ctl.setOpen(!isOpen);
      },
      syncFullscreen,
      destroy() {
        if (dead) return;
        dead = true;
        clearTimeout(readyTimer);
        win.removeEventListener('message', onMessage);
        win.removeEventListener('keydown', onKey, true);
        doc.removeEventListener('fullscreenchange', syncFullscreen);
        doc.removeEventListener('webkitfullscreenchange', syncFullscreen);
        doc.removeEventListener('visibilitychange', syncFrame);
        host.remove();
        if (live === ctl) live = null;
      },
    };

    win.addEventListener('message', onMessage);
    win.addEventListener('keydown', onKey, true);
    doc.addEventListener('fullscreenchange', syncFullscreen);
    doc.addEventListener('webkitfullscreenchange', syncFullscreen);
    doc.addEventListener('visibilitychange', syncFrame);

    // documentElement, not body: survives frameworks that replace <body>.
    doc.documentElement.appendChild(host);
    isOpen = !!open;
    paint();
    syncFullscreen();
    live = ctl;
    return ctl;
  } catch (err) {
    console.warn('[DEFLECTION] strip failed to mount', err);
    try {
      host?.remove();
    } catch {
      // nothing left to undo
    }
    return null;
  }
}

// --- Extension glue (top frame only) ---------------------------------------
// The strip appears on page load when `panelHome` is 'strip'; it opens or
// folds with `stripOpen`, which every tab follows. The service worker sends
// {type: MSG, op: 'toggle'} for the toolbar icon and Ctrl+Shift+P, and gets
// {ok: false} back if the strip cannot be shown here — then it opens the
// window instead, so the panel is always reachable.

export async function initStrip() {
  const chromeApi = globalThis.chrome;
  const runtime = chromeApi?.runtime;
  const storage = chromeApi?.storage?.local;
  if (!runtime?.id || !storage) return;

  let state;
  try {
    state = await storage.get({ panelHome: 'strip', stripOpen: false });
  } catch {
    return;
  }

  let strip = null;
  let failed = false;
  const ensure = () => {
    if (failed) return null;
    if (strip) return strip;
    strip = mountStrip({
      src: runtime.getURL('panel/panel.html?layout=strip'),
      open: state.stripOpen === true,
      onOpenChange: (open) => {
        storage.set({ stripOpen: open })?.catch?.(() => {});
      },
      onFail: () => {
        failed = true;
        strip = null;
      },
    });
    if (!strip) failed = true;
    return strip;
  };

  if (state.panelHome === 'strip') ensure();

  runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== MSG) return;
    try {
      const s = ensure();
      if (!s) {
        sendResponse({ ok: false });
        return;
      }
      if (msg.op === 'open') s.setOpen(true);
      else s.toggle();
      sendResponse({ ok: true, open: s.open });
    } catch {
      sendResponse({ ok: false });
    }
  });

  chromeApi.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('stripOpen' in changes) || !strip) return;
    strip.setOpen(changes.stripOpen.newValue === true, false);
  });
}
