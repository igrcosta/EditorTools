import type { CaptionPreset } from '@editools/shared';
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
 * long enough to read as a sentence break.
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

interface PresetStyle {
  fontName: string;
  /** Font size as a fraction of the video height, so it scales with resolution. */
  fontSizeRatio: number;
  /** Plain RGB hex (no "#", no "&H"). */
  primaryColorRgb: string;
  /** Word-highlight color for the karaoke preset; null for presets with no per-word highlight. */
  highlightColorRgb: string | null;
  bold: boolean;
  /** ASS numpad alignment: 1/2/3 bottom-left/center/right, 7/8/9 top-left/center/right. */
  alignment: number;
  marginLRatio: number;
  marginRRatio: number;
  marginVRatio: number;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
}

/** Fixed, server-defined visual presets — not user-customizable in v1. */
const PRESETS: Record<CaptionPreset, PresetStyle> = {
  clean: {
    fontName: 'Arial',
    fontSizeRatio: 0.045,
    primaryColorRgb: 'FFFFFF',
    highlightColorRgb: null,
    bold: false,
    alignment: 2,
    marginLRatio: 0.06,
    marginRRatio: 0.06,
    marginVRatio: 0.06,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
  },
  karaoke: {
    fontName: 'Arial',
    fontSizeRatio: 0.05,
    primaryColorRgb: 'FFFFFF',
    // Editools' own brand accent, used as the per-word highlight.
    highlightColorRgb: '9146FF',
    bold: true,
    alignment: 2,
    marginLRatio: 0.06,
    marginRRatio: 0.06,
    marginVRatio: 0.07,
    borderStyle: 1,
    outline: 2,
    shadow: 1,
  },
  lowerthird: {
    fontName: 'Arial',
    fontSizeRatio: 0.032,
    primaryColorRgb: 'FFFFFF',
    highlightColorRgb: null,
    bold: false,
    alignment: 1,
    marginLRatio: 0.06,
    marginRRatio: 0.06,
    marginVRatio: 0.08,
    borderStyle: 1,
    outline: 1,
    shadow: 1,
  },
  boxed: {
    fontName: 'Arial',
    fontSizeRatio: 0.042,
    primaryColorRgb: 'FFFFFF',
    highlightColorRgb: null,
    bold: false,
    alignment: 2,
    marginLRatio: 0.08,
    marginRRatio: 0.08,
    marginVRatio: 0.06,
    borderStyle: 3,
    outline: 4,
    shadow: 0,
  },
};

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

/** Escapes ASS's own special characters — text comes from ASR output, never trusted as markup. */
function escapeAssText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/\n/g, '\\N');
}

function dialogueLine(start: number, end: number, text: string): string {
  return `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${text}`;
}

/**
 * Builds a complete .ass subtitle file for the given preset. The karaoke
 * preset emits one Dialogue line per word (each spanning that word's own
 * timestamps, with only that word color-overridden) instead of using ASS's
 * \k karaoke sweep tag — deterministic string output, no reliance on a
 * particular libass version's karaoke rendering.
 */
export function buildAssTrack(words: TranscriptWord[], preset: CaptionPreset, videoWidth: number, videoHeight: number): string {
  const style = PRESETS[preset];
  const fontSize = Math.max(12, Math.round(videoHeight * style.fontSizeRatio));
  const marginL = Math.max(0, Math.round(videoWidth * style.marginLRatio));
  const marginR = Math.max(0, Math.round(videoWidth * style.marginRRatio));
  const marginV = Math.max(0, Math.round(videoHeight * style.marginVRatio));
  const backColor = style.borderStyle === 3 ? assStyleColor('000000', '80') : assStyleColor('000000', '00');

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
      assStyleColor('000000'),
      backColor,
      style.bold ? -1 : 0,
      0, 0, 0, 100, 100, 0, 0,
      style.borderStyle,
      style.outline,
      style.shadow,
      style.alignment,
      marginL,
      marginR,
      marginV,
      1,
    ].join(','),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n');

  const lines: string[] = [];
  for (const chunk of groupWords(words)) {
    if (style.highlightColorRgb) {
      const highlight = assInlineColor(style.highlightColorRgb);
      chunk.words.forEach((word, i) => {
        const before = chunk.words.slice(0, i).map((w) => escapeAssText(w.text));
        const after = chunk.words.slice(i + 1).map((w) => escapeAssText(w.text));
        const active = `{\\c${highlight}}${escapeAssText(word.text)}{\\c}`;
        lines.push(dialogueLine(word.start, word.end, [...before, active, ...after].join(' ')));
      });
    } else {
      const text = escapeAssText(chunk.words.map((w) => w.text).join(' '));
      lines.push(dialogueLine(chunk.start, chunk.end, text));
    }
  }

  return `${header}\n${lines.join('\n')}\n`;
}
