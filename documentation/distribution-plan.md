# CORRUPTION — Distribution Plan

**Status: superseded as a plan, kept as a record.** Written 2026-08-21 from
a read-only audit of the tree at commit `d198589`; line references are to
that commit. The same day John chose to distribute the piece as a
**standalone kiosk browser** instead of an extension — see
[kiosk-browser-plan.md](kiosk-browser-plan.md), which says which of the
findings below still apply. This document remains the answer to "what would
the extension model have demanded", and its code findings are still
accurate.
When it is picked up, log progress in [build-plan.md](build-plan.md) as with
every other phase, and keep the discipline: one commit per verified
iteration, the relevant harness green before each.

Internal `deflection` identifiers stay as they are throughout (John's call,
2026-08-20) — nothing below touches storage keys, the worklet name, the data
attribute's name, or log prefixes.

## The short answer

The code is clean in the ways a store reviewer checks mechanically — no
remote code, no `eval`/`innerHTML`, no network calls of its own, no telemetry,
no dev hooks or localhost strings in `source/`, the rename complete on every
user-facing surface, tests depending on source strictly one way. What it
lacks is everything that assumes *someone else's* browser. Ranked:

1. **The browser-wide CORS header rule** (`source/rules/cors-media.json`) —
   weakens every site's same-origin policy for images/media, breaks other
   sites' credentialed media, and the kill switch can't turn it off. Must
   become per-request.
2. **Audio taps before the gesture gate** (`content/audio-job.js:89-92`) —
   without the kiosk's autoplay flag, a suspended AudioContext silences the
   tapped element, irreversibly for that element. Must move inside
   `whenRunning()`.
3. **No teardown** — updates, disable, uninstall, and `enabled=false` all
   leave overlays, patched layout, observers, and scrambled text behind.
4. **No consent surface** — fully armed on install, on every URL, with no
   first-run page, no per-site off switch, no toolbar state, and a surprise
   MIDI prompt on first panel open.
5. **Unhardened service-worker fetch** — any page can make the extension
   fetch an arbitrary URL with `<all_urls>` authority.
6. **Console logging of URLs on every page**, unconditionally.
7. **No LICENSE, README, privacy text, package script, or version bump, ever.**

Everything else is listing mechanics or robustness polish.

## Context

CORRUPTION was built for one machine: a Mac mini kiosk running a pinned Chrome
for Testing with `--autoplay-policy=no-user-gesture-required`, the extension
loaded unpacked from `source/`, the profile wiped nightly, consent handled by
wall text. The proposal's only sentence on distribution is that the extension
"can be given away … may be worth building into the piece as a takeaway."
Every design choice assumes the kiosk.

"Distributable" means a stranger installs it on their own browser without John
touching the machine, and it behaves responsibly there. On Mac and Windows,
Chrome only installs extensions from the Chrome Web Store (non-store CRX
installs are blocked; branded Chrome ≥137 also removed `--load-extension`), so
the realistic paths are:

1. **Chrome Web Store** — public or *unlisted* (same review, link-only).
   Auto-updates. Broad host permissions mean an in-depth review (weeks) and
   mandatory privacy disclosures.
2. **GitHub release zip + "Load unpacked"** — technical audience only; no
   review, no auto-update, Chrome nags about developer-mode extensions.
3. **Other browsers** — Edge Add-ons takes the same zip; Firefox needs a
   manifest variant and an AMO listing; Safari needs an Xcode-wrapped app.

The work is tiered: Tier 1 is what any distribution needs; Tier 2 is what the
Web Store adds; Tier 3 is other browsers.

## Decisions John owns (flagged, not made)

- **Target**: Tier 1 only (zip) / Tier 1+2 (Web Store — unlisted first is the
  low-risk default) / Tier 3 as well.
- **License**: none exists. Code and artwork can carry different terms.
- **Video calls**: `audio/graph.js:44` treats `srcObject` (MediaStream) as
  safe, so Meet/Zoom-in-browser participants go through the resonator and
  lose output-device selection. Recommendation: a param `audioStreams`,
  default **off** for distribution; the kiosk can flip it.
