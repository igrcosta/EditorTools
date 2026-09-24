import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CaptionWord } from '@editools/shared';
import { config } from '../config';
import { killProcess, type ProcessHandle } from './ffmpeg';

export type TranscriptWord = CaptionWord;

export interface TranscriptResult {
  words: TranscriptWord[];
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
 * `vadModelPath`, when given, turns on whisper.cpp's built-in Voice Activity Detection: it
 * pre-filters actual speech before transcription, which stops whisper from hallucinating text
 * over silence/music and gives segments cleaner start/end boundaries than the decoder's own
 * timestamps. Optional — plain transcription without it works the same as before.
 *
 * `outputBaseName` (default "transcript") names the JSON file inside `tempDir` — callers
 * transcribing several chunks of the same job (see tasks.ts's transcribeCaptionsTask) give each
 * chunk its own name so they don't overwrite each other.
 */
export function transcribe(
  wavPath: string,
  modelPath: string,
  tempDir: string,
  vadModelPath?: string | null,
  outputBaseName = 'transcript',
): ProcessHandle {
  if (!config.whisperPath) {
    return { kill() {}, done: Promise.reject(new Error('EDITOOLS_ASR_MODEL_MISSING: whisper binary not configured')) };
  }
  const outBase = path.join(tempDir, outputBaseName);
  const args = ['-m', modelPath, '-f', wavPath, '-l', 'auto', '-oj', '-ojf', '-of', outBase, '-np'];
  if (vadModelPath) args.push('--vad', '--vad-model', vadModelPath);
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
export async function readTranscript(tempDir: string, outputBaseName = 'transcript'): Promise<TranscriptResult> {
  const raw = await readFile(path.join(tempDir, `${outputBaseName}.json`), 'utf8');
  return parseWhisperOutput(JSON.parse(raw));
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
export function parseWhisperOutput(json: unknown): TranscriptResult {
  const root = json as {
    transcription?: Array<{
      offsets?: { from?: number };
      tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number } }>;
    }>;
    result?: { language?: string };
  };
  const segments = Array.isArray(root.transcription) ? root.transcription : [];

  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    const tokens = segment.tokens ?? [];
    const segmentStart = segment.offsets?.from ?? 0;
    // With --vad, whisper.cpp decodes each detected speech span as its own cropped buffer, so
    // that segment's own token offsets restart from 0 — even though the *segment's* offsets are
    // correctly mapped back to the real timeline (empirically confirmed: a segment reported
    // starting at 3170ms had its first token at offset 40ms, not ~3170ms). Detected per segment
    // by comparing its first real token's offset against the segment's own start — plain
    // (non-VAD) segments' tokens are already absolute and never trip this.
    const firstReal = tokens.find((t) => {
      const text = (t.text ?? '').trim();
      return text && !/^\[.*\]$/.test(text);
    });
    const base = firstReal && (firstReal.offsets?.from ?? 0) < segmentStart ? segmentStart : 0;

    for (const token of tokens) {
      const raw = token.text ?? '';
      const text = raw.trim();
      // Whisper's control/special tokens ("[_BEG_]", "[_TT_283]", ...) aren't real words.
      if (!text || /^\[.*\]$/.test(text)) continue;

      const from = base + (token.offsets?.from ?? 0);
      const to = Math.max(base + (token.offsets?.to ?? token.offsets?.from ?? 0), from + 1);
      if (/^\s/.test(raw) || words.length === 0) {
        words.push({ text, start: from / 1000, end: to / 1000 });
      } else {
        const current = words[words.length - 1];
        current.text += text;
        current.end = to / 1000;
      }
    }
  }
  return { words: padWordEnds(words), language: root.result?.language };
}
