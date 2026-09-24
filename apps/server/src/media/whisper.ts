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
 */
export function transcribe(wavPath: string, modelPath: string, tempDir: string): ProcessHandle {
  if (!config.whisperPath) {
    return { kill() {}, done: Promise.reject(new Error('EDITOOLS_ASR_MODEL_MISSING: whisper binary not configured')) };
  }
  const outBase = path.join(tempDir, 'transcript');
  const proc = spawn(
    config.whisperPath,
    ['-m', modelPath, '-f', wavPath, '-l', 'auto', '-oj', '-ojf', '-of', outBase, '-np'],
    { windowsHide: true },
  );

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
export async function readTranscript(tempDir: string): Promise<TranscriptResult> {
  const raw = await readFile(path.join(tempDir, 'transcript.json'), 'utf8');
  return parseWhisperOutput(JSON.parse(raw));
}

/**
 * Parses whisper-cli's -ojf JSON output and regroups its per-token offsets into words: a token
 * whose own text starts with a space begins a new word (GPT-2/whisper BPE convention — a token
 * with no leading space is a sub-word continuation, e.g. "world" + "-" + "level"), everything
 * else appends to the word in progress. A word's End is its own last token's End, never
 * stretched into whatever silence follows — that's the whole point over whisper.cpp's built-in
 * `-ml 1 -sow` word-splitting (see transcribe()). Offsets are milliseconds.
 */
export function parseWhisperOutput(json: unknown): TranscriptResult {
  const root = json as {
    transcription?: Array<{ tokens?: Array<{ text?: string; offsets?: { from?: number; to?: number } }> }>;
    result?: { language?: string };
  };
  const segments = Array.isArray(root.transcription) ? root.transcription : [];

  const words: TranscriptWord[] = [];
  for (const segment of segments) {
    for (const token of segment.tokens ?? []) {
      const raw = token.text ?? '';
      const text = raw.trim();
      // Whisper's control/special tokens ("[_BEG_]", "[_TT_283]", ...) aren't real words.
      if (!text || /^\[.*\]$/.test(text)) continue;

      const from = token.offsets?.from ?? 0;
      const to = Math.max(token.offsets?.to ?? from, from + 1);
      if (/^\s/.test(raw) || words.length === 0) {
        words.push({ text, start: from / 1000, end: to / 1000 });
      } else {
        const current = words[words.length - 1];
        current.text += text;
        current.end = to / 1000;
      }
    }
  }
  return { words, language: root.result?.language };
}
