interface Props {
  title: string;
  description?: string;
  hint?: string;
}

/** Tool page header: title (+ optional description/hint), shared by every tool and hub page. */
export function PageHeader({ title, description, hint }: Props) {
  return (
    <div className="relative pb-1">
      <h1 className="text-fade font-display text-4xl leading-[1.05] tracking-[0.01em] sm:text-5xl">{title}</h1>
      {description && <p className="mt-3 max-w-xl text-base text-zinc-400">{description}</p>}
      {hint && <p className="mt-1.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}
