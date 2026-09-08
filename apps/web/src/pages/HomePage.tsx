import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

interface Tool {
  key: 'download' | 'convert' | 'fixAudio' | 'trimAudio';
  to?: string;
}

const TOOLS: Tool[] = [
  { key: 'download', to: '/download' },
  { key: 'convert' },
  { key: 'fixAudio' },
  { key: 'trimAudio' },
];

export function HomePage() {
  const { t } = useTranslation();
  return (
    <div>
      <div className="mb-10 text-center">
        <h1 className="text-2xl font-semibold text-zinc-100">{t('tagline')}</h1>
        <p className="mt-1 text-sm text-zinc-400">{t('subtitle')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TOOLS.map((tool) =>
          tool.to ? (
            <Link
              key={tool.key}
              to={tool.to}
              className="group rounded-lg border border-zinc-800 bg-zinc-900 p-5 transition-colors hover:border-accent"
            >
              <h2 className="font-medium text-zinc-100 group-hover:text-accent">
                {t(`tools.${tool.key}.title`)}
              </h2>
              <p className="mt-1 text-sm text-zinc-400">{t(`tools.${tool.key}.description`)}</p>
            </Link>
          ) : (
            <div
              key={tool.key}
              className="rounded-lg border border-zinc-800/60 bg-zinc-900/40 p-5 opacity-60"
            >
              <div className="flex items-center justify-between">
                <h2 className="font-medium text-zinc-300">{t(`tools.${tool.key}.title`)}</h2>
                <span className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-500">
                  {t('comingSoon')}
                </span>
              </div>
              <p className="mt-1 text-sm text-zinc-500">{t(`tools.${tool.key}.description`)}</p>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
