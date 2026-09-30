import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ThumbnailFrame, TimelineSegment, WaveformPeaks } from '@editools/shared';

interface Props {
  mediaEl: HTMLMediaElement | null;
  currentTime: number;
  duration: number;
  playing: boolean;
  peaks: WaveformPeaks | null;
  thumbnails: ThumbnailFrame[];
  /** Kept (audible) ranges — sorted, non-overlapping. Everything else is cut. */
  segments: TimelineSegment[];
  onChangeSegments: (segments: TimelineSegment[]) => void;
  disabled?: boolean;
  playLabel: string;
  pauseLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  keptHint: string;
  cutHint: string;
}

const MIN_PX_PER_SEC = 5;
const MAX_PX_PER_SEC = 300;
const MIN_SEGMENT_DURATION = 0.2;
const SPLIT_GAP_SECONDS = 0.3;
const TICK_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const TILE_WIDTH_PX = 4000;
const WAVEFORM_HEIGHT = 56;
const THUMBNAIL_HEIGHT = 56;

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

function tickInterval(pxPerSec: number): number {
  return TICK_INTERVALS.find((i) => i * pxPerSec >= 70) ?? TICK_INTERVALS[TICK_INTERVALS.length - 1];
}

/** One tile draws its own [timeStart, timeEnd) slice of the peaks array. Canvases have a hard
 *  max width in every browser (commonly ~32k px) — a single canvas spanning a long, zoomed-in
 *  timeline would silently fail to render, so the waveform is tiled into fixed-width chunks. */
function WaveformTile({
  peaks,
  timeStart,
  timeEnd,
  pxPerSec,
}: {
  peaks: WaveformPeaks;
  timeStart: number;
  timeEnd: number;
  pxPerSec: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const width = Math.max(1, Math.round((timeEnd - timeStart) * pxPerSec));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(WAVEFORM_HEIGHT * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, WAVEFORM_HEIGHT);
    if (peaks.bucketSeconds <= 0 || peaks.values.length === 0) return;

    const mid = WAVEFORM_HEIGHT / 2;
    const barWidth = Math.max(1, pxPerSec * peaks.bucketSeconds);
    const firstBucket = Math.max(0, Math.floor(timeStart / peaks.bucketSeconds) - 1);
    const lastBucket = Math.min(peaks.values.length / 2 - 1, Math.ceil(timeEnd / peaks.bucketSeconds) + 1);
    ctx.fillStyle = 'rgba(145, 70, 255, 0.6)';
    for (let b = firstBucket; b <= lastBucket; b += 1) {
      const t = b * peaks.bucketSeconds;
      const x = (t - timeStart) * pxPerSec;
      const min = peaks.values[b * 2] ?? 0;
      const max = peaks.values[b * 2 + 1] ?? 0;
      const yTop = mid - max * mid;
      const yBottom = mid - min * mid;
      ctx.fillRect(x, yTop, barWidth, Math.max(1, yBottom - yTop));
    }
  }, [peaks, timeStart, timeEnd, pxPerSec, width]);

  return <canvas ref={canvasRef} style={{ width, height: WAVEFORM_HEIGHT }} className="block" />;
}

function WaveformTrack({ peaks, pxPerSec, duration }: { peaks: WaveformPeaks; pxPerSec: number; duration: number }) {
  const tiles = useMemo(() => {
    const totalWidth = Math.max(1, duration * pxPerSec);
    const count = Math.ceil(totalWidth / TILE_WIDTH_PX);
    return Array.from({ length: count }, (_, i) => {
      const startPx = i * TILE_WIDTH_PX;
      const endPx = Math.min(totalWidth, startPx + TILE_WIDTH_PX);
      return { timeStart: startPx / pxPerSec, timeEnd: endPx / pxPerSec };
    });
  }, [duration, pxPerSec]);

  return (
    <div className="flex border-b border-white/10 bg-zinc-950/40" style={{ height: WAVEFORM_HEIGHT }}>
      {tiles.map((tile) => (
        <WaveformTile key={tile.timeStart} peaks={peaks} timeStart={tile.timeStart} timeEnd={tile.timeEnd} pxPerSec={pxPerSec} />
      ))}
    </div>
  );
}

