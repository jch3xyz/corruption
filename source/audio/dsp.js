// Pure DSP helpers shared by the worklet and the harness. These are the
// audio ports of the shader's compare-exchange semantics: quiet material is
// a barrier exactly as dark pixels are, and "loud rises toward the start"
// is the analog of "bright rises toward the top."

// Descending stride ladder, two passes (both parities) per level — the same
// schedule as gl/pipeline.js runSortPasses.
export function ladderSchedule(streak) {
  let top = 1;
  while (top * 2 <= Math.max(1, streak || 1)) top *= 2;
  const schedule = [];
  for (let s = top; s >= 1; s >>= 1) schedule.push([s, 0], [s, 1]);
  return schedule;
}

// One compare-exchange pass over `order` (indices into `keys`), block-paired
// at stride s with parity p. Louder keys rise toward index 0. Both members
// must meet the cutoff — quiet grains are barriers.
export function sortIndicesPass(keys, order, s, p, cutoff) {
  const n = order.length;
  for (let i = 0; i < n; i++) {
    const block = (i / s) | 0;
    if (((block + p) & 1) !== 0) continue; // only upper members drive swaps
    const j = i + s;
    if (j >= n) continue;
    const a = keys[order[i]];
    const b = keys[order[j]];
    if (a < cutoff || b < cutoff) continue;
    if (a < b) {
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
  }
}

// Same pass over raw values in place (used on spectral magnitudes).
export function sortValuesPass(vals, s, p, cutoff, lo, hi) {
  for (let i = lo; i < hi; i++) {
    const rel = i - lo;
    const block = (rel / s) | 0;
    if (((block + p) & 1) !== 0) continue;
    const j = i + s;
    if (j >= hi) continue;
    const a = vals[i];
    const b = vals[j];
    if (a < cutoff || b < cutoff) continue;
    if (a < b) {
      vals[i] = b;
      vals[j] = a;
    }
  }
}

export function rms(buf, start, len) {
  let sum = 0;
  for (let i = start; i < start + len; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / len);
}
