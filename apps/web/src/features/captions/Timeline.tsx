import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { CaptionWord } from '@editools/shared';

interface Props {
  videoEl: HTMLVideoElement | null;
  currentTime: number;
  duration: number;
  playing: boolean;
  /** Video's own frame rate — drives arrow-key frame stepping. */
  fps: number;
  words: CaptionWord[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onUpdateWord: (index: number, patch: Partial<CaptionWord>) => void;
  disabled?: boolean;
  playLabel: string;
  pauseLabel: string;
  muteLabel: string;
  unmuteLabel: string;
  zoomInLabel: string;
  zoomOutLabel: string;
}

const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 300;
const DEFAULT_PX_PER_SEC = 60;
const MIN_WORD_DURATION = 0.08;
const TICK_INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = (s % 60).toFixed(1).padStart(4, '0');
  return `${m}:${rest}`;
}

function tickInterval(pxPerSec: number): number {
  return TICK_INTERVALS.find((i) => i * pxPerSec >= 70) ?? TICK_INTERVALS[TICK_INTERVALS.length - 1];
}

type DragMode = 'move' | 'resize-start' | 'resize-end';
interface DragState {
  index: number;
  mode: DragMode;
  startClientX: number;
  origStart: number;
  origEnd: number;
}

/**
 * Scrubbable word timeline, subvid.app-style: play the clip, zoom the ruler, drag a word's
 * edges to retime it or its body to shift it, click a word to select + seek. Drives the SAME
 * <video> element the stage above renders — there's exactly one player, so what plays here is
 * what you see there, never a second, unsynced preview.
 */
export function Timeline({
  videoEl,
  currentTime,
  duration,
  playing,
  fps,
  words,
  selectedIndex,
  onSelect,
  onUpdateWord,
  disabled,
  playLabel,
  pauseLabel,
  muteLabel,
  unmuteLabel,
  zoomInLabel,
  zoomOutLabel,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const scrubbing = useRef(false);
  const wasPlayingBeforeScrub = useRef(false);

  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (videoEl) videoEl.muted = muted;
  }, [videoEl, muted]);

  // Keep the playhead in view while the clip plays, without fighting manual scrubbing.
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
    if (!videoEl) return;
    videoEl.currentTime = Math.min(duration, Math.max(0, seconds));
  };

  const togglePlay = () => {
    if (!videoEl || disabled) return;
    if (videoEl.paused) void videoEl.play();
    else videoEl.pause();
  };

  // Spacebar plays/pauses and the arrow keys step one frame at a time, same as Premiere — but not
  // while the user is typing (a word's text, its start/end, a template name) since those keys
  // need to reach the text field instead (moving the cursor, or a space character).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (disabled || !videoEl) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        videoEl.pause();
        const frame = 1 / fps;
        seekTo(videoEl.currentTime + (e.code === 'ArrowLeft' ? -frame : frame));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [videoEl, disabled, fps]);

  const zoom = (factor: number) => {
    setPxPerSec((prev) => Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, Math.round(prev * factor))));
  };

  const clientXToSeconds = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return (clientX - rect.left) / pxPerSec;
  };

  const onTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || dragRef.current || !videoEl) return;
    scrubbing.current = true;
    wasPlayingBeforeScrub.current = !videoEl.paused;
    videoEl.pause();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekTo(clientXToSeconds(e.clientX));
  };

  const onTrackPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrubbing.current || disabled) return;
    seekTo(clientXToSeconds(e.clientX));
  };

  const onTrackPointerUp = () => {
    if (scrubbing.current && wasPlayingBeforeScrub.current) void videoEl?.play();
    scrubbing.current = false;
  };

  const onWordPointerDown = (e: ReactPointerEvent<Element>, index: number, mode: DragMode) => {
    if (disabled) return;
    e.stopPropagation();
    onSelect(index);
    seekTo(words[index].start);
    dragRef.current = { index, mode, startClientX: e.clientX, origStart: words[index].start, origEnd: words[index].end };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onWordPointerMove = (e: ReactPointerEvent<Element>) => {
    const drag = dragRef.current;
    if (!drag || disabled) return;
    const deltaSec = (e.clientX - drag.startClientX) / pxPerSec;
    if (drag.mode === 'resize-start') {
      const start = Math.min(drag.origEnd - MIN_WORD_DURATION, Math.max(0, drag.origStart + deltaSec));
      onUpdateWord(drag.index, { start });
    } else if (drag.mode === 'resize-end') {
      const end = Math.max(drag.origStart + MIN_WORD_DURATION, Math.min(duration || Infinity, drag.origEnd + deltaSec));
      onUpdateWord(drag.index, { end });
    } else {
      const span = drag.origEnd - drag.origStart;
      const start = Math.min(Math.max(0, duration - span), Math.max(0, drag.origStart + deltaSec));
      onUpdateWord(drag.index, { start, end: start + span });
    }
  };

  const onWordPointerUp = () => {
    dragRef.current = null;
  };

  const trackWidth = Math.max(1, duration * pxPerSec);
  const interval = tickInterval(pxPerSec);
  const tickCount = duration > 0 ? Math.ceil(duration / interval) + 1 : 0;

  return (
    <div className="min-w-0 space-y-2 rounded-md border border-white/10 p-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={togglePlay}
          disabled={disabled || !videoEl}
          aria-label={playing ? pauseLabel : playLabel}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-zinc-200 hover:border-accent/50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className={playing ? 'fi-rr-pause' : 'fi-rr-play'} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          disabled={disabled || !videoEl}
          aria-label={muted ? unmuteLabel : muteLabel}
          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/15 text-zinc-400 hover:border-accent/50 hover:text-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <i className={muted ? 'fi-rr-volume-mute' : 'fi-rr-volume'} aria-hidden="true" />
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

          <div className="relative h-11 cursor-text">
            {words.map((word, i) => {
              const left = word.start * pxPerSec;
              const width = Math.max(6, (word.end - word.start) * pxPerSec);
              const selected = selectedIndex === i;
              return (
                <div
                  key={i}
                  onPointerDown={(e) => onWordPointerDown(e, i, 'move')}
                  onPointerMove={onWordPointerMove}
                  onPointerUp={onWordPointerUp}
                  onPointerCancel={onWordPointerUp}
                  title={word.text}
                  className={`absolute top-1 flex h-9 cursor-grab items-center overflow-hidden rounded border px-1.5 text-xs text-white select-none active:cursor-grabbing ${
                    selected ? 'border-accent bg-accent/40' : 'border-white/20 bg-white/10 hover:bg-white/15'
                  }`}
                  style={{ left, width }}
                >
                  <span
                    onPointerDown={(e) => onWordPointerDown(e, i, 'resize-start')}
                    onPointerMove={onWordPointerMove}
                    onPointerUp={onWordPointerUp}
                    onPointerCancel={onWordPointerUp}
                    className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize"
                  />
                  <span className="truncate">{word.text}</span>
                  <span
                    onPointerDown={(e) => onWordPointerDown(e, i, 'resize-end')}
                    onPointerMove={onWordPointerMove}
                    onPointerUp={onWordPointerUp}
                    onPointerCancel={onWordPointerUp}
                    className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize"
                  />
                </div>
              );
            })}
          </div>

          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 w-px bg-accent"
            style={{ left: currentTime * pxPerSec }}
          >
            <div className="absolute -top-0.5 -left-1 h-2 w-2 rounded-full bg-accent" />
          </div>
        </div>
      </div>
    </div>
  );
}
