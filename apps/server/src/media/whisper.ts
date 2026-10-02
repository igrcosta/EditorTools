import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaptionWord } from '@editools/shared';
import { config } from '../config';
import { killProcess, type ProcessHandle } from './ffmpeg';

export type TranscriptWord = CaptionWord;

export interface TranscribeOptions {
  /** ISO 639-1 code the user picked, or 'auto' to let whisper guess (it guesses wrong on short or noisy clips). */
  language?: string;
  /**
   * Ask whisper for DTW token timestamps (cross-attention alignment) instead of the decoder's raw
   * ones. Slower (no flash attention), so only used for languages without a forced-alignment model.
   */
  dtw?: boolean;
}

/** whisper.cpp's alignment-head preset; must match the model in features.ts (ggml-small, multilingual). */
const DTW_PRESET = 'small';

/**
 * DTW's per-token time is where the attention peaks, i.e. inside the word, not at its onset.
 * Measured on ground-truth speech (Windows SAPI word-boundary events, English and Portuguese): the
 * first token's DTW time is 200–300 ms after the true word start, never early. 250 ms centres it.
 */
const DTW_ONSET_OFFSET_SECONDS = 0.25;
const DTW_END_TAIL_SECONDS = 0.1;

/** A run of consecutive words whisper decoded together: `words.slice(from, to)`. */
export interface TranscriptSegment {
  from: number;
  to: number;
}

export interface TranscriptResult {
  words: TranscriptWord[];
  /** How whisper grouped `words` into segments — the windows the forced aligner works on. */
  segments: TranscriptSegment[];
  /** whisper's own language guess (e.g. "pt"), when it reported one. */
  language?: string;
}

/**
 * Runs whisper.cpp's CLI against a 16kHz mono WAV, writing `<tempDir>/transcript.json`. No
 * progress callback: whisper-cli's own --print-progress counter is unreliable (observed
 * reporting over 100%) — callers should treat this whole step as indeterminate.
 *
 * Deliberately doesn't ask whisper.cpp to do the word-splitting itself (the old `-ml 1 -sow`
 * flags): that mode stretches each word's End to wherever the *next* word starts, silently
 * swallowing real pauses into the previous word's duration (empirically confirmed — a word
 * before a 300ms breath would report as 300ms longer than it was actually spoken). `--dtw`
 * would be the "correct" fix but is broken in this vendored build regardless of model/preset
 * (every token comes back with `t_dtw: -1`). Instead this parses the raw per-token offsets
 * (`-oj -ojf`, no `-ml`) and reconstructs words itself in parseWhisperOutput — same underlying
 * per-token timestamps whisper.cpp already computes, just without the stretch-to-next-word step.
 *
 * No `--vad`: whisper.cpp's built-in VAD returns token times on a timeline with the silences cut
 * out, while segment times are mapped back to real time, so adding the two double-counts every
 * removed pause — each segment after the first came back later and later (measured: 5–16 s late
 * on a 22 s clip, the "word shows up long after it was spoken" bug). tasks.ts already splits the
 * audio on real pauses before calling this, so every chunk here is continuous speech and all
 * token times are plain absolute offsets.
 *
 * `outputBaseName` (default "transcript") names the JSON file inside `tempDir` — callers
 * transcribing several chunks of the same job (see tasks.ts's transcribeCaptionsTask) give each
 * chunk its own name so they don't overwrite each other.
 */
export function transcribe(
  wavPath: string,
  modelPath: string,
  tempDir: string,
  outputBaseName = 'transcript',
  options: TranscribeOptions = {},
): ProcessHandle {
  if (!config.whisperPath) {
    return { kill() {}, done: Promise.reject(new Error('EDITOOLS_ASR_MODEL_MISSING: whisper binary not configured')) };
  }
  const outBase = path.join(tempDir, outputBaseName);
  const args = ['-m', modelPath, '-f', wavPath, '-l', options.language ?? 'auto', '-oj', '-ojf', '-of', outBase, '-np'];
  // whisper.cpp silently disables --dtw while flash attention is on (its default), which is why
  // `t_dtw` used to come back as -1 for every token. Both must change together.
  if (options.dtw) args.push('-nfa', '--dtw', DTW_PRESET);
  const proc = spawn(config.whisperPath, args, { windowsHide: true });

  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  // Transcript text also prints to stdout; discarded (the JSON file is the source of truth) but drained to avoid backpressure.
  proc.stdout?.on('data', () => undefined);

  const done = new Promise<void>((resolve, reject) => {
    proc.on('error', (err) => reject(err));
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.slice(-1500) || `whisper-cli exited with code ${code}`));
    });
  });

  return { kill: () => killProcess(proc), done };
}

/** Reads back the JSON file `transcribe()` wrote into `tempDir`. */
export async function readTranscript(
  tempDir: string,
  outputBaseName = 'transcript',
  options: { dtw?: boolean } = {},
): Promise<TranscriptResult> {
  const raw = await readFile(path.join(tempDir, `${outputBaseName}.json`), 'utf8');
  return parseWhisperOutput(JSON.parse(raw), options);
}

