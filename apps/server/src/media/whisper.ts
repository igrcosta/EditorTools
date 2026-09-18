import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config';
import { killProcess, type ProcessHandle } from './ffmpeg';

export interface TranscriptWord {
  text: string;
  /** Seconds. */
  start: number;
  end: number;
}

/**
 * Runs whisper.cpp's CLI (word-level timestamps via -ml 1 -sow) against a
 * 16kHz mono WAV, writing `<tempDir>/transcript.json`. No progress callback:
 * whisper-cli's own --print-progress counter is unreliable (observed reporting
 * over 100%) — callers should treat this whole step as indeterminate.
 */
export function transcribe(wavPath: string, modelPath: string, tempDir: string): ProcessHandle {
  if (!config.whisperPath) {
    return { kill() {}, done: Promise.reject(new Error('EDITOOLS_ASR_MODEL_MISSING: whisper binary not configured')) };
  }
  const outBase = path.join(tempDir, 'transcript');
  const proc = spawn(
    config.whisperPath,
    ['-m', modelPath, '-f', wavPath, '-l', 'auto', '-ml', '1', '-sow', '-oj', '-ojf', '-of', outBase, '-np'],
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
export async function readTranscript(tempDir: string): Promise<TranscriptWord[]> {
  const raw = await readFile(path.join(tempDir, 'transcript.json'), 'utf8');
  return parseWhisperOutput(JSON.parse(raw));
}

/**
 * Parses whisper-cli's -ojf JSON output. With -ml 1 -sow, each
 * `transcription[]` entry is already exactly one word (verified against a
 * real b5130 build) — offsets are milliseconds, text carries a leading space.
 */
export function parseWhisperOutput(json: unknown): TranscriptWord[] {
  const root = json as { transcription?: Array<{ text?: string; offsets?: { from?: number; to?: number } }> };
  const entries = Array.isArray(root.transcription) ? root.transcription : [];
  const words: TranscriptWord[] = [];
  for (const entry of entries) {
    const text = (entry.text ?? '').trim();
    if (!text) continue;
    const from = entry.offsets?.from ?? 0;
    const to = entry.offsets?.to ?? from;
    words.push({ text, start: from / 1000, end: Math.max(to, from + 1) / 1000 });
  }
  return words;
}
