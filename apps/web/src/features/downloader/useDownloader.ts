import { useCallback, useEffect, useState } from 'react';
import type { AnalyzeResult, JobState, OutputFormat } from '@editools/shared';
import { api, ApiClientError } from '../../lib/api';

interface DownloaderState {
  analyzing: boolean;
  analysis: AnalyzeResult | null;
  analyzedUrl: string | null;
  starting: boolean;
  job: JobState | null;
  errorCode: string | null;
}

const IDLE: DownloaderState = {
  analyzing: false,
  analysis: null,
  analyzedUrl: null,
  starting: false,
  job: null,
  errorCode: null,
};

function codeOf(err: unknown): string {
  return err instanceof ApiClientError ? err.code : 'download_failed';
}

export function useDownloader() {
  const [state, setState] = useState<DownloaderState>(IDLE);

  const analyze = useCallback(async (url: string) => {
    setState({ ...IDLE, analyzing: true });
    try {
      const analysis = await api.analyze(url);
      setState({ ...IDLE, analysis, analyzedUrl: url });
    } catch (err) {
      setState({ ...IDLE, errorCode: codeOf(err) });
    }
  }, []);

  /** Starts (or re-starts) the download with the user's chosen format/quality. */
  const start = useCallback(
    async (output: OutputFormat, height: number | undefined) => {
      const { analyzedUrl, analysis, job } = state;
      if (!analyzedUrl || !analysis) return;
      if (job && (job.status === 'queued' || job.status === 'running')) {
        void api.cancelJob(job.id).catch(() => undefined);
      }
      setState((s) => ({ ...s, starting: true, job: null, errorCode: null }));
      try {
        const { jobId } = await api.startDownload({
          url: analyzedUrl,
          output,
          height: output === 'mp4' ? height : undefined,
          title: analysis.title,
        });
        setState((s) => ({
          ...s,
          starting: false,
          job: { id: jobId, status: 'queued', progress: null },
        }));
      } catch (err) {
        setState((s) => ({ ...s, starting: false, errorCode: codeOf(err) }));
      }
    },
    [state],
  );

  const cancel = useCallback(() => {
    const jobId = state.job?.id;
    if (jobId) void api.cancelJob(jobId).catch(() => undefined);
    setState((s) => ({ ...s, job: null, errorCode: null }));
  }, [state.job?.id]);

  const reset = useCallback(() => setState(IDLE), []);

  // Poll job status while a job is queued/running.
  const jobId = state.job?.id;
  const jobActive = state.job !== null && (state.job.status === 'queued' || state.job.status === 'running');
  useEffect(() => {
    if (!jobId || !jobActive) return;
    let stopped = false;
    const tick = async () => {
      try {
        const job = await api.getJob(jobId);
        if (stopped) return;
        setState((s) => {
          if (s.job?.id !== jobId) return s;
          return {
            ...s,
            job,
            errorCode: job.status === 'error' ? (job.error ?? 'download_failed') : s.errorCode,
          };
        });
      } catch (err) {
        if (stopped) return;
        setState((s) =>
          s.job?.id === jobId ? { ...s, job: null, errorCode: codeOf(err) } : s,
        );
      }
    };
    const interval = setInterval(() => void tick(), 1000);
    void tick();
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [jobId, jobActive]);

  return { ...state, analyze, start, cancel, reset };
}
