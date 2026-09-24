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

export const TRACK_ASPECTS = ['9:16', '16:9'] as const;
export type TrackAspect = (typeof TRACK_ASPECTS)[number];

/** Zoom relative to the largest crop of the target aspect that fits the frame: 1 = that full crop, higher = tighter. */
export const TRACK_ZOOM_MIN = 1;
export const TRACK_ZOOM_MAX = 2.5;
export const TRACK_ZOOM_DEFAULT = 1.3;

export const TRACK_SMOOTHING = ['low', 'medium', 'high'] as const;
export type TrackSmoothing = (typeof TRACK_SMOOTHING)[number];

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

/** Visual style only — where the captions sit on screen and how big they are is a separate, independent choice. */
export const CAPTION_PRESETS = ['karaoke'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];

/**
 * Free placement, set by dragging a box directly on the video preview: `positionX`/`positionY`
 * are the caption's anchor as a 0–1 fraction of the frame, `scale` multiplies the preset's own
 * font size. Replaces the old fixed 3×3 zone grid — continuous, so it's the same control for
 * every aspect ratio instead of a preset-position picker.
 */
export const CAPTION_POSITION_DEFAULT = 0.5;
export const CAPTION_POSITION_Y_DEFAULT = 0.88;
export const CAPTION_SCALE_MIN = 0.5;
export const CAPTION_SCALE_MAX = 2;
export const CAPTION_SCALE_DEFAULT = 1;

/** Curated set of bundled, license-cleared fonts — the only ones a custom template can use. */
export const CAPTION_FONTS = [
  'anton',
  'bebas-neue',
  'poppins',
  'archivo-black',
  'luckiest-guy',
  'bangers',
] as const;
export type CaptionFont = (typeof CAPTION_FONTS)[number];

/**
 * Per-word reveal animation, played once at the moment each word is spoken — the alternative to
 * a static caption line. `bounce` pops the word in past full size then settles (the "MrBeast/
 * CapCut" look); `fade` is a plain opacity ramp.
 */
export const CAPTION_ANIMATIONS = ['none', 'fade', 'bounce'] as const;
export type CaptionAnimation = (typeof CAPTION_ANIMATIONS)[number];

/** A user-built template: replaces a fixed preset with the caller's own font/colors/outline/shadow/animation. */
export interface CustomCaptionStyle {
  font: CaptionFont;
  /** Plain RGB hex, no "#" (e.g. "FFFFFF"). */
  primaryColorRgb: string;
  bold: boolean;
  italic: boolean;
  outline: boolean;
  outlineColorRgb: string;
  shadow: boolean;
  background: boolean;
  backgroundColorRgb: string;
  /** 0 (fully transparent) – 1 (fully opaque). */
  backgroundOpacity: number;
  animation: CaptionAnimation;
}

/** One transcribed (or user-edited) word with its own timing, in seconds. */
export interface CaptionWord {
  text: string;
  start: number;
  end: number;
}

export interface WordChunk {
  words: CaptionWord[];
  start: number;
  end: number;
}

const MAX_CHUNK_CHARS = 42;
const MAX_CHUNK_WORDS = 7;
const MAX_GAP_SECONDS = 0.6;

/**
 * Regroups a flat word list into on-screen caption lines: a new chunk starts once a line gets
 * too long, has too many words, or there's a pause long enough to read as a sentence break.
 * Shared between the server's burned-in render and the web app's live preview so both agree on
 * exactly the same line breaks.
 */
export function groupWords(words: CaptionWord[]): WordChunk[] {
  const chunks: WordChunk[] = [];
  let current: CaptionWord[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
    currentChars = 0;
  };

  for (const word of words) {
    const gap = current.length > 0 ? word.start - current[current.length - 1].end : 0;
    const wouldOverflow = currentChars + word.text.length + 1 > MAX_CHUNK_CHARS || current.length >= MAX_CHUNK_WORDS;
    if (current.length > 0 && (gap > MAX_GAP_SECONDS || wouldOverflow)) flush();
    current.push(word);
    currentChars += word.text.length + 1;
  }
  flush();
  return chunks;
}

/**
 * Timing for the per-word entrance animations (see CaptionAnimation), in milliseconds relative
 * to the word's own start. Shared so the server's burned-in `.ass` tags and the web app's live
 * preview play the exact same curve instead of two hand-tuned approximations drifting apart.
 */
export const CAPTION_BOUNCE_TIMING = { startScale: 0.6, peakScale: 1.15, peakMs: 80, settleMs: 150 } as const;
export const CAPTION_FADE_TIMING = { durationMs: 150 } as const;

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
  /** Captions: whisper's own language guess (e.g. "pt"), shown as a confirmation. */
  captionLanguage?: string;
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
