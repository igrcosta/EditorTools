import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { TRACK_ZOOM_MAX, TRACK_ZOOM_MIN, type TrackAspect } from '@editools/shared';

interface Props {
  videoUrl: string;
  aspect: TrackAspect;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  label: string;
  disabled?: boolean;
}

const TARGET_RATIO: Record<TrackAspect, number> = { '9:16': 9 / 16, '16:9': 16 / 9 };

/** Largest box of `targetRatio` that fits `w`×`h`, shrunk by `zoom` — mirrors the server's own cropWindow math. */
function cropBox(w: number, h: number, targetRatio: number, zoom: number) {
  let boxW: number;
  let boxH: number;
  if (targetRatio <= w / h) {
    boxH = h;
    boxW = h * targetRatio;
  } else {
    boxW = w;
    boxH = w / targetRatio;
  }
  return { w: boxW / zoom, h: boxH / zoom };
}

/**
 * Video preview with a visual stand-in for the crop the job will produce: drag
 * (mouse, touch, or arrow keys via the underlying range input) — closer to the
 * frame's center is tighter zoom, closer to the edge is looser. Purely a
 * preview: the real per-frame crop position is decided at render time by
 * wherever the detected face actually is.
 */
export function ZoomFrame({ videoUrl, aspect, zoom, onZoomChange, label, disabled }: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState({ w: 16, h: 9 });
  const dragging = useRef(false);

  const targetRatio = TARGET_RATIO[aspect];
  const box = cropBox(frameSize.w, frameSize.h, targetRatio, zoom);

  const zoomFromPointer = (clientY: number): number => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return zoom;
    const centerY = rect.top + rect.height / 2;
    const distFraction = Math.min(1, Math.abs(clientY - centerY) / (rect.height / 2));
    // Center of the frame = tightest zoom; the frame's edge = loosest (no crop beyond the target aspect).
    return TRACK_ZOOM_MAX - distFraction * (TRACK_ZOOM_MAX - TRACK_ZOOM_MIN);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onZoomChange(zoomFromPointer(e.clientY));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    onZoomChange(zoomFromPointer(e.clientY));
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  return (
    <div className="space-y-2">
      <div
        ref={frameRef}
        className="relative mx-auto max-h-80 overflow-hidden rounded-md border-2 border-accent/50 bg-black select-none"
        style={{ aspectRatio: `${frameSize.w} / ${frameSize.h}` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video
          src={videoUrl}
          muted
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth && v.videoHeight) setFrameSize({ w: v.videoWidth, h: v.videoHeight });
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-sm border-2 border-accent shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
          style={{
            width: `${(box.w / frameSize.w) * 100}%`,
            height: `${(box.h / frameSize.h) * 100}%`,
            left: `${50 - (box.w / frameSize.w) * 50}%`,
            top: `${50 - (box.h / frameSize.h) * 50}%`,
          }}
        />
        <input
          type="range"
          min={TRACK_ZOOM_MIN}
          max={TRACK_ZOOM_MAX}
          step={0.01}
          value={zoom}
          disabled={disabled}
          onChange={(e) => onZoomChange(Number(e.target.value))}
          aria-label={label}
          className="absolute inset-0 h-full w-full cursor-ns-resize opacity-0 disabled:cursor-not-allowed"
        />
      </div>
      <p className="text-center text-xs text-zinc-500">
        {label} · {zoom.toFixed(1)}×
      </p>
    </div>
  );
}
