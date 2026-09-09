export type OutputFormat = 'mp4' | 'mp3';

export interface QualityOption {
  /** Vertical resolution, e.g. 1080 */
  height: number;
  /** Display label, e.g. "1080p" */
  label: string;
  recommended: boolean;
}

export interface AnalyzeRequest {
  url: string;
}

export interface AnalyzeResult {
  title: string;
  durationSeconds: number | null;
  thumbnailUrl: string | null;
  /** Source platform, e.g. "YouTube" */
  source: string;
  qualities: QualityOption[];
}

export interface DownloadRequest {
  url: string;
  output: OutputFormat;
  /** Max height for mp4 downloads; ignored for mp3 */
  height?: number;
  /** Media title from analyze, used (sanitized) for the downloaded filename */
  title?: string;
}

export interface DownloadStarted {
  jobId: string;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export type JobStage = 'downloading' | 'processing';

export interface JobState {
  id: string;
  status: JobStatus;
  /** Current phase while running: fetching media vs. merging/converting at the end. */
  stage?: JobStage;
  /** 0–100 when known, null when progress cannot be measured (UI shows indeterminate) */
  progress: number | null;
  filename?: string;
  fileSizeBytes?: number;
  /** One of ERROR_CODES when status === 'error' */
  error?: ErrorCode;
}

export const ERROR_CODES = [
  'invalid_url',
  'unsupported_scheme',
  'blocked_host',
  'unresolvable_host',
  'unsupported_url',
  'restricted',
  'unavailable',
  'geo_blocked',
  'bot_check',
  'too_long',
  'too_large',
  'busy',
  'not_found',
  'canceled',
  'download_failed',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: ErrorCode;
  message: string;
}
