import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { SegmentedTabs } from '../../components/SegmentedTabs';
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

      <SegmentedTabs
        options={['download', 'convert'] as const}
        value={tab}
        onChange={setTab}
        label={(key) => t(`filesHub.tabs.${key}`)}
      />

      {tab === 'download' ? <DownloadPage embedded /> : <ConvertPage embedded />}
    </div>
  );
}
