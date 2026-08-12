// The text mode (optional, off by default) — the sorting grammar applied to
// language. Captions are *rearranged*, never scrambled: every title on the
// page is still a real, correctly spelled title, attached to the wrong
// thing. Nothing added, nothing lost, unreliable anyway.
//
// Restraint is the design. Only text living in the same card as a medium the
// pipeline is already corrupting is eligible, so navigation, search and
// buttons stay clean *by construction* rather than by a blocklist — and a
// card whose media abandoned (DRM, taint) keeps its real caption, because its
// picture is real too.
//
// Three rules keep it from breaking the page:
//
//   1. Only `Text.nodeValue` is ever written — never structure, never an
//      attribute. Character data is not a childList mutation, so the
//      registry's MutationObserver cannot see these writes and cannot loop
//      on them. (Setting textContent or replacing nodes would.)
//   2. Every record is self-invalidating. If a site re-renders a node we
//      tracked, the value we wrote is gone: the record is dropped, never
//      restored, so a stale title can never be written back over live
//      content — the case that matters on YouTube, which reuses the same
//      DOM nodes for the next video.
//   3. Swaps stay inside a length class, so a caption never lands somewhere
//      that cannot hold it and the layout underneath stays put.

const CARD_MAX_DEPTH = 6; // how far above a medium a caption may live
const MIN_CHARS = 12; // shorter than this is a label, not a caption
const MAX_DIGIT_RATIO = 0.25; // filters durations, view counts, dates
const MAX_TRACKED = 300; // bound on live records per document
const DONOR_LIMIT = 400; // bound on remembered originals per length class
const MISS_LIMIT = 3; // give up re-walking a card with no caption
const BUCKETS = [32, 96, Infinity]; // length classes, in characters

const SKIP_TAGS = new Set([
  'BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'FORM',
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS',
  'NAV', 'HEADER', 'FOOTER', 'TIME',
  'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'SOURCE', 'TRACK', // fallback text
]);
const SKIP_ROLES = new Set([
  'button', 'menuitem', 'tab', 'textbox', 'searchbox', 'navigation', 'toolbar',
]);

function isSkippable(el) {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable === true) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  const role = el.getAttribute('role');
  return !!role && SKIP_ROLES.has(role.toLowerCase());
}

// A caption is prose: long enough, more than one word, mostly letters.
export function qualifies(raw) {
  const s = raw.trim();
  if (s.length < MIN_CHARS) return false;
  if (!/\s/.test(s)) return false;
  if (!/\p{L}/u.test(s)) return false;
  const digits = (s.match(/\d/g) || []).length;
  return digits / s.length <= MAX_DIGIT_RATIO;
}

export function bucketOf(text) {
  return BUCKETS.findIndex((max) => text.length < max);
}

export class TextSwap {
  constructor(params) {
    this.params = params;
    this.records = new Map(); // Text node → { el, original, shown }
    this.donors = new Map(); // bucket → [original strings seen]
    this.handled = new WeakSet(); // media elements with a live record
    this.misses = new WeakMap(); // media element → failed caption walks
  }

  // Called from the registry sweep with the media the pipeline is corrupting.
  update(mediaElements) {
    if (!this.params.enabled || !this.params.textSwap) return;
    this.prune();
    if (this.records.size >= MAX_TRACKED) return;

    const tracked =
      mediaElements instanceof Set ? mediaElements : new Set(mediaElements);
    const fresh = [];
    // One caption per card, even when the card holds two media — a stacked
    // preview and its thumbnail both resolve here to the same text node, and
    // letting it into the pass twice would write it twice and record the
    // second "original" from already-swapped text, poisoning the restore.
    const claimed = new Set();
    for (const el of tracked) {
      if (!el.isConnected || this.handled.has(el)) continue;
      if ((this.misses.get(el) ?? 0) >= MISS_LIMIT) continue;
      const node = this.findCaption(el, tracked);
      if (!node || this.records.has(node) || claimed.has(node)) {
        this.misses.set(el, (this.misses.get(el) ?? 0) + 1);
        continue;
      }
      claimed.add(node);
      this.misses.delete(el);
      fresh.push({ el, node, text: node.nodeValue.trim() });
      if (this.records.size + fresh.length >= MAX_TRACKED) break;
    }
    if (fresh.length) this.swap(fresh);
  }