- **Text exclusions**: at `textMin` 8 "most labels dissolve" (`defs.js:244`) —
  John's aesthetic call, kept. The data-integrity set (`code/pre/kbd/samp`,
  `label`, `aria-live` regions) is recommended below; buttons and links stay
  his call.
- **Default per-site exclusions**: ship an empty list (recommended) or
  pre-exclude conferencing domains.

---

## Tier 1 — required for any distribution

### 1. Replace the browser-wide CORS rule with per-request session rules

`source/rules/cors-media.json` is one rule: `urlFilter: "*"`, resource types
`image`+`media`, `set` `Access-Control-Allow-Origin: *`. It applies to every
image and media response in the browser, on every page, in every tab, whether
or not the effect is running there — and since there are no
`chrome.declarativeNetRequest` calls anywhere in `source/`, **Ctrl+Shift+D
does not turn it off**; only uninstalling does. Consequences:

- Any website can read pixels of cross-origin images/video that are not
  cookie-protected (intranet hosts, LAN devices, IP-allowlisted CDNs, signed
  URLs) by loading them with `crossorigin="anonymous"`.
- `set` replaces the server's own ACAO, and `*` is rejected with credentials —
  other sites' `crossorigin="use-credentials"` media **fails to load** while
  this is installed (`audio/graph.js:52-54` already notes the wildcard is
  unsafe with credentials).
- A reviewer sees `modifyHeaders` on `<all_urls>`.

Only two code paths need the header: image route 2 (detached `crossorigin`
`Image`, `content/image-job.js:231-249`) and the tainted-video mirror
(`SrcMirror`, `content/video-job.js:22-46`). Route 3 (the SW fetch) does not —
host permissions already let the SW fetch anything. The audio predicate
(`graph.js:54`, site-set `crossOrigin === 'anonymous'` → tappable) stays valid
without the rule: such an element only *plays* if it passed a real CORS check
against the server's own header, and the tap is on the page element, not the
mirror.

Change:
- Delete the static ruleset (`declarative_net_request` in the manifest,
  `rules/cors-media.json`); switch the permission to
  `declarativeNetRequestWithHostAccess` (no "Block content on any page you
  visit" warning; the `<all_urls>` host permission it needs is already held).
- Service worker: handle `cors-allow {url}` by adding a **session rule**
  (`chrome.declarativeNetRequest.updateSessionRules`) scoped to that URL
  (anchored `urlFilter` or `regexFilter`), `resourceTypes: ["image","media"]`,
  `tabIds: [sender.tab.id]`; reply when in place. Remove on `cors-release` or
  when the tab closes; keep a timeout as backstop. Validate `sender.id ===
  chrome.runtime.id` and `sender.tab`.
- Image route 2 and `SrcMirror` request the rule before creating the detached
  element and release it on completion/destroy (the video mirror keeps
  fetching ranges for as long as it plays, so release with the job). On
  failure fall through to route 3 / abandon exactly as today.
- Known edge: a CDN that 302s elsewhere — the response that matters is the
  redirect target. If Instagram's scontent CDN (the case that motivated the
  mirror, [site-notes.md](site-notes.md)) redirects, widen the rule to the
  target host rather than the exact URL. Verify on real Instagram.

### 2. Make the audio tap wait for a running context

`content/audio-job.js:89-92` calls `graph.getTap(el)` — `createMediaElementSource`,
permanent — unconditionally; only `engage()` sits behind `whenRunning()` (:95).
`audio/graph.js:94-97` says plainly that the kiosk flag is what makes this
safe. On any other machine the context starts suspended until a gesture in
that frame, and a tap into a suspended graph **silences the element** until
one arrives — exactly the failure correction #5 in build-plan.md forbids,
with a different trigger. Also, `whenRunning` pushes a closure per `sync()`
while suspended (`graph.js:128`), unbounded.

Change: tap only when `graph.running()`; otherwise queue one closure per job
(dedupe by job) that taps *and* engages on `statechange`. Keep the
pointerdown/keydown resume (`graph.js:101-102`). Add the `audioStreams`
param (see Decisions) and, when off, return `'skip'` for `srcObject` in the
safety predicate. Row + tip in `panel/defs.js`; extend the audio harness's
live tier with "suspended context → element never silent".

