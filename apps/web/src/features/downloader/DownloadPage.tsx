import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutputFormat } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Input } from '../../components/Input';
import { ProgressBar } from '../../components/ProgressBar';
import { Spinner } from '../../components/Spinner';
import { api, type DesktopSettings } from '../../lib/api';
import { formatBytes, formatDuration } from '../../lib/format';
import { useDownloader } from './useDownloader';

const FORMAT_KEY = 'editools.downloader.format';

function loadFormat(): OutputFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    return v === 'mp3' ? 'mp3' : 'mp4';
  } catch {
    return 'mp4';
  }
}

export function DownloadPage() {
  const { t } = useTranslation('downloader');
  const dl = useDownloader();

  const [url, setUrl] = useState('');
  const [output, setOutput] = useState<OutputFormat>(loadFormat);
  const [desktop, setDesktop] = useState<DesktopSettings | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(FORMAT_KEY, output);
    } catch {
      // per-browser convenience only
    }
  }, [output]);

  useEffect(() => {
    void api.getDesktopSettings().then(setDesktop);
  }, []);

  const job = dl.job;
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running');
  const jobDone = job !== null && job.status === 'done';
  const jobFailed = job !== null && job.status === 'error';
  const busy = dl.analyzing || dl.starting || jobActive;

  // When a job finishes, save the file automatically (desktop: straight into the
  // configured folder; browser: the regular download flow).
  const savedJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (jobDone && job && savedJobRef.current !== job.id) {
      savedJobRef.current = job.id;
      const a = document.createElement('a');
      a.href = api.jobFileUrl(job.id);
      a.download = '';
      a.click();
    }
  }, [jobDone, job]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !busy) void dl.run(url.trim(), output);
  };

  const onSelectFormat = (fmt: OutputFormat) => {
    setOutput(fmt);
    if (dl.analysis && (jobActive || jobDone) && fmt !== dl.output) {
      void dl.restart(fmt, dl.height);
    }
  };

  const onSelectQuality = (height: number) => {
    if (!dl.analysis || height === dl.height) return;
    void dl.restart('mp4', height);
  };

  const onReset = () => {
    setUrl('');
    dl.reset();
  };

  const chooseFolder = async () => {
    try {
      setDesktop(await api.chooseDesktopFolder());
    } catch {
      // dialog dismissed or unavailable
    }
  };

  const runningLabel =
    job?.status === 'queued'
      ? t('queued')
      : job?.stage === 'processing'
        ? t('processing')
        : t('downloading');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('description')}</p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t('urlPlaceholder')}
            disabled={busy}
            autoFocus
          />
          <Button type="submit" disabled={!url.trim() || busy}>
            {dl.analyzing || dl.starting ? <Spinner /> : null}
            {dl.analyzing ? t('analyzing') : t('download')}
          </Button>
        </div>
        <div className="flex gap-2">
          {(['mp4', 'mp3'] as const).map((fmt) => (
            <button
              key={fmt}
              type="button"
              onClick={() => onSelectFormat(fmt)}
              disabled={dl.analyzing || dl.starting}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                output === fmt
                  ? 'border-accent text-accent'
                  : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
              }`}
            >
              {t(`format.${fmt}`)}
            </button>
          ))}
        </div>
      </form>

      {dl.errorCode && (
        <ErrorMessage>
          {t(`errors.${dl.errorCode}`, t('errors.download_failed'))}
          {jobFailed && (
            <div className="mt-2">
              <Button variant="secondary" onClick={dl.cancel}>
                {t('tryAgain')}
              </Button>
            </div>
          )}
        </ErrorMessage>
      )}

      {dl.analysis && (
        <Card className="space-y-4">
          <div className="flex gap-4">
            {dl.analysis.thumbnailUrl && (
              <img
                src={dl.analysis.thumbnailUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="h-20 w-32 shrink-0 rounded-md object-cover"
              />
            )}
            <div className="min-w-0">
              <h2 className="line-clamp-2 font-medium text-zinc-100">{dl.analysis.title}</h2>
              <p className="mt-1 text-sm text-zinc-400">
                {dl.analysis.source}
                {dl.analysis.durationSeconds !== null &&
                  ` · ${formatDuration(dl.analysis.durationSeconds)}`}
              </p>
            </div>
          </div>

          {dl.output === 'mp4' && dl.analysis.qualities.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t('quality')} <span className="normal-case">· {t('qualityHint')}</span>
              </p>
              <div className="flex flex-wrap gap-2">
                {dl.analysis.qualities.map((q) => (
                  <button
                    key={q.height}
                    type="button"
                    onClick={() => onSelectQuality(q.height)}
                    disabled={dl.starting}
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      dl.height === q.height
                        ? 'border-accent text-accent'
                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                    }`}
                  >
                    {q.label}
                    {q.recommended && (
                      <span className="ml-1.5 text-xs opacity-70">· {t('recommended')}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(jobActive || dl.starting) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>{dl.starting ? t('starting') : runningLabel}</span>
                {job?.status === 'running' && job.progress !== null && <span>{job.progress}%</span>}
              </div>
              <ProgressBar value={job?.status === 'running' ? job.progress : null} />
              {jobActive && (
                <Button variant="secondary" onClick={dl.cancel}>
                  {t('cancel')}
                </Button>
              )}
            </div>
          )}

          {jobDone && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-accent">✓ {t('savedAutomatically')}</p>
              <p className="text-sm text-zinc-300">
                {job.filename}
                {job.fileSizeBytes !== undefined && (
                  <span className="text-zinc-500"> · {formatBytes(job.fileSizeBytes)}</span>
                )}
              </p>
              <div className="flex gap-2">
                <a
                  href={api.jobFileUrl(job.id)}
                  download
                  className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 px-4 text-sm text-zinc-200 transition-colors hover:border-zinc-500"
                >
                  {t('saveAgain')}
                </a>
                <Button onClick={onReset}>{t('downloadAnother')}</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {desktop && (
        <p className="text-xs text-zinc-500">
          {t('savingTo')}{' '}
          <span className="font-mono text-zinc-400">{desktop.downloadDir}</span>{' '}
          <button
            type="button"
            onClick={() => void chooseFolder()}
            className="cursor-pointer text-accent hover:underline"
          >
            {t('changeFolder')}
          </button>
        </p>
      )}
    </div>
  );
}
