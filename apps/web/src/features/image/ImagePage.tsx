import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { RemoveBgPage } from './RemoveBgPage';
import { UpscalePage } from './UpscalePage';

type Tab = 'removeBg' | 'upscale';

/** Hub for the image tools: Remove Background and Upscale as tabs of one screen. */
export function ImagePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('removeBg');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader eyebrow={t('nav.image')} title={t('imageHub.title')} description={t('imageHub.description')} />

      <div className="flex gap-1 rounded-full border border-white/10 bg-surface/70 p-1">
        {(['removeBg', 'upscale'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 cursor-pointer rounded-full px-3 py-2 text-sm transition-colors ${
              tab === key ? 'bg-accent/15 font-medium text-accent-text' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t(`imageHub.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'removeBg' ? <RemoveBgPage embedded /> : <UpscalePage embedded />}
    </div>
  );
}
