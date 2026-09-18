import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  UPSCALE_MODELS,
  UPSCALE_OUTPUTS,
  UPSCALE_SCALES,
  type UpscaleModel,
  type UpscaleOutput,
  type UpscaleScale,
} from '@editools/shared';
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
/** Mirrors the server's default MAX_IMAGE_PIXELS so the warning appears before uploading. */
const MAX_OUTPUT_MEGAPIXELS = 50;

function extOf(file: File): string {
  return file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
}

export function UpscalePage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('image');
  const features = useFeatures();
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [model, setModel] = useState<UpscaleModel>('photo');
  const [scale, setScale] = useState<UpscaleScale>(4);
  const [output, setOutput] = useState<UpscaleOutput>('png');
  const [dims, setDims] = useState<{ width: number; height: number } | null>(null);
  const localUrl = useObjectUrl(file);

  const busy = runner.starting || runner.jobActive;
  const done = runner.job?.status === 'done';
  const outMegapixels = dims ? (dims.width * scale * dims.height * scale) / 1_000_000 : 0;
  const tooLarge = outMegapixels > MAX_OUTPUT_MEGAPIXELS;

  const onFile = (f: File) => {
    setFile(f);
    setDims(null);
    runner.reset();
    const ext = extOf(f);
    setOutput(ext === 'jpg' || ext === 'jpeg' ? 'jpg' : ext === 'webp' ? 'webp' : 'png');
  };

  const process = () => {
    if (!file || tooLarge) return;
    const form = new FormData();
    form.append('model', model);
    form.append('scale', String(scale));
    form.append('output', output);
    form.append('file', file);
    void runner.start('/api/image/upscale', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {!embedded && (
        <PageHeader
          eyebrow={t('common:nav.image')}
          title={t('upscale.title')}
          description={t('upscale.description')}
        />
      )}

      {features && !features.upscale ? (
        <DesktopOnlyNotice />
      ) : (
        <>
          {!file && (
            <>
              <Dropzone
                label={t('upscale.dropLabel')}
                hint={t('upscale.dropHint')}
                pasteHint={t('pasteHint')}
                accept={ACCEPT}
                onFile={onFile}
              />
              <p className="text-xs text-zinc-500">{t('upscale.gpuHint')}</p>
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
                <img
                  src={localUrl}
                  alt=""
                  className="mx-auto max-h-64 rounded-md object-contain"
                  onLoad={(e) => setDims({ width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight })}
                />
              )}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('upscale.modelTitle')}</p>
                <Pills options={UPSCALE_MODELS} value={model} onChange={setModel} disabled={busy} label={(m) => t(`upscale.model.${m}`)} />
                <p className="mt-2 text-xs text-zinc-500">{t(`upscale.modelHint.${model}`)}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('upscale.scaleTitle')}</p>
                <Pills options={UPSCALE_SCALES} value={scale} onChange={setScale} disabled={busy} label={(s) => t(`upscale.scale.${s}`)} />
                {dims && (
                  <p className={`mt-2 text-xs ${tooLarge ? 'text-amber-300' : 'text-zinc-500'}`}>
                    {tooLarge
                      ? t('upscale.tooLarge', { limit: MAX_OUTPUT_MEGAPIXELS })
                      : t('upscale.sizePreview', {
                          from: `${dims.width}×${dims.height}`,
                          to: `${dims.width * scale}×${dims.height * scale}`,
                        })}
                  </p>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('upscale.outputTitle')}</p>
                <Pills options={UPSCALE_OUTPUTS} value={output} onChange={setOutput} disabled={busy} label={(o) => t(`upscale.output.${o}`)} />
              </div>

              {!busy && !done && (
                <Button className="w-full" onClick={process} disabled={tooLarge}>
                  {t('upscale.process')}
                </Button>
              )}
              {runner.starting && (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <Spinner /> {t('upscale.uploading')}
                </div>
              )}

              <JobStatus
                starting={false}
                job={runner.job}
                onCancel={runner.cancel}
                preview
                previewNode={
                  done && localUrl && runner.job ? (
                    <BeforeAfter before={localUrl} after={api.jobPreviewUrl(runner.job.id)} zoomable />
                  ) : undefined
                }
                doneActions={
                  <Button variant="secondary" onClick={process} disabled={tooLarge}>
                    {t('upscale.processAgain')}
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
