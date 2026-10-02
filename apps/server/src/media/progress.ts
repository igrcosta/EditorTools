export type WorkKind = 'whisper' | 'align';

/**
 * Speed learned from finished jobs (this process only), so the second transcription on a machine
 * starts with a realistic estimate instead of the built-in guess.
 */
const learnedRtf: Partial<Record<WorkKind, number>> = {};

/**
 * Percent-complete for work that has no fine-grained progress of its own.
 *
 * whisper.cpp only reports progress once per 30 s window of audio, so a bar driven by that alone
 * sits still for most of a long job. Instead this works like a file-copy dialog: percent is
 * time spent over time spent plus time still expected, where the expectation comes from the
 * speed ("real-time factor": seconds of work per second of audio) measured on the units already
 * finished. Real signals (a whisper window completing, an aligner window completing) correct the
 * estimate as they arrive, rather than being the only thing that moves the bar.
 *
 * It is an estimate, not a measurement, so it is capped below 100: the job reaching 100 is the
 * runner's own completion, once the result actually exists. The value never goes backwards.
 */
export class EtaProgress {
  private readonly startedAt = Date.now();
  private readonly rtf: Record<WorkKind, number>;
  /** Audio seconds still to process per kind, not counting the unit in progress. */
  private remaining: Record<WorkKind, number> = { whisper: 0, align: 0 };
  private current: {
    kind: WorkKind;
    audio: number;
    startedAt: number;
    /** Last real fraction reported, when it arrived, and the fraction the next report can't exceed. */
    real: number;
    realAt: number;
    next: number;
  } | null = null;
  private last = 0;

  constructor(defaults: Record<WorkKind, number>) {
    this.rtf = { whisper: learnedRtf.whisper ?? defaults.whisper, align: learnedRtf.align ?? defaults.align };
  }

  /** Sets the audio left to process (call again when the plan firms up, e.g. once chunks are known). */
  plan(remaining: Record<WorkKind, number>): void {
    this.remaining = { ...remaining };
  }

  /** Drops the expected aligner work, e.g. when the detected language turns out to have no model. */
  skipAlign(): void {
    this.remaining.align = 0;
  }

  /**
   * @param firstStep fraction of the unit its first real report will cover at most (a whisper
   *   window is 30 s of audio), so the estimate never runs past what is known to still be pending.
   */
  begin(kind: WorkKind, audioSeconds: number, firstStep = 1): void {
    this.remaining[kind] = Math.max(0, this.remaining[kind] - audioSeconds);
    const now = Date.now();
    this.current = { kind, audio: audioSeconds, startedAt: now, real: 0, realAt: now, next: Math.min(1, firstStep) };
  }

  /**
   * A real fraction (0–1) of the current unit, when the tool reports one.
   * @param next the largest fraction the following report can be, if known (end of the next window)
   */
  setReal(fraction: number, next = 1): void {
    const c = this.current;
    if (!c || fraction <= c.real) return;
    c.real = Math.min(1, fraction);
    c.realAt = Date.now();
    c.next = Math.min(1, Math.max(next, c.real));
  }

  end(): void {
    const c = this.current;
    if (!c) return;
    const measured = (Date.now() - c.startedAt) / 1000 / Math.max(c.audio, 0.5);
    // Blend, so one odd chunk doesn't swing every later estimate.
    this.rtf[c.kind] = 0.5 * this.rtf[c.kind] + 0.5 * measured;
    learnedRtf[c.kind] = this.rtf[c.kind];
    this.current = null;
  }

  /** 0–99, never decreasing. */
  percent(): number {
    const now = Date.now();
    const elapsed = (now - this.startedAt) / 1000;
    let left = this.remaining.whisper * this.rtf.whisper + this.remaining.align * this.rtf.align;

    const c = this.current;
    if (c) {
      const spent = (now - c.startedAt) / 1000;
      // Pace: what the unit as a whole should take. Measured from the last real report once there
      // is one (a few percent in), otherwise the speed learned or assumed for this kind of work.
      const expectedTotal = c.real >= 0.05 ? (c.realAt - c.startedAt) / 1000 / c.real : c.audio * this.rtf[c.kind];
      // Advance by that pace, but never past the next point a real report could land at: whatever
      // lies beyond it has not been confirmed yet. Always at least what was actually reported.
      const byTime = expectedTotal > 0 ? spent / expectedTotal : 0;
      const fraction = Math.max(c.real, Math.min(byTime, c.next * 0.97, 0.97));
      left += expectedTotal * (1 - fraction);
    }

    const total = elapsed + left;
    const pct = total > 0 ? Math.min(99, Math.floor((elapsed / total) * 100)) : 0;
    this.last = Math.max(this.last, pct);
    return this.last;
  }
}
