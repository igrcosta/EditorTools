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
import { PageHeader } from '../../components/PageHeader';
import { Spinner } from '../../components/Spinner';
import { formatBytes, formatDuration } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

const MODES: SilenceMode[] = ['off', 'gentle', 'balanced', 'aggressive'];

interface NoiseSample {
  start: number;
  end: number;
  thresholdDb: number;
}

/**
 * Measures the selected span of the decoded audio and derives a silencedetect
 * threshold slightly above the sample's level, so "silence" matches this
 * recording's actual room tone.
 */
function measureThresholdDb(buffer: AudioBuffer, start: number, end: number): number {
  const from = Math.max(0, Math.floor(start * buffer.sampleRate));
  const to = Math.min(buffer.length, Math.ceil(end * buffer.sampleRate));
  if (to <= from) return -35;
  const stride = Math.max(1, Math.floor((to - from) / 500_000));
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch += 1) {
    const data = buffer.getChannelData(ch);
    for (let i = from; i < to; i += stride) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sumSquares += v * v;
      count += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const peakDb = 20 * Math.log10(Math.max(peak, 1e-6));
  const rmsDb = 20 * Math.log10(Math.max(rms, 1e-6));
  // A little headroom above the sample so similar moments count as silence.
  const threshold = Math.max(peakDb + 4, rmsDb + 10);
  return Math.round(Math.min(-15, Math.max(-70, threshold)));
}

export function SilenceCutPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('silencecut');
  const runner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SilenceMode>('balanced');
  const [waveReady, setWaveReady] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);
  const [duration, setDuration] = useState(0);
  const [sample, setSample] = useState<NoiseSample | null>(null);

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
    setSample(null);
    const url = URL.createObjectURL(file);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 96,
      waveColor: '#3f3f46',
      progressColor: '#9146ff',
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
        color: 'rgba(145, 70, 255, 0.16)',
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

  /** Takes the current selection as a background-noise sample, then restores the full region. */
  const markSample = () => {
    const ws = wavesurferRef.current;
    const region = regionRef.current;
    if (!ws || !region || !range) return;
    const buffer = ws.getDecodedData();
    if (!buffer) return;
    const thresholdDb = measureThresholdDb(buffer, range.start, range.end);
    setSample({ start: range.start, end: range.end, thresholdDb });
    region.setOptions({ start: 0, end: duration });
    setRange({ start: 0, end: duration });
  };

  const process = () => {
    if (!file) return;
    const form = new FormData();
    form.append('mode', mode);
    if (waveReady && range) {
      form.append('start', range.start.toFixed(3));
      form.append('end', range.end.toFixed(3));
    }
    if (mode !== 'off' && sample) form.append('noiseDb', String(sample.thresholdDb));
    form.append('file', file);
    void runner.start('/api/audio/cut-silence', form);
  };

  const nothingToDo = mode === 'off' && !trimmed;

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
            <div className="flex items-center justify-between gap-2 text-sm text-zinc-300">
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={togglePlay}>
                  {playing ? t('pause') : t('playSelection')}
                </Button>
                {mode !== 'off' && (
                  <Button variant="secondary" onClick={markSample} disabled={busy}>
                    {t('sampleButton')}
                  </Button>
                )}
              </div>
              <span className="shrink-0">
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

          {mode !== 'off' && (
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                {t('thresholdTitle')}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSample(null)}
                  disabled={busy}
                  className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    !sample
                      ? 'border-accent text-accent'
                      : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                  }`}
                >
                  {t('thresholdAuto')}
                </button>
                {sample && (
                  <span className="inline-flex items-center gap-2 rounded-md border border-accent px-3 py-1.5 text-sm text-accent">
                    {t('thresholdSample', {
                      from: formatDuration(Math.floor(sample.start)),
                      to: formatDuration(Math.ceil(sample.end)),
                      db: sample.thresholdDb,
                    })}
                    <button
                      type="button"
                      onClick={() => setSample(null)}
                      disabled={busy}
                      className="cursor-pointer text-accent/70 hover:text-accent"
                      aria-label={t('sampleClear')}
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
              {!sample && <p className="mt-2 text-xs text-zinc-500">{t('sampleHint')}</p>}
            </div>
          )}

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
