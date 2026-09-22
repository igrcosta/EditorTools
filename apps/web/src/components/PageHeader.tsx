interface Props {
  title: string;
  description?: string;
  hint?: string;
}

/** Tool page header: title (+ optional description/hint), shared by every tool and hub page. */
export function PageHeader({ title, description, hint }: Props) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-100">{title}</h1>
      {description && <p className="mt-1.5 text-sm text-zinc-400">{description}</p>}
      {hint && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
