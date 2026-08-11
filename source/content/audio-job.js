// Per-element audio job. Deliberately separate from VideoJob: a <video>
// carries both a visual job and an audio tap, and an <audio> element has no
// visual job at all. Activation is playback-driven, not visibility-driven —
// a display:none <audio> playing music is exactly the target.
//
// Lifecycle: pending (gated/queued) → tapped (engaged|bypassed) → abandoned.
// The tap itself is permanent and lives in the graph's WeakMap; this job
// only decides whether the tap is engaged.

import { acquireAudio, tapSafety } from '../audio/graph.js';

export class AudioJob {
  constructor(el, params) {
    this.kind = 'audio';
    this.el = el;
    this.params = params;
    this.graph = null;
    this.tap = null;
    this.allowed = false; // registry cap slot
    this.abandoned = false;
    this.destroyed = false;
    this.lastPlayingAt = 0;
    this.loggedSilence = false;

    this.onPlaying = () => {
      this.lastPlayingAt = performance.now();
      this.sync();
    };
    this.onQuiet = () => this.sync();
    // Src swaps re-run the safety gate: a safe element can become unsafe
    // (unrecoverable if already tapped — log it) and vice versa.
    this.onSrcChange = () => {
      this.loggedSilence = false;
      this.sync();
    };
    this.onEncrypted = () => this.abandon('drm');

    el.addEventListener('playing', this.onPlaying);
    el.addEventListener('pause', this.onQuiet);
    el.addEventListener('ended', this.onQuiet);
    el.addEventListener('emptied', this.onSrcChange);
    el.addEventListener('loadstart', this.onSrcChange);
    el.addEventListener('encrypted', this.onEncrypted);

    if (this.playing()) this.onPlaying();
  }

  playing() {
    return !this.el.paused && !this.el.ended && this.el.readyState >= 2;
  }

  setAllowed(on) {
    if (this.allowed === on) return;
    this.allowed = on;
    this.sync();
  }

  shouldEngage() {
    return (
      !this.abandoned &&
      !this.destroyed &&
      this.allowed &&
      this.params.enabled &&
      this.params.audioEnabled !== false &&
      this.playing()
    );
  }

  sync() {
    if (this.abandoned || this.destroyed) return;

    if (!this.shouldEngage()) {
      if (this.tap?.engaged) this.graph.bypass(this.tap);
      return;
    }

    const safety = tapSafety(this.el);
    if (safety !== 'safe') {
      if (safety === 'drm') return this.abandon('drm');
      // cors / no-src: never tap; the original audio plays untouched. The
      // element may become safe later (src swap) — stay pending.
      return;
    }

    if (!this.graph) {
      this.graph = acquireAudio();
      if (!this.graph) return this.abandon('no-web-audio');
    }
    if (!this.tap) {
      this.tap = this.graph.getTap(this.el);
      if (!this.tap) return this.abandon('page-web-audio');
    }

    if (!this.tap.engaged) {
      this.graph.whenRunning(() => {
        if (this.shouldEngage() && this.tap && !this.tap.engaged) {
          this.graph.engage(this.tap, this.params, (e) => this.onStats(e.data));
        }
      });
    } else {
      this.graph.setMix(this.tap, this.params.audioMix ?? 1);
    }
  }

  onStats(msg) {
    if (msg?.type !== 'stats') return;
    // A tapped element playing loud video with a silent worklet input means
    // an unpredicted CORS/DRM silence — telemetry for site-notes.md.
    if (msg.silentMs > 3000 && this.playing() && !this.el.muted && !this.loggedSilence) {
      this.loggedSilence = true;
      console.log(
        '[DEFLECTION] tapped element reads silent (undetected taint?):',
        (this.el.currentSrc || '').slice(0, 100)
      );
    }
  }

  applyParams() {
    if (this.tap?.engaged) {
      this.graph.sendParams(this.tap, this.params);
      this.graph.setMix(this.tap, this.params.audioMix ?? 1);
    }
    this.sync();
  }

  // API parity with the visual jobs so the registry can treat all jobs alike.
  checkHealth() {}
  syncGeometry() {}
  activate() {}
  suspend() {
    if (this.tap?.engaged) this.graph.bypass(this.tap);
  }

  abandon(reason) {
    if (this.abandoned) return;
    this.abandoned = true;
    if (this.tap?.engaged) this.graph?.bypass(this.tap);
    console.log('[DEFLECTION] audio left untouched:', reason);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const el = this.el;
    el.removeEventListener('playing', this.onPlaying);
    el.removeEventListener('pause', this.onQuiet);
    el.removeEventListener('ended', this.onQuiet);
    el.removeEventListener('emptied', this.onSrcChange);
    el.removeEventListener('loadstart', this.onSrcChange);
    el.removeEventListener('encrypted', this.onEncrypted);
    if (this.tap?.engaged) this.graph?.bypass(this.tap);
    // The tap itself stays in the graph's WeakMap: if this element comes
    // back (YouTube re-parenting), the next job reuses it — re-tapping
    // would throw.
  }
}
