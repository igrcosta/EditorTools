import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { CAPTION_SCALE_MAX, CAPTION_SCALE_MIN } from '@editools/shared';
import { outlineShadow, withAlpha, type PreviewStyle } from './previewStyles';

interface Props {
  videoUrl: string;
  positionX: number;
  positionY: number;
  scale: number;
  onPositionChange: (x: number, y: number) => void;
  onScaleChange: (scale: number) => void;
  sampleText: string;
  previewStyle: PreviewStyle;
  disabled?: boolean;
}

/**
 * Video preview with the actual selected template rendered live on top — not a placeholder box.
 * Drag it to set where captions sit, resize with the "Size" slider. Position also has plain
 * range-input fallbacks below the frame for keyboard/screen-reader use. It's still a CSS
 * approximation of the real burned-in render (which is the .ass file libass draws), but it's the
 * chosen font/colors/outline/shadow/background/animation, not a generic stand-in.
 */
export function CaptionFrame({
  videoUrl,
  positionX,
  positionY,
  scale,
  onPositionChange,
  onScaleChange,
  sampleText,
  previewStyle: style,
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
          className="absolute max-w-[85%] -translate-x-1/2 -translate-y-1/2 cursor-move text-center leading-tight whitespace-pre-wrap outline-1 outline-dashed outline-white/30 outline-offset-4"
          style={{
            left: `${positionX * 100}%`,
            top: `${positionY * 100}%`,
            fontFamily: style.fontFamily,
            fontSize: `${0.85 * scale}rem`,
            fontWeight: style.weight,
            fontStyle: style.italic ? 'italic' : undefined,
            color: style.color,
            textShadow: style.outlineColor ? outlineShadow(style.outlineColor) : undefined,
            filter: style.shadow ? 'drop-shadow(2px 3px 2px rgba(0,0,0,0.7))' : undefined,
            backgroundColor: style.background ? withAlpha(style.background.color, style.background.opacity) : undefined,
            padding: style.background ? '0.2em 0.5em' : undefined,
            borderRadius: style.background ? '0.25em' : undefined,
            animation:
              style.highlight || style.animation
                ? style.highlight
                  ? 'caption-preview-highlight 1500ms steps(1) infinite'
                  : `caption-preview-${style.animation} 1800ms ease-out infinite`
                : undefined,
            ...(style.highlight ? { ['--highlight-color' as string]: style.highlight } : {}),
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
