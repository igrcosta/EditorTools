import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useLocation } from 'react-router-dom';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ErrorMessage } from '../../components/ErrorMessage';
import { Input } from '../../components/Input';
import { ApiClientError } from '../../lib/api';
import { useAuth } from '../../lib/auth';

const RESEND_SECONDS = 30;

export function accountErrorKey(err: unknown): string {
  const code = err instanceof ApiClientError ? err.code : '';
  return ['invalid_code', 'rate_limited', 'account_offline'].includes(code) ? code : 'generic';
}

export function LoginPage() {
  const { t } = useTranslation('account');
  const { session, requestCode, verifyCode } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  if (session?.state === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from;
    return <Navigate to={from && from.startsWith('/') ? from : '/'} replace />;
  }

  const send = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      await requestCode(address);
      setSentTo(address);
      setCode('');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      setError(accountErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    void send(email.trim());
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    try {
      await verifyCode(sentTo, code.trim());
    } catch (err) {
      setError(accountErrorKey(err));
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-2xl text-zinc-100">{t('login.title')}</h1>
        <p className="text-sm text-zinc-400">{t('login.description')}</p>
      </div>

      <Card className="space-y-4">
        {!sentTo ? (
          <form onSubmit={onEmail} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('login.email')}</span>
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                autoFocus
                required
                maxLength={254}
                placeholder={t('login.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {error && <ErrorMessage>{t(`errors.${error}`)}</ErrorMessage>}
            <Button type="submit" className="w-full" disabled={busy || !email.includes('@')}>
              {busy ? t('login.sending') : t('login.sendCode')}
            </Button>
          </form>
        ) : (
          <form onSubmit={(e) => void onCode(e)} className="space-y-4">
            <p className="text-sm text-zinc-300">{t('login.codeSent', { email: sentTo })}</p>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t('login.code')}</span>
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                maxLength={6}
                pattern="\d{6}"
                placeholder="000000"
                className="text-center font-mono text-lg tracking-[0.4em]"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            {error && <ErrorMessage>{t(`errors.${error}`)}</ErrorMessage>}
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? t('login.verifying') : t('login.verify')}
            </Button>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <Button
                type="button"
                variant="ghost"
                className="!px-3 !py-1.5"
                disabled={busy || cooldown > 0}
                onClick={() => void send(sentTo)}
              >
                {cooldown > 0 ? t('login.resendIn', { seconds: cooldown }) : t('login.resend')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="!px-3 !py-1.5"
                disabled={busy}
                onClick={() => {
                  setSentTo(null);
                  setError(null);
                }}
              >
                {t('login.changeEmail')}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
