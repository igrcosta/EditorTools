import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { CAPTION_SCALE_MAX, CAPTION_SCALE_MIN } from '@editools/shared';

interface Props {
  videoUrl: string;
  positionX: number;
  positionY: number;
  scale: number;
  onPositionChange: (x: number, y: number) => void;
  onScaleChange: (scale: number) => void;
  sampleText: string;
  disabled?: boolean;
}

/**
 * Video preview with a draggable box standing in for the caption: drag it to
 * set where captions sit, resize with the "Size" slider. Position also has
 * plain range-input fallbacks below the frame for keyboard/screen-reader use.
 */
export function CaptionFrame({
  videoUrl,
  positionX,
  positionY,
  scale,
  onPositionChange,
  onScaleChange,
  sampleText,
  disabled,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const moveTo = (clientX: number, clientY: number) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    onPositionChange(x, y);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    moveTo(e.clientX, e.clientY);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current || disabled) return;
    moveTo(e.clientX, e.clientY);
  };

  const onPointerUp = () => {
    dragging.current = false;
  };

  // Purely a visual stand-in: a mock caption box, not the real render (that depends on the
  // chosen preset's own font/weight/outline, applied at render time).
  const boxWidth = 44 * scale;

  return (
    <div className="space-y-3">
      <div
        ref={frameRef}
        className="relative aspect-video w-full touch-none overflow-hidden rounded-md border border-white/10 bg-black select-none"
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
        />
        <div
          aria-hidden
          className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded border-2 border-dashed border-accent bg-black/40 px-2 py-1 text-center font-semibold text-white shadow-[0_0_0_9999px_rgba(0,0,0,0.15)]"
          style={{
            left: `${positionX * 100}%`,
            top: `${positionY * 100}%`,
            width: `${boxWidth}%`,
            fontSize: `${0.55 * scale}rem`,
          }}
        >
          {sampleText}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs text-zinc-500">
        <label className="space-y-1">
          <span className="block">Horizontal</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={positionX}
            disabled={disabled}
            onChange={(e) => onPositionChange(Number(e.target.value), positionY)}
            className="w-full accent-accent"
          />
        </label>
        <label className="space-y-1">
          <span className="block">Vertical</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={positionY}
            disabled={disabled}
            onChange={(e) => onPositionChange(positionX, Number(e.target.value))}
            className="w-full accent-accent"
          />
        </label>
        <label className="col-span-2 space-y-1">
          <span className="block">Size</span>
          <input
            type="range"
            min={CAPTION_SCALE_MIN}
            max={CAPTION_SCALE_MAX}
            step={0.05}
            value={scale}
            disabled={disabled}
            onChange={(e) => onScaleChange(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </label>
      </div>
    </div>
  );
}
