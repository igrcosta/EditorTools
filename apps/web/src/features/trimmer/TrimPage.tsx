import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin, { type Region } from 'wavesurfer.js/dist/plugins/regions.esm.js';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { Spinner } from '../../components/Spinner';
import { formatBytes, formatDuration } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';

export function TrimPage() {
  const { t } = useTranslation('trimmer');
  const runner = useJobRunner();

  const [file, setFile] = useState<File | null>(null);
  const [waveReady, setWaveReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [range, setRange] = useState<{ start: number; end: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionRef = useRef<Region | null>(null);

  const busy = runner.starting || runner.jobActive;

  useEffect(() => {
    if (!file || !containerRef.current) return;
    setWaveReady(false);
    setLoadError(false);
    setRange(null);
    const url = URL.createObjectURL(file);
    const ws = WaveSurfer.create({
      container: containerRef.current,
      url,
      height: 96,
      waveColor: '#3f3f46',
      progressColor: '#34d399',
      cursorColor: '#e4e4e7',
      normalize: true,
    });
    const regions = ws.registerPlugin(RegionsPlugin.create());
    // 'decode' fires as soon as the audio data is usable (duration known,
    // waveform drawn); 'ready' additionally waits for playback readiness and
    // can be delayed — unlock the UI on whichever comes first.
    const unlock = () => {
      if (regionRef.current) return;
      const duration = ws.getDuration();
      if (!duration) return;
      const region = regions.addRegion({
        start: 0,
        end: duration,
        color: 'rgba(52, 211, 153, 0.15)',
        drag: true,
        resize: true,
      });
      regionRef.current = region;
      setRange({ start: 0, end: duration });
      setWaveReady(true);
    };
    ws.on('decode', unlock);
    ws.on('ready', unlock);
    ws.on('error', () => {
      setWaveReady(false);
      setLoadError(true);
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

  const trim = () => {
    if (!file || !range) return;
    const form = new FormData();
    form.append('start', String(range.start.toFixed(3)));
    form.append('end', String(range.end.toFixed(3)));
    form.append('file', file);
    void runner.start('/api/audio/trim', form);
  };

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('description')}</p>
      </div>

      {!file && <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept="audio/*" onFile={onFile} />}

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
            {!waveReady && !loadError && (
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
          {!waveReady && !loadError && (
            <div className="flex items-center gap-2 text-sm text-zinc-400">
              <Spinner /> {t('loadingWave')}
            </div>
          )}
          {loadError && <ErrorMessage>{t('loadFailed')}</ErrorMessage>}

          {waveReady && range && (
            <>
              <p className="text-xs text-zinc-500">{t('dragHint')}</p>
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

              {!busy && runner.job?.status !== 'done' && (
                <Button className="w-full" onClick={trim}>
                  {t('trim')}
                </Button>
              )}
            </>
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
            doneActions={
              <Button variant="secondary" onClick={trim}>
                {t('trimAgain')}
              </Button>
            }
          />
        </Card>
      )}
    </div>
  );
}
