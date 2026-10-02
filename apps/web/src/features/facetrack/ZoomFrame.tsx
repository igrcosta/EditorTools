import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  TRACK_ANCHOR_MAX,
  TRACK_ANCHOR_MIN,
  TRACK_ANCHOR_X_DEFAULT,
  TRACK_ANCHOR_Y_DEFAULT,
  TRACK_ZOOM_DEFAULT,
  TRACK_ZOOM_MAX,
  TRACK_ZOOM_MIN,
  type TrackAspect,
} from '@editools/shared';

interface Props {
  videoUrl: string;
  aspect: TrackAspect;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  /** Where the tracked face sits inside the crop, 0–1 (see TRACK_ANCHOR_*). */
  anchorX: number;
  anchorY: number;
  onAnchorChange: (x: number, y: number) => void;
  labels: { zoom: string; boxHint: string; face: string; reset: string };
  disabled?: boolean;
}

const TARGET_RATIO: Record<TrackAspect, number> = { '9:16': 9 / 16, '16:9': 16 / 9 };
const MAX_FRAME_HEIGHT_PX = 340;
const KEY_STEP = 0.02;
const ZOOM_KEY_STEP = 0.1;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Largest box of `targetRatio` that fits `w`×`h` at zoom 1 — mirrors the server's own cropWindow math. */
function fullCrop(w: number, h: number, targetRatio: number) {
  return targetRatio <= w / h ? { w: h * targetRatio, h } : { w, h: w / targetRatio };
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'move'; startX: number; startY: number; left: number; top: number; boxW: number; boxH: number }
  | { kind: 'resize'; corner: Corner; anchorX: number; fullW: number };

const CORNER_STYLE: Record<Corner, string> = {
  nw: '-left-1.5 -top-1.5 cursor-nwse-resize',
  ne: '-right-1.5 -top-1.5 cursor-nesw-resize',
  sw: '-bottom-1.5 -left-1.5 cursor-nesw-resize',
  se: '-bottom-1.5 -right-1.5 cursor-nwse-resize',
};

/**
 * Video preview with the crop the job will produce, as a box you can handle directly:
 * drag the box to choose where the face sits in the final frame (it moves around the face marker,
 * which stands in for the face at the middle of the shot), drag a corner to zoom, or use the arrow
 * keys / zoom slider. The per-frame crop position still follows the real face at render time; this
 * only edits the framing around it.
 *
 * One input path only. An earlier version layered an invisible range input over the frame, whose
 * horizontal mapping fought the vertical one here and made the box jitter while dragging. A drag
 * now listens on `window` from pointer-down to pointer-up instead of relying on pointer capture:
 * resizing shrinks the box out from under the cursor, and without capture the later moves were
 * delivered to whatever sat underneath, so the zoom only updated every few moves.
 */
