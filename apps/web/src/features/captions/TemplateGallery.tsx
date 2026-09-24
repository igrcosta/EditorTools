import { CAPTION_PRESETS, type CaptionPreset, type CustomCaptionStyle } from '@editools/shared';
import type { CustomTemplate } from './customTemplates';

interface PreviewStyle {
  fontFamily: string;
  fontSize: string;
  weight: number;
  color: string;
  outlineColor: string | null;
  shadow: boolean;
  boxed?: boolean;
  highlight?: string;
}

/**
 * Visual approximation only, for the picker — mirrors apps/server/src/media/captions.ts's
 * PRESETS table (the actual render styles) closely enough to recognize each look at a glance.
 */
const PRESET_PREVIEW_STYLES: Record<CaptionPreset, PreviewStyle> = {
  clean: { fontFamily: 'inherit', fontSize: '0.8rem', weight: 400, color: '#fff', outlineColor: '#000', shadow: false },
  karaoke: {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    weight: 700,
    color: '#fff',
    outlineColor: '#000',
    shadow: false,
    highlight: '#9146ff',
  },
  boxed: { fontFamily: 'inherit', fontSize: '0.78rem', weight: 400, color: '#fff', outlineColor: '#000', shadow: false, boxed: true },
  minimal: { fontFamily: 'inherit', fontSize: '0.65rem', weight: 400, color: '#fff', outlineColor: '#000', shadow: false },
  bold: { fontFamily: 'inherit', fontSize: '1rem', weight: 700, color: '#fff', outlineColor: '#000', shadow: false },
  outline: { fontFamily: 'inherit', fontSize: '0.85rem', weight: 700, color: '#fff', outlineColor: '#9146ff', shadow: false },
};

const CUSTOM_FONT_FAMILY: Record<CustomCaptionStyle['font'], string> = {
  anton: 'Anton',
  'bebas-neue': "'Bebas Neue'",
  poppins: 'Poppins',
  'archivo-black': "'Archivo Black'",
};

function customPreviewStyle(style: CustomCaptionStyle): PreviewStyle {
  return {
    fontFamily: CUSTOM_FONT_FAMILY[style.font],
    fontSize: '0.85rem',
    weight: 700,
    color: `#${style.primaryColorRgb}`,
    outlineColor: style.outline ? `#${style.outlineColorRgb}` : null,
    shadow: style.shadow,
  };
}

function outlineShadow(color: string): string {
  return [-1, 1].flatMap((x) => [-1, 1].map((y) => `${x}px ${y}px 0 ${color}`)).join(', ');
}

const SAMPLE_WORDS = ['LIKE', 'THIS', 'ONE'];
/** Each word's highlight pulses in turn, CSS-only — a cheap stand-in for a real animated preview. */
const KARAOKE_CYCLE_MS = 1500;

function Preview({ style }: { style: PreviewStyle }) {
  return (
    <div className="flex aspect-video items-center justify-center rounded bg-zinc-800 p-2">
      <span
        className="text-center leading-tight"
        style={{
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.weight,
          color: style.color,
          textShadow: style.outlineColor ? outlineShadow(style.outlineColor) : undefined,
          filter: style.shadow ? 'drop-shadow(1.5px 2px 1.5px rgba(0,0,0,0.7))' : undefined,
          backgroundColor: style.boxed ? 'rgba(0,0,0,0.7)' : undefined,
          padding: style.boxed ? '2px 6px' : undefined,
          borderRadius: style.boxed ? '3px' : undefined,
        }}
      >
        {SAMPLE_WORDS.map((w, i) => (
          <span
            key={i}
            style={
              style.highlight
                ? {
                    animation: `caption-preview-highlight ${KARAOKE_CYCLE_MS * SAMPLE_WORDS.length}ms steps(1) infinite`,
                    animationDelay: `${i * KARAOKE_CYCLE_MS}ms`,
                    ['--highlight-color' as string]: style.highlight,
                  }
                : undefined
            }
          >
            {w}
            {i < SAMPLE_WORDS.length - 1 ? ' ' : ''}
          </span>
        ))}
      </span>
    </div>
  );
}

interface Props {
  customTemplates: CustomTemplate[];
  /** A CaptionPreset, or `custom:<id>` for one of customTemplates. */
  selectedKey: string;
  onSelect: (key: string) => void;
  onCreateNew: () => void;
  onDeleteCustom: (id: string) => void;
  label: (preset: CaptionPreset) => string;
  disabled?: boolean;
}

/** Template picker: a live-styled preview per template instead of a plain label list. */
export function TemplateGallery({ customTemplates, selectedKey, onSelect, onCreateNew, onDeleteCustom, label, disabled }: Props) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {CAPTION_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onSelect(preset)}
          disabled={disabled}
          className={`space-y-1.5 rounded-md border-2 p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            selectedKey === preset ? 'border-accent' : 'border-transparent hover:border-white/20'
          }`}
        >
          <Preview style={PRESET_PREVIEW_STYLES[preset]} />
          <p className={`truncate text-center text-xs ${selectedKey === preset ? 'text-accent-text' : 'text-zinc-400'}`}>
            {label(preset)}
          </p>
        </button>
      ))}

      {customTemplates.map((t) => {
        const key = `custom:${t.id}`;
        return (
          <div key={t.id} className="relative">
            <button
              type="button"
              onClick={() => onSelect(key)}
              disabled={disabled}
              className={`w-full space-y-1.5 rounded-md border-2 p-1.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedKey === key ? 'border-accent' : 'border-transparent hover:border-white/20'
              }`}
            >
              <Preview style={customPreviewStyle(t.style)} />
              <p className={`truncate text-center text-xs ${selectedKey === key ? 'text-accent-text' : 'text-zinc-400'}`}>
                {t.name}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDeleteCustom(t.id)}
              disabled={disabled}
              aria-label={`Delete ${t.name}`}
              className="absolute top-0.5 right-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-black/60 text-xs text-zinc-300 hover:text-red-400 disabled:cursor-not-allowed"
            >
              &times;
            </button>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onCreateNew}
        disabled={disabled}
        className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-white/15 p-1.5 text-zinc-500 transition-colors hover:border-accent/50 hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="text-xl leading-none">+</span>
        <span className="text-center text-[10px] leading-tight">New template</span>
      </button>
    </div>
  );
}
