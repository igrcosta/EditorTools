import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { JobState } from '@editools/shared';
import { api } from '../lib/api';
import { formatBytes } from '../lib/format';
import { Button } from './Button';
import { ProgressBar } from './ProgressBar';
import { Spinner } from './Spinner';

interface Props {
  starting: boolean;
  job: JobState | null;
  onCancel: () => void;
  /** Extra actions rendered next to "Save again" when the job is done. */
  doneActions?: ReactNode;
}

/** Progress + result panel shared by the upload-based tools. */
export function JobStatus({ starting, job, onCancel, doneActions }: Props) {
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
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-accent">✓ {t('job.savedAutomatically')}</p>
        <p className="text-sm text-zinc-300">
          {job.filename}
          {job.fileSizeBytes !== undefined && (
            <span className="text-zinc-500"> · {formatBytes(job.fileSizeBytes)}</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <a
            href={api.jobFileUrl(job.id)}
            download
            className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-700 px-4 text-sm text-zinc-200 transition-colors hover:border-zinc-500"
          >
            {t('job.saveAgain')}
          </a>
          {doneActions}
        </div>
      </div>
    );
  }

  return null;
}