### 3. One teardown path, used everywhere

Today `enabled=false` (`registry.js:157-164`) calls `suspend()` on jobs and
`text.restoreAll()`, which restores `opacity` and hides canvases — but leaves
the `<canvas data-deflection>` siblings in the DOM, the parent's injected
`position: relative` in place (`overlay.js:19-23`; only `destroy()` reverts
it, :70-75 — a live layout-corruption path on arbitrary sites), the
MutationObserver/IntersectionObserver/ResizeObserver connected, the 2 s sweep
and four capture-phase listeners running, and new jobs still being
constructed (`registry.js:95-117` has no `enabled` check). There is no
`Registry.stop()`.

And when the extension is **updated** (store installs auto-update),
disabled, or removed with tabs open, every content script is orphaned:
`chrome.runtime.id` goes undefined, `storage.onChanged` (`params.js:80`)
goes quiet, the loaded modules keep rendering, and the guard at
`image-job.js:257-259` — which checks that `chrome.runtime.sendMessage`
*exists*, and it still does — lets line 261 throw "Extension context
invalidated" up through the sweep every 2 s. No `chrome.runtime.id` or
port-disconnect detection exists in `source/`.

Change:
- `Registry.stop()`: disconnect observers, clear the sweep and image ticker,
  remove listeners, `destroy()` every job (remove canvases, restore
  `opacity`, unpatch parents, drop `SrcMirror`s), `text.restoreAll()`,
  `graph.bypass()` every tap. `start()` already exists; `enabled` toggles
  between them. Per-site disable (§6) and orphan teardown use the same call.
- In the sweep, check `chrome.runtime?.id`; when gone, `stop()` once and
  never touch `chrome.*` again. Fix the image-job guard to test `runtime.id`.
- Audio taps are permanent (`createMediaElementSource`), so "off" is and
  stays a wet/dry bypass until the page reloads — say so in README/PRIVACY.
- Optional, for the install experience: on `onInstalled`, inject
  `content/bootstrap.js` into already-open tabs with `chrome.scripting`
  (no warning) so the piece appears everywhere at once.

### 4. Harden the service-worker image fetch (route 3)

`background/service-worker.js:53-74` fetches whatever `msg.url` a content
script sends — no `sender` check, no scheme allowlist (the video mirror gates
on `/^https?:/`, `video-job.js:261`; the image path doesn't), the 20 MB cap
applied after the whole body is buffered, no timeout, content-type defaulted
to `image/jpeg`. Content scripts run on every frame of every page and forward
page-controlled `src` values, so a hostile page can make the extension fetch
an intranet URL with `<all_urls>` authority and draw the (sorted) result onto
a canvas in the page's own DOM, which the page can read.

Change: require `sender.id === chrome.runtime.id` and `sender.tab`; accept
only `http(s):`; reject literal loopback/private/link-local hosts and
`localhost`; check `Content-Length` first and abort via `AbortController`
after a few seconds; require `Content-Type: image/*`. Same guards on the
`cors-allow` request in §1. (DNS rebinding to a private address isn't
solvable in a SW — note it, don't chase it.)

### 5. Silence the console by default

Twelve `console.*` sites ship, none gated: `service-worker.js:7,37`;
`main.js:22`; `bootstrap.js:9`; `video-job.js:262,360,473`;
`image-job.js:360`; `audio-job.js:111,138`; `graph.js:90`; `panel.js:244`.
`main.js:22-30` logs the first 120 chars of every page's URL (query strings
and all) once per frame per load, into the *page's* console; two more log
media URLs. Add a `debug` param (default off) in `content/params.js` + a row
in `panel/defs.js`, route every call through a small `log()` that checks it.
The docs' console tricks keep working with `debug` on; `[DEFLECTION]` stays
the prefix.

### 6. Consent surface: first-run page, per-site off switch, toolbar state

A fresh install is fully armed — `enabled`, `feedbackVideo`, `textScramble`,
`audioEnabled`, `audioFeedback` all `true` (`params.js:11-56`) on
`<all_urls>`, `all_frames`, with no `exclude_matches`, no hostname list, no
welcome page (`onInstalled` only logs), no badge, and an action that opens a
popup window which immediately requests MIDI access (`panel.js:570` →
`midi.js:12`). Add:

- **`panel/welcome.html`**, opened once from `onInstalled` when
  `reason === 'install'`: what the piece does, that it runs on every site,
  the kill switch, the panel shortcut, how to disable on one site, that
  audio routing persists until a page reload, that copied text copies
  scrambled. Read the *actual* bindings with `chrome.commands.getAll()` —
  suggested keys aren't guaranteed to bind (`Ctrl` becomes `Cmd` on macOS,
  where Cmd+Shift+D is Chrome's bookmark-all-tabs; Ctrl+Shift+P is Chrome's
  system-print dialog on Windows/Linux). Pick non-colliding defaults and
  verify in `chrome://extensions/shortcuts`.