export function ZoomFrame({
  videoUrl,
  aspect,
  zoom,
  onZoomChange,
  anchorX,
  anchorY,
  onAnchorChange,
  labels,
  disabled,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  // The drag's window listeners outlive a render, so they call through this for the latest props.
  const latest = useRef({ onZoomChange, onAnchorChange });
  latest.current = { onZoomChange, onAnchorChange };
  const [frameSize, setFrameSize] = useState({ w: 16, h: 9 });

  useEffect(() => () => stopDrag.current?.(), []);

  const full = fullCrop(frameSize.w, frameSize.h, TARGET_RATIO[aspect]);
  // Box size and position as fractions of the frame. The face marker is the frame's centre.
  const boxW = full.w / zoom / frameSize.w;
  const boxH = full.h / zoom / frameSize.h;
  const left = clamp(0.5 - anchorX * boxW, 0, 1 - boxW);
  const top = clamp(0.5 - anchorY * boxH, 0, 1 - boxH);
  // What the box really shows once clamped to the frame (so the first drag never jumps).
  const effX = clamp((0.5 - left) / boxW, TRACK_ANCHOR_MIN, TRACK_ANCHOR_MAX);
  const effY = clamp((0.5 - top) / boxH, TRACK_ANCHOR_MIN, TRACK_ANCHOR_MAX);

  const setBox = (nextLeft: number, nextTop: number, size = { w: boxW, h: boxH }) => {
    const l = clamp(nextLeft, 0, 1 - size.w);
    const t = clamp(nextTop, 0, 1 - size.h);
    latest.current.onAnchorChange(
      clamp((0.5 - l) / size.w, TRACK_ANCHOR_MIN, TRACK_ANCHOR_MAX),
      clamp((0.5 - t) / size.h, TRACK_ANCHOR_MIN, TRACK_ANCHOR_MAX),
    );
  };

  const applyDrag = (d: Drag, clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    if (d.kind === 'move') {
      setBox(
        d.left + (clientX - d.startX) / rect.width,
        d.top + (clientY - d.startY) / rect.height,
        { w: d.boxW, h: d.boxH },
      );
      return;
    }
    // Resize around the face marker: the corner's distance from it, over the share of the box on that side.
    const px = (clientX - rect.left) / rect.width;
    const rightSide = d.corner === 'ne' || d.corner === 'se';
    const sideShare = rightSide ? 1 - d.anchorX : d.anchorX;
    const nextW = Math.max(Math.abs(px - 0.5) / sideShare, 0.001);
    latest.current.onZoomChange(clamp(d.fullW / nextW, TRACK_ZOOM_MIN, TRACK_ZOOM_MAX));
  };

  const beginDrag = (d: Drag) => {
    stopDrag.current?.();
    const onMove = (ev: PointerEvent) => applyDrag(d, ev.clientX, ev.clientY);
    const end = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      stopDrag.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    stopDrag.current = end;
    // Freeze the visible (clamped) placement as the anchor so nothing shifts on pick-up.
    latest.current.onAnchorChange(effX, effY);
  };

  const onBoxDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.focus();
    beginDrag({ kind: 'move', startX: e.clientX, startY: e.clientY, left, top, boxW, boxH });
  };

  const onCornerDown = (corner: Corner) => (e: ReactPointerEvent<HTMLSpanElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    beginDrag({ kind: 'resize', corner, anchorX: effX, fullW: full.w / frameSize.w });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const move = (dx: number, dy: number) => {
      e.preventDefault();
      setBox(left + dx, top + dy);
    };
    switch (e.key) {
      case 'ArrowLeft':
        return move(-KEY_STEP, 0);
      case 'ArrowRight':
        return move(KEY_STEP, 0);
      case 'ArrowUp':
        return move(0, -KEY_STEP);
      case 'ArrowDown':
        return move(0, KEY_STEP);
      case '+':
      case '=':
        e.preventDefault();
        return onZoomChange(clamp(zoom + ZOOM_KEY_STEP, TRACK_ZOOM_MIN, TRACK_ZOOM_MAX));
      case '-':
        e.preventDefault();
        return onZoomChange(clamp(zoom - ZOOM_KEY_STEP, TRACK_ZOOM_MIN, TRACK_ZOOM_MAX));
      default:
    }
  };

  const pct = (v: number) => `${v * 100}%`;

  return (
    <div className="space-y-3">
      <div
        ref={frameRef}
        className="relative mx-auto w-full touch-none overflow-hidden rounded-md border border-white/15 bg-black select-none"
        style={{
          aspectRatio: `${frameSize.w} / ${frameSize.h}`,
          // Cap the height without letting the container drift from the video's own proportions.
          maxWidth: `${(MAX_FRAME_HEIGHT_PX * frameSize.w) / frameSize.h}px`,
        }}
      >
        <video
          src={`${videoUrl}#t=0.1`}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setFrameSize({ w: v.videoWidth, h: v.videoHeight });
          }}
        />
        {/* The shot's centre: where the tracked face is assumed to be for this preview. */}
        <span
          aria-hidden
          className="pointer-events-none absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent shadow-[0_0_0_3px_rgba(0,0,0,0.5)]"
          style={{ left: '50%', top: '50%' }}
          title={labels.face}
        />
        <div
          role="group"
          tabIndex={disabled ? -1 : 0}
          aria-label={labels.boxHint}
          onPointerDown={onBoxDown}
          onKeyDown={onKeyDown}
          className={`absolute touch-none rounded-sm border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline-none focus-visible:ring-2 focus-visible:ring-accent-text ${
            disabled ? 'cursor-not-allowed' : 'cursor-move'
          }`}
          style={{ left: pct(left), top: pct(top), width: pct(boxW), height: pct(boxH) }}
        >
          {!disabled &&
            (Object.keys(CORNER_STYLE) as Corner[]).map((corner) => (
              <span
                key={corner}
                onPointerDown={onCornerDown(corner)}
                className={`absolute z-20 h-3.5 w-3.5 touch-none rounded-sm border-2 border-accent bg-zinc-950 ${CORNER_STYLE[corner]}`}
              />
            ))}
        </div>
      </div>

      <div className="mx-auto flex max-w-md items-center gap-3">
        <label htmlFor="track-zoom" className="shrink-0 text-xs font-medium tracking-wide text-zinc-500 uppercase">
          {labels.zoom}
        </label>
        <input
          id="track-zoom"
          type="range"
          min={TRACK_ZOOM_MIN}
          max={TRACK_ZOOM_MAX}
          step={0.01}
          value={zoom}
          disabled={disabled}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
        />
        <span className="w-10 shrink-0 text-right text-xs tabular-nums text-zinc-400">{zoom.toFixed(1)}×</span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onZoomChange(TRACK_ZOOM_DEFAULT);
            onAnchorChange(TRACK_ANCHOR_X_DEFAULT, TRACK_ANCHOR_Y_DEFAULT);
          }}
          className="shrink-0 cursor-pointer text-xs text-zinc-400 transition hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.reset}
        </button>
      </div>
    </div>
  );
}
