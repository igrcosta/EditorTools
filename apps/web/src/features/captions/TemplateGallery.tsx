import { CAPTION_PRESETS, type CaptionPreset } from '@editools/shared';
import type { CustomTemplate } from './customTemplates';
import { customPreviewStyle, outlineShadow, PRESET_PREVIEW_STYLES, withAlpha, type PreviewStyle } from './previewStyles';

/** A single word, small enough to read in a compact card. */
const CARD_SAMPLE = 'LIKE';

function Preview({ style }: { style: PreviewStyle }) {
  return (
    <div className="flex h-11 w-full items-center justify-center rounded bg-zinc-800">
      <span
        className="px-1 text-center leading-none"
        style={{
          fontFamily: style.fontFamily,
          fontSize: '0.7rem',
          fontWeight: style.weight,
          fontStyle: style.italic ? 'italic' : undefined,
          color: style.color,
          textShadow: style.outlineColor ? outlineShadow(style.outlineColor) : undefined,
          filter: style.shadow ? 'drop-shadow(1px 1.5px 1px rgba(0,0,0,0.7))' : undefined,
          backgroundColor: style.background ? withAlpha(style.background.color, style.background.opacity) : undefined,
          padding: style.background ? '1px 4px' : undefined,
          borderRadius: style.background ? '3px' : undefined,
        }}
      >
        <span
          style={{
            display: 'inline-block',
            animation: style.highlight
              ? 'caption-preview-highlight 1500ms steps(1) infinite'
              : style.animation
                ? `caption-preview-${style.animation} 1800ms ease-out infinite`
                : undefined,
            ...(style.highlight ? { ['--highlight-color' as string]: style.highlight } : {}),
          }}
        >
          {CARD_SAMPLE}
        </span>
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

const CARD_WIDTH = 'w-16 shrink-0';

/** Compact, horizontally scrollable strip — the video preview stays the focus, not this row. */
export function TemplateGallery({ customTemplates, selectedKey, onSelect, onCreateNew, onDeleteCustom, label, disabled }: Props) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {CAPTION_PRESETS.map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onSelect(preset)}
          disabled={disabled}
          className={`${CARD_WIDTH} space-y-1 rounded-md border-2 p-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            selectedKey === preset ? 'border-accent' : 'border-transparent hover:border-white/20'
          }`}
        >
          <Preview style={PRESET_PREVIEW_STYLES[preset]} />
          <p className={`truncate text-center text-[10px] ${selectedKey === preset ? 'text-accent-text' : 'text-zinc-400'}`}>
            {label(preset)}
          </p>
        </button>
      ))}

      {customTemplates.map((t) => {
        const key = `custom:${t.id}`;
        return (
          <div key={t.id} className={`relative ${CARD_WIDTH}`}>
            <button
              type="button"
              onClick={() => onSelect(key)}
              disabled={disabled}
              className={`w-full space-y-1 rounded-md border-2 p-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                selectedKey === key ? 'border-accent' : 'border-transparent hover:border-white/20'
              }`}
            >
              <Preview style={customPreviewStyle(t.style)} />
              <p className={`truncate text-center text-[10px] ${selectedKey === key ? 'text-accent-text' : 'text-zinc-400'}`}>
                {t.name}
              </p>
            </button>
            <button
              type="button"
              onClick={() => onDeleteCustom(t.id)}
              disabled={disabled}
              aria-label={`Delete ${t.name}`}
              className="absolute -top-1 -right-1 flex h-4 w-4 cursor-pointer items-center justify-center rounded-full bg-black/70 text-[10px] text-zinc-300 hover:text-red-400 disabled:cursor-not-allowed"
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
        className={`${CARD_WIDTH} flex h-11 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-white/15 text-zinc-500 transition-colors hover:border-accent/50 hover:text-accent-text disabled:cursor-not-allowed disabled:opacity-50`}
      >
        <span className="text-lg leading-none">+</span>
      </button>
    </div>
  );
}
