// The text mode (optional, off by default) — the sorting grammar applied to
// language, everywhere on the page. Every letter stays inside its own word;
// the order within the word is rearranged. Nothing added, nothing lost,
// unreadable anyway: the argument the pixel sort makes about images, made
// literal about words.
//
// The barrier rule is the sort's, transposed. In the shader a sub-threshold
// pixel refuses to be traded through, so sorting stays confined inside bright
// spans and dark material holds the image together. Here anything that is not
// a letter — space, punctuation, digit, emoji — is that barrier: no glyph
// ever crosses one. Word count, word lengths, and every mark stay exactly
// where they were, so the page keeps its shape and loses its sense.
//
// John's calls, 2026-08-12, in order: scrambling rather than swapping
// captions between cards (that version is tag `text-swap`), and then the
// whole page rather than only media captions. The proposal argued against
// both — an unreadable interface is an unnavigable one — so what protects
// navigability now is not containment but a minimum run length: only runs
// of at least TEXT_MIN characters are eligible, and interface labels are
// short. At 8 the prose dissolves and the shortest furniture (Home, OK)
// survives. It was the panel's `textMin` slider until 2026-10-11; John
// retired the slider (the mode is an on/off effect) and 8, his setting,
// became the constant. A stale `textMin` in an older profile is ignored.
//
// Three exclusions are not aesthetic and must stay:
//
//   - **script / style / noscript.** A page's CSS is live text; scrambling it
//     would wreck the layout rather than bend the rendering.
//   - **contenteditable, input, textarea.** A visitor's half-typed comment is
//     data, and a site may well save it. (Their values aren't text nodes
//     anyway, which is why search still works while everything around it
//     dissolves — the one navigational lifeline left, and it is free.)
//   - **our own overlay canvases**, which have no text but are cheap to skip.
//
// And three rules keep it from breaking the page:
//
//   1. Only `Text.nodeValue` is ever written — never structure, never an
//      attribute. Character data is not a childList mutation, so the
//      registry's MutationObserver cannot see these writes and cannot loop
//      on them. (Setting textContent or replacing nodes would.)
//   2. Every record is self-invalidating. If a site re-renders a node we
//      tracked, the value we wrote is gone: the record is dropped, never
//      restored, so stale text can never be written back over live content —
//      the case that matters on YouTube, which reuses the same DOM nodes for
//      the next video.
//   3. Nothing here reads layout, so a pass costs no reflow no matter how
//      much of the page it touches.

const MAX_TRACKED = 2000; // bound on live records per document
export const TEXT_MIN = 8; // shortest run of text that scrambles (was the textMin knob)
const SHUFFLE_TRIES = 8; // attempts to land on an arrangement that differs

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', // live text: scrambling these breaks the page
  'INPUT', 'TEXTAREA', 'OPTION', // the visitor's own data
  'VIDEO', 'AUDIO', 'IMG', 'PICTURE', 'SOURCE', 'TRACK', // fallback text
]);

// A word is a run of letters and the marks that belong to them; graphemes,
// not code points, so a combining accent travels with its base letter.
const WORD = /[\p{L}\p{M}]+/gu;
const graphemes =
  typeof Intl !== 'undefined' && Intl.Segmenter
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

function isSkippable(el) {
  if (SKIP_TAGS.has(el.tagName.toUpperCase())) return true;
  if (el.isContentEditable === true) return true;
  if (el.dataset?.deflection !== undefined) return true; // our own overlay
  return el.getAttribute('aria-hidden') === 'true';
}

// Eligibility is a single number: enough letters to be worth rearranging.
// `min` is TEXT_MIN in the piece (kept as a parameter so the grammar stays a
// pure, testable function) — at 8 the prose goes and the interface labels
// survive by being short; at 1 nothing survives.
export function qualifies(raw, min = TEXT_MIN) {
  const s = raw.trim();
  return s.length >= min && /\p{L}/u.test(s);
}

// Rearrange each word in place. Everything between words is a barrier and is
// returned untouched, so this is a permutation of the string's own glyphs.
export function scramble(text) {
  return text.replace(WORD, permute);
}

function permute(word) {
  const units = graphemes
    ? [...graphemes.segment(word)].map((s) => s.segment)
    : [...word];
  if (units.length < 2 || new Set(units).size < 2) return word; // "I", "aaa"
  for (let i = 0; i < SHUFFLE_TRIES; i++) {
    const out = shuffle([...units]).join('');
    if (out !== word) return out;
  }
  return word;
}

export class TextScramble {
  constructor(params) {
    this.params = params;
    this.records = new Map(); // Text node → { original, shown }
  }

  // Called from the registry sweep. Walks the document rather than following
  // media: this mode is not tied to what the pipeline is corrupting.
  update() {
    if (!this.params.enabled || !this.params.textScramble) return;
    this.prune();
    if (this.records.size >= MAX_TRACKED) return;

    const min = TEXT_MIN;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            return isSkippable(node)
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_SKIP;
          }
          return qualifies(node.nodeValue, min)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );

    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (this.records.has(n)) continue; // already ours; leave it settled
      this.apply(n);
      if (this.records.size >= MAX_TRACKED) break;
    }
  }

  apply(node) {
    const original = node.nodeValue;
    const shown = scramble(original);
    if (shown === original) return; // nothing here can be rearranged
    node.nodeValue = shown;
    this.records.set(node, { original, shown });
  }

  // Drop records whose node left the document or whose value the site
  // rewrote. Both mean our copy of the original is no longer the truth.
  prune() {
    for (const [node, rec] of this.records) {
      if (node.isConnected && node.nodeValue === rec.shown) continue;
      this.records.delete(node);
    }
  }

  // The kill switch's other half: everything we wrote goes back, and only
  // where our text is still the one on screen.
  restoreAll() {
    for (const [node, rec] of this.records) {
      if (node.isConnected && node.nodeValue === rec.shown) {
        node.nodeValue = rec.original;
      }
    }
    this.records.clear();
  }

  stats() {
    return { scrambled: this.records.size };
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
