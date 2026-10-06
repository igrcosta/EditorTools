import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { PLAN_IDS, type PlanLimits } from '@editools/shared';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { PageHeader } from '../../components/PageHeader';
import { Pills } from '../../components/Pills';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const fmtDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso)) : '';

export function AccountPage() {
  const { t } = useTranslation('account');
  const { session, entitlements, isAdmin, signOut, setConsent, deleteAccount, adminSetPlan, adminResetQuota } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (session?.state !== 'authenticated' || !entitlements) return <Navigate to="/login" replace />;
  const e = entitlements;

  const run = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name);
    setFailed(false);
    try {
      await action();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  const exportData = () =>
    run('export', async () => {
      const data = await api.exportAccountData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'editools-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
    });

  const limitRows = (l: PlanLimits): Array<[string, string]> => {
    const none = t('account.limits.unlimited');
    return [
      ['dailyRuns', l.dailyRuns === null ? none : String(l.dailyRuns)],
      ['maxMediaSeconds', l.maxMediaSeconds === null ? none : t('account.limits.minutes', { count: Math.round(l.maxMediaSeconds / 60) })],
      [
        'maxUploadBytes',
        l.maxUploadBytes === null
          ? none
          : l.maxUploadBytes >= 1024 ** 3
            ? t('account.limits.gigabytes', { count: +(l.maxUploadBytes / 1024 ** 3).toFixed(1) })
            : t('account.limits.megabytes', { count: Math.round(l.maxUploadBytes / 1024 ** 2) }),
      ],
      ['maxDownloadHeight', l.maxDownloadHeight === null ? none : t('account.limits.height', { count: l.maxDownloadHeight })],
      ['allowedUpscaleScales', l.allowedUpscaleScales === null ? none : t('account.limits.scales', { list: l.allowedUpscaleScales.join(', ×') })],
    ];
  };

  const statusText = t(`account.status.${e.status}`, { date: fmtDate(e.accessUntil) });
  const q = e.quota;

  return (
    <div className="space-y-6">
      <PageHeader title={t('account.title')} description={session.user.email} />

      {session.offline && <ErrorMessage>{t('account.offline')}</ErrorMessage>}
      {failed && <ErrorMessage>{t('errors.generic')}</ErrorMessage>}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('account.plan')}</p>
            <p className="font-display text-xl text-zinc-100">{t(`account.plans.${e.plan}`)}</p>
            {statusText && <p className="text-sm text-zinc-400">{statusText}</p>}
          </div>
          {e.plan === 'free' && (
            <Link to="/pricing" className="btn-primary rounded-full px-6 py-2.5 text-sm font-semibold text-white">
              {t('account.upgrade')}
            </Link>
          )}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('account.usage')}</p>
          <p className="text-sm text-zinc-200">
            {q.limit === null
              ? t('account.usageUnlimited', { used: q.used })
              : t('account.usageLimited', { used: q.used, limit: q.limit })}
          </p>
          {q.limit !== null && (
            <>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <div className="h-full bg-accent" style={{ width: `${Math.min(100, (q.used / q.limit) * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-zinc-500">{t('account.resets', { when: fmtDate(q.resetsAt) })}</p>
            </>
          )}
        </div>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-zinc-100">{t('account.limitsTitle')}</p>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {limitRows(e.limits).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-4 border-b border-white/5 pb-1.5">
              <dt className="text-zinc-400">{t(`account.limits.${key}`)}</dt>
              <dd className="text-zinc-100">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-zinc-100">{t('account.privacyTitle')}</p>
        <p className="text-sm text-zinc-400">{t('account.privacyDescription')}</p>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-zinc-200">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--color-accent,#9146ff)]"
            checked={e.consentAnalytics}
            disabled={busy !== null}
            onChange={(ev) => void run('consent', () => setConsent(ev.target.checked))}
          />
          {t('account.analytics')}
        </label>
      </Card>

      <Card className="space-y-3">
        <p className="font-medium text-zinc-100">{t('account.yourData')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy !== null} onClick={() => void exportData()}>
            {busy === 'export' ? t('account.exporting') : t('account.export')}
          </Button>
          <Button variant="ghost" disabled={busy !== null} onClick={() => void run('signout', signOut)}>
            {t('account.signOut')}
          </Button>
          {!confirmDelete && (
            <Button variant="ghost" className="text-red-300" disabled={busy !== null} onClick={() => setConfirmDelete(true)}>
              {t('account.delete')}
            </Button>
          )}
        </div>
        {confirmDelete && (
          <div className="space-y-3 rounded-md border border-red-900/60 bg-red-950/30 p-4">
            <p className="text-sm text-red-200">{t('account.deleteConfirm')}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                className="!border-red-800 text-red-200"
                disabled={busy !== null}
                onClick={() => void run('delete', deleteAccount)}
              >
                {busy === 'delete' ? t('account.deleting') : t('account.deleteConfirmButton')}
              </Button>
              <Button variant="ghost" disabled={busy !== null} onClick={() => setConfirmDelete(false)}>
                {t('account.cancel')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {isAdmin && (
        <Card className="space-y-3 border border-accent/30">
          <p className="font-medium text-zinc-100">{t('account.devTools')}</p>
          <p className="text-sm text-zinc-400">{t('account.devDescription')}</p>
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t('account.devSetPlan')}</p>
            <Pills
              options={PLAN_IDS}
              value={e.plan}
              disabled={busy !== null}
              onChange={(plan) => void run('plan', () => adminSetPlan(plan))}
              label={(p) => t(`account.plans.${p}`)}
            />
          </div>
          <Button variant="secondary" disabled={busy !== null} onClick={() => void run('quota', adminResetQuota)}>
            {t('account.devResetQuota')}
          </Button>
        </Card>
      )}
    </div>
  );
}