function ThumbnailTrack({
  thumbnails,
  pxPerSec,
  duration,
}: {
  thumbnails: ThumbnailFrame[];
  pxPerSec: number;
  duration: number;
}) {
  return (
    <div className="relative overflow-hidden border-b border-white/10 bg-black/40" style={{ height: THUMBNAIL_HEIGHT }}>
      {thumbnails.map((thumb, i) => {
        const next = thumbnails[i + 1]?.at ?? duration;
        const width = Math.max(1, (next - thumb.at) * pxPerSec);
        return (
          <img
            key={thumb.at}
            src={thumb.dataUrl}
            alt=""
            draggable={false}
            className="absolute top-0 h-full select-none object-cover"
            style={{ left: thumb.at * pxPerSec, width }}
          />
        );
      })}
    </div>
  );
}

type EdgeMode = 'start' | 'end';
interface DragState {
  index: number;
  mode: EdgeMode;
  startClientX: number;
  origStart: number;
  origEnd: number;
  /** Boundaries this edge can't cross — the neighbouring segment, or the clip's own ends. */
  lowerBound: number;
  upperBound: number;
}

interface Gap {
  start: number;
  end: number;
  /** Index into `segments` of the kept range right before this gap, or null at the very start. */
  before: number | null;
  /** Index into `segments` of the kept range right after this gap, or null at the very end. */
  after: number | null;
}

/** Complement of `segments` over [0, duration] — the cut ranges shown between/around the kept ones. */
function gapsOf(segments: TimelineSegment[], duration: number): Gap[] {
  const gaps: Gap[] = [];
  let cursor = 0;
  segments.forEach((s, i) => {
    if (s.start - cursor > 0.02) gaps.push({ start: cursor, end: s.start, before: i === 0 ? null : i - 1, after: i });
    cursor = s.end;
  });
  if (duration - cursor > 0.02) {
    gaps.push({ start: cursor, end: duration, before: segments.length === 0 ? null : segments.length - 1, after: null });
  }
  return gaps;
}

/**
 * Editable kept/cut timeline: a zoomable waveform + thumbnail filmstrip with the kept ranges
 * drawn on top. Drag a kept range's edge to adjust it, click a cut (dimmed) gap to restore it,
 * double-click inside a kept range to cut a new gap there — the same handful of interactions
 * serve both "trim an auto-detected silence" and "manually cut part of the video."
 */
