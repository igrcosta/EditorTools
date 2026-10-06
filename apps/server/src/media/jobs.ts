import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ErrorCode, JobMeta, JobStage, JobState, JobStatus, ToolId } from '@editools/shared';
import { config } from '../config';
import { mapYtdlpError, stderrOf } from './errors';
import type { ProcessHandle } from './ffmpeg';

export interface JobCallbacks {
  onProgress: (percent: number) => void;
  onStage: (stage: JobStage) => void;
  onMeta?: (meta: JobMeta) => void;
}

/**
 * A unit of processing work (download, conversion, audio fix, trim…).
 * Tasks share the queue, progress reporting, cancellation, retries and
 * temp-dir lifecycle — the "shared processing layer" of the spec.
 */
export interface JobTask {
  /** Display name used (sanitized) for the result filename. */
  title?: string;
  /** Total attempts allowed; generic failures are retried transparently up to this. */
  maxAttempts: number;
  start(tempDir: string, callbacks: JobCallbacks): ProcessHandle;
  /** Absolute path of the produced file, or undefined if nothing was produced. */
  resolveOutput(tempDir: string): Promise<string | undefined>;
}

/**
 * Who started a job and which run of the daily quota it holds. Created by the account layer's
 * request hook (account/enforcement.ts) and handed to createJob(), which sets `committed`: from
 * then on the job owns the reservation, and gives it back if it fails or is canceled.
 */
export interface JobContext {
  tool: ToolId;
  userId: string;
  reservationId: string | null;
  committed: boolean;
}

export interface Job {
  id: string;
  status: JobStatus;
  stage?: JobStage;
  progress: number | null;
  tempDir: string;
  task: JobTask;
  filePath?: string;
  filename?: string;
  fileSizeBytes?: number;
  meta?: JobMeta;
  error?: ErrorCode;
  handle?: ProcessHandle;
  canceled: boolean;
  attempts: number;
  createdAt: number;
  /** Set when the job first starts running / when it reaches done or error. */
  startedAt?: number;
  finishedAt?: number;
  context?: JobContext;
}

type Logger = { debug: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };
let log: Logger = { debug: () => {}, warn: () => {} };
export function setJobLogger(logger: Logger): void {
  log = logger;
}

const jobs = new Map<string, Job>();
const queue: Job[] = [];
let running = 0;

const finishedListeners = new Set<(job: Job) => void>();
const notified = new WeakSet<Job>();

/** Calls `listener` once per job, when it reaches `done` or `error` (which includes canceled). */
export function onJobFinished(listener: (job: Job) => void): () => void {
  finishedListeners.add(listener);
  return () => finishedListeners.delete(listener);
}

/**
 * The only place a job's status changes. Keeping it in one function is what lets the quota be
 * given back, and usage recorded, exactly once per job no matter how it ended.
 */
function setStatus(job: Job, status: JobStatus, error?: ErrorCode): void {
  job.status = status;
  if (error !== undefined) job.error = error;
  if (status === 'running') job.startedAt ??= Date.now();
  if ((status === 'done' || status === 'error') && !notified.has(job)) {
    notified.add(job);
    job.finishedAt = Date.now();
    for (const listener of finishedListeners) {
      try {
        listener(job);
      } catch (err) {
        log.warn({ jobId: job.id, err: String(err) }, 'job listener failed');
      }
    }
  }
}

/**
 * Queues a task. Pass `tempDir` when the route already staged files (uploads)
 * into a directory created with createTempDir(); otherwise one is created.
 */
export async function createJob(task: JobTask, tempDir?: string, context?: JobContext): Promise<Job | 'busy'> {
  if (running + queue.length >= config.maxConcurrentJobs + config.maxQueuedJobs) return 'busy';

  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    progress: null,
    tempDir: tempDir ?? (await createTempDir()),
    task,
    canceled: false,
    attempts: 0,
    createdAt: Date.now(),
    context,
  };
  // From here the job owns the quota run that was reserved for it (see JobContext).
  if (context) context.committed = true;
  jobs.set(job.id, job);
  queue.push(job);
  pump();
  return job;
}

export function createTempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'editools-'));
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
    meta: job.meta,
    error: job.error,
  };
}

export async function cancelJob(job: Job): Promise<void> {
  job.canceled = true;
  const queued = queue.indexOf(job);
  if (queued !== -1) {
    queue.splice(queued, 1);
    setStatus(job, 'error', 'canceled');
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
  setStatus(job, 'running');
  job.stage = 'downloading';
  job.handle = job.task.start(job.tempDir, {
    onProgress: (percent) => {
      job.progress = percent;
    },
    onStage: (stage) => {
      job.stage = stage;
    },
    onMeta: (meta) => {
      job.meta = meta;
    },
  });
  job.handle.done
    .then(() => finalize(job))
    .catch(async (err: unknown) => {
      const code = job.canceled ? 'canceled' : mapYtdlpError(stderrOf(err));
      log.debug({ jobId: job.id, attempt: job.attempts + 1, stderr: stderrOf(err) }, 'job failed');
      // Some work fails transiently (TikTok's anti-bot roulette) or needs a
      // different strategy on retry (remux → transcode) — retry generic
      // failures transparently before surfacing an error.
      if (!job.canceled && code === 'download_failed' && job.attempts + 1 < job.task.maxAttempts) {
        job.attempts += 1;
        setStatus(job, 'queued');
        job.progress = null;
        job.stage = undefined;
        queue.unshift(job);
        return;
      }
      setStatus(job, 'error', code);
      await cleanupTempDir(job);
    })
    .finally(() => {
      running -= 1;
      pump();
    });
}

async function finalize(job: Job): Promise<void> {
  const output = await job.task.resolveOutput(job.tempDir).catch(() => undefined);
  if (job.canceled) {
    setStatus(job, 'error', 'canceled');
    await cleanupTempDir(job);
    return;
  }
  if (!output) {
    // Exited 0 without producing output (e.g. match-filter rejected the media).
    setStatus(job, 'error', 'download_failed');
    await cleanupTempDir(job);
    return;
  }
  const ext = path.extname(output);
  job.filePath = output;
  job.fileSizeBytes = (await stat(output)).size;
  job.filename = sanitizeFilename(job.task.title, path.basename(output, ext)) + ext;
  job.progress = 100;
  job.stage = undefined;
  setStatus(job, 'done');
}

/** Strips path separators, control chars and Windows-reserved characters from a display filename. */
export function sanitizeFilename(name: string | undefined, fallback: string): string {
  const cleaned = (name ?? '')
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