- **Per-site disable**: `disabledHosts` array in storage (outside
  `DEFAULTS`, like `midiMap`, so it stays out of the params whitelist);
  `main.js` checks `location.hostname` before `boot()` and on change;
  "disable on this site" in the panel's global block (active tab hostname via
  `chrome.tabs.query` with `activeTab`, no warning) plus a `contextMenus`
  item on the action. Restores through `Registry.stop()`.
- **Badge/title** reflecting `enabled` (`chrome.action.setBadgeText` on
  `storage.onChanged` in the SW). Today there is no `chrome.action` call
  except the click handler.
- **MIDI behind a click**: an "enable MIDI" control (row in `defs.js`)
  instead of `requestMIDIAccess()` at panel load.
- `panelWindowId` is module state in a service worker (`service-worker.js:10`)
  and dies on idle suspension, so the next click opens a second panel — keep
  it in `chrome.storage.session` or find the window by URL.

### 7. Text scramble: data-integrity exclusions

`SKIP_TAGS` (`text-scramble.js:50-54`) covers script/style/inputs/media;
`contenteditable`, `aria-hidden`, and own overlays are skipped (:66-68).
Not skipped, and not aesthetics: `code`/`pre`/`kbd`/`samp` (shell commands,
keys, hashes get their letters permuted), `label` (field names scramble next
to intact inputs), and `aria-live` / `role=alert|status|log` regions (screen
readers announce scrambled text). Add those to the skip set; leave
buttons/links/nav as John's call (see Decisions). Document in README that
selection, copy, find-in-page, and Reader Mode see the scrambled DOM. Text
suite gains a tier-2 check per new exclusion.

### 8. Bounds for machines with thirty tabs

- **Images have no cap**: `registry.js:185-187` activates every visible
  `<img>` ≥48 px, each retaining a full-size 2D canvas after its one render.
  Add `maxImages` (ranked by visible area like `maxVideos`, default ~48), row
  in `defs.js`.
- **`createPipeline` in the context-restore handler is unguarded**
  (`gl/context.js:51-60`): a compile/link throw (`pipeline.js:314,329`)
  leaves `lost` true forever with originals hidden — reachable precisely
  under the many-tab context-loss churn the extension itself causes. Wrap
  it: on failure latch `unavailable` and have jobs abandon (originals
  restored).
- Nice-to-have, not blocking: release GL bundles and bypass the worklet on
  `visibilitychange` hidden (the worklet keeps running in background tabs);
  coalesce `storage.onChanged` rebalancing (a 30 Hz knob drag fans out to
  every frame of every tab); note `graph.taps` entries are never collected
  (the `MediaElementAudioSourceNode` value references its key) — idle nodes,
  not CPU.

### 9. Packaging, manifest, release mechanics

Nothing packages the extension today: no script, no CI; `.gitignore`'s
`exports/*.zip` / `*.crx` / `*.pem` lines and an empty untracked `exports/`
are the only trace of the intent. `manifest.json` has said `0.1.0` since
Phase 0 across all 33 commits; the three tags are design lineage. No git
remote.

