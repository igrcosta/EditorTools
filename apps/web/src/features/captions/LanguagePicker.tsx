import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CAPTION_LANGUAGES, type CaptionLanguage } from '@editools/shared';

const STORAGE_KEY = 'editools.captions.language';

function isCaptionLanguage(value: string | null): value is CaptionLanguage {
  return value !== null && (CAPTION_LANGUAGES as readonly string[]).includes(value);
}

/** Last pick if there is one, otherwise the browser's language when whisper supports it, otherwise English. */
function initialLanguage(): CaptionLanguage {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (isCaptionLanguage(saved)) return saved;
  } catch {
    // storage blocked: fall through to the browser default
  }
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return isCaptionLanguage(browser) && browser !== 'auto' ? browser : 'en';
}

/** The language to transcribe in, remembered between sessions. */
export function useCaptionLanguage() {
  const [language, setLanguageState] = useState<CaptionLanguage>(initialLanguage);
  const setLanguage = (next: CaptionLanguage) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisted: still applies to this session
    }
  };
  return [language, setLanguage] as const;
}

interface Props {
  value: CaptionLanguage;
  onChange: (language: CaptionLanguage) => void;
  /** Languages this install can time word-by-word with a forced-alignment model. */
  preciseLanguages: readonly string[];
  disabled?: boolean;
}

/**
 * "Which language is spoken?" — asked up front because whisper's own auto-detection misfires on
 * short or noisy clips (garbled text), and because the language also decides which word-timing
 * model can be used.
 */
export function LanguagePicker({ value, onChange, preciseLanguages, disabled }: Props) {
  const { t, i18n } = useTranslation('captions');

  const options = useMemo(() => {
    const names = new Intl.DisplayNames([i18n.language || 'en'], { type: 'language' });
    const label = (code: CaptionLanguage) => (code === 'auto' ? t('language.auto') : (names.of(code) ?? code));
    const named = CAPTION_LANGUAGES.filter((code) => code !== 'auto')
      .map((code) => ({ code, label: label(code) }))
      .sort((a, b) => a.label.localeCompare(b.label, i18n.language || 'en'));
    return [{ code: 'auto' as CaptionLanguage, label: label('auto') }, ...named];
  }, [i18n.language, t]);

  // Make sure the persisted choice is still valid if the list ever changes.
  useEffect(() => {
    if (!isCaptionLanguage(value)) onChange('en');
  }, [value, onChange]);

  const precise = preciseLanguages.includes(value);
  const hint = value === 'auto' ? t('language.hintAuto') : precise ? t('language.hintPrecise') : t('language.hintApprox');

  return (
    <div className="space-y-1.5">
      <label htmlFor="caption-language" className="block text-sm font-medium text-zinc-200">
        {t('language.label')}
      </label>
      <select
        id="caption-language"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as CaptionLanguage)}
        className="h-10 w-full cursor-pointer rounded-md border border-white/10 bg-surface-2/60 px-3 text-sm text-zinc-100 transition focus:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        {options.map(({ code, label }) => (
          <option key={code} value={code} className="bg-zinc-900">
            {label}
          </option>
        ))}
      </select>
      <p className={`text-xs ${precise && value !== 'auto' ? 'text-accent-text' : 'text-zinc-500'}`}>
        {precise && value !== 'auto' && <i className="fi-rr-check mr-1" aria-hidden="true" />}
        {hint}
      </p>
    </div>
  );
}
