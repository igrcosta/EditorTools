interface Props<T extends string | number> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
  disabled?: boolean;
  /** Options that cannot be picked right now (rendered dimmed). */
  disabledOptions?: readonly T[];
}

/** Single-choice option row used by the tool pages. */
export function Pills<T extends string | number>({ options, value, onChange, label, disabled, disabledOptions }: Props<T>) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const off = disabled || disabledOptions?.includes(opt);
        return (
          <button
            key={String(opt)}
            type="button"
            onClick={() => onChange(opt)}
            disabled={off}
            className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              value === opt
                ? 'border-accent text-accent-text shadow-glow'
                : 'border-white/10 text-zinc-400 hover:border-white/25'
            }`}
          >
            {label(opt)}
          </button>
        );
      })}
    </div>
  );
}