export function SegmentTimeline({
  mediaEl,
  currentTime,
  duration,
  playing,
  peaks,
  thumbnails,
  segments,
  onChangeSegments,
  disabled,
  playLabel,
  pauseLabel,
  zoomInLabel,
  zoomOutLabel,
  keptHint,
  cutHint,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubbing = useRef(false);
  const wasPlayingBeforeScrub = useRef(false);
  const zoomInitialized = useRef(false);

  const [pxPerSec, setPxPerSec] = useState(MIN_PX_PER_SEC);

  // Pick a starting zoom that fits the whole clip in roughly one screen, once duration is known.
  useEffect(() => {
    if (zoomInitialized.current || duration <= 0) return;
    zoomInitialized.current = true;
    const fit = (scrollRef.current?.clientWidth || 800) / duration;
    setPxPerSec(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, Math.round(fit))));
  }, [duration]);

  useEffect(() => {
    if (!playing) return;
    const scroller = scrollRef.current;
    if (!scroller) return;
    const x = currentTime * pxPerSec;
    if (x < scroller.scrollLeft || x > scroller.scrollLeft + scroller.clientWidth - 40) {
      scroller.scrollLeft = Math.max(0, x - scroller.clientWidth / 3);
    }
  }, [currentTime, pxPerSec, playing]);

  const seekTo = (seconds: number) => {
    if (!mediaEl) return;
    mediaEl.currentTime = Math.min(duration, Math.max(0, seconds));
  };

  const togglePlay = () => {
    if (!mediaEl || disabled) return;
    if (mediaEl.paused) void mediaEl.play();
    else mediaEl.pause();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabled || !mediaEl) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaEl, disabled]);

  const zoom = (factor: number) => {
    setPxPerSec((prev) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, Math.round(prev * factor))));
  };

  const clientXToSeconds = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(duration, Math.max(0, (clientX - rect.left) / pxPerSec));
  };

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || dragRef.current || !mediaEl) return;
    scrubbing.current = true;
    wasPlayingBeforeScrub.current = !mediaEl.paused;
    mediaEl.pause();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekTo(clientXToSeconds(e.clientX));
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current || disabled) return;
    seekTo(clientXToSeconds(e.clientX));
  };

  const onTrackPointerUp = () => {
    if (scrubbing.current && wasPlayingBeforeScrub.current) void mediaEl?.play();
    scrubbing.current = false;
  };

  const onEdgePointerDown = (e: ReactPointerEvent<Element>, index: number, mode: EdgeMode) => {
    if (disabled) return;
    e.stopPropagation();
    const seg = segments[index];
    const lowerBound = index > 0 ? segments[index - 1].end : 0;
    const upperBound = index < segments.length - 1 ? segments[index + 1].start : duration;
    dragRef.current = { index, mode, startClientX: e.clientX, origStart: seg.start, origEnd: seg.end, lowerBound, upperBound };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onEdgePointerMove = (e: ReactPointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || disabled) return;
    const deltaSec = (e.clientX - drag.startClientX) / pxPerSec;
    const next = segments.slice();
    if (drag.mode === 'start') {
      const start = Math.min(drag.origEnd - MIN_SEGMENT_DURATION, Math.max(drag.lowerBound, drag.origStart + deltaSec));
      next[drag.index] = { start, end: drag.origEnd };
    } else {
      const end = Math.max(drag.origStart + MIN_SEGMENT_DURATION, Math.min(drag.upperBound, drag.origEnd + deltaSec));
      next[drag.index] = { start: drag.origStart, end };
    }
    onChangeSegments(next);
  };

  const onEdgePointerUp = () => {
    dragRef.current = null;
  };

  const restoreGap = (gap: Gap) => {
    if (disabled) return;
    if (gap.before !== null && gap.after !== null) {
      const next = segments.slice();
      next[gap.before] = { start: segments[gap.before].start, end: segments[gap.after].end };
      next.splice(gap.after, 1);
      onChangeSegments(next);
    } else if (gap.after !== null) {
      const next = segments.slice();
      next[gap.after] = { start: 0, end: segments[gap.after].end };
      onChangeSegments(next);
    } else if (gap.before !== null) {
      const next = segments.slice();
      next[gap.before] = { start: segments[gap.before].start, end: duration };
      onChangeSegments(next);
    } else {
      onChangeSegments([{ start: 0, end: duration }]);
    }
  };

  const splitSegment = (index: number, atTime: number) => {
    if (disabled) return;
    const seg = segments[index];
    const half = SPLIT_GAP_SECONDS / 2;
    const cutStart = atTime - half;
    const cutEnd = atTime + half;
    if (cutStart - seg.start < MIN_SEGMENT_DURATION || seg.end - cutEnd < MIN_SEGMENT_DURATION) return;
    const next = segments.slice();
    next.splice(index, 1, { start: seg.start, end: cutStart }, { start: cutEnd, end: seg.end });
    onChangeSegments(next);
  };

  const trackWidth = Math.max(1, duration * pxPerSec);
  const interval = tickInterval(pxPerSec);
  const tickCount = duration > 0 ? Math.ceil(duration / interval) + 1 : 0;
  const gaps = useMemo(() => gapsOf(segments, duration), [segments, duration]);
  const contentHeight = (peaks ? WAVEFORM_HEIGHT : 0) + (thumbnails.length > 0 ? THUMBNAIL_HEIGHT : 0);

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-white/10 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={disabled || !mediaEl}
          aria-label={playing ? pauseLabel : playLabel}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-zinc-200 hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className={playing ? 'fi-rr-pause' : 'fi-rr-play'} aria-hidden="true" />
        </button>
        <span className="font-mono text-xs text-zinc-400 tabular-nums">
          {formatClock(currentTime)} / {formatClock(duration)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoom(1 / 1.4)}
            disabled={disabled || pxPerSec <= MIN_PX_PER_SEC}
            aria-label={zoomOutLabel}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-white/15 text-zinc-400 hover:border-accent/50 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="fi-rr-zoom-out text-xs" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => zoom(1.4)}
            disabled={disabled || pxPerSec >= MAX_PX_PER_SEC}
            aria-label={zoomInLabel}
            className="flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-white/15 text-zinc-400 hover:border-accent/50 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <i className="fi-rr-zoom-in text-xs" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-w-0 touch-none overflow-x-auto overflow-y-hidden rounded border border-white/10 bg-zinc-900/60">
        <div
          ref={trackRef}
          className="relative select-none"
          style={{ width: trackWidth, minWidth: '100%' }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
          onPointerCancel={onTrackPointerUp}
        >
          <div className="relative h-5 border-b border-white/10">
            {Array.from({ length: tickCount }, (_, i) => i * interval).map((t) => (
              <div key={t} className="absolute top-0 h-full border-l border-white/10" style={{ left: t * pxPerSec }}>
                <span className="ml-1 text-[10px] text-zinc-500 tabular-nums">{formatClock(t)}</span>
              </div>
            ))}
          </div>

          <div className="relative" style={{ height: contentHeight || WAVEFORM_HEIGHT }}>
            {thumbnails.length > 0 && <ThumbnailTrack thumbnails={thumbnails} pxPerSec={pxPerSec} duration={duration} />}
            {peaks && peaks.values.length > 0 && <WaveformTrack peaks={peaks} pxPerSec={pxPerSec} duration={duration} />}

            {/* Segment overlay: cut (dimmed, click to restore) and kept (accent border, drag edges / double-click to cut). */}
            <div className="pointer-events-none absolute inset-0">
              {gaps.map((gap) => (
                <div
                  key={`gap-${gap.start}`}
                  title={cutHint}
                  onClick={() => restoreGap(gap)}
                  className="pointer-events-auto absolute inset-y-0 cursor-pointer bg-black/60 [background-image:repeating-linear-gradient(135deg,rgba(255,255,255,0.06)_0_6px,transparent_6px_12px)] hover:bg-black/45"
                  style={{ left: gap.start * pxPerSec, width: Math.max(1, (gap.end - gap.start) * pxPerSec) }}
                />
              ))}
              {segments.map((seg, i) => (
                <div
                  key={`seg-${seg.start}`}
                  title={keptHint}
                  onDoubleClick={(e) => {
                    const rect = trackRef.current?.getBoundingClientRect();
                    if (!rect) return;
                    splitSegment(i, (e.clientX - rect.left) / pxPerSec);
                  }}
                  className="pointer-events-auto absolute inset-y-0 cursor-text border-y-2 border-accent/70"
                  style={{ left: seg.start * pxPerSec, width: Math.max(1, (seg.end - seg.start) * pxPerSec) }}
                >
                  <div
                    onPointerDown={(e) => onEdgePointerDown(e, i, 'start')}
                    onPointerMove={onEdgePointerMove}
                    onPointerUp={onEdgePointerUp}
                    onPointerCancel={onEdgePointerUp}
                    className="pointer-events-auto absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-accent/80"
                  />
                  <div
                    onPointerDown={(e) => onEdgePointerDown(e, i, 'end')}
                    onPointerMove={onEdgePointerMove}
                    onPointerUp={onEdgePointerUp}
                    onPointerCancel={onEdgePointerUp}
                    className="pointer-events-auto absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-accent/80"
                  />
                </div>
              ))}
            </div>
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-white"
            style={{ left: currentTime * pxPerSec, height: 20 + (contentHeight || WAVEFORM_HEIGHT) }}
          >
            <div className="absolute -top-0.5 -left-1 h-2 w-2 rounded-full bg-white" />
          </div>
        </div>
      </div>
    </div>
  );
}
