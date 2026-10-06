import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/Button';
import { useAuth } from '../../lib/auth';

/** First-run question. Declining is as easy as accepting, and changeable later in Account. */
export function ConsentNotice() {
  const { t } = useTranslation('account');
  const { setConsent } = useAuth();
  const [busy, setBusy] = useState(false);

  const answer = async (value: boolean) => {
    setBusy(true);
    try {
      await setConsent(value);
    } catch {
      setBusy(false); // the notice stays, the user can try again
    }
  };

  return (
    <div
      role="dialog"
      aria-labelledby="consent-title"
      className="panel fixed inset-x-4 bottom-4 z-40 mx-auto max-w-lg space-y-3 rounded-xl p-5 shadow-2xl"
    >
      <p id="consent-title" className="font-medium text-zinc-100">
        {t('consent.title')}
      </p>
      <p className="text-sm text-zinc-400">{t('consent.description')}</p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => void answer(true)}>
          {t('consent.accept')}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => void answer(false)}>
          {t('consent.decline')}
        </Button>
      </div>
    </div>
  );
}
