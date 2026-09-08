import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { OutputFormat } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Input } from '../../components/Input';
import { ProgressBar } from '../../components/ProgressBar';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatBytes, formatDuration } from '../../lib/format';
import { useDownloader } from './useDownloader';

export function DownloadPage() {
  const { t } = useTranslation('downloader');
  const dl = useDownloader();

  const [url, setUrl] = useState('');
  const [output, setOutput] = useState<OutputFormat>('mp4');
  const [height, setHeight] = useState<number | undefined>(undefined);

  const recommended = dl.analysis?.qualities.find((q) => q.recommended)?.height;
  useEffect(() => {
    setHeight(recommended);
  }, [recommended, dl.analysis]);

  const onAnalyze = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim() && !dl.analyzing) void dl.analyze(url.trim());
  };

  const onReset = () => {
    setUrl('');
    setOutput('mp4');
    dl.reset();
  };

  const job = dl.job;
  const jobActive = job !== null && (job.status === 'queued' || job.status === 'running');
  const jobDone = job !== null && job.status === 'done';
  const jobFailed = job !== null && job.status === 'error';

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('description')}</p>
      </div>

      <form onSubmit={onAnalyze} className="flex gap-2">
        <Input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={t('urlPlaceholder')}
          disabled={dl.analyzing || jobActive}
          autoFocus
        />
        <Button type="submit" disabled={!url.trim() || dl.analyzing || jobActive}>
          {dl.analyzing ? <Spinner /> : null}
          {dl.analyzing ? t('analyzing') : t('analyze')}
        </Button>
      </form>

      {dl.errorCode && !jobActive && (
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

          {!jobActive && !jobDone && (
            <>
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

              <Button
                className="w-full"
                disabled={dl.starting}
                onClick={() => void dl.start(output, height)}
              >
                {dl.starting ? <Spinner /> : null}
                {dl.starting ? t('starting') : t('download')}
              </Button>
            </>
          )}

          {jobActive && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm text-zinc-400">
                <span>
                  {job.status === 'queued'
                    ? t('queued')
                    : job.progress === 100
                      ? t('processing')
                      : t('downloading')}
                </span>
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
              <p className="text-sm font-medium text-accent">✓ {t('done')}</p>
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
                  className="inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-zinc-950 transition-colors hover:bg-accent-strong"
                >
                  {t('saveFile')}
                </a>
                <Button variant="secondary" onClick={onReset}>
                  {t('downloadAnother')}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
