/**
 * Plans, tools and limits — the pure rules shared by the local server, the web app and the
 * Supabase Edge Functions.
 *
 * Self-contained on purpose (no imports): the Edge Functions run on Deno, which cannot resolve this
 * package's extension-less relative imports, so they import this file directly.
 *
 * What lives where: the numbers themselves are rows in the `plans` table (editable without a
 * release); DEFAULT_PLAN_LIMITS is the seed for that table and the fallback when it is unreachable.
 * Quota (runs per day) is counted by the database; everything else here is evaluated locally.
 */

/** Every billable-or-gated tool endpoint. One id per route that starts work. */
export const TOOL_IDS = [
  'download',
  'convert',
  'audio_fix',
  'silence_analyze',
  'silence_cut',
  'remove_background',
  'upscale',
  'face_track',
  'captions_transcribe',
  'captions_render',
] as const;
export type ToolId = (typeof TOOL_IDS)[number];

/**
 * The steps that consume one run of the daily quota. The preview-style first steps
 * (silence analysis, captions transcription) are free so people can try the tool, but still obey
 * the per-job limits — and /transcribe is the expensive one, so it stays gated by media duration.
 */
export const COUNTED_TOOLS: ReadonlySet<ToolId> = new Set<ToolId>([
  'download',
  'convert',
  'audio_fix',
  'silence_cut',
  'remove_background',
  'upscale',
  'face_track',
  'captions_render',
]);

export function isCountedTool(tool: ToolId): boolean {
  return COUNTED_TOOLS.has(tool);
}

const TOOL_ROUTES: Record<string, ToolId> = {
  '/api/download': 'download',
  '/api/convert': 'convert',
  '/api/audio/fix': 'audio_fix',
  '/api/audio/timeline/analyze': 'silence_analyze',
  '/api/audio/timeline/cut': 'silence_cut',
  '/api/image/remove-background': 'remove_background',
  '/api/image/upscale': 'upscale',
  '/api/video/face-track': 'face_track',
  '/api/video/captions/transcribe': 'captions_transcribe',
  '/api/video/captions/render': 'captions_render',
};

/** The tool a request starts, or null when it is not a tool endpoint (health, jobs, features…). */
export function toolForRequest(method: string, url: string): ToolId | null {
  if (method.toUpperCase() !== 'POST') return null;
  const path = url.split('?')[0].replace(/\/+$/, '');
  return TOOL_ROUTES[path] ?? null;
}

