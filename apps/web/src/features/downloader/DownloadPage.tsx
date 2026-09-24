import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COOKIE_BROWSERS, type CookieBrowser, type OutputFormat } from '@editools/shared';
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
const COOKIES_KEY = 'editools.downloader.cookiesFromBrowser';

function loadFormat(): OutputFormat {
  try {
    const v = localStorage.getItem(FORMAT_KEY);
    return v === 'mp3' ? 'mp3' : 'mp4';
  } catch {
    return 'mp4';
  }
}

function loadCookiesFromBrowser(): CookieBrowser | undefined {
  try {
    const v = localStorage.getItem(COOKIES_KEY);
    return (COOKIE_BROWSERS as readonly string[]).includes(v ?? '') ? (v as CookieBrowser) : undefined;
  } catch {
    return undefined;
  }
}

export function DownloadPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('downloader');
  const dl = useDownloader();

  const [url, setUrl] = useState('');
  const [output, setOutput] = useState<OutputFormat>(loadFormat);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [desktop, setDesktop] = useState<DesktopSettings | null>(null);
  const [cookiesFromBrowser, setCookiesFromBrowser] = useState<CookieBrowser | undefined>(loadCookiesFromBrowser);
  const [showCookies, setShowCookies] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(FORMAT_KEY, output);
    } catch {
      // per-browser convenience only
    }
  }, [output]);

  useEffect(() => {
    try {
      if (cookiesFromBrowser) localStorage.setItem(COOKIES_KEY, cookiesFromBrowser);
      else localStorage.removeItem(COOKIES_KEY);
    } catch {
      // per-browser convenience only
    }
  }, [cookiesFromBrowser]);

  // A bot-check wall is exactly what this option is for — surface it automatically instead of
  // making the user go find it after already reading the error.
  useEffect(() => {
    if (dl.errorCode === 'bot_check' || dl.errorCode === 'cookies_browser_locked') setShowCookies(true);
  }, [dl.errorCode]);

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
    if (url.trim() && !dl.analyzing && !jobActive) void dl.analyze(url.trim(), cookiesFromBrowser);
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
      {!embedded && (
        <PageHeader title={t('title')} description={t('description')} hint={t('platformsHint')} />
      )}

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

      <div className="text-xs">
        <button
          type="button"
          onClick={() => setShowCookies((v) => !v)}
          className="cursor-pointer text-zinc-500 hover:text-zinc-300"
        >
          {t('cookies.toggle')}
        </button>
        {showCookies && (
          <div className="mt-2 space-y-1.5 rounded-md border border-white/10 p-3">
            <label className="flex flex-wrap items-center gap-2">
              <span className="text-zinc-400">{t('cookies.label')}</span>
              <select
                value={cookiesFromBrowser ?? ''}
                onChange={(e) => setCookiesFromBrowser((e.target.value || undefined) as CookieBrowser | undefined)}
                className="h-8 cursor-pointer rounded border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 focus:border-accent focus:outline-none"
              >
                <option value="">{t('cookies.none')}</option>
                {COOKIE_BROWSERS.map((b) => (
                  <option key={b} value={b}>
                    {t(`cookies.browser.${b}`)}
                  </option>
                ))}
              </select>
            </label>
            {cookiesFromBrowser && <p className="text-zinc-500">{t('cookies.hint')}</p>}
          </div>
        )}
      </div>

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
                      ? 'border-accent text-accent-text'
                      : 'border-white/10 text-zinc-400 hover:border-white/25'
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
                        ? 'border-accent text-accent-text'
                        : 'border-white/10 text-zinc-400 hover:border-white/25'
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
              <p className="text-sm font-medium text-accent-text">✓ {t('savedAutomatically')}</p>
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
            className="cursor-pointer text-accent-text hover:underline"
          >
            {t('changeFolder')}
          </button>
        </p>
      )}
    </div>
  );
}
