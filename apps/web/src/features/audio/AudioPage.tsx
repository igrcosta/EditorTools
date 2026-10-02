import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '../../components/PageHeader';
import { SegmentedTabs } from '../../components/SegmentedTabs';
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

      <SegmentedTabs
        options={['silence', 'fix'] as const}
        value={tab}
        onChange={setTab}
        label={(key) => t(`audioHub.tabs.${key}`)}
      />

      {tab === 'silence' ? <SilenceCutPage embedded /> : <AudioFixPage embedded />}
    </div>
  );
}
