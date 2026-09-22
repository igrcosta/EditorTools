import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  /** Image URLs. Both are drawn at the same size, so they should share an aspect ratio. */
  before: string;
  after: string;
  /** Draw the "after" side over a checkerboard so transparency is visible. */
  transparent?: boolean;
  /** Offer a 1:1 pixel view (useful when the result is much larger than the viewport). */
  zoomable?: boolean;
}

/**
 * Before/after comparison: the result sits on top and is revealed by a
 * draggable divider. The divider is a full-size range input, so it works
 * with mouse, touch and keyboard alike.
 */
export function BeforeAfter({ before, after, transparent = false, zoomable = false }: Props) {
  const { t } = useTranslation('image');
  const [position, setPosition] = useState(50);
  const [actualSize, setActualSize] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setPosition(50);
    setActualSize(false);
    setNatural(null);
    setFailed(false);
  }, [after]);

  if (failed) return null;

  const frameStyle = actualSize && natural ? { width: `${natural.width}px`, maxWidth: 'none' } : undefined;

  return (
    <div className="space-y-2">
      <div className={actualSize ? 'max-h-[70vh] overflow-auto rounded-md border border-white/10' : ''}>
        <div className="relative w-full select-none overflow-hidden rounded-md bg-zinc-950" style={frameStyle}>
          <img src={before} alt={t('compare.before')} draggable={false} className="block w-full" />
          <div
            className={`absolute inset-0 ${transparent ? 'checkerboard' : ''}`}
            style={{ clipPath: `inset(0 0 0 ${position}%)` }}
          >
            <img
              src={after}
              alt={t('compare.after')}
              draggable={false}
              className="block h-full w-full"
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }}
              onError={() => setFailed(true)}
            />
          </div>
          <div
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ left: `calc(${position}% - 1px)` }}
          >
            <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-xs font-semibold text-zinc-900 shadow">
              ⇔
            </div>
          </div>
          <span className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-zinc-100">
            {t('compare.before')}
          </span>
          <span className="pointer-events-none absolute top-2 right-2 rounded bg-black/60 px-2 py-0.5 text-xs text-zinc-100">
            {t('compare.after')}
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
            aria-label={t('compare.slider')}
            className="absolute inset-0 h-full w-full cursor-ew-resize opacity-0"
          />
        </div>
      </div>
      {zoomable && natural && (
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>
            {natural.width}×{natural.height}
          </span>
          <div className="flex gap-1">
            {(['fit', 'actual'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setActualSize(mode === 'actual')}
                className={`cursor-pointer rounded px-2 py-0.5 transition-colors ${
                  (mode === 'actual') === actualSize ? 'bg-accent/15 text-accent-text' : 'hover:text-zinc-300'
                }`}
              >
                {t(`compare.${mode}`)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
