import { useCallback, useEffect, useRef, useState } from 'react';
import type { JobState } from '@editools/shared';
import { api, ApiClientError } from './api';

function codeOf(err: unknown): string {
  return err instanceof ApiClientError ? err.code : 'download_failed';
}

/**
 * Shared lifecycle for upload-based tools: POST a FormData to a tool endpoint
 * and poll the returned job. With `autoSave` the finished file downloads
 * itself; without it the page previews the result and saves on demand.
 */
export function useJobRunner({ autoSave = true }: { autoSave?: boolean } = {}) {
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const start = useCallback(async (path: string, form: FormData) => {
    setStarting(true);
    setJob(null);
    setErrorCode(null);
    try {
      const { jobId } = await api.uploadAndStart(path, form);
      setJob({ id: jobId, status: 'queued', progress: null });
    } catch (err) {
      setErrorCode(codeOf(err));
    } finally {
      setStarting(false);
    }
  }, []);

  const cancel = useCallback(() => {
    if (job?.id) void api.cancelJob(job.id).catch(() => undefined);
    setJob(null);
    setErrorCode(null);
  }, [job?.id]);

  const reset = useCallback(() => {
    setJob(null);
    setErrorCode(null);
  }, []);

  const jobId = job?.id;
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!jobId || !jobActive) return;
    let stopped = false;
    const tick = async () => {
      try {
        const next = await api.getJob(jobId);
        if (stopped) return;
        setJob((current) => (current?.id === jobId ? next : current));
        if (next.status === 'error') setErrorCode(next.error ?? 'download_failed');
      } catch (err) {
        if (stopped) return;
        setJob(null);
        setErrorCode(codeOf(err));
      }
    };
    const interval = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [jobId, jobActive]);

  // Auto-save the finished file (desktop: straight into the configured folder).
  const savedRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoSave && job?.status === 'done' && savedRef.current !== job.id) {
      savedRef.current = job.id;
      const a = document.createElement('a');
      a.href = api.jobFileUrl(job.id);
      a.download = '';
      a.click();
    }
  }, [autoSave, job]);

  return { starting, job, jobActive, errorCode, start, cancel, reset };
}
