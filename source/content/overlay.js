// Sibling-canvas overlay. The canvas sits immediately after the media
// element in the DOM, absolutely positioned against the element's parent
// (patched to position:relative if static). This survives scrolling with
// zero per-frame work, and survives fullscreen because the sibling lives
// inside the fullscreened subtree.

export class Overlay {
  constructor(el) {
    this.el = el;
    this.parent = el.parentElement;
    if (!this.parent) throw new Error('no parent element');

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('data-deflection', '');
    this.canvas.style.cssText =
      'position:absolute;margin:0;padding:0;border:0;pointer-events:none;display:none;';

    this.parentPatched = false;
    if (getComputedStyle(this.parent).position === 'static') {
      this.savedParentPosition = this.parent.style.position;
      this.parent.style.position = 'relative';
      this.parentPatched = true;
    }

    el.insertAdjacentElement('afterend', this.canvas);

    this.lastGeom = { left: NaN, top: NaN, width: NaN, height: NaN };
    this.sync();
  }

  // Recompute position and backing-store size. Event-driven (resize,
  // fullscreen, sweep) — never per frame.
  sync() {
    const { el, parent, canvas } = this;
    if (!el.isConnected || !canvas.isConnected) return false;

    const er = el.getBoundingClientRect();
    if (er.width < 1 || er.height < 1) return false;
    const pr = parent.getBoundingClientRect();

    // Absolute position is relative to the parent's padding box.
    const left = er.left - pr.left - parent.clientLeft + parent.scrollLeft;
    const top = er.top - pr.top - parent.clientTop + parent.scrollTop;
    const width = Math.round(er.width);
    const height = Math.round(er.height);

    const g = this.lastGeom;
    if (left !== g.left || top !== g.top) {
      canvas.style.left = `${left}px`;
      canvas.style.top = `${top}px`;
    }
    if (width !== g.width || height !== g.height) {
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.width = width; // resets the drawing buffer
      canvas.height = height;
    }
    this.lastGeom = { left, top, width, height };
    return true;
  }

  show() {
    this.canvas.style.display = 'block';
  }

  hide() {
    this.canvas.style.display = 'none';
  }

  destroy() {
    this.canvas.remove();
    if (this.parentPatched && this.parent.isConnected) {
      this.parent.style.position = this.savedParentPosition;
    }
  }
}

// Dest rect for drawing a natW×natH frame into a boxW×boxH canvas the way
// the element's object-fit / object-position would render it. (Blink's UA
// stylesheet gives <video> object-fit:contain — computed style reflects it.)
export function objectFitRect(el, boxW, boxH, natW, natH) {
  const cs = getComputedStyle(el);
  let fit = cs.objectFit;
  if (fit === 'scale-down') {
    fit = natW <= boxW && natH <= boxH ? 'none' : 'contain';
  }

  let w = boxW;
  let h = boxH;
  if (fit === 'contain' || fit === 'cover') {
    const scale =
      fit === 'contain'
        ? Math.min(boxW / natW, boxH / natH)
        : Math.max(boxW / natW, boxH / natH);
    w = natW * scale;
    h = natH * scale;
  } else if (fit === 'none') {
    w = natW;
    h = natH;
  }

  const [x, y] = parseObjectPosition(cs.objectPosition, boxW - w, boxH - h);
  return { x, y, w, h };
}

// Computed object-position resolves to "<x> <y>" in % or px. Percentages
// distribute the leftover space, like background-position.
function parseObjectPosition(str, spareW, spareH) {
  const parts = str.split(' ');
  const solve = (part, spare) => {
    if (part === undefined) return spare / 2;
    if (part.endsWith('%')) return (parseFloat(part) / 100) * spare;
    return parseFloat(part) || 0;
  };
  return [solve(parts[0], spareW), solve(parts[1], spareH)];
}
