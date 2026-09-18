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
  meta?: JobMeta;
  /** One of ERROR_CODES when status === 'error' */
  error?: ErrorCode;
}

export const CONVERT_FORMATS = ['mp4', 'mov', 'mkv', 'webm', 'mp3', 'wav', 'm4a', 'flac', 'ogg'] as const;
export type ConvertFormat = (typeof CONVERT_FORMATS)[number];

export const NOISE_LEVELS = ['off', 'light', 'balanced', 'strong'] as const;
export type NoiseLevel = (typeof NOISE_LEVELS)[number];

export const LOUDNESS_PRESETS = ['off', 'youtube', 'social', 'podcast'] as const;
export type LoudnessPreset = (typeof LOUDNESS_PRESETS)[number];

export type AudioFixOutput = 'wav' | 'mp3';

/** 'off' = no silence cutting — the tool then just trims to the selected region. */
export const SILENCE_MODES = ['off', 'gentle', 'balanced', 'aggressive'] as const;
export type SilenceMode = (typeof SILENCE_MODES)[number];

// ---------------------------------------------------------------------------
// Image tools
// ---------------------------------------------------------------------------

/** Background removal output — formats that carry an alpha channel. */
export const BG_OUTPUTS = ['png', 'webp'] as const;
export type BgOutput = (typeof BG_OUTPUTS)[number];

/** Real-ESRGAN model families exposed to the user. */
export const UPSCALE_MODELS = ['photo', 'anime', 'fast'] as const;
export type UpscaleModel = (typeof UPSCALE_MODELS)[number];

export const UPSCALE_SCALES = [2, 4] as const;
export type UpscaleScale = (typeof UPSCALE_SCALES)[number];

export const UPSCALE_OUTPUTS = ['png', 'jpg', 'webp'] as const;
export type UpscaleOutput = (typeof UPSCALE_OUTPUTS)[number];

// ---------------------------------------------------------------------------
// Face tracking
// ---------------------------------------------------------------------------

export const TRACK_ASPECTS = ['original', '9:16', '1:1', '16:9'] as const;
export type TrackAspect = (typeof TRACK_ASPECTS)[number];

/** Zoom relative to the largest crop that fits the frame (strings: multipart fields are text). */
export const TRACK_ZOOMS = ['1', '1.2', '1.5', '2'] as const;
export type TrackZoom = (typeof TRACK_ZOOMS)[number];

export const TRACK_SMOOTHING = ['low', 'medium', 'high'] as const;
export type TrackSmoothing = (typeof TRACK_SMOOTHING)[number];

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

export const CAPTION_PRESETS = ['clean', 'karaoke', 'lowerthird', 'boxed'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

/** Extra result info some tools report (e.g. silence cutting stats). */
export interface JobMeta {
  silencesCut?: number;
  removedSeconds?: number;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  /** Face tracking: fraction (0–1) of sampled frames where a face was found. */
  faceCoverage?: number;
  /** Captions: number of words transcribed (lets the UI flag a suspiciously short result). */
  captionWordCount?: number;
}

/** Which optional tools this server instance can run (desktop ships the models; the web deploy does not). */
export interface FeaturesResponse {
  removeBackground: boolean;
  upscale: boolean;
  faceTracking: boolean;
  captions: boolean;
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
  'invalid_file',
  'image_too_large',
  'gpu_required',
  'no_face_found',
  'no_speech_detected',
  'feature_unavailable',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  error: ErrorCode;
  message: string;
}
