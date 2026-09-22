import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AudioFixOutput, LoudnessPreset, NoiseLevel } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { PageHeader } from '../../components/PageHeader';
import { Spinner } from '../../components/Spinner';
import { formatBytes } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

const NOISE_OPTIONS: NoiseLevel[] = ['off', 'light', 'balanced', 'strong'];
const LOUDNESS_OPTIONS: LoudnessPreset[] = ['off', 'youtube', 'social', 'podcast'];
const OUTPUT_OPTIONS: AudioFixOutput[] = ['wav', 'mp3'];

export function AudioFixPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('audiofix');
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [noise, setNoise] = useState<NoiseLevel>('balanced');
  const [loudness, setLoudness] = useState<LoudnessPreset>('youtube');
  const [output, setOutput] = useState<AudioFixOutput>('wav');

  const busy = runner.starting || runner.jobActive;
  const nothingSelected = noise === 'off' && loudness === 'off';

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const process = () => {
    if (!file || nothingSelected) return;
    const form = new FormData();
    form.append('noise', noise);
    form.append('loudness', loudness);
    form.append('output', output);
    form.append('file', file);
    void runner.start('/api/audio/fix', form);
  };

  const pills = <T extends string>(options: T[], value: T, set: (v: T) => void, labelKey: string) => (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          onClick={() => set(opt)}
          disabled={busy}
          className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
            value === opt
              ? 'border-accent text-accent-text'
              : 'border-white/10 text-zinc-400 hover:border-white/25'
          }`}
        >
          {t(`${labelKey}.${opt}`)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {!embedded && (
        <PageHeader eyebrow={t('common:nav.audio')} title={t('title')} description={t('description')} />
      )}

      {!file && <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept="audio/*,video/*" onFile={onFile} />}

      {runner.errorCode && (
        <ErrorMessage>{t(`downloader:errors.${runner.errorCode}`, t('downloader:errors.download_failed'))}</ErrorMessage>
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
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('noiseTitle')}</p>
            {pills(NOISE_OPTIONS, noise, setNoise, 'noise')}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('loudnessTitle')}</p>
            {pills(LOUDNESS_OPTIONS, loudness, setLoudness, 'loudness')}
          </div>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('outputTitle')}</p>
            {pills(OUTPUT_OPTIONS, output, setOutput, 'output')}
          </div>

          {nothingSelected && <p className="text-sm text-zinc-500">{t('nothingSelected')}</p>}

          {!busy && runner.job?.status !== 'done' && (
            <Button className="w-full" disabled={nothingSelected} onClick={process}>
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
