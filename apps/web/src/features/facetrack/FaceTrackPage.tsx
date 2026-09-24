import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  TRACK_ASPECTS,
  TRACK_SMOOTHING,
  TRACK_ZOOM_DEFAULT,
  type TrackAspect,
  type TrackSmoothing,
} from '@editools/shared';
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
import { ZoomFrame } from './ZoomFrame';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska';

export function FaceTrackPage() {
  const { t } = useTranslation('facetrack');
  const features = useFeatures();
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState<TrackAspect>('9:16');
  const [zoom, setZoom] = useState(TRACK_ZOOM_DEFAULT);
  const [smoothing, setSmoothing] = useState<TrackSmoothing>('medium');
  const localUrl = useObjectUrl(file);

  const busy = runner.starting || runner.jobActive;
  const done = runner.job?.status === 'done';
  const coverage = runner.job?.meta?.faceCoverage;

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('aspect', aspect);
    form.append('zoom', String(zoom));
    form.append('smoothing', smoothing);
    form.append('file', file);
    void runner.start('/api/video/face-track', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('title')} description={t('description')} />

      {features && !features.faceTracking ? (
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

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('aspectTitle')}</p>
                <div className="flex gap-2">
                  {TRACK_ASPECTS.map((a) => (
                    <button
                      key={a}
                      type="button"
                      onClick={() => setAspect(a)}
                      disabled={busy}
                      className={`flex-1 cursor-pointer rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                        aspect === a
                          ? 'bg-accent text-white'
                          : 'border border-white/10 text-zinc-400 hover:border-white/25'
                      }`}
                    >
                      {t(`aspect.${a}`)}
                    </button>
                  ))}
                </div>
              </div>

              {localUrl && !done && (
                <div>
                  <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('zoomTitle')}</p>
                  <ZoomFrame
                    videoUrl={localUrl}
                    aspect={aspect}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    label={t('zoomLabel')}
                    disabled={busy}
                  />
                  <p className="mt-2 text-xs text-zinc-500">{t('zoomHint')}</p>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('smoothingTitle')}</p>
                <Pills options={TRACK_SMOOTHING} value={smoothing} onChange={setSmoothing} disabled={busy} label={(s) => t(`smoothing.${s}`)} />
              </div>

              {!busy && !done && (
                <Button className="w-full !text-white" onClick={process}>
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
                  coverage !== undefined && coverage < 0.6 ? (
                    <p className="text-sm text-amber-300">
                      {t('coverageWarning', { percent: Math.round(coverage * 100) })}
                    </p>
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
