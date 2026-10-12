# CORRUPTION — Kiosk Browser Plan

**Status: not started.** The decision: distribute CORRUPTION as a
**standalone kiosk browser** — an app that carries its own pinned Chromium
and the extension inside it — rather than as a browser extension people
install into their own Chrome. Reached in the Phase 6 scope thread
(2026-08-12, revisited 2026-08-20) and stated by John 2026-08-21: a bundled
browser can't be broken by browser updates, and it doesn't have to meet the
store's standards for an extension living in someone's daily browser.

This supersedes most of [distribution-plan.md](distribution-plan.md), which
is kept as the record of what the *extension* model would have demanded;
§"What carries over" below says which of its findings still apply. It also
absorbs Phase 6 of [build-plan.md](build-plan.md) (kiosk hardening + soak):
the distributed app and the installation's kiosk become **one build**.

Written 2026-08-21 from the repo at commit `d198589`, the Phase 6 thread, and
the checks listed under "Facts relied on". Internal `deflection` identifiers
stay as they are (John's call, 2026-08-20).

## What changes, in one breath

The extension stops being the product and becomes a component. The product
is an app — `CORRUPTION.app` (and optionally a Windows build) — that opens a
fullscreen browser window on the live internet with the piece already
running, the autoplay flag set, MIDI pre-granted, a first-run screen instead
of wall text, and a menu with the four things a visitor needs: corrupt
on/off, the panel, reset, quit. The same app runs the gallery kiosk; the
installation adds a restart/wipe agent around it.

## Decisions John owns (flagged, not made)

1. **Shell technology** — see the spike in K0. Recommendation: **Electron**,
   if it can run the extension (that is what the spike settles). Reasons:
   redistributable (MIT; Chromium is BSD), ships proprietary codecs (the
   separate download is the *patent-free* variant), one-command packaging
   and signing for macOS/Windows, kiosk windows, per-request response-header
   control, a session-wipe API, and Web MIDI/autoplay handled in code rather
   than flags. Alternatives: a **Chromium build + launcher** (full extension
   fidelity, `--load-extension` still works there, but official Chromium
   lacks H.264/AAC — Instagram is H.264 — so it means a codec-enabled build
   and per-platform launchers); **Chrome for Testing** (what the kiosk plan
   assumed — fine on John's own machine, but Google Chrome binaries are
   under Google's terms, not an open-source license; do not build a
   distributable on it without confirming redistribution is permitted).
2. **Physical form** — a downloadable DMG/installer, a **USB-drive edition**
   (John's idea from the Phase 6 thread: plug in to start, unplug to stop —
   the drive doubles as the gallery takeaway), or both. Auto-start on plug
   needs something installed on the host (a LaunchAgent watching
   `/Volumes/CORRUPTION`); a bare drive can only be "open the app on it".
3. **Profile policy for strangers** — wipe every session (gallery semantics,
   nobody stays logged in) or persist (it's their machine) with a "reset"
   menu item. The installation needs wipe; the takeaway probably wants
   persist + reset.
4. **Lockdown level** — the open Phase 6 question: true kiosk (no chrome,
   no Esc) vs fullscreen with the panel reachable. Recommendation:
   fullscreen with panel for the takeaway; true kiosk is an installation
   setting on the same build.
5. **Platforms** — macOS arm64 first (the kiosk is an M4; the author's
   machine). x64 Mac and Windows are cheap with Electron, not free to test.
6. **Text exclusions** — unchanged from distribution-plan.md: the
   data-integrity set (`code/pre/kbd/samp`, `label`, `aria-live`) is
   recommended; buttons/links stay John's call at `textMin` 8.

## The honest trade

A pinned browser is a frozen attack surface. Branded Chrome patches
security bugs every few weeks; the kiosk browser gets them only when John
re-ships with a newer Chromium. The README must say the app is for viewing
the piece, not for banking or mail, and the release process needs a cadence
(re-ship on each Electron major, roughly quarterly) even if nothing else
changed. The extension model had the opposite problem — it could be broken
by updates — and this is the price of not having it.

Two smaller wrinkles of the same kind: Google blocks sign-in from browsers
it deems "embedded" (Electron's default user agent), so a signed-in YouTube
or Instagram feed inside the app needs a Chrome-like UA string or is
accepted as logged-out (the original plan already noted logged-out Instagram
is nearly unusable); and there is no Widevine in Electron or Chromium, so
DRM video — which the extension deliberately leaves untouched — now does not
play at all. Neither is a blocker for the piece.

---

## Phases

### K0 — Shell spike (first; everything else waits on it)

Prove the extension runs inside Electron, unmodified where possible. One
`main.js` with `session.defaultSession.loadExtension('<repo>/source')`, a
`BrowserWindow` on YouTube, `app.commandLine.appendSwitch('autoplay-policy',
'no-user-gesture-required')`. Check, in order:

1. `content/bootstrap.js` runs on every frame and its dynamic
   `import(chrome.runtime.getURL('content/main.js'))` resolves (this rides
   `web_accessible_resources`; Electron's support for that key is
   undocumented).
2. `chrome.storage.local` + `onChanged` work — the panel-to-content
   parameter flow is nothing else.
3. The MV3 service worker: does `chrome.runtime.onMessage` fire for
   `fetch-image` (route 3)? Electron's MV3 service-worker support has a
   history of gaps (electron/electron#34178; Electron 35 added service-worker
   preloads/IPC). If it doesn't, route 3 moves into the shell (see K1) and
   the SW is dropped from the Electron build — the panel/commands parts of it
   are shell jobs anyway.
4. Unsupported manifest keys (`declarative_net_request`, `commands`,
   `action`) are **ignored**, not fatal.
5. `audioWorklet.addModule(chrome-extension://…/audio/worklet.js)` loads;
   a YouTube video distorts *with sound* under the defaults; Instagram
   explore (H.264) plays and its grid previews distort once K1's header
   injection is in.
6. The panel loads in a second `BrowserWindow` at
   `chrome-extension://<id>/panel/panel.html`; Web MIDI works when the
   session's permission handler grants `midi`.

Exit: YouTube, Instagram, and a news site all distort with sound in an
unsigned `.app` produced by `electron-builder`. If 1–3 fail and
`electron-chrome-extensions` (Samuel Maddock's bridge that adds
`chrome.tabs`/`windows`/actions on top of Electron) doesn't close the gap,
the fallback is the Chromium-build path, and this document gets a K0′.

### K1 — The shell

- **Window**: fullscreen (or `kiosk: true` per decision 4), single instance
  (`app.requestSingleInstanceLock`), relaunch the window on renderer crash,
  `Ctrl+Shift+D`/`Ctrl+Shift+P`-equivalents as menu accelerators and
  `globalShortcut`s that flip `enabled` / open the panel — implemented by
  running `chrome.storage.local.set(...)` in an extension-origin window the
  shell owns, since `chrome.commands`/`chrome.windows` don't exist here.
- **Header injection replaces the DNR rule**:
  `session.webRequest.onHeadersReceived` sets `Access-Control-Allow-Origin: *`
  on `image`/`media` responses **inside the app's session only**. This is the
  same behaviour as `rules/cors-media.json` confined to the kiosk browser,
  which is what makes it acceptable: the app exists to be corrupted and the
  README says not to bank in it. If the spike shows route 3 needs to move,
  the shell serves it too (`net.fetch` → data URL → `webContents` message).
- **Permissions**: `setPermissionRequestHandler` grants `midi`; everything
  else denied (no camera/mic/notifications/geolocation prompts in a piece).
- **Session policy** per decision 3: `session.clearStorageData()` on launch
  (wipe) or a Reset menu item (persist).
- **User agent**: Chrome-like string if signed-in feeds matter (decision
  under "The honest trade").
- **First-run screen**: the wall text, digitized — what the piece does,
  that every site in this window is altered, the two shortcuts, reset,
  "don't log into anything you care about". Shown once per profile (or
  every launch under wipe policy, briefly).
- **Consent for audio**: none needed — the autoplay switch starts the
  AudioContext running, which is the kiosk condition the extension was
  built for.

### K2 — Extension changes that survive the model change

Keep the extension loadable in plain Chrome (Load unpacked) — the four
harnesses and the dev loop stay exactly as they are. Changes, all small:

- **Audio tap order** (`content/audio-job.js:89-92`): tap only when
  `graph.running()`, queue otherwise. Moot under the autoplay switch, but
  it is correct regardless and keeps the extension safe in the dev browser.
- **Service-worker fetch hardening** (`background/service-worker.js:53-74`):
  sender check, `http(s)` only, reject loopback/private hosts,
  `Content-Length` pre-check + timeout, `image/*` only. The kiosk browser
  still browses the live internet; cheap insurance.
- **Image cap** `maxImages` (`registry.js:185-187` activates every visible
  image today) and a try/catch around `createPipeline` in the context-restore
  handler (`gl/context.js:51-60`) — both are long-run robustness and help the
  installation soak as much as the takeaway.
- **`debug` param** gating the twelve `console.*` sites — optional; nobody
  opens DevTools in a kiosk, but the dev loop likes quiet.
- **Text exclusions** per decision 6.
- **Electron build variant**: if K0 shows the MV3 worker doesn't run, a
  `manifest.electron.json` without `background`/`declarative_net_request`/
  `commands`/`action`, generated by the package script from the real
  manifest — never a second hand-maintained copy.

Drop from the extension plan: orphan teardown (no in-place extension
updates — the app is replaced whole), per-site disable (the window is the
piece), badge/welcome in the extension (the shell owns both), the MIDI gate
in the panel (the shell grants it), the Web Store manifest hygiene.

### K3 — Packaging, signing, provenance

- `electron-builder` (or Forge) config producing `exports/CORRUPTION-<version>-arm64.dmg`
  (+ x64/universal, + Windows NSIS if decision 5 says so). App version =
  `package.json` version; the extension's `manifest.json` version tracks
  it; tag `v<version>`; `CHANGELOG.md`.
- **macOS**: Developer ID certificate (Apple Developer Program, $99/yr)
  and notarization (`notarytool`, automated by the builder). Sequoia
  removed the right-click-Open bypass; an unsigned app now needs the user
  to go to System Settings → Privacy & Security → Open Anyway. For a
  gallery takeaway that is a wall-text sentence; for a download it is a
  support burden. Sign it.
- **Windows** (if built): a code-signing cert or accept SmartScreen's
  "unrecognized app" — Azure Trusted Signing is the cheap route now.
- **Third-party notices**: Electron ships `LICENSES.chromium.html`; the
  app's About/README must carry it plus Electron's MIT notice.
- **USB edition** (decision 2): a script that formats a drive
  (exFAT for both platforms), copies the app(s) and `README.txt`, names the
  volume `CORRUPTION`, ejects. The installation's plug-to-start is a
  LaunchAgent with `StartOnMount` watching that volume; "unplug to stop" is
  the app noticing its volume vanished and quitting.
- **Repo provenance** — unchanged from distribution-plan.md §10: `LICENSE`
  (John's choice; code vs artwork), `README.md` (now: download, open,
  shortcuts, "this is a frozen browser — view the piece, don't bank in
  it", attribution to Paik / Asendorf / Menkman), `CHANGELOG.md`,
  `PRIVACY.md` (local-only processing; the app phones nobody; if the
  session is persisted, say where).
- **Size**: expect 250–350 MB on disk; the DMG ~120 MB. Say so on the
  download page.

### K4 — The installation on the same build (absorbs Phase 6)

- The kiosk runs the distributed app with the installation settings:
  `kiosk: true`, wipe-on-launch, MIDI granted, `--kiosk`-style no-Esc.
  A launchd agent with `KeepAlive` relaunches it; the app's own wipe
  replaces the template-profile restore (keep the nightly restart).
- `documentation/kiosk-setup.md` — the file build-plan.md promised:
  build the cold spare from it.
- 72 h then 7-day soak against a `soak-log.md`: memory flat, GPU memory
  flat, no renderer crashes, audio still engaged after the nightly restart.

---

## What carries over from distribution-plan.md

| Finding there | Here |
|---|---|
| §1 browser-wide ACAO rule | Confined to the app session by the shell (K1). Acceptable. |
| §2 audio tap before gate | Moot under the autoplay switch; fix anyway (K2). |
| §3 teardown / orphaned scripts | Moot — no in-place extension updates. |
| §4 SW fetch hardening | Keep (K2). |
| §5 console logging | Optional (K2). |
| §6 consent surface | Becomes the shell's first-run screen + menu (K1). Per-site disable dropped. |
| §7 text exclusions | Unchanged, John's call. |
| §8 image cap, restore guard | Keep (K2) — long-run robustness. |
| §9 packaging/manifest | Replaced by K3; the store manifest hygiene is irrelevant. |
| §10 LICENSE/README/PRIVACY | Keep, reworded for an app (K3). |
| Tier 2 (Web Store) | Gone. |
| Tier 3 (Firefox/Safari) | Gone — one Chromium, pinned. |

## Verification

- **K0** is its own verification; its exit criterion is the gate for
  everything after it.
- **Harnesses**: unchanged, still run in real Chrome via
  `python3 test/serve.py`; must stay green through K2.
- **App smoke test** (scripted, runs against the packaged app via the
  DevTools protocol or Playwright's Electron support): launch → YouTube →
  a `canvas[data-deflection]` appears within 10 s → audio tap count in
  `__deflection.registry.stats()` ≥ 1 → Ctrl+Shift+D → canvas hidden and
  video visible → panel opens on Ctrl+Shift+P → quit. Same script on
  Instagram explore for the H.264 + header-injection path.
- **Fresh machine**: a clean user account (or a second Mac): open the
  DMG, drag, launch — no Gatekeeper block once signed/notarized; first-run
  screen once; MIDI works with a controller attached; wipe/persist behaves
  per decision 3.
- **USB edition**: build the drive with the script, plug into the
  second machine, open — and on the kiosk, plug-to-start / unplug-to-stop.
- **Soak** (K4): 72 h then 7 days, per build-plan.md's original Phase 6
  criteria.

## Facts relied on (checked 2026-08-21)

- Branded Chrome ≥137 removed `--load-extension`; Chromium and Chrome for
  Testing keep it —
  [chromium-extensions PSA](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ).
- Electron's extension support is explicitly partial and "a non-goal … to be
  perfectly compatible": supported are `chrome.runtime` (partial),
  `chrome.storage.local`, `chrome.scripting`, `chrome.tabs` (partial),
  `chrome.webRequest`, `content_scripts`, `host_permissions`; `storage.sync`
  is not —
  [Electron: Chrome Extension Support](https://www.electronjs.org/docs/latest/api/extensions).
  MV3 service-worker gaps:
  [electron/electron#34178](https://github.com/electron/electron/issues/34178);
  Electron 35 added service-worker preloads and IPC —
  [Electron 35 release notes](https://www.electronjs.org/blog/electron-35-0).
- Electron's default ffmpeg includes the proprietary codecs; the separately
  downloadable one is the *patent-free* variant —
  [electron/electron#13445](https://github.com/electron/electron/issues/13445).
  Official Chromium builds do not include them. **Confirm in K0 by playing
  Instagram.**
- Chrome for Testing binaries are Google Chrome builds under Google's terms
  (the Apache license in the `chrome-for-testing` GitHub repo covers the
  availability tooling, not the browser). Treat redistribution as not
  permitted unless confirmed —
  [Google Chrome terms](https://www.google.com/chrome/terms/).
- macOS Sequoia removed the Control-click Gatekeeper override; unsigned apps
  require System Settings → Privacy & Security → Open Anyway; Apple's
  recommendation is Developer ID + notarization —
  [Apple developer news](https://developer.apple.com/news/?id=saqachfa).
- `electron-chrome-extensions` (MV3 support landed) —
  [samuelmaddock/electron-browser-shell#38](https://github.com/samuelmaddock/electron-browser-shell/issues/38).