export const PLAN_IDS = ['free', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** `null` means "no plan-specific limit" (the server's own global caps still apply). */
export interface PlanLimits {
  /** Counted runs per day (America/Sao_Paulo). */
  dailyRuns: number | null;
  maxMediaSeconds: number | null;
  maxUploadBytes: number | null;
  /** Highest video height the downloader may request. */
  maxDownloadHeight: number | null;
  /** Upscale factors the plan may use; null = all. */
  allowedUpscaleScales: number[] | null;
}

export const DEFAULT_PLAN_LIMITS: Record<PlanId, PlanLimits> = {
  free: {
    dailyRuns: 10,
    maxMediaSeconds: 300,
    maxUploadBytes: 500 * 1024 * 1024,
    maxDownloadHeight: 720,
    allowedUpscaleScales: [2],
  },
  pro: {
    dailyRuns: null,
    maxMediaSeconds: null,
    maxUploadBytes: null,
    maxDownloadHeight: null,
    allowedUpscaleScales: null,
  },
};

/** The server's global cap, tightened by the plan's when there is one. */
export function effectiveCap(globalCap: number, planCap: number | null): number {
  return planCap === null ? globalCap : Math.min(globalCap, planCap);
}

export type LimitKey = Exclude<keyof PlanLimits, 'dailyRuns'>;

export interface LimitRequest {
  mediaSeconds?: number;
  uploadBytes?: number;
  downloadHeight?: number;
  upscaleScale?: number;
}

export type LimitCheck = { ok: true } | { ok: false; limit: LimitKey; max: number | number[] };

/**
 * Checks one job against the plan's per-job limits. Only what the request actually carries is
 * checked (an upload size is known up front, a duration only after probing). The daily quota is
 * deliberately not here: it is counted by the database, not decided locally.
 */
export function evaluateLimits(limits: PlanLimits, req: LimitRequest): LimitCheck {
  if (req.mediaSeconds !== undefined && limits.maxMediaSeconds !== null && req.mediaSeconds > limits.maxMediaSeconds) {
    return { ok: false, limit: 'maxMediaSeconds', max: limits.maxMediaSeconds };
  }
  if (req.uploadBytes !== undefined && limits.maxUploadBytes !== null && req.uploadBytes > limits.maxUploadBytes) {
    return { ok: false, limit: 'maxUploadBytes', max: limits.maxUploadBytes };
  }
  if (
    req.downloadHeight !== undefined &&
    limits.maxDownloadHeight !== null &&
    req.downloadHeight > limits.maxDownloadHeight
  ) {
    return { ok: false, limit: 'maxDownloadHeight', max: limits.maxDownloadHeight };
  }
  if (
    req.upscaleScale !== undefined &&
    limits.allowedUpscaleScales !== null &&
    !limits.allowedUpscaleScales.includes(req.upscaleScale)
  ) {
    return { ok: false, limit: 'allowedUpscaleScales', max: limits.allowedUpscaleScales };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Account / entitlement contracts
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'none' | 'active' | 'past_due' | 'canceled' | 'refunded' | 'chargeback';
export type AccountRole = 'user' | 'admin';

export interface QuotaState {
  used: number;
  /** null = unlimited. */
  limit: number | null;
  /** ISO timestamp of the next reset. */
  resetsAt: string;
}

export interface Entitlements {
  plan: PlanId;
  status: SubscriptionStatus;
  /** ISO timestamp; access to a paid plan ends here (grace included), null for the free plan. */
  accessUntil: string | null;
  limits: PlanLimits;
  quota: QuotaState;
  role: AccountRole;
  consentAnalytics: boolean;
  /** False until the user has answered the analytics notice (consentAnalytics is then false). */
  consentAnswered: boolean;
}

/** What `GET /api/session` returns: the web app's whole view of the account. Never contains tokens. */
export type SessionInfo =
  | { state: 'disabled' } // accounts are not configured on this server (web demo, dev without Supabase)
  | { state: 'anonymous' }
  /** Signed in before, but the backend cannot be reached and there is no valid offline grace left. */
  | { state: 'unreachable' }
  | {
      state: 'authenticated';
      user: { id: string; email: string };
      entitlements: Entitlements;
      /** True while running on the cached, signed limits because the backend is unreachable. */
      offline: boolean;
    };

/** The limits the cloud signs for a user, valid for a bounded offline grace period. */
export interface LimitsPayload {
  sub: string;
  plan: PlanId;
  limits: PlanLimits;
  /** Unix seconds. */
  iat: number;
  exp: number;
}

export interface SignedLimits {
  payload: LimitsPayload;
  /** Ed25519 signature of limitsPayloadMessage(payload), base64url. */
  signature: string;
}

/** How long a signed limits payload may be used without reaching the backend. */
export const OFFLINE_GRACE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The exact bytes that are signed and verified. A fixed key order and no whitespace make signer
 * (Deno, WebCrypto) and verifier (Node) agree regardless of how the JSON was re-serialized in transit.
 */
export function limitsPayloadMessage(p: LimitsPayload): string {
  const l = p.limits;
  return JSON.stringify([
    'editools-limits-v1',
    p.sub,
    p.plan,
    [l.dailyRuns, l.maxMediaSeconds, l.maxUploadBytes, l.maxDownloadHeight, l.allowedUpscaleScales],
    p.iat,
    p.exp,
  ]);
}