  // The card: the shallowest ancestor holding this medium and a caption, and
  // no medium belonging to a *different* card. Tracked is the operative word
  // — the registry has already discarded icons and avatars by size, so an
  // avatar in a video card doesn't count as a second medium and cut the
  // search short.
  findCaption(media, tracked) {
    const rect = media.getBoundingClientRect();
    let el = media.parentElement;
    for (let depth = 0; el && depth < CARD_MAX_DEPTH; depth++) {
      if (el === document.body || el === document.documentElement) break;
      if (hasForeignMedia(el, tracked, media, rect)) break;
      const node = this.pickText(el);
      if (node) return node;
      el = el.parentElement;
    }
    return null;
  }

  // The longest qualifying text in the card — the title, in practice.
  pickText(card) {
    const walker = document.createTreeWalker(
      card,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return isSkippable(node)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP;
          }
          return qualifies(node.nodeValue)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    let best = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (this.records.has(n)) continue;
      if (!best || n.nodeValue.trim().length > best.nodeValue.trim().length) {
        best = n;
      }
    }
    return best;
  }

  // Within a length class: shuffle, then rotate by one. Rotation is a perfect
  // derangement — nobody keeps their own title — and it conserves the page's
  // text exactly, which is the whole argument. A lone arrival (infinite
  // scroll trickling one card at a time) takes a remembered original instead;
  // if there is nothing to trade with yet it is left alone and re-offered on
  // the next sweep, so text never changes without a partner.
  swap(fresh) {
    const byBucket = new Map();
    for (const item of fresh) {
      const b = bucketOf(item.text);
      if (!byBucket.has(b)) byBucket.set(b, []);
      byBucket.get(b).push(item);
    }

    for (const [bucket, items] of byBucket) {
      if (items.length >= 2) {
        shuffle(items);
        const texts = items.map((i) => i.text);
        items.forEach((item, i) => {
          this.apply(item, texts[(i + 1) % texts.length], bucket);
        });
      } else {
        const [item] = items;
        const donor = this.pickDonor(bucket, item.text);
        if (donor) this.apply(item, donor, bucket);
      }
    }
  }

  pickDonor(bucket, own) {
    const pool = this.donors.get(bucket);
    if (!pool?.length) return null;
    const options = pool.filter((t) => t !== own);
    if (!options.length) return null;
    return options[Math.floor(Math.random() * options.length)];
  }

  apply(item, donorText, bucket) {
    if (this.records.has(item.node)) return; // never re-record a swapped node
    const raw = item.node.nodeValue;
    const lead = raw.match(/^\s*/)[0];
    const tail = raw.match(/\s*$/)[0];
    const shown = lead + donorText + tail;
    item.node.nodeValue = shown;
    this.records.set(item.node, { el: item.el, original: raw, shown });
    this.handled.add(item.el);

    // The original joins the pool the swap draws from, so a page's text keeps
    // circulating across scroll and navigation instead of resetting.
    if (!this.donors.has(bucket)) this.donors.set(bucket, []);
    const pool = this.donors.get(bucket);
    if (!pool.includes(item.text)) pool.push(item.text);
    if (pool.length > DONOR_LIMIT) pool.shift();
  }

  // Drop records whose node left the document or whose value the site
  // rewrote. Both mean our copy of the original is no longer the truth.
  prune() {
    for (const [node, rec] of this.records) {
      if (node.isConnected && node.nodeValue === rec.shown) continue;
      this.records.delete(node);
      this.handled.delete(rec.el);
      this.misses.delete(rec.el);
    }
  }

  // The kill switch's other half: every caption we wrote goes back, and only
  // where our text is still the one on screen.
  restoreAll() {
    for (const [node, rec] of this.records) {
      if (node.isConnected && node.nodeValue === rec.shown) {
        node.nodeValue = rec.original;
      }
    }
    this.records.clear();
    this.donors.clear();
    this.handled = new WeakSet();
    this.misses = new WeakMap();
  }

  stats() {
    let pooled = 0;
    for (const pool of this.donors.values()) pooled += pool.length;
    return { swapped: this.records.size, pooled };
  }
}

// A second tracked medium under an ancestor usually means the climb has
// reached a grid — but not always: a feed tile stacks a preview <video> over
// its own thumbnail <img> (Instagram explore), and that pair is one card.
// Media overlapping the medium we started from is part of the same tile;
// anything else belongs to another card, and that is where the climb stops.
// Every rect here is read during the collection pass, before any caption is
// written, so a sweep costs one layout flush rather than one per card.
function hasForeignMedia(el, tracked, self, rect) {
  for (const media of el.querySelectorAll('video, img')) {
    if (media === self || !tracked.has(media)) continue;
    if (!overlaps(rect, media.getBoundingClientRect())) return true;
  }
  return false;
}

function overlaps(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return false;
  const smaller = Math.min(a.width * a.height, b.width * b.height);
  return smaller > 0 && (w * h) / smaller > 0.5;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
