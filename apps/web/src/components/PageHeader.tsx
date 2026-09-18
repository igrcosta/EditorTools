interface Props {
  eyebrow: string;
  title: string;
  description?: string;
  hint?: string;
}

/** Tool page header: a `{ category }` eyebrow above the title, shared by every tool and hub page. */
export function PageHeader({ eyebrow, title, description, hint }: Props) {
  return (
    <div>
      <p className="font-mono text-xs text-zinc-500">{`{ ${eyebrow} }`}</p>
      <h1 className="mt-2 text-2xl font-semibold text-zinc-100">{title}</h1>
      {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
