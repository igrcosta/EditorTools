import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutputFormat } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Input } from '../../components/Input';
import { PageHeader } from '../../components/PageHeader';
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
  const [height, setHeight] = useState<number | undefined>(undefined);
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

  // Pre-select the recommended quality whenever a new analysis lands.
  const recommended = dl.analysis?.qualities.find((q) => q.recommended)?.height;
  useEffect(() => {
    setHeight(recommended);
  }, [recommended, dl.analysis]);

  const job = dl.job;
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running');
  const jobDone = job !== null && job.status === 'done';
  const jobFailed = job !== null && job.status === 'error';

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

  const onAnalyze = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !dl.analyzing && !jobActive) void dl.analyze(url.trim());
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
      <PageHeader
        eyebrow={t('common:nav.downloader')}
        title={t('title')}
        description={t('description')}
        hint={t('platformsHint')}
      />

      <form onSubmit={onAnalyze} className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          disabled={dl.analyzing}
          autoFocus
        />
        <Button type="submit" disabled={!url.trim() || dl.analyzing || jobActive}>
          {dl.analyzing ? <Spinner /> : null}
          {dl.analyzing ? t('analyzing') : t('analyze')}
        </Button>
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
        <Card className="space-y-4 divide-y divide-white/10">
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

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {t('format.label')}
            </p>
            <div className="flex gap-2">
              {(['mp4', 'mp3'] as const).map((fmt) => (
                <button
                  key={fmt}
                  type="button"
                  onClick={() => setOutput(fmt)}
                  disabled={jobActive || dl.starting}
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
          </div>

          {output === 'mp4' && dl.analysis.qualities.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t('quality')}
              </p>
              <div className="flex flex-wrap gap-2">
                {dl.analysis.qualities.map((q) => (
                  <button
                    key={q.height}
                    type="button"
                    onClick={() => setHeight(q.height)}
                    disabled={jobActive || dl.starting}
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      height === q.height
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

          {!jobActive && !jobDone && (
            <Button
              className="w-full"
              disabled={dl.starting}
              onClick={() => void dl.start(output, height)}
            >
              {dl.starting ? <Spinner /> : null}
              {dl.starting ? t('starting') : t('download')}
            </Button>
          )}

          {jobActive && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>{runningLabel}</span>
                {job.status === 'running' && job.progress !== null && <span>{job.progress}%</span>}
              </div>
              <ProgressBar value={job.status === 'running' ? job.progress : null} />
              <Button variant="secondary" onClick={dl.cancel}>
                {t('cancel')}
              </Button>
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
                <Button onClick={() => void dl.start(output, height)}>{t('download')}</Button>
                <a
                  href={api.jobFileUrl(job.id)}
                  download
                  className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 px-4 text-sm text-zinc-200 transition-colors hover:border-zinc-500"
                >
                  {t('saveAgain')}
                </a>
                <Button variant="secondary" onClick={onReset}>
                  {t('downloadAnother')}
                </Button>
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
