import { CAPTION_PRESETS, type CaptionAnimation, type CaptionPreset, type CustomCaptionStyle } from '@editools/shared';

export interface PreviewStyle {
  fontFamily: string;
  weight: number;
  italic: boolean;
  color: string;
  outlineColor: string | null;
  shadow: boolean;
  background: { color: string; opacity: number } | null;
  highlight?: string;
  animation?: Exclude<CaptionAnimation, 'none'>;
}

/**
 * Visual approximation only — mirrors apps/server/src/media/captions.ts's PRESETS table (the
 * actual render styles) closely enough to recognize each look at a glance in the browser.
 */
export const PRESET_PREVIEW_STYLES: Record<CaptionPreset, PreviewStyle> = {
  karaoke: {
    fontFamily: 'inherit',
    weight: 700,
    italic: false,
    color: '#fff',
    outlineColor: '#000',
    shadow: false,
    background: null,
    highlight: '#9146ff',
    animation: 'bounce',
  },
};

export const CUSTOM_FONT_FAMILY: Record<CustomCaptionStyle['font'], string> = {
  anton: 'Anton',
  'bebas-neue': "'Bebas Neue'",
  poppins: 'Poppins',
  'archivo-black': "'Archivo Black'",
  'luckiest-guy': "'Luckiest Guy'",
  bangers: 'Bangers',
};

export function customPreviewStyle(style: CustomCaptionStyle): PreviewStyle {
  return {
    fontFamily: CUSTOM_FONT_FAMILY[style.font],
    weight: style.bold ? 700 : 400,
    italic: style.italic,
    color: `#${style.primaryColorRgb}`,
    outlineColor: style.outline ? `#${style.outlineColorRgb}` : null,
    shadow: style.shadow,
    background: style.background ? { color: `#${style.backgroundColorRgb}`, opacity: style.backgroundOpacity } : null,
    animation: style.animation === 'none' ? undefined : style.animation,
  };
}

/** `preset` (a CaptionPreset) or `custom:<id>` resolved against the caller's own custom-template list. */
export function resolvePreviewStyle(
  selectedKey: string,
  customTemplates: { id: string; style: CustomCaptionStyle }[],
): PreviewStyle {
  if (selectedKey.startsWith('custom:')) {
    const id = selectedKey.slice('custom:'.length);
    const found = customTemplates.find((t) => t.id === id);
    if (found) return customPreviewStyle(found.style);
  }
  const preset = CAPTION_PRESETS.includes(selectedKey as CaptionPreset) ? (selectedKey as CaptionPreset) : 'karaoke';
  return PRESET_PREVIEW_STYLES[preset];
}

export function outlineShadow(color: string): string {
  return [-1, 1].flatMap((x) => [-1, 1].map((y) => `${x}px ${y}px 0 ${color}`)).join(', ');
}

/** "#rrggbb" + 0–1 opacity → "#rrggbbaa", the CSS 8-digit hex form. */
export function withAlpha(hex: string, opacity: number): string {
  const alpha = Math.round(Math.min(1, Math.max(0, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${alpha}`;
}
