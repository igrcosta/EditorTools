import { readFile } from 'node:fs/promises';
import type { CaptionWord } from '@editools/shared';
import { getEmissionClient } from './emission';
import type { TranscriptSegment } from './whisper';

/**
 * Word timing by CTC forced alignment — the technique WhisperX is built on.
 *
 * whisper only decides *what* was said. Its own per-token timestamps are a by-product of the
 * decoder (not an alignment), and measured against a ground-truth clip they land 150–1500 ms off
 * (see the benchmark notes in whisper.ts). Here the transcript is instead aligned to the audio by
 * a wav2vec2 CTC acoustic model: it emits a character distribution every 20 ms, and a Viterbi
 * pass finds the single best way to lay the known transcript characters over those frames.
 *
 * One model per language (wav2vec2 CTC models are char-level and language-specific), listed in
 * ALIGNER_MODELS and downloaded by scripts/fetch-vendor.mjs. A language without a model keeps
 * whisper's own timings — see tasks.ts.
 */

const SAMPLE_RATE = 16_000;
/** wav2vec2's convolutional front-end downsamples 320:1, i.e. one emission frame per 20 ms. */
const FRAME_SECONDS = 0.02;
/** Audio on each side of a window, so a word at a whisper segment edge is not clipped. */
const WINDOW_MARGIN_SECONDS = 0.4;
/** wav2vec2 attention is quadratic in length: keep each pass to roughly this much speech. */
const MAX_WINDOW_SECONDS = 20;
/**
 * The CTC spike for a character lands a little after the sound begins (the model "commits" once
 * it has heard enough). Measured against ground truth in the alignment benchmark; see
 * ONSET_BIAS_SECONDS use below.
 */
const ONSET_BIAS_SECONDS = 0.06;
/** A word's end is the last character's frame plus this tail, then capped at the next word's start. */
const END_TAIL_SECONDS = 0.12;

export interface AlignerSpec {
  /** ISO 639-1 code (what whisper's `-l` and the UI language picker use). */
  language: string;
  /** Files under the models dir. */
  model: string;
  vocab: string;
}

/** Languages with a forced-alignment model. Keep in sync with ALIGNER_MODELS in scripts/fetch-vendor.mjs. */
export const ALIGNER_MODELS: readonly AlignerSpec[] = [
  { language: 'en', model: 'aligner-en.onnx', vocab: 'aligner-en.vocab.json' },
  { language: 'pt', model: 'aligner-pt.onnx', vocab: 'aligner-pt.vocab.json' },
];

interface Vocab {
  ids: Map<string, number>;
  blank: number;
  separator: number;
  /** English wav2vec2 is uppercase-only, Portuguese lowercase-only. */
  upper: boolean;
}

async function loadVocab(file: string): Promise<Vocab> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, number>;
  const ids = new Map(Object.entries(raw));
  const upper = ids.has('A') && !ids.has('a');
  return { ids, blank: raw['<pad>'] ?? 0, separator: raw['|'] ?? 4, upper };
}

