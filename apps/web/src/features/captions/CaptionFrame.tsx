import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { CAPTION_SCALE_MAX, CAPTION_SCALE_MIN, groupWords, type CaptionWord } from '@editools/shared';
import { bounceScale, fadeAlpha, resolveActiveCaption } from './liveCaption';
import { outlineShadow, withAlpha, type PreviewStyle } from './previewStyles';

interface Props {
  videoRef: (el: HTMLVideoElement | null) => void;
  videoUrl: string;
  words: CaptionWord[];
  currentTime: number;
  positionX: number;
  positionY: number;
  scale: number;
  onPositionChange: (x: number, y: number) => void;
  onScaleChange: (scale: number) => void;
  previewStyle: PreviewStyle;
  placeholder: string;
  disabled?: boolean;
}

/**
 * The actual video, playing, with the real caption words overlaid exactly where and when they'll
 * burn in — not a static sample. Drag the overlay to set position, resize with "Size". Position
 * also has plain range-input fallbacks below the frame for keyboard/screen-reader use.
 */
export function CaptionFrame({
  videoRef,
  videoUrl,
  words,
  currentTime,
  positionX,
  positionY,
  scale,
  onPositionChange,
  onScaleChange,
  previewStyle: style,
  placeholder,
  disabled,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const chunks = useMemo(() => groupWords(words), [words]);
  const active = useMemo(() => resolveActiveCaption(chunks, currentTime, style), [chunks, currentTime, style]);

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
          ref={videoRef}
          src={videoUrl}
          playsInline
          preload="metadata"
          className="pointer-events-none absolute inset-0 h-full w-full object-contain"
        />

        <div
          aria-hidden
          className="pointer-events-none absolute inline-flex max-w-[85%] -translate-x-1/2 -translate-y-1/2 flex-wrap justify-center text-center leading-tight"
          style={{
            left: `${positionX * 100}%`,
            top: `${positionY * 100}%`,
            columnGap: '0.35em',
            rowGap: '0.15em',
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
          }}
        >
          {active !== null
            ? active.words.map((w, i) =>
                w.role === 'active' ? (
                  <span
                    key={i}
                    style={{
                      display: 'inline-block',
                      color: style.highlight ?? style.color,
                      transform: style.animation === 'bounce' ? `scale(${bounceScale(active.elapsedMs)})` : undefined,
                      opacity: style.animation === 'fade' ? fadeAlpha(active.elapsedMs) : 1,
                    }}
                  >
                    {w.text}
                  </span>
                ) : (
                  <span key={i}>{w.text}</span>
                ),
              )
            : (
                <span className="rounded border border-dashed border-white/30 px-3 py-1 text-xs font-normal text-white/50 normal-case">
                  {placeholder}
                </span>
              )}
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
