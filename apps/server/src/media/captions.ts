import type { CaptionAnimation, CaptionFont, CaptionPreset, CustomCaptionStyle } from '@editools/shared';
import type { TranscriptWord } from './whisper';

export interface WordChunk {
  words: TranscriptWord[];
  start: number;
  end: number;
}

const MAX_CHUNK_CHARS = 42;
const MAX_CHUNK_WORDS = 7;
const MAX_GAP_SECONDS = 0.6;

/**
 * Regroups whisper's flat word list into on-screen caption lines: a new chunk
 * starts once a line gets too long, has too many words, or there's a pause
 * long enough to read as a sentence break. Works the same whether the words
 * came straight from ASR or were edited/re-timed by the user first.
 */
export function groupWords(words: TranscriptWord[]): WordChunk[] {
  const chunks: WordChunk[] = [];
  let current: TranscriptWord[] = [];
  let currentChars = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({ words: current, start: current[0].start, end: current[current.length - 1].end });
    current = [];
    currentChars = 0;
  };

  for (const word of words) {
    const gap = current.length > 0 ? word.start - current[current.length - 1].end : 0;
    const wouldOverflow = currentChars + word.text.length + 1 > MAX_CHUNK_CHARS || current.length >= MAX_CHUNK_WORDS;
    if (current.length > 0 && (gap > MAX_GAP_SECONDS || wouldOverflow)) flush();
    current.push(word);
    currentChars += word.text.length + 1;
  }
  flush();
  return chunks;
}

/** Sorts by start time and drops anything with non-positive duration or empty text — user edits can produce either. */
export function normalizeWords(words: TranscriptWord[]): TranscriptWord[] {
  return words
    .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(0, w.end) }))
    .filter((w) => w.text.length > 0 && w.end > w.start)
    .sort((a, b) => a.start - b.start);
}

interface PresetStyle {
  fontName: string;
  /** Font size as a fraction of the video height, so it scales with resolution. */
  fontSizeRatio: number;
  /** Plain RGB hex (no "#", no "&H"). */
  primaryColorRgb: string;
  outlineColorRgb: string;
  /** Word-highlight color for the karaoke preset; null for presets with no per-word highlight. */
  highlightColorRgb: string | null;
  bold: boolean;
  italic: boolean;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  /** BackColour field: shadow tint when borderStyle=1, the opaque-box fill when borderStyle=3. */
  backColorRgb: string;
  /** 0–1. Only meaningful when borderStyle=3 (the box's own opacity) — the shadow tint (borderStyle=1) is always fully opaque. */
  backOpacity: number;
  /** 'none' for every built-in preset — only a custom template can turn this on. */
  animation: CaptionAnimation;
}

/** Fixed, server-defined visual styles — not user-customizable in v1. Where/how big they sit is a separate, free-form position + scale (see buildAssTrack). */
const PRESETS: Record<CaptionPreset, PresetStyle> = {
  clean: {
    fontName: 'Arial',
    fontSizeRatio: 0.045,
    primaryColorRgb: 'FFFFFF',
    outlineColorRgb: '000000',
    highlightColorRgb: null,
    bold: false,
    italic: false,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
    backColorRgb: '000000',
    backOpacity: 1,
    animation: 'none',
  },
  karaoke: {
    fontName: 'Arial',
    fontSizeRatio: 0.05,
    primaryColorRgb: 'FFFFFF',
    outlineColorRgb: '000000',
    // Editools' own brand accent, used as the per-word highlight.
    highlightColorRgb: '9146FF',
    bold: true,
    italic: false,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
    backColorRgb: '000000',
    backOpacity: 1,
    // The one built-in preset that plays a per-word reveal — it's already the "active word" style.
    animation: 'bounce',
  },
  boxed: {
    fontName: 'Arial',
    fontSizeRatio: 0.042,
    primaryColorRgb: 'FFFFFF',
    outlineColorRgb: '000000',
    highlightColorRgb: null,
    bold: false,
    italic: false,
    borderStyle: 3,
    outline: 4,
    shadow: 0,
    backColorRgb: '000000',
    backOpacity: 0.5,
    animation: 'none',
  },
  minimal: {
    fontName: 'Arial',
    fontSizeRatio: 0.032,
    primaryColorRgb: 'FFFFFF',
    outlineColorRgb: '000000',
    highlightColorRgb: null,
    bold: false,
    italic: false,
    borderStyle: 1,
    outline: 1,
    shadow: 1,
    backColorRgb: '000000',
    backOpacity: 1,
    animation: 'none',
  },
  bold: {
    fontName: 'Arial',
    fontSizeRatio: 0.065,
    primaryColorRgb: 'FFFFFF',
    outlineColorRgb: '000000',
    highlightColorRgb: null,
    bold: true,
    italic: false,
    borderStyle: 1,
    outline: 4,
    shadow: 1,
    backColorRgb: '000000',
    backOpacity: 1,
    animation: 'none',
  },
  outline: {
    fontName: 'Arial',
    fontSizeRatio: 0.048,
    primaryColorRgb: 'FFFFFF',
    // Editools' own brand accent, used as the outline instead of the usual black.
    outlineColorRgb: '9146FF',
    highlightColorRgb: null,
    bold: true,
    italic: false,
    borderStyle: 1,
    outline: 3,
    shadow: 0,
    backColorRgb: '000000',
    backOpacity: 1,
    animation: 'none',
  },
};

