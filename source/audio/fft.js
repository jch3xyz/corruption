// Iterative radix-2 FFT with precomputed bit-reversal and twiddle tables.
// No dependencies; importable by the worklet, the harness, and any plain
// page. ~The audio analog of shaders-as-modules: the DSP core stays
// testable without an audio API in sight.

export function createFFT(n) {
  if ((n & (n - 1)) !== 0) throw new Error('FFT size must be a power of 2');
  const levels = Math.log2(n) | 0;

  const rev = new Uint32Array(n);
  for (let i = 1; i < n; i++) {
    rev[i] = (rev[i >> 1] >> 1) | ((i & 1) << (levels - 1));
  }

  // Forward twiddles e^{-i2πk/n}; inverse flips the sign of sin.
  const cosT = new Float32Array(n / 2);
  const sinT = new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cosT[i] = Math.cos((2 * Math.PI * i) / n);
    sinT[i] = -Math.sin((2 * Math.PI * i) / n);
  }

  function transform(re, im, inverse) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const c = cosT[tw];
          const s = inverse ? -sinT[tw] : sinT[tw];
          const i1 = start + k;
          const i2 = i1 + half;
          const tr = re[i2] * c - im[i2] * s;
          const ti = re[i2] * s + im[i2] * c;
          re[i2] = re[i1] - tr;
          im[i2] = im[i1] - ti;
          re[i1] += tr;
          im[i1] += ti;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }

  return {
    size: n,
    forward: (re, im) => transform(re, im, false),
    inverse: (re, im) => transform(re, im, true),
  };
}