/** Reads a 16 kHz mono PCM16 WAV (what the captions task extracts with ffmpeg) as floats. */
export async function readWav16kMono(file: string): Promise<Float32Array> {
  const buf = await readFile(file);
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const end = Math.min(buf.length, offset + 8 + size);
      const count = Math.floor((end - offset - 8) / 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i += 1) out[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
      return out;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('EDITOOLS_INVALID_FILE: wav has no data chunk');
}

/** Characters of one word that the model can represent, as token ids. */
function wordTokens(word: string, vocab: Vocab): number[] {
  const tokens: number[] = [];
  const cased = vocab.upper ? word.toUpperCase() : word.toLowerCase();
  for (const ch of cased.normalize('NFC')) {
    let id = vocab.ids.get(ch);
    if (id === undefined) {
      // Accents the model lacks (è, ñ…) fall back to their base letter; digits, symbols, emoji are
      // simply not alignable and the word is timed by interpolation instead.
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      id = base.length === 1 ? vocab.ids.get(base) : undefined;
    }
    // '-' and the word separator are structure, not sounds.
    if (id !== undefined && ch !== '-' && ch !== '|' && id !== vocab.blank) tokens.push(id);
  }
  return tokens;
}

function logSoftmaxInPlace(logits: Float32Array, frames: number, vocabSize: number): void {
  for (let t = 0; t < frames; t += 1) {
    const row = t * vocabSize;
    let max = -Infinity;
    for (let v = 0; v < vocabSize; v += 1) max = Math.max(max, logits[row + v]);
    let sum = 0;
    for (let v = 0; v < vocabSize; v += 1) sum += Math.exp(logits[row + v] - max);
    const logSum = max + Math.log(sum);
    for (let v = 0; v < vocabSize; v += 1) logits[row + v] -= logSum;
  }
}

/**
 * Best monotonic assignment of `tokens` to frames (torchaudio's forced-alignment trellis):
 * state j = "j tokens emitted so far"; staying costs the blank score, advancing costs the next
 * token's score. Returns the frame each token was emitted on, or null when the audio is too
 * short to hold the text at all.
 */
function forcedAlign(
  emission: Float32Array,
  frames: number,
  vocabSize: number,
  tokens: number[],
  blank: number,
): Int32Array | null {
  const n = tokens.length;
  if (n === 0 || frames < n) return null;
  const width = n + 1;
  const trellis = new Float32Array((frames + 1) * width).fill(-Infinity);
  trellis[0] = 0;
  for (let t = 0; t < frames; t += 1) {
    const row = t * vocabSize;
    const stay = emission[row + blank];
    const cur = t * width;
    const next = (t + 1) * width;
    for (let j = 0; j <= n; j += 1) {
      let best = trellis[cur + j] + stay;
      if (j > 0) {
        const advance = trellis[cur + j - 1] + emission[row + tokens[j - 1]];
        if (advance > best) best = advance;
      }
      trellis[next + j] = best;
    }
  }
  if (!Number.isFinite(trellis[frames * width + n])) return null;

  const emittedAt = new Int32Array(n);
  let j = n;
  for (let t = frames; t > 0 && j > 0; t -= 1) {
    const row = (t - 1) * vocabSize;
    const stayed = trellis[(t - 1) * width + j] + emission[row + blank];
    const changed = trellis[(t - 1) * width + j - 1] + emission[row + tokens[j - 1]];
    if (changed > stayed) {
      emittedAt[j - 1] = t - 1;
      j -= 1;
    }
  }
  return j === 0 ? emittedAt : null;
}

export interface Aligner {
  language: string;
  /** Re-times `words` (one chunk's worth, with `segments` as whisper grouped them) against `samples`. */
  align(
    samples: Float32Array,
    words: CaptionWord[],
    segments: TranscriptSegment[],
    /** Called before each window; throws when the job was cancelled (an in-process pass has no child to kill). */
    assertAlive?: () => void,
    /** Called after each window finishes, with how many are done of how many in total. */
    onWindow?: (done: number, total: number) => void,
  ): Promise<CaptionWord[]>;
}

export async function loadAligner(modelFile: string, vocabFile: string, language: string): Promise<Aligner> {
  const vocab = await loadVocab(vocabFile);
  const client = await getEmissionClient(modelFile);

  async function emissionFor(samples: Float32Array, from: number, to: number) {
    const slice = samples.subarray(from, to);
    // wav2vec2's feature extractor normalises each utterance to zero mean, unit variance.
    let mean = 0;
    for (let i = 0; i < slice.length; i += 1) mean += slice[i];
    mean /= slice.length;
    let variance = 0;
    for (let i = 0; i < slice.length; i += 1) variance += (slice[i] - mean) ** 2;
    const std = Math.sqrt(variance / slice.length + 1e-7);
    const input = new Float32Array(slice.length);
    for (let i = 0; i < slice.length; i += 1) input[i] = (slice[i] - mean) / std;

    // Inference runs on a worker thread (emission.ts) so the server stays responsive meanwhile.
    const { data, frames, vocabSize } = await client.run(input);
    logSoftmaxInPlace(data, frames, vocabSize);
    return { data, frames, vocabSize };
  }

  /** Aligns words[from..to) inside the audio window starting at `windowStart` seconds. */
  async function alignWindow(
    samples: Float32Array,
    words: CaptionWord[],
    from: number,
    to: number,
    windowStart: number,
    windowEnd: number,
  ): Promise<Array<{ start: number; end: number } | null>> {
    const perWord = words.slice(from, to).map((w) => wordTokens(w.text, vocab));
    const tokens: number[] = [];
    const owner: number[] = []; // word index (within the window) of each token; -1 for separators
    perWord.forEach((toks, wi) => {
      if (toks.length === 0) return;
      if (tokens.length > 0) {
        tokens.push(vocab.separator);
        owner.push(-1);
      }
      for (const t of toks) {
        tokens.push(t);
        owner.push(wi);
      }
    });
    const result: Array<{ start: number; end: number } | null> = perWord.map(() => null);
    if (tokens.length === 0) return result;

    const a = Math.max(0, Math.floor(windowStart * SAMPLE_RATE));
    const b = Math.min(samples.length, Math.ceil(windowEnd * SAMPLE_RATE));
    if (b - a < 1600) return result;
    const { data, frames, vocabSize } = await emissionFor(samples, a, b);
    const emittedAt = forcedAlign(data, frames, vocabSize, tokens, vocab.blank);
    if (!emittedAt) return result;

    const first = new Map<number, number>();
    const last = new Map<number, number>();
    emittedAt.forEach((frame, k) => {
      const wi = owner[k];
      if (wi < 0) return;
      if (!first.has(wi)) first.set(wi, frame);
      last.set(wi, frame);
    });
    const t0 = a / SAMPLE_RATE;
    for (const [wi, frame] of first) {
      const start = t0 + frame * FRAME_SECONDS - ONSET_BIAS_SECONDS;
      const end = t0 + (last.get(wi) as number) * FRAME_SECONDS + END_TAIL_SECONDS;
      result[wi] = { start: Math.max(0, start), end: Math.max(start + 0.05, end) };
    }
    return result;
  }

  return {
    language,
    async align(samples, words, segments, assertAlive, onWindow) {
      const duration = samples.length / SAMPLE_RATE;
      const timings: Array<{ start: number; end: number } | null> = words.map(() => null);

      // Group consecutive whisper segments into windows of at most MAX_WINDOW_SECONDS.
      const windows: Array<{ from: number; to: number }> = [];
      for (const seg of segments) {
        const open = windows[windows.length - 1];
        const span = (from: number, to: number) => words[to - 1].end - words[from].start;
        if (open && span(open.from, seg.to) <= MAX_WINDOW_SECONDS) open.to = seg.to;
        else windows.push({ from: seg.from, to: seg.to });
      }

      for (const [index, w] of windows.entries()) {
        assertAlive?.();
        const first = words[w.from];
        const lastWord = words[w.to - 1];
        const windowStart = Math.max(0, first.start - WINDOW_MARGIN_SECONDS);
        const windowEnd = Math.min(duration, lastWord.end + WINDOW_MARGIN_SECONDS);
        try {
          const res = await alignWindow(samples, words, w.from, w.to, windowStart, windowEnd);
          res.forEach((r, i) => {
            timings[w.from + i] = r;
          });
        } catch {
          // This window keeps whisper's own timing; one bad window never fails the whole job.
        }
        onWindow?.(index + 1, windows.length);
      }

      return refine(words, timings);
    },
  };
}

/**
 * Applies aligned timings. Words the aligner couldn't place (numbers, symbols, or a whole window
 * that failed) are spread evenly between their placed neighbours, or keep whisper's timing when
 * there are no neighbours. Order is then enforced, since each caption word must start no earlier
 * than the previous one and end no later than the next begins.
 */
function refine(words: CaptionWord[], timings: Array<{ start: number; end: number } | null>): CaptionWord[] {
  const out: CaptionWord[] = words.map((w, i) => ({ text: w.text, start: timings[i]?.start ?? w.start, end: timings[i]?.end ?? w.end }));

  let i = 0;
  while (i < words.length) {
    if (timings[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < words.length && !timings[j]) j += 1;
    const before = i > 0 ? timings[i - 1] : null;
    const after = j < words.length ? timings[j] : null;
    if (before && after && after.start > before.end) {
      const slot = (after.start - before.end) / (j - i);
      for (let k = i; k < j; k += 1) {
        out[k] = { text: words[k].text, start: before.end + (k - i) * slot, end: before.end + (k - i + 1) * slot };
      }
    }
    i = j;
  }

  for (let k = 0; k < out.length; k += 1) {
    const prev = out[k - 1];
    const next = out[k + 1];
    if (prev && out[k].start < prev.start) out[k].start = prev.start;
    if (next && out[k].end > next.start) out[k].end = Math.max(out[k].start + 0.03, next.start);
    if (out[k].end <= out[k].start) out[k].end = out[k].start + 0.03;
  }
  return out;
}