/**
 * Custom templates (see CustomCaptionStyle): the only fonts a template can use, since libass
 * needs the actual font file — not whatever happens to be installed on the user's system. Each
 * maps to its embedded font-family name (the ASS `Fontname` field) and the bundled file libass
 * resolves it from via `fontsdir` (renderCaptionsTask copies it into the ffmpeg working dir).
 */
export const CAPTION_FONT_FILES: Record<CaptionFont, { family: string; file: string }> = {
  anton: { family: 'Anton', file: 'Anton-Regular.ttf' },
  'bebas-neue': { family: 'Bebas Neue', file: 'BebasNeue-Regular.ttf' },
  poppins: { family: 'Poppins', file: 'Poppins-Bold.ttf' },
  'archivo-black': { family: 'Archivo Black', file: 'ArchivoBlack-Regular.ttf' },
  // Chunky, rounded, high-contrast — the two fonts behind most "MrBeast style" caption templates.
  'luckiest-guy': { family: 'Luckiest Guy', file: 'LuckiestGuy-Regular.ttf' },
  bangers: { family: 'Bangers', file: 'Bangers-Regular.ttf' },
};

function resolveStyle(preset: CaptionPreset, custom: CustomCaptionStyle | null): PresetStyle {
  if (!custom) return PRESETS[preset];
  return {
    fontName: CAPTION_FONT_FILES[custom.font].family,
    fontSizeRatio: 0.05,
    primaryColorRgb: custom.primaryColorRgb,
    outlineColorRgb: custom.outlineColorRgb,
    highlightColorRgb: null,
    bold: custom.bold,
    italic: custom.italic,
    borderStyle: custom.background ? 3 : 1,
    outline: custom.outline ? 2.5 : 0,
    shadow: custom.shadow ? 1.5 : 0,
    backColorRgb: custom.background ? custom.backgroundColorRgb : '000000',
    backOpacity: custom.background ? custom.backgroundOpacity : 1,
    animation: custom.animation,
  };
}

