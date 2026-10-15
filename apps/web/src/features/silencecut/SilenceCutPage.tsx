import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SilenceMode, TimelineAnalysis, TimelineSegment } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Dropzone } from '../../components/Dropzone';
import { ErrorMessage } from '../../components/ErrorMessage';
import { JobStatus } from '../../components/JobStatus';
import { PageHeader } from '../../components/PageHeader';
import { Spinner } from '../../components/Spinner';
import { api } from '../../lib/api';
import { formatBytes, formatDuration } from '../../lib/format';
import { useJobRunner } from '../../lib/useJobRunner';
import { useObjectUrl } from '../../lib/useObjectUrl';
import { useVideoPlayback } from '../../lib/useVideoPlayback';
import { SegmentTimeline } from './SegmentTimeline';

const MODES: SilenceMode[] = ['off', 'gentle', 'balanced', 'aggressive'];
const MAX_HISTORY = 50;

export function SilenceCutPage({ embedded = false }: { embedded?: boolean }) {
  const { t } = useTranslation('silencecut');
  const analyzeRunner = useJobRunner({ autoSave: false });
  const cutRunner = useJobRunner({ autoSave: false });

  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<SilenceMode>('balanced');
  const [analysis, setAnalysis] = useState<TimelineAnalysis | null>(null);
  const [segments, setSegments] = useState<TimelineSegment[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sampleDb, setSampleDb] = useState<number | null>(null);
  const [sampleRange, setSampleRange] = useState<TimelineSegment | null>(null);
  const [selectingSample, setSelectingSample] = useState(false);
  const [skipCuts, setSkipCuts] = useState(true);
  const [history, setHistory] = useState<TimelineSegment[][]>([]);

  const localUrl = useObjectUrl(file);
  const { videoRef, videoEl, currentTime, duration, playing } = useVideoPlayback();

  const analyzing = analyzeRunner.starting || analyzeRunner.jobActive || parsing;
  const cutBusy = cutRunner.starting || cutRunner.jobActive;
  const meta = cutRunner.job?.status === 'done' ? cutRunner.job.meta : undefined;

  const startAnalyze = (forFile: File, opts?: { mode?: SilenceMode; sample?: TimelineSegment | null }) => {
    // Re-detecting replaces the cuts; keep the previous ones one Undo away.
    if (segments) setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), segments]);
    setAnalysis(null);
    setSegments(null);
    if (!opts?.sample) setSampleDb(null);
    const form = new FormData();
    form.append('mode', opts?.mode ?? mode);
    if (opts?.sample) form.append('sample', JSON.stringify(opts.sample));
    form.append('file', forFile);
    void analyzeRunner.start('/api/audio/timeline/analyze', form);
  };

  // On drop only the waveform loads (mode 'off'): nothing is cut until the editor picks a silence sample / mode.
  useEffect(() => {
    if (!file) return;
    startAnalyze(file, { mode: 'off' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // The analyze job's "file" is analysis.json, not media — pull it in once the job finishes.
  useEffect(() => {
    const job = analyzeRunner.job;
    if (job?.status !== 'done') return;
    let active = true;
    setParsing(true);
    void api
      .jobResult<TimelineAnalysis>(job.id)
      .then((result) => {
        if (!active) return;
        setAnalysis(result);
        setSegments(result.kept);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setParsing(false);
      });
    return () => {
      active = false;
    };
  }, [analyzeRunner.job]);

  const resetEditing = () => {
    setAnalysis(null);
    setSegments(null);
    setSampleDb(null);
    setSampleRange(null);
    setSelectingSample(false);
    setHistory([]);
    analyzeRunner.reset();
    cutRunner.reset();
  };

  const onFile = (f: File) => {
    resetEditing();
    setFile(f);
    setMode('balanced');
  };

  const onChangeFile = () => {
    resetEditing();
    setFile(null);
  };

  const detect = () => {
    if (!file) return;
    setSelectingSample(false);
    startAnalyze(file, { sample: sampleRange });
  };

  const snapshot = () => {
    if (segments) setHistory((h) => [...h.slice(-(MAX_HISTORY - 1)), segments]);
  };

  const undo = () => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setSegments(prev);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (analysis?.noiseDb !== undefined) setSampleDb(analysis.noiseDb);
  }, [analysis]);

  const process = () => {
    if (!file || !segments) return;
    const form = new FormData();
    form.append('segments', JSON.stringify(segments));
    form.append('file', file);
    void cutRunner.start('/api/audio/timeline/cut', form);
  };

  const keptTotal = segments?.reduce((sum, s) => sum + (s.end - s.start), 0) ?? 0;
  const nothingToDo =
    !segments || (segments.length === 1 && segments[0].start <= 0.05 && duration - segments[0].end <= 0.05);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {!embedded && <PageHeader title={t('title')} description={t('description')} />}

      {!file && <Dropzone label={t('dropLabel')} hint={t('dropHint')} accept="audio/*,video/*" onFile={onFile} />}

      {analyzeRunner.errorCode && (
        <ErrorMessage>{t(`downloader:errors.${analyzeRunner.errorCode}`, t('downloader:errors.download_failed'))}</ErrorMessage>
      )}

      {file && (
        <Card className="space-y-4 divide-y divide-white/10">
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 truncate text-sm text-zinc-300">
              {file.name} <span className="text-zinc-500">· {formatBytes(file.size)}</span>
            </p>
            <button
              type="button"
              onClick={onChangeFile}
              disabled={cutBusy}
              className="shrink-0 cursor-pointer text-sm text-zinc-400 hover:text-zinc-200"
            >
              {t('changeFile')}
            </button>
          </div>

          {localUrl &&
            (analysis?.hasVideo !== false ? (
              <video ref={videoRef} src={localUrl} className="hidden" preload="metadata" />
            ) : (
              <audio ref={videoRef} src={localUrl} className="hidden" preload="metadata" />
            ))}

          {analyzing && (
            <div className="flex items-center gap-2 py-6 text-sm text-zinc-400">
              <Spinner /> {t('loadingWave')}
            </div>
          )}

          {!analyzing && analysis && segments && (
            <div className="space-y-3 pt-4">
              <SegmentTimeline
                mediaEl={videoEl}
                currentTime={currentTime}
                duration={analysis.duration}
                playing={playing}
                peaks={analysis.peaks}
                thumbnails={analysis.thumbnails}
                segments={segments}
                onChangeSegments={setSegments}
                onEditStart={snapshot}
                sampleRange={sampleRange}
                selectingSample={selectingSample}
                onSampleRange={setSampleRange}
                skipCuts={skipCuts}
                disabled={cutBusy}
                playLabel={t('timeline.play')}
                pauseLabel={t('timeline.pause')}
                zoomInLabel={t('timeline.zoomIn')}
                zoomOutLabel={t('timeline.zoomOut')}
                keptHint={t('timeline.keptHint')}
                cutHint={t('timeline.cutHint')}
              />
              <p className="text-xs text-zinc-500">{t('timelineHint')}</p>

              <div className="flex items-center justify-between gap-2 text-sm text-zinc-300">
                <span>
                  {formatDuration(Math.round(keptTotal))} {t('selected')}{' '}
                  <span className="text-zinc-500">
                    · {t('removedSoFar', { time: formatDuration(Math.max(0, Math.round(analysis.duration - keptTotal))) })}
                  </span>
                </span>
              </div>
            </div>
          )}

          {analysis && (
            <div className="pt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('modeTitle')}</p>
              <div className="flex flex-wrap gap-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    disabled={cutBusy || analyzing}
                    className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      mode === m
                        ? 'border-accent text-accent-text'
                        : 'border-white/10 text-zinc-400 hover:border-white/25'
                    }`}
                  >
                    {t(`mode.${m}`)}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-zinc-500">{t(`modeHint.${mode}`)}</p>

              {analysis.hasAudio && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setSelectingSample((s) => !s)}
                      disabled={cutBusy || analyzing}
                    >
                      {selectingSample ? t('sampleDone') : t('sampleButton')}
                    </Button>
                    {sampleRange && (
                      <button
                        type="button"
                        onClick={() => setSampleRange(null)}
                        disabled={cutBusy || analyzing}
                        className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200"
                      >
                        {t('sampleClear')}
                      </button>
                    )}
                    <Button onClick={detect} disabled={cutBusy || analyzing || mode === 'off'}>
                      {t('detect')}
                    </Button>
                    <Button variant="secondary" onClick={undo} disabled={cutBusy || analyzing || history.length === 0}>
                      {t('undo')}
                    </Button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    {selectingSample
                      ? t('sampleSelecting')
                      : sampleRange
                        ? t('sampleRange', {
                            start: formatDuration(Math.round(sampleRange.start)),
                            end: formatDuration(Math.round(sampleRange.end)),
                          })
                        : t('sampleNone')}
                    {sampleDb !== null && sampleRange && ` · ${t('thresholdSample', { db: sampleDb })}`}
                  </p>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" checked={skipCuts} onChange={(e) => setSkipCuts(e.target.checked)} />
                    {t('skipCuts')}
                  </label>
                </div>
              )}
              {!analysis.hasAudio && <p className="mt-2 text-xs text-zinc-500">{t('noAudioHint')}</p>}
            </div>
          )}

          {nothingToDo && analysis && <p className="text-sm text-zinc-500">{t('nothingToDo')}</p>}

          {analysis && !cutBusy && cutRunner.job?.status !== 'done' && (
            <div className="pt-4">
              <Button className="w-full" disabled={nothingToDo} onClick={process}>
                {t('process')}
              </Button>
            </div>
          )}
          {cutRunner.starting && (
            <div className="flex items-center gap-2 pt-4 text-sm text-zinc-400">
              <Spinner /> {t('uploading')}
            </div>
          )}

          {meta && (
            <p className="pt-4 text-sm text-zinc-300">
              {meta.silencesCut && meta.silencesCut > 0 && meta.removedSeconds !== undefined
                ? t('stats', { count: meta.silencesCut, time: formatDuration(meta.removedSeconds) })
                : t('nothingToCut')}
            </p>
          )}

          <JobStatus
            starting={false}
            job={cutRunner.job}
            onCancel={cutRunner.cancel}
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
