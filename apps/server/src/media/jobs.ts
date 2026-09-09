import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ErrorCode, JobStage, JobState, JobStatus, OutputFormat } from '@editools/shared';
import { config } from '../config';
import { mapYtdlpError, stderrOf } from './errors';
import { runDownload, type DownloadHandle } from './ytdlp';

export interface Job {
  id: string;
  status: JobStatus;
  stage?: JobStage;
  progress: number | null;
  url: string;
  output: OutputFormat;
  height?: number;
  title?: string;
  tempDir: string;
  filePath?: string;
  filename?: string;
  fileSizeBytes?: number;
  error?: ErrorCode;
  handle?: DownloadHandle;
  canceled: boolean;
  attempts: number;
  createdAt: number;
}

type Logger = { debug: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
let log: Logger = { debug: () => {}, warn: () => {} };
export function setJobLogger(logger: Logger): void {
  log = logger;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

export async function createJob(req: {
  url: string;
  output: OutputFormat;
  height?: number;
  title?: string;
}): Promise<Job | 'busy'> {
  if (running + queue.length >= config.maxConcurrentJobs + config.maxQueuedJobs) return 'busy';

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'editools-'));
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    progress: null,
    url: req.url,
    output: req.output,
    height: req.height,
    title: req.title,
    tempDir,
    canceled: false,
    attempts: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function toJobState(job: Job): JobState {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    filename: job.filename,
    fileSizeBytes: job.fileSizeBytes,
    error: job.error,
  };
}

export async function cancelJob(job: Job): Promise<void> {
  job.canceled = true;
  const queued = queue.indexOf(job);
  if (queued !== -1) {
    queue.splice(queued, 1);
    job.status = 'error';
    job.error = 'canceled';
    await destroyJob(job);
    return;
  }
  if (job.status === 'running') {
    job.handle?.kill();
    // The process promise rejection finishes cleanup.
  } else {
    await destroyJob(job);
  }
}

function pump(): void {
  while (running < config.maxConcurrentJobs && queue.length > 0) {
    start(queue.shift()!);
  }
}

function start(job: Job): void {
  running += 1;
  job.status = 'running';
  job.stage = 'downloading';
  job.handle = runDownload(
    { url: job.url, output: job.output, height: job.height, tempDir: job.tempDir },
    {
      onProgress: (percent) => {
        job.progress = percent;
      },
      onStage: (stage) => {
        job.stage = stage;
      },
    },
  );
  job.handle.done
    .then(() => finalize(job))
    .catch(async (err: unknown) => {
      const code = job.canceled ? 'canceled' : mapYtdlpError(stderrOf(err));
      log.debug({ jobId: job.id, attempt: job.attempts + 1, stderr: stderrOf(err) }, 'yt-dlp failed');
      // Some sites fail intermittently (e.g. TikTok's anti-bot page roulette) —
      // retry generic failures transparently before surfacing an error.
      if (!job.canceled && code === 'download_failed' && job.attempts < 2) {
        job.attempts += 1;
        job.status = 'queued';
        job.progress = null;
        job.stage = undefined;
        queue.unshift(job);
        return;
      }
      job.status = 'error';
      job.error = code;
      await cleanupTempDir(job);
    })
    .finally(() => {
      running -= 1;
      pump();
    });
}

async function finalize(job: Job): Promise<void> {
  const expectedExt = `.${job.output}`;
  let file: string | undefined;
  try {
    const entries = await readdir(job.tempDir);
    file = entries.find((f) => f.toLowerCase().endsWith(expectedExt));
  } catch {
    file = undefined;
  }
  if (job.canceled) {
    job.status = 'error';
    job.error = 'canceled';
    await cleanupTempDir(job);
    return;
  }
  if (!file) {
    // yt-dlp exited 0 without producing output (e.g. match-filter rejected it).
    job.status = 'error';
    job.error = 'download_failed';
    await cleanupTempDir(job);
    return;
  }
  job.filePath = path.join(job.tempDir, file);
  job.fileSizeBytes = (await stat(job.filePath)).size;
  job.filename = sanitizeFilename(job.title, path.basename(file, expectedExt)) + expectedExt;
  job.progress = 100;
  job.stage = undefined;
  job.status = 'done';
}

/** Strips path separators, control chars and Windows-reserved characters from a display filename. */
export function sanitizeFilename(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.{2,}/g, '.')
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}

async function cleanupTempDir(job: Job): Promise<void> {
  try {
    await rm(job.tempDir, { recursive: true, force: true });
  } catch (err) {
    log.warn({ jobId: job.id, err: String(err) }, 'temp dir cleanup failed');
  }
}

async function destroyJob(job: Job): Promise<void> {
  jobs.delete(job.id);
  await cleanupTempDir(job);
}

/** Periodically wipes expired jobs and their temp files. */
export function startSweeper(): void {
  setInterval(() => {
    const now = Date.now();
    for (const job of jobs.values()) {
      if (now - job.createdAt > config.jobTtlMs) {
        if (job.status === 'running') job.handle?.kill();
        void destroyJob(job);
      }
    }
  }, 60_000).unref();
}
