import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAPTION_PRESETS, type CaptionPreset } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DesktopOnlyNotice } from '../../components/DesktopOnlyNotice';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { PageHeader } from '../../components/PageHeader';
import { Pills } from '../../components/Pills';
import { Spinner } from '../../components/Spinner';
import { formatBytes } from '../../lib/format';
import { useFeatures } from '../../lib/useFeatures';
import { useJobRunner } from '../../lib/useJobRunner';
import { useObjectUrl } from '../../lib/useObjectUrl';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska';

export function CaptionsPage() {
  const { t } = useTranslation('captions');
  const features = useFeatures();
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [preset, setPreset] = useState<CaptionPreset>('clean');
  const localUrl = useObjectUrl(file);

  const busy = runner.starting || runner.jobActive;
  const done = runner.job?.status === 'done';
  const wordCount = runner.job?.meta?.captionWordCount;

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('preset', preset);
    form.append('file', file);
    void runner.start('/api/video/captions', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow={t('common:nav.captions')} title={t('title')} description={t('description')} />

      {features && !features.captions ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          {!file && (
            <>
              <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept={ACCEPT} onFile={onFile} />
              <p className="text-xs text-zinc-500">{t('hint')}</p>
            </>
          )}

          {runner.errorCode && (
            <ErrorMessage>
              {t(`downloader:errors.${runner.errorCode}`, t('downloader:errors.download_failed'))}
            </ErrorMessage>
          )}

          {file && (
            <Card className="space-y-4 divide-y divide-zinc-800/70">
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

              {localUrl && !done && (
                <video src={localUrl} controls className="max-h-64 w-full rounded-md bg-black" />
              )}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('presetTitle')}</p>
                <Pills options={CAPTION_PRESETS} value={preset} onChange={setPreset} disabled={busy} label={(p) => t(`preset.${p}`)} />
              </div>

              {!busy && !done && (
                <Button className="w-full" onClick={process}>
                  {t('process')}
                </Button>
              )}
              {runner.starting && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Spinner /> {t('uploading')}
                </div>
              )}

              <JobStatus
                starting={false}
                job={runner.job}
                onCancel={runner.cancel}
                preview
                doneNote={
                  wordCount !== undefined && wordCount < 3 ? (
                    <p className="text-sm text-amber-300">{t('fewWordsWarning')}</p>
                  ) : undefined
                }
                doneActions={
                  <Button variant="secondary" onClick={process}>
                    {t('processAgain')}
                  </Button>
                }
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
