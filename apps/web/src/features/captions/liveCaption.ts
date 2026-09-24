import { CAPTION_BOUNCE_TIMING, CAPTION_FADE_TIMING, type WordChunk } from '@editools/shared';
import type { PreviewStyle } from './previewStyles';

export interface WordSlot {
  text: string;
  role: 'plain' | 'active';
}

export interface ActiveCaption {
  words: WordSlot[];
  /** Milliseconds since the active word's own start — drives its entrance animation. */
  elapsedMs: number;
}

/**
 * What should be on screen at `currentTime`, mirroring apps/server/src/media/captions.ts's
 * buildAssTrack exactly (same chunking, same per-word-line vs static-line branch, same
 * progressive-reveal rule) so the preview is never a guess at what the burned-in render will do.
 */
export function resolveActiveCaption(chunks: WordChunk[], currentTime: number, style: PreviewStyle): ActiveCaption | null {
  const perWord = style.highlight !== undefined || style.animation !== undefined;
  const revealProgressively = style.animation !== undefined;

  for (const chunk of chunks) {
    if (!perWord) {
      if (currentTime >= chunk.start && currentTime < chunk.end) {
        return { words: chunk.words.map((w) => ({ text: w.text, role: 'plain' as const })), elapsedMs: 0 };
      }
      continue;
    }

    const idx = chunk.words.findIndex((w) => currentTime >= w.start && currentTime < w.end);
    if (idx === -1) continue;

    const slots: WordSlot[] = chunk.words.slice(0, idx).map((w) => ({ text: w.text, role: 'plain' as const }));
    slots.push({ text: chunk.words[idx].text, role: 'active' });
    if (!revealProgressively) {
      slots.push(...chunk.words.slice(idx + 1).map((w) => ({ text: w.text, role: 'plain' as const })));
    }
    return { words: slots, elapsedMs: (currentTime - chunk.words[idx].start) * 1000 };
  }
  return null;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

/** Mirrors the server's \fscx/\fscy \t() tag: startScale → overshoot at peakMs → settle by settleMs. */
export function bounceScale(elapsedMs: number): number {
  const { startScale, peakScale, peakMs, settleMs } = CAPTION_BOUNCE_TIMING;
  if (elapsedMs <= 0) return startScale;
  if (elapsedMs < peakMs) return lerp(startScale, peakScale, elapsedMs / peakMs);
  if (elapsedMs < settleMs) return lerp(peakScale, 1, (elapsedMs - peakMs) / (settleMs - peakMs));
  return 1;
}

/** Mirrors the server's \alpha \t() tag: linear ramp from transparent to opaque. */
export function fadeAlpha(elapsedMs: number): number {
  return Math.min(1, Math.max(0, elapsedMs / CAPTION_FADE_TIMING.durationMs));
}
