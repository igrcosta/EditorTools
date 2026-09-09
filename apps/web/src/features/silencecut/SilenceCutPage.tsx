import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import type { SilenceMode } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { Spinner } from '../../components/Spinner';
import { formatBytes, formatDuration } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

const MODES: SilenceMode[] = ['off', 'gentle', 'balanced', 'aggressive'];

export function SilenceCutPage() {
  const { t } = useTranslation('silencecut');
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SilenceMode>('balanced');
  const [waveReady, setWaveReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [duration, setDuration] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const busy = runner.starting || runner.jobActive;
  const meta = runner.job?.status === 'done' ? runner.job.meta : undefined;
  const trimmed = range !== null && duration > 0 && (range.start > 0.05 || range.end < duration - 0.05);

  useEffect(() => {
    if (!file || !containerRef.current) return;
    setWaveReady(false);
    setPreviewFailed(false);
    setRange(null);
    setDuration(0);
    const url = URL.createObjectURL(file);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 96,
      waveColor: '#3f3f46',
      progressColor: '#34d399',
      cursorColor: '#e4e4e7',
      normalize: true,
      // Play through WebAudio — the same path that decodes the waveform —
      // instead of a media element, which is unreliable in the desktop shell.
      backend: 'WebAudio',
    });
    const regions = ws.registerPlugin(RegionsPlugin.create());
    const unlock = () => {
      if (regionRef.current) return;
      const total = ws.getDuration();
      if (!total) return;
      const region = regions.addRegion({
        start: 0,
        end: total,
        color: 'rgba(52, 211, 153, 0.15)',
        drag: true,
        resize: true,
      });
      regionRef.current = region;
      setDuration(total);
      setRange({ start: 0, end: total });
      setWaveReady(true);
    };
    ws.on('decode', unlock);
    ws.on('ready', unlock);
    // Some codecs can't be decoded by the browser — processing still works,
    // only the visual preview is unavailable.
    ws.on('error', () => {
      setWaveReady(false);
      setPreviewFailed(true);
    });
    regions.on('region-updated', (region) => {
      regionRef.current = region;
      setRange({ start: region.start, end: region.end });
    });
    regions.on('region-out', () => {
      ws.pause();
    });
    ws.on('play', () => setPlaying(true));
    ws.on('pause', () => setPlaying(false));
    ws.on('finish', () => setPlaying(false));
    wavesurferRef.current = ws;
    return () => {
      ws.destroy();
      wavesurferRef.current = null;
      regionRef.current = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const onFile = (f: File) => {
    setFile(f);
    runner.reset();
  };

  const togglePlay = () => {
    const ws = wavesurferRef.current;
    const region = regionRef.current;
    if (!ws || !region) return;
    if (ws.isPlaying()) ws.pause();
    else region.play();
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('mode', mode);
    if (waveReady && range) {
      form.append('start', range.start.toFixed(3));
      form.append('end', range.end.toFixed(3));
    }
    form.append('file', file);
    void runner.start('/api/audio/cut-silence', form);
  };

  const nothingToDo = mode === 'off' && !trimmed;

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

          <div className="relative overflow-hidden rounded-md bg-zinc-950/60 p-2">
            <div ref={containerRef} />
            {!waveReady && !previewFailed && (
              <div className="absolute inset-0 flex items-end gap-[3px] px-3 pb-3" aria-hidden>
                {Array.from({ length: 56 }).map((_, i) => (
                  <div
                    key={i}
                    className="wave-skeleton-bar flex-1 rounded-sm bg-zinc-700/70"
                    style={{
                      height: `${18 + ((i * 37) % 58)}%`,
                      animationDelay: `${(i % 14) * 90}ms`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {!waveReady && !previewFailed && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Spinner /> {t('loadingWave')}
            </div>
          )}
          {previewFailed && <p className="text-sm text-zinc-500">{t('previewUnavailable')}</p>}

          {waveReady && range && (
            <div className="flex items-center justify-between text-sm text-zinc-300">
              <Button variant="secondary" onClick={togglePlay}>
                {playing ? t('pause') : t('playSelection')}
              </Button>
              <span>
                {formatDuration(Math.floor(range.start))} → {formatDuration(Math.ceil(range.end))}{' '}
                <span className="text-zinc-500">
                  · {t('selected')} {formatDuration(Math.max(1, Math.round(range.end - range.start)))}
                </span>
              </span>
            </div>
          )}
          {waveReady && <p className="text-xs text-zinc-500">{t('dragHint')}</p>}

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

          {nothingToDo && <p className="text-sm text-zinc-500">{t('nothingToDo')}</p>}

          {!busy && runner.job?.status !== 'done' && (
            <Button className="w-full" disabled={nothingToDo} onClick={process}>
              {mode === 'off' ? t('processTrim') : t('process')}
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
