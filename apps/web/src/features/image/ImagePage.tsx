import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { SegmentedTabs } from '../../components/SegmentedTabs';
import { RemoveBgPage } from './RemoveBgPage';
import { UpscalePage } from './UpscalePage';

type Tab = 'removeBg' | 'upscale';

/** Hub for the image tools: Remove Background and Upscale as tabs of one screen. */
export function ImagePage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('removeBg');

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title={t('imageHub.title')} description={t('imageHub.description')} />

      <SegmentedTabs
        options={['removeBg', 'upscale'] as const}
        value={tab}
        onChange={setTab}
        label={(key) => t(`imageHub.tabs.${key}`)}
      />

      {tab === 'removeBg' ? <RemoveBgPage embedded /> : <UpscalePage embedded />}
    </div>
  );
}
