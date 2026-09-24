import { useState } from 'react';
import { CAPTION_FONTS, type CaptionFont, type CustomCaptionStyle } from '@editools/shared';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';

const FONT_LABEL: Record<CaptionFont, string> = {
  anton: 'Anton',
  'bebas-neue': 'Bebas Neue',
  poppins: 'Poppins',
  'archivo-black': 'Archivo Black',
  'luckiest-guy': 'Luckiest Guy',
  bangers: 'Bangers',
};

const FONT_FAMILY: Record<CaptionFont, string> = {
  anton: 'Anton',
  'bebas-neue': "'Bebas Neue'",
  poppins: 'Poppins',
  'archivo-black': "'Archivo Black'",
  'luckiest-guy': "'Luckiest Guy'",
  bangers: 'Bangers',
};

function outlineShadow(color: string): string {
  return [-1, 1].flatMap((x) => [-1, 1].map((y) => `${x}px ${y}px 0 ${color}`)).join(', ');
}

interface Props {
  onSave: (name: string, style: CustomCaptionStyle) => void;
  onCancel: () => void;
}

/** Inline template builder — no modal: it takes over the gallery's spot, same as any other in-page state change. */
export function CustomTemplateEditor({ onSave, onCancel }: Props) {
  const [name, setName] = useState('');
  const [font, setFont] = useState<CaptionFont>('anton');
  const [primaryColorRgb, setPrimaryColorRgb] = useState('FFFFFF');
  const [outline, setOutline] = useState(true);
  const [outlineColorRgb, setOutlineColorRgb] = useState('000000');
  const [shadow, setShadow] = useState(false);

  const style: CustomCaptionStyle = { font, primaryColorRgb, outline, outlineColorRgb, shadow };

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, style);
  };

  return (
    <div className="space-y-4 rounded-md border border-white/10 bg-surface p-4">
      <div className="flex aspect-video items-center justify-center rounded bg-zinc-800">
        <span
          className="px-3 text-center text-2xl leading-tight"
          style={{
            fontFamily: FONT_FAMILY[font],
            color: `#${primaryColorRgb}`,
            textShadow: outline ? outlineShadow(`#${outlineColorRgb}`) : undefined,
            filter: shadow ? 'drop-shadow(2px 3px 2px rgba(0,0,0,0.7))' : undefined,
          }}
        >
          Like this
        </span>
      </div>

      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Template name" maxLength={40} />

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Font</p>
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_FONTS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFont(f)}
              className={`cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                font === f ? 'border-accent text-accent-text' : 'border-white/10 text-zinc-400 hover:border-white/25'
              }`}
              style={{ fontFamily: FONT_FAMILY[f] }}
            >
              {FONT_LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <label className="space-y-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
          <span className="block">Text color</span>
          <input
            type="color"
            value={`#${primaryColorRgb}`}
            onChange={(e) => setPrimaryColorRgb(e.target.value.slice(1).toUpperCase())}
            className="h-9 w-full cursor-pointer rounded border border-white/10 bg-transparent"
          />
        </label>
        <label className={`space-y-1 text-xs font-medium uppercase tracking-wide ${outline ? 'text-zinc-500' : 'text-zinc-700'}`}>
          <span className="block">Outline color</span>
          <input
            type="color"
            value={`#${outlineColorRgb}`}
            onChange={(e) => setOutlineColorRgb(e.target.value.slice(1).toUpperCase())}
            disabled={!outline}
            className="h-9 w-full cursor-pointer rounded border border-white/10 bg-transparent disabled:cursor-not-allowed disabled:opacity-40"
          />
        </label>
      </div>

      <div className="flex gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={outline} onChange={(e) => setOutline(e.target.checked)} className="accent-accent" />
          Outline
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={shadow} onChange={(e) => setShadow(e.target.checked)} className="accent-accent" />
          Shadow
        </label>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={save} disabled={!name.trim()}>
          Save template
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
