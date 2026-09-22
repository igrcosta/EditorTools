import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { AudioFixPage } from '../audiofix/AudioFixPage';
import { SilenceCutPage } from '../silencecut/SilenceCutPage';

type Tab = 'silence' | 'fix';

/** Hub for the audio tools: Cut Silence and Fix Audio as tabs of one screen. */
export function AudioPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('silence');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('audioHub.title')} description={t('audioHub.description')} />

      <div className="flex gap-1 rounded-full border border-white/10 bg-surface p-1">
        {(['silence', 'fix'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 cursor-pointer rounded-full px-3 py-2 text-sm transition-colors ${
              tab === key
                ? 'bg-accent/15 font-medium text-accent-text'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t(`audioHub.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'silence' ? <SilenceCutPage embedded /> : <AudioFixPage embedded />}
    </div>
  );
}
