import type {
  AnalyzeResult,
  ApiError,
  DownloadRequest,
  DownloadStarted,
  JobState,
} from '@editools/shared';

export class ApiClientError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiClientError('network_error');
  }
  if (res.status === 204) return undefined as T;
  if (!res.ok) {
    let code = 'download_failed';
    try {
      const body = (await res.json()) as ApiError;
      if (body?.error) code = body.error;
    } catch {
      // non-JSON error body — keep generic code
    }
    throw new ApiClientError(code);
  }
  return (await res.json()) as T;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export interface DesktopSettings {
  downloadDir: string;
}

export const api = {
  analyze: (url: string) => request<AnalyzeResult>('/api/analyze', jsonPost({ url })),
  startDownload: (req: DownloadRequest) => request<DownloadStarted>('/api/download', jsonPost(req)),
  getJob: (id: string) => request<JobState>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<void>(`/api/jobs/${id}`, { method: 'DELETE' }),
  jobFileUrl: (id: string) => `/api/jobs/${id}/file`,
  /** Present only inside the desktop app; null in the browser. */
  getDesktopSettings: async (): Promise<DesktopSettings | null> => {
    try {
      return await request<DesktopSettings>('/api/desktop/settings');
    } catch {
      return null;
    }
  },
  chooseDesktopFolder: () => request<DesktopSettings>('/api/desktop/choose-folder', { method: 'POST' }),
};
