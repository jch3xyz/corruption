// Adaptive quality governor, one per video job. Signal: rVFC
// metadata.presentedFrames deltas — a jump of 2+ means the compositor
// presented frames we never got to process, i.e. the pipeline isn't
// keeping up. Response ladder: halve the sort passes first (cheapest
// lever), then step processing resolution down. Hysteresis both ways so
// the quality level doesn't oscillate on a busy page.

const RES_STEPS = [1, 0.75, 0.5];
const MAX_LEVEL = 3; // 1: passes/2 · 2: + res×0.75 · 3: + res×0.5
const DROP_STREAK_LIMIT = 15; // consecutive dropped-frame callbacks → step down
const RECOVERY_MS = 10000; // clean time → step back up

export class FrameGovernor {
  constructor() {
    this.level = 0;
    this.lastPresented = 0;
    this.lastNow = 0;
    this.dropStreak = 0;
    this.cleanMs = 0;
  }

  sample(now, metadata) {
    const presented = metadata?.presentedFrames;
    const prevPresented = this.lastPresented;
    const prevNow = this.lastNow;
    this.lastPresented = presented ?? 0;
    this.lastNow = now;
    // First sample (or resume after suspend) has a garbage delta; skip it.
    if (presented === undefined || prevPresented === 0 || prevNow === 0) return;

    if (presented - prevPresented > 1) {
      this.dropStreak++;
      this.cleanMs = 0;
      if (this.dropStreak >= DROP_STREAK_LIMIT && this.level < MAX_LEVEL) {
        this.level++;
        this.dropStreak = 0;
      }
    } else {
      this.dropStreak = 0;
      this.cleanMs += now - prevNow;
      if (this.cleanMs >= RECOVERY_MS && this.level > 0) {
        this.level--;
        this.cleanMs = 0;
      }
    }
  }

  effectivePasses(requested) {
    if (!requested || requested <= 0) return 0;
    return this.level >= 1 ? Math.max(2, Math.round(requested / 2)) : requested;
  }

  resScale() {
    return RES_STEPS[Math.max(0, this.level - 1)];
  }
}
