import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConvertFormat } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { Spinner } from '../../components/Spinner';
import { formatBytes } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

const VIDEO_FORMATS: ConvertFormat[] = ['mp4', 'mov', 'mkv', 'webm'];
const AUDIO_FORMATS: ConvertFormat[] = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff'];
const VIDEO_EXTS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'm4v', 'mts', 'mpg', 'mpeg'];

type FileKind = 'audio' | 'video' | 'unknown';

function extOf(file: File): string {
  return file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
}

function kindOf(file: File): FileKind {
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'video';
  const ext = extOf(file);
  if (AUDIO_EXTS.includes(ext)) return 'audio';
  if (VIDEO_EXTS.includes(ext)) return 'video';
  return 'unknown';
}

export function ConvertPage() {
  const { t } = useTranslation('converter');
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState<ConvertFormat>('mp4');

  const busy = runner.starting || runner.jobActive;
  const kind = file ? kindOf(file) : 'unknown';
  const inputExt = file ? extOf(file) : '';

  // No point offering the format the file already is.
  const videoOptions = VIDEO_FORMATS.filter((f) => f !== inputExt);
  const audioOptions = AUDIO_FORMATS.filter((f) => f !== inputExt);

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
    const k = kindOf(f);
    const ext = extOf(f);
    if (k === 'audio') setFormat((AUDIO_FORMATS.filter((x) => x !== ext))[0] ?? 'mp3');
    else setFormat((VIDEO_FORMATS.filter((x) => x !== ext))[0] ?? 'mp4');
  };

  const convert = () => {
    if (!file) return;
    const form = new FormData();
    form.append('format', format);
    form.append('file', file);
    void runner.start('/api/convert', form);
  };

  const isExtraction = kind === 'video' && AUDIO_FORMATS.includes(format);

  const pill = (fmt: ConvertFormat) => (
    <button
      key={fmt}
      type="button"
      onClick={() => setFormat(fmt)}
      disabled={busy}
      className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm uppercase transition-colors ${
        format === fmt
          ? 'border-accent text-accent'
          : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
      }`}
    >
      {fmt}
    </button>
  );

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('description')}</p>
      </div>

      {!file && <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept="video/*,audio/*" onFile={onFile} />}

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

          {kind !== 'audio' && videoOptions.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t('convertTo')}
              </p>
              <div className="flex flex-wrap gap-2">{videoOptions.map(pill)}</div>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              {kind === 'audio' ? t('convertTo') : t('extractAudioTitle')}
            </p>
            <div className="flex flex-wrap gap-2">{audioOptions.map(pill)}</div>
          </div>

          {!busy && runner.job?.status !== 'done' && (
            <Button className="w-full" onClick={convert}>
              {isExtraction ? t('extract') : t('convert')}
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
            doneActions={
              <Button variant="secondary" onClick={convert}>
                {isExtraction ? t('extractAgain') : t('convertAgain')}
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
