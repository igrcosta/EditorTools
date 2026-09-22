import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { JobState } from '@editools/shared';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';

const VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.mkv'];
const AUDIO_EXTS = ['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.opus', '.aac'];
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];

interface Props {
  starting: boolean;
  job: JobState | null;
  onCancel: () => void;
  /**
   * Preview-then-save mode: show an inline player and an explicit Save button
   * instead of reporting an automatic save.
   */
  preview?: boolean;
  /** Replaces the default inline preview (e.g. a before/after comparison). */
  previewNode?: ReactNode;
  /** Extra actions rendered next to the save/save-again button when done. */
  doneActions?: ReactNode;
  /** Extra content shown under the result line (warnings, stats). */
  doneNote?: ReactNode;
}

/** Progress + result panel shared by the upload-based tools. */
export function JobStatus({ starting, job, onCancel, preview = false, previewNode, doneActions, doneNote }: Props) {
  const { t } = useTranslation();
  const active = job !== null && (job.status === 'queued' || job.status === 'running');

  if (starting) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-400">
        <Spinner /> {t('job.starting')}
      </div>
    );
  }

  if (active && job) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm text-zinc-400">
          <span>{job.status === 'queued' ? t('job.queued') : t('job.working')}</span>
          {job.status === 'running' && job.progress !== null && <span>{job.progress}%</span>}
        </div>
        <ProgressBar value={job.status === 'running' ? job.progress : null} />
        <Button variant="secondary" onClick={onCancel}>
          {t('job.cancel')}
        </Button>
      </div>
    );
  }

  if (job?.status === 'done') {
    const ext = job.filename ? job.filename.slice(job.filename.lastIndexOf('.')).toLowerCase() : '';
    const isVideo = VIDEO_EXTS.includes(ext);
    const isAudio = AUDIO_EXTS.includes(ext);
    const isImage = IMAGE_EXTS.includes(ext);
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-accent">
          ✓ {preview ? t('job.ready') : t('job.savedAutomatically')}
        </p>
        <p className="text-sm text-zinc-300">
          {job.filename}
          {job.fileSizeBytes !== undefined && (
            <span className="text-zinc-500"> · {formatBytes(job.fileSizeBytes)}</span>
          )}
        </p>
        {doneNote}
        {preview && previewNode}
        {preview && !previewNode && isVideo && (
          <video
            controls
            className="w-full rounded-md bg-black"
            src={api.jobPreviewUrl(job.id)}
            onError={(e) => {
              (e.currentTarget as HTMLVideoElement).hidden = true;
            }}
          />
        )}
        {preview && !previewNode && isAudio && (
          <audio controls className="w-full" src={api.jobPreviewUrl(job.id)} />
        )}
        {preview && !previewNode && isImage && (
          <img
            alt=""
            className="checkerboard w-full rounded-md"
            src={api.jobPreviewUrl(job.id)}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).hidden = true;
            }}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <a
            href={api.jobFileUrl(job.id)}
            download
            className={
              preview
                ? 'inline-flex h-10 items-center justify-center rounded-md bg-accent px-4 text-sm font-medium text-zinc-950 shadow-glow transition hover:bg-accent-strong'
                : 'inline-flex h-10 items-center justify-center rounded-md border border-white/10 px-4 text-sm text-zinc-200 transition hover:border-accent/40'
            }
          >
            {preview ? t('job.saveFile') : t('job.saveAgain')}
          </a>
          {doneActions}
        </div>
      </div>
    );
  }

  return null;
}