/** Opacity (0–1) → ASS alpha byte, which is inverted: 00 = fully opaque, FF = fully transparent. */
function opacityToAssAlpha(opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  return Math.round((1 - clamped) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/**
 * Inline override tags for the word that's actively being spoken, played once from that word's
 * own Start (all `\t()` times are relative to it) — libass, not CSS, since this has to exist in
 * the burned-in video, not just the browser preview.
 */
function animationTags(animation: CaptionAnimation): string {
  switch (animation) {
    case 'bounce':
      // 60% → overshoot to 115% by 80ms → settle to 100% by 150ms: a pop, not a linear grow.
      return '\\fscx60\\fscy60\\t(0,80,\\fscx115\\fscy115)\\t(80,150,\\fscx100\\fscy100)';
    case 'fade':
      return '\\alpha&HFF&\\t(0,150,\\alpha&H00&)';
    default:
      return '';
  }
}

/** RGB hex ("FFFFFF") → the BGR byte order ASS colors use. */
function toBgr(rgbHex: string): string {
  const [r, g, b] = [rgbHex.slice(0, 2), rgbHex.slice(2, 4), rgbHex.slice(4, 6)];
  return `${b}${g}${r}`.toUpperCase();
}

/** `Style:` line color field: &H<alpha><bb><gg><rr>, alpha 00 = opaque. */
function assStyleColor(rgbHex: string, alphaHex = '00'): string {
  return `&H${alphaHex}${toBgr(rgbHex)}`;
}

/** Inline `{\c...}` override tag: &H<bb><gg><rr>& (no alpha byte). */
function assInlineColor(rgbHex: string): string {
  return `&H${toBgr(rgbHex)}&`;
}

function formatAssTime(seconds: number): string {
  const centiseconds = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(centiseconds / 360_000);
  const m = Math.floor((centiseconds % 360_000) / 6_000);
  const s = Math.floor((centiseconds % 6_000) / 100);
  const c = centiseconds % 100;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** Escapes ASS's own special characters — text comes from ASR output or user edits, never trusted as markup. */
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
}

function dialogueLine(start: number, end: number, text: string): string {
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
}

/**
 * Builds a complete .ass subtitle file for the given preset + position. A style with a
 * per-word highlight and/or a reveal animation emits one Dialogue line per word (each spanning
 * that word's own timestamps, with only that word color/scale/alpha-overridden) instead of
 * using ASS's \k karaoke sweep tag — deterministic string output, no reliance on a particular
 * libass version's karaoke rendering, and it's the same mechanism a `\t()` animation needs
 * anyway (it has to be scoped to one word's own Start).
 */
export function buildAssTrack(
  words: TranscriptWord[],
  preset: CaptionPreset,
  customStyle: CustomCaptionStyle | null,
  positionX: number,
  positionY: number,
  scale: number,
  videoWidth: number,
  videoHeight: number,
): string {
  const style = resolveStyle(preset, customStyle);
  const fontSize = Math.max(12, Math.round(videoHeight * style.fontSizeRatio * scale));
  const backColor = assStyleColor(style.backColorRgb, opacityToAssAlpha(style.backOpacity));
  // Free placement (dragged on the video preview) beats a fixed zone grid — \pos anchors the
  // text's own center at an exact pixel, so alignment 5 (middle-center) is always correct here
  // regardless of where positionX/positionY put it; margins are meaningless once \pos is used.
  const posTag = `{\\pos(${Math.round(videoWidth * positionX)},${Math.round(videoHeight * positionY)})}`;

  const header = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${videoWidth}`,
    `PlayResY: ${videoHeight}`,
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    [
      'Style: Default',
      style.fontName,
      fontSize,
      assStyleColor(style.primaryColorRgb),
      '&H000000FF',
      assStyleColor(style.outlineColorRgb),
      backColor,
      style.bold ? -1 : 0,
      style.italic ? -1 : 0,
      0, 0, 100, 100, 0, 0,
      style.borderStyle,
      style.outline,
      style.shadow,
      5,
      0,
      0,
      0,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const lines: string[] = [];
  const perWord = style.highlightColorRgb !== null || style.animation !== 'none';
  // An entrance animation means a word must not exist on screen at all before its own line —
  // showing it plainly first and only then animating it reads as "playing out of nowhere", not
  // an entrance. A highlight-only style (no animation) is the other case per-word lines serve:
  // the classic karaoke sweep, where the full line is already visible and only the color moves.
  const revealProgressively = style.animation !== 'none';
  for (const chunk of groupWords(words)) {
    if (perWord) {
      const activeTags =
        animationTags(style.animation) + (style.highlightColorRgb ? `\\c${assInlineColor(style.highlightColorRgb)}` : '');
      chunk.words.forEach((word, i) => {
        const before = chunk.words.slice(0, i).map((w) => escapeAssText(w.text));
        const after = revealProgressively ? [] : chunk.words.slice(i + 1).map((w) => escapeAssText(w.text));
        const active = `{${activeTags}}${escapeAssText(word.text)}{\\r}`;
        lines.push(dialogueLine(word.start, word.end, posTag + [...before, active, ...after].join(' ')));
      });
    } else {
      const text = escapeAssText(chunk.words.map((w) => w.text).join(' '));
      lines.push(dialogueLine(chunk.start, chunk.end, posTag + text));
    }
  }

  return `${header}\n${lines.join('\n')}\n`;
}
