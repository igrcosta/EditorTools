import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BG_OUTPUTS, type BgOutput } from '@editools/shared';
import { BeforeAfter } from '../../components/BeforeAfter';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DesktopOnlyNotice } from '../../components/DesktopOnlyNotice';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { PageHeader } from '../../components/PageHeader';
import { Pills } from '../../components/Pills';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatBytes } from '../../lib/format';
import { useFeatures } from '../../lib/useFeatures';
import { useJobRunner } from '../../lib/useJobRunner';
import { useObjectUrl } from '../../lib/useObjectUrl';

const ACCEPT = 'image/png,image/jpeg,image/webp';

export function RemoveBgPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('image');
  const features = useFeatures();
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [output, setOutput] = useState<BgOutput>('png');
  const localUrl = useObjectUrl(file);

  const busy = runner.starting || runner.jobActive;
  const done = runner.job?.status === 'done';

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('output', output);
    form.append('file', file);
    void runner.start('/api/image/remove-background', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {!embedded && (
        <PageHeader
          title={t('removeBg.title')}
          description={t('removeBg.description')}
        />
      )}

      {features && !features.removeBackground ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          {!file && (
            <>
              <Dropzone
                label={t('removeBg.dropLabel')}
                hint={t('removeBg.dropHint')}
                pasteHint={t('pasteHint')}
                accept={ACCEPT}
                onFile={onFile}
              />
              <p className="text-xs text-zinc-500">{t('removeBg.hint')}</p>
            </>
          )}

          {runner.errorCode && (
            <ErrorMessage>
              {t(`downloader:errors.${runner.errorCode}`, t('downloader:errors.download_failed'))}
            </ErrorMessage>
          )}

          {file && (
            <Card className="space-y-4 divide-y divide-white/10">
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
                <img src={localUrl} alt="" className="mx-auto max-h-64 rounded-md object-contain" />
              )}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  {t('removeBg.outputTitle')}
                </p>
                <Pills
                  options={BG_OUTPUTS}
                  value={output}
                  onChange={setOutput}
                  disabled={busy}
                  label={(o) => t(`removeBg.output.${o}`)}
                />
              </div>

              {!busy && !done && (
                <Button className="w-full" onClick={process}>
                  {t('removeBg.process')}
                </Button>
              )}
              {runner.starting && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Spinner /> {t('removeBg.uploading')}
                </div>
              )}

              <JobStatus
                starting={false}
                job={runner.job}
                onCancel={runner.cancel}
                preview
                previewNode={
                  done && localUrl && runner.job ? (
                    <BeforeAfter before={localUrl} after={api.jobPreviewUrl(runner.job.id)} transparent />
                  ) : undefined
                }
                doneActions={
                  <Button variant="secondary" onClick={process}>
                    {t('removeBg.processAgain')}
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
