import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AudioFixPage } from '../audiofix/AudioFixPage';
import { SilenceCutPage } from '../silencecut/SilenceCutPage';

type Tab = 'silence' | 'fix';

/** Hub for the audio tools: Cut Silence and Fix Audio as tabs of one screen. */
export function AudioPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('silence');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">{t('audioHub.title')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('audioHub.description')}</p>
      </div>

      <div className="flex gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
        {(['silence', 'fix'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 cursor-pointer rounded-md px-3 py-2 text-sm transition-colors ${
              tab === key
                ? 'bg-accent/15 font-medium text-accent'
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
