import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SilenceMode } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { Spinner } from '../../components/Spinner';
import { formatBytes, formatDuration } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

const MODES: SilenceMode[] = ['gentle', 'balanced', 'aggressive'];

export function SilenceCutPage() {
  const { t } = useTranslation('silencecut');
  const runner = useJobRunner();

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SilenceMode>('balanced');

  const busy = runner.starting || runner.jobActive;
  const meta = runner.job?.status === 'done' ? runner.job.meta : undefined;

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('mode', mode);
    form.append('file', file);
    void runner.start('/api/audio/cut-silence', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('description')}</p>
      </div>

      {!file && <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept="audio/*,video/*" onFile={onFile} />}

      {runner.errorCode && (
        <ErrorMessage>{t(`downloader:errors.${runner.errorCode}`, t('downloader:errors.download_failed'))}</ErrorMessage>
      )}

      {file && (
        <Card className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 truncate text-sm text-zinc-300">
              {file.name} <span className="text-zinc-500">· {formatBytes(file.size)}</span>
            </p>
            <button
              type="button"
              onClick={() => {
                setFile(null);
                runner.reset();
              }}
              disabled={busy}
              className="shrink-0 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200"
            >
              {t('changeFile')}
            </button>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('modeTitle')}</p>
            <div className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  disabled={busy}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    mode === m
                      ? 'border-accent text-accent'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {t(`mode.${m}`)}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-zinc-500">{t(`modeHint.${mode}`)}</p>
          </div>

          {!busy && runner.job?.status !== 'done' && (
            <Button className="w-full" onClick={process}>
              {t('process')}
            </Button>
          )}
          {runner.starting && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Spinner /> {t('uploading')}
            </div>
          )}

          {meta && (
            <p className="text-sm text-zinc-300">
              {meta.silencesCut && meta.silencesCut > 0 && meta.removedSeconds !== undefined
                ? t('stats', {
                    count: meta.silencesCut,
                    time: formatDuration(meta.removedSeconds),
                  })
                : t('nothingToCut')}
            </p>
          )}

          <JobStatus
            starting={false}
            job={runner.job}
            onCancel={runner.cancel}
            doneActions={
              <Button variant="secondary" onClick={process}>
                {t('processAgain')}
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
