export const config = {
  /**
   * Defaults to localhost only for local development. Deployments (e.g. the
   * Docker image) set HOST=0.0.0.0 — inside a container that is safe because
   * only the platform's proxy reaches the port.
   */
  host: process.env.HOST ?? '127.0.0.1',
  port: Number(process.env.PORT ?? 3001),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  /** Set TRUST_PROXY=1 behind a hosting proxy so rate limiting sees real client IPs. */
  trustProxy: process.env.TRUST_PROXY === '1',
  /** When set, the server also serves the built web app from this directory (single-port deploy). */
  webDist: process.env.WEB_DIST ?? null,
  corsOrigins: ['http://localhost:5173', 'http://127.0.0.1:5173'],

  maxConcurrentJobs: Number(process.env.MAX_CONCURRENT_JOBS ?? 2),
  maxQueuedJobs: 4,
  /** Jobs (and their temp files) are wiped this long after creation. */
  jobTtlMs: 30 * 60_000,
  /** Hard timeout for a single yt-dlp download process. */
  jobTimeoutMs: 30 * 60_000,
  analyzeTimeoutMs: 45_000,
  /** Media longer than this is refused at analyze time and filtered at download time. */
  maxDurationSeconds: Number(process.env.MAX_DURATION_SECONDS ?? 4 * 3600),
  /** Passed to yt-dlp --max-filesize. */
  maxFilesize: process.env.MAX_FILESIZE ?? '6G',
} as const;
