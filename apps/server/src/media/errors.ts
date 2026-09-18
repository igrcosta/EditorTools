import type { ApiError, ErrorCode } from '@editools/shared';

const PATTERNS: Array<[RegExp, ErrorCode]> = [
  [/unsupported url/i, 'unsupported_url'],
  [/is not a valid url/i, 'invalid_url'],
  // Anti-bot wall (typically hit from datacenter IPs) — must match before the generic "sign in" pattern.
  [/confirm you.?re not a bot|not a robot|use --cookies|http error 429|too many requests/i, 'bot_check'],
  [/private video|sign in|login required|members-only|age.?restrict|confirm your age/i, 'restricted'],
  [/video unavailable|has been removed|does not exist|account.+terminated|no longer available/i, 'unavailable'],
  [/not available in your country|geo.?restrict|blocked in your/i, 'geo_blocked'],
  [/larger than max-filesize|file is larger than/i, 'too_large'],
  // Real-ESRGAN (ncnn-vulkan) without a usable Vulkan GPU.
  [/vkCreateInstance failed|vkEnumeratePhysicalDevices failed|no vulkan device|invalid gpu device|vulkan-1\.dll|EDITOOLS_GPU_REQUIRED/i, 'gpu_required'],
  // Markers thrown by the image / tracking tasks.
  [/EDITOOLS_IMAGE_TOO_LARGE/, 'image_too_large'],
  [/EDITOOLS_NO_FACE_FOUND/, 'no_face_found'],
  [/EDITOOLS_NO_SPEECH_DETECTED/, 'no_speech_detected'],
  [/EDITOOLS_INVALID_FILE/, 'invalid_file'],
  [/EDITOOLS_TOO_LONG/, 'too_long'],
];

/** Maps raw tool output (yt-dlp, ffmpeg, ncnn…) to a stable error code. Raw output stays in server logs only. */
export function mapYtdlpError(output: string): ErrorCode {
  for (const [re, code] of PATTERNS) {
    if (re.test(output)) return code;
  }
  return 'download_failed';
}

/** English fallback messages; the web app translates codes via i18n. */
const MESSAGES: Record<ErrorCode, string> = {
  invalid_url: "That doesn't look like a valid link.",
  unsupported_scheme: 'Only http and https links are supported.',
  blocked_host: 'This address cannot be accessed.',
  unresolvable_host: "We couldn't reach this address.",
  unsupported_url: "This site isn't supported yet.",
  restricted: 'This media is private or requires a login.',
  unavailable: 'This media is unavailable or has been removed.',
  geo_blocked: 'This media is not available in this region.',
  bot_check: "The platform is blocking our server with an anti-bot check. Try again later — some sources restrict cloud servers.",
  too_long: 'This media is too long to process.',
  too_large: 'This file is too large to process.',
  busy: 'Too many downloads are running. Try again in a moment.',
  not_found: 'This job no longer exists.',
  canceled: 'The download was canceled.',
  invalid_file: "We couldn't read this file. Check the file and options and try again.",
  download_failed: "We couldn't process this media. It may be unsupported or temporarily unavailable.",
  image_too_large: 'This image has too many pixels to process.',
  gpu_required: 'Upscaling needs a Vulkan-capable GPU and up-to-date graphics drivers.',
  no_face_found: "We couldn't find a face in this video.",
  no_speech_detected: "We couldn't find any speech in this video.",
  feature_unavailable: 'This tool is only available in the Editools desktop app.',
};

export function apiError(code: ErrorCode): ApiError {
  return { error: code, message: MESSAGES[code] };
}

export function stderrOf(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { stderr?: unknown; message?: unknown };
    if (typeof e.stderr === 'string' && e.stderr) return e.stderr;
    if (typeof e.message === 'string') return e.message;
  }
  return String(err);
}