- `scripts/package.sh`: zip `source/` into `exports/corruption-<version>.zip`
  excluding `source/_metadata/` (Chrome writes it on every load — it is on
  disk, gitignored but inside `source/` — and the store uploader rejects
  `_`-prefixed names), `.DS_Store`, `__MACOSX` (`zip -r -X` or
  `ditto --norsrc`; or build from `git archive`). Read the version from the
  manifest; refuse on a dirty tree.
- Version convention: bump `manifest.json` `version` (the store requires it
  to increase per upload), tag `v<version>`, entry in `CHANGELOG.md`.
- `manifest.json`: add `author`, `homepage_url`, `minimum_chrome_version`
  (API floor ~91 — module SW, rVFC, AudioWorklet, `Intl.Segmenter` with its
  fallback — but declare the lowest version the harnesses have passed on),
  `options_ui: { page: "panel/panel.html", open_in_tab: true }`, and a
  `default_title` on `action`. The 114-char `description` fits the 132 limit
  but is the store's summary line and says nothing about what happens to the
  browser — consider one clause of mechanics. (The all-caps name may draw a
  listing note; it is the title of the work.)
- `web_accessible_resources`: drop the redundant `gl/shaders/*.js`; consider
  `use_dynamic_url: true` against URL-probe fingerprinting — **verify** the
  content-script `import()` (`bootstrap.js:7`) and the `import.meta.url`
  worklet resolution (`graph.js:18`) still work, drop it if not. The
  `data-deflection` attribute (`overlay.js:14`) is also a one-line beacon; it
  exists so the scrambler can skip overlays (`text-scramble.js:67`), which a
  WeakSet would do invisibly. Optional.
- Icons: `icon{16,48,128}.png` are real and correctly sized but RGB with no
  alpha — a hard black square on a light toolbar. Look before shipping.
- Nothing in `source/` depends on `test/`, `documentation/`, or the dev
  server; the panel's in-memory storage shim (`panel.js:77-107`) is dead in
  a real extension and can ship. `.claude/` is gitignored and untracked.

### 10. Repo provenance

No LICENSE, README, CHANGELOG, or privacy text has ever existed; the manifest
`description` is the only published attribution. Create:
- `LICENSE` — John's choice; say which terms apply to code vs artwork.
- `README.md` — what it is, install (store link / load unpacked), kill
  switch, panel, per-site switch, known limitations (native `controls`
  invisible while mirrored; audio routing persists; clipboard sees the
  scramble; a saved "set defaults" snapshot outranks updated defaults),
  attribution (the proposal credits Paik's *Magnet TV*, Kim Asendorf's pixel
  sorting, Rosa Menkman), links into `documentation/`.
- `CHANGELOG.md` — from the first distributed version.
- `PRIVACY.md` — all processing is local; page media and text are read and
  rewritten in the tab only; nothing collected or transmitted; storage holds
  settings only; the SW image fetch sends no credentials.

---

## Tier 2 — Chrome Web Store

Non-code, but blocking for a listing:
- Developer account ($5 one-time; 2-step verification on the Google account).
- **Privacy policy URL** — required: the extension handles "website content"
  even though nothing leaves the device (local-only processing still needs
  disclosure). Host `PRIVACY.md` at a stable URL.
- **Privacy practices form** + Limited Use certification.
- **Permission justifications**, one paragraph each naming the feature:
  `<all_urls>` (the work is done to every page), `storage` (settings),
  `declarativeNetRequestWithHostAccess` (CORS header on media the extension
  itself re-fetches, per request), `activeTab`/`contextMenus`/`scripting` if
  added; remote code: none.
- Listing assets: 128×128 store icon (`icon128.png` serves), ≥1 screenshot at
  1280×800, 440×280 small promo tile; single-purpose description. A
  screenshot of the piece is a screenshot of someone else's video being
  deformed — shoot listing images on John's own footage or openly licensed
  media, not a YouTube/Instagram feed.
- Publish **unlisted** first: identical review, link-only; flip to public
  when the listing is right.

---

## Tier 3 — other browsers (separate effort)

