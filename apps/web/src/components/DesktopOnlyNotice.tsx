import { useTranslation } from 'react-i18next';
import { Card } from './Card';

/** Shown in place of a tool that this server cannot run (web deploy without the AI models). */
export function DesktopOnlyNotice() {
  const { t } = useTranslation();
  return (
    <Card className="space-y-2">
      <p className="inline-flex rounded-full border border-accent/40 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent-text">
        {t('desktopOnly.badge')}
      </p>
      <p className="font-medium text-zinc-100">{t('desktopOnly.title')}</p>
      <p className="text-sm text-zinc-400">{t('desktopOnly.description')}</p>
    </Card>
  );
}
