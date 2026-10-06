import type {
  AnalyzeResult,
  ApiError,
  CookieBrowser,
  DownloadRequest,
  DownloadStarted,
  Entitlements,
  FeaturesResponse,
  JobState,
  PlanId,
  SessionInfo,
} from '@editools/shared';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    public readonly details?: ApiError['details'],
  ) {
    super(code);
  }
}

/** Sent on every call: a page on another origin cannot add it without a CORS preflight, which is refused. */
const CLIENT_HEADERS = { 'x-editools-client': '1' };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { ...CLIENT_HEADERS, ...init?.headers } });
  } catch {
    throw new ApiClientError('network_error');
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let code = 'download_failed';
    let details: ApiError['details'];
    try {
      const body = (await res.json()) as ApiError;
      if (body?.error) code = body.error;
      details = body?.details;
    } catch {
      // non-JSON error body — keep generic code
    }
    if (PLAN_CODES.has(code)) {
      window.dispatchEvent(new CustomEvent<PlanErrorDetail>(PLAN_ERROR_EVENT, { detail: { code, details } }));
    }
    throw new ApiClientError(code, details);
  }
  return (await res.json()) as T;
}

/** Window events the account UI listens to, so no tool page has to know about plans. */
export const PLAN_ERROR_EVENT = 'editools:plan-error';
export const JOB_STARTED_EVENT = 'editools:job-started';
export interface PlanErrorDetail {
  code: string;
  details?: ApiError['details'];
}
const PLAN_CODES = new Set(['quota_exceeded', 'plan_limit', 'unauthenticated']);

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** A started job used a run of today's quota: let the account UI re-read it. */
function jobStarted(started: DownloadStarted): DownloadStarted {
  window.dispatchEvent(new Event(JOB_STARTED_EVENT));
  return started;
}

export interface DesktopSettings {
  downloadDir: string;
}

export const api = {
  /** Which optional (desktop-only) tools this server can run. */
  getFeatures: () => request<FeaturesResponse>('/api/features'),
  analyze: (url: string, cookiesFromBrowser?: CookieBrowser) =>
    request<AnalyzeResult>('/api/analyze', jsonPost({ url, cookiesFromBrowser })),
  /** Multipart upload to a tool endpoint (converter/audio); returns the created job. */
  uploadAndStart: (path: string, form: FormData) =>
    request<DownloadStarted>(path, { method: 'POST', body: form }).then(jobStarted),
  startDownload: (req: DownloadRequest) => request<DownloadStarted>('/api/download', jsonPost(req)).then(jobStarted),
  getJob: (id: string) => request<JobState>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  jobFileUrl: (id: string) => `/api/jobs/${id}/file`,
  /** Fetches a finished job's file and parses it as JSON (e.g. captions' transcribed word list). */
  jobResult: <T>(id: string) => request<T>(`/api/jobs/${id}/file`),
  /** Same file served inline (no attachment disposition) for in-app preview players. */
  jobPreviewUrl: (id: string) => `/api/jobs/${id}/file?inline=1`,
  /** Present only inside the desktop app; null in the browser. */
  getDesktopSettings: async (): Promise<DesktopSettings | null> => {
    try {
      return await request<DesktopSettings>('/api/desktop/settings');
    } catch {
      return null;
    }
  },
  chooseDesktopFolder: () => request<DesktopSettings>('/api/desktop/choose-folder', { method: 'POST' }),

  // --- accounts (the local server holds the tokens; the UI only ever sees SessionInfo) ---
  getSession: () => request<SessionInfo>('/api/session'),
  getEntitlements: () => request<SessionInfo>('/api/entitlements'),
  requestCode: (email: string) => request<void>('/api/auth/request-code', jsonPost({ email })),
  verifyCode: (email: string, code: string) => request<SessionInfo>('/api/auth/verify-code', jsonPost({ email, code })),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  setConsent: (value: boolean) => request<SessionInfo>('/api/account/consent', jsonPost({ value })),
  exportAccountData: () => request<unknown>('/api/account/export', { method: 'POST' }),
  deleteAccount: () => request<void>('/api/account/delete', jsonPost({ confirm: true })),
  adminSetPlan: (plan: PlanId) => request<SessionInfo>('/api/admin/plan', jsonPost({ plan })),
  adminResetQuota: () => request<SessionInfo>('/api/admin/reset-quota', { method: 'POST' }),
  /** Desktop only: opens an allow-listed https page (checkout) in the system browser. */
  openExternal: (url: string) => request<void>('/api/desktop/open-external', jsonPost({ url })),
};

export type { Entitlements };