- **Edge**: same zip, Edge Add-ons account.
- **Firefox**: no `background.service_worker` — declare both
  `background.scripts` and `service_worker` (Chrome takes the worker, Firefox
  the scripts); add `browser_specific_settings.gecko.id`; host permissions
  are user-revocable at any time, so check `permissions.contains` and request
  on demand; rVFC is Firefox ≥132, `Intl.Segmenter` ≥125. Run all four
  harnesses in Firefox before listing.
- **Safari**: `safari-web-extension-converter`, Apple developer account, App
  Store review. Defer.

---

## Verification

- All four harnesses after every step (`python3 test/serve.py`; visual suite
  in a visible tab, 50/50 at time of writing; audio 43/43; text 35/35; panel
  62/62 — the panel suite fails until every new param has a row and tip in
  `panel/defs.js`).
- **CORS rewrite**: the `:8439` cross-origin image check still passes (note
  `test/serve.py` sends ACAO itself, so it doesn't exercise the DNR path) →
  real Chrome: Instagram explore-grid previews distort, a cross-origin `<img>`
  page distorts, a `crossorigin="use-credentials"` test page still loads;
  `chrome.declarativeNetRequest.getSessionRules()` is empty once jobs are
  destroyed and after the tab closes.
- **Audio gate**: fresh profile, default autoplay policy, open a page whose
  video autoplays with sound via engagement (or a test page that plays on
  load) → never silent before the first gesture, processing engages after
  it; `pending` stays bounded; the new live-tier check passes. With
  `audioStreams` off, a `srcObject` element is left untouched.
- **Teardown**: YouTube live → Ctrl+Shift+D: canvases gone, parents'
  `style.position` back, text restored, no observers (check
  `__deflection.registry` from the extension console context). Reload the
  extension from `chrome://extensions` with the tab open → same result, no
  "Extension context invalidated" in the page console.
- **Consent surface**: welcome page opens once on install, never on update;
  badge tracks the kill switch; "disable on this site" restores instantly and
  survives reload; panel opens without a MIDI prompt until "enable MIDI".
- **Text**: a page with `<code>`, `<label>`, and an `aria-live` region keeps
  them intact at `textMin` 8; prose still dissolves.
- **Bounds**: an image-heavy feed activates at most `maxImages`; simulate
  context loss (`WEBGL_lose_context`) with a deliberately broken shader to
  confirm originals come back.
- **Package**: `scripts/package.sh` → unzip to a scratch folder → Load
  unpacked from it → boots; `unzip -l` shows no `_metadata`, `__MACOSX`,
  `.DS_Store`.
- **Console**: a default install logs nothing on ordinary pages; `debug` on
  restores the `[DEFLECTION]` lines.

## Policy facts relied on (checked 2026-08-21)

- `declarativeNetRequest` triggers the install warning "Block content on any
  page you visit"; `declarativeNetRequestWithHostAccess` shows none but needs
  host permissions; `tabIds` conditions are session-rule only —
  [Chrome DNR reference](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest),
  [permission warnings list](https://developer.chrome.com/docs/extensions/reference/permissions-list).
- A privacy policy and the practices disclosure are required for any
  extension handling user data, "even when data is processed or stored
  locally"; "website content" and "web browsing activity" count —
  [Web Store user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq).
- Broad host permissions trigger in-depth review —
  [Web Store review process](https://developer.chrome.com/docs/webstore/review-process).
- Branded Chrome ≥137 removed `--load-extension`; Chromium and Chrome for
  Testing keep it —
  [chromium-extensions PSA](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ).
- `Ctrl` in a command's default key becomes `Command` on macOS; some
  OS/Chrome shortcuts always win —
  [commands API](https://developer.chrome.com/docs/extensions/reference/api/commands).
- Firefox does not support `background.service_worker`; declare both keys.
  Firefox 127+ grants listed host permissions at install but users can
  revoke any of them at any time —
  [MDN background key](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background),
  [Firefox MV3 migration guide](https://extensionworkshop.com/documentation/develop/manifest-v3-migration-guide/).
- Underscore-prefixed names (`_metadata`, `__MACOSX`) are rejected by the
  extension loader and the store uploader —
  [chromium-extensions thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/JxquRLk3Xk8).
