import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { ConvertPage } from '../converter/ConvertPage';
import { DownloadPage } from '../downloader/DownloadPage';

type Tab = 'download' | 'convert';

/** Hub for the file tools: Master Downloader and Convert as tabs of one screen. */
export function FilesPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('download');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('filesHub.title')} description={t('filesHub.description')} />

      <div className="flex gap-1 rounded-full border border-white/10 bg-surface p-1">
        {(['download', 'convert'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex-1 cursor-pointer rounded-full px-3 py-2 text-sm transition-colors ${
              tab === key ? 'bg-accent/15 font-medium text-accent-text' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {t(`filesHub.tabs.${key}`)}
          </button>
        ))}
      </div>

      {tab === 'download' ? <DownloadPage embedded /> : <ConvertPage embedded />}
    </div>
  );
}