/**
 * Whisper's own per-token End timestamp is conservative — it routinely clips a word's trailing
 * sound short even in fluent, continuous speech (confirmed empirically: captions were cutting
 * out well before the next word started, not just before real pauses — a plain "only bridge if
 * the gap is under some threshold" rule still left a visible cliff right around that threshold).
 * Padding every word's End by a fixed amount instead, capped at the next word's own Start, fixes
 * that smoothly either way: a small gap (at or under the pad) disappears completely, a bigger
 * one just shrinks by the same fixed amount and stays visible as a real pause. groupWords' own
 * MAX_GAP_SECONDS (0.6s, for starting a new caption line) is well above the pad, so this never
 * reads as a line break either.
 */
const END_PAD_SECONDS = 0.18;

function padWordEnds(words: TranscriptWord[]): TranscriptWord[] {
  return words.map((word, i) => {
    const next = words[i + 1];
    if (!next) return word;
    return { ...word, end: Math.min(word.end + END_PAD_SECONDS, next.start) };
  });
}

/**
 * Parses whisper-cli's -ojf JSON output and regroups its per-token offsets into words: a token
 * whose own text starts with a space begins a new word (GPT-2/whisper BPE convention — a token
 * with no leading space is a sub-word continuation, e.g. "world" + "-" + "level"), everything
 * else appends to the word in progress. A word's End starts out as its own last token's End —
 * never stretched all the way to the next word like whisper.cpp's built-in `-ml 1 -sow`
 * word-splitting did (see transcribe()) — then padWordEnds nudges it back out to compensate for
 * that same End being conservative. Offsets are milliseconds.
 */
export function parseWhisperOutput(json: unknown, options: { dtw?: boolean } = {}): TranscriptResult {
  const root = json as {
    transcription?: Array<{
      offsets?: { from?: number };
      tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number }; t_dtw?: number }>;
    }>;
    result?: { language?: string };
  };
  const segments = Array.isArray(root.transcription) ? root.transcription : [];

  const words: TranscriptWord[] = [];
  // DTW time (seconds) of each word's first and last token, parallel to `words`; null when whisper had none.
  const dtwSpans: Array<{ first: number; last: number } | null> = [];
  const wordSegments: TranscriptSegment[] = [];
  for (const segment of segments) {
    const firstWordOfSegment = words.length;
    const tokens = segment.tokens ?? [];
    for (const token of tokens) {
      const raw = token.text ?? '';
      const text = raw.trim();
      // Whisper's control/special tokens ("[_BEG_]", "[_TT_283]", ...) aren't real words.
      if (!text || /^\[.*\]$/.test(text)) continue;

      const from = token.offsets?.from ?? 0;
      const to = Math.max(token.offsets?.to ?? token.offsets?.from ?? 0, from + 1);
      const dtw = options.dtw && typeof token.t_dtw === 'number' && token.t_dtw >= 0 ? token.t_dtw / 100 : null;
      if (/^\s/.test(raw) || words.length === 0) {
        words.push({ text, start: from / 1000, end: to / 1000 });
        dtwSpans.push(dtw === null ? null : { first: dtw, last: dtw });
      } else {
        const current = words[words.length - 1];
        current.text += text;
        current.end = to / 1000;
        const span = dtwSpans[dtwSpans.length - 1];
        if (span && dtw !== null) span.last = dtw;
        else if (dtw === null) dtwSpans[dtwSpans.length - 1] = null;
      }
    }
    if (words.length > firstWordOfSegment) wordSegments.push({ from: firstWordOfSegment, to: words.length });
  }
  if (options.dtw && dtwSpans.length > 0 && dtwSpans.every((span) => span !== null)) {
    return { words: wordsFromDtw(words, dtwSpans as Array<{ first: number; last: number }>), segments: wordSegments, language: root.result?.language };
  }
  return { words: padWordEnds(words), segments: wordSegments, language: root.result?.language };
}

/** Re-times words from their DTW token times; see DTW_ONSET_OFFSET_SECONDS. Keeps order and no overlap. */
function wordsFromDtw(words: TranscriptWord[], spans: Array<{ first: number; last: number }>): TranscriptWord[] {
  const out = words.map((word, i) => ({
    text: word.text,
    start: Math.max(0, spans[i].first - DTW_ONSET_OFFSET_SECONDS),
    end: spans[i].last + DTW_END_TAIL_SECONDS,
  }));
  for (let i = 0; i < out.length; i += 1) {
    const prev = out[i - 1];
    if (prev && out[i].start < prev.start) out[i].start = prev.start;
    const next = out[i + 1];
    if (next && out[i].end > next.start) out[i].end = Math.max(out[i].start + 0.03, next.start);
    if (out[i].end <= out[i].start) out[i].end = out[i].start + 0.03;
  }
  return out;
}
