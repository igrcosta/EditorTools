import { useCallback, useEffect, useState } from 'react';
import type { AnalyzeResult, JobState, OutputFormat } from '@editools/shared';
import { api, ApiClientError } from '../../lib/api';

interface DownloaderState {
  analyzing: boolean;
  analysis: AnalyzeResult | null;
  analyzedUrl: string | null;
  /** Quality currently being downloaded (mp4 only). */
  height: number | undefined;
  output: OutputFormat;
  starting: boolean;
  job: JobState | null;
  errorCode: string | null;
}

const IDLE: DownloaderState = {
  analyzing: false,
  analysis: null,
  analyzedUrl: null,
  height: undefined,
  output: 'mp4',
  starting: false,
  job: null,
  errorCode: null,
};

function codeOf(err: unknown): string {
  return err instanceof ApiClientError ? err.code : 'download_failed';
}

async function startJob(
  url: string,
  analysis: AnalyzeResult,
  output: OutputFormat,
  height: number | undefined,
): Promise<JobState> {
  const { jobId } = await api.startDownload({
    url,
    output,
    height: output === 'mp4' ? height : undefined,
    title: analysis.title,
  });
  return { id: jobId, status: 'queued', progress: null };
}

export function useDownloader() {
  const [state, setState] = useState<DownloaderState>(IDLE);

  /** One-shot flow: analyze the URL and immediately download with the recommended quality. */
  const run = useCallback(async (url: string, output: OutputFormat) => {
    setState({ ...IDLE, output, analyzing: true });
    let analysis: AnalyzeResult;
    try {
      analysis = await api.analyze(url);
    } catch (err) {
      setState({ ...IDLE, output, errorCode: codeOf(err) });
      return;
    }
    const height = analysis.qualities.find((q) => q.recommended)?.height;
    setState({ ...IDLE, output, analysis, analyzedUrl: url, height, starting: true });
    try {
      const job = await startJob(url, analysis, output, height);
      setState((s) => ({ ...s, starting: false, job }));
    } catch (err) {
      setState((s) => ({ ...s, starting: false, errorCode: codeOf(err) }));
    }
  }, []);

  /** Re-download the analyzed media with a different quality or format. */
  const restart = useCallback(
    async (output: OutputFormat, height: number | undefined) => {
      const { analyzedUrl, analysis, job } = state;
      if (!analyzedUrl || !analysis) return;
      if (job && (job.status === 'queued' || job.status === 'running')) {
        void api.cancelJob(job.id).catch(() => undefined);
      }
      setState((s) => ({ ...s, output, height, starting: true, job: null, errorCode: null }));
      try {
        const newJob = await startJob(analyzedUrl, analysis, output, height);
        setState((s) => ({ ...s, starting: false, job: newJob }));
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

  return { ...state, run, restart, cancel, reset };
}
