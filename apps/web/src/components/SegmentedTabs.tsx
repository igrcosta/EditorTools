interface Props<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  label: (value: T) => string;
}

/** Equal-width tab strip whose highlight slides to the selected option (hub pages). */
export function SegmentedTabs<T extends string>({ options, value, onChange, label }: Props<T>) {
  const index = Math.max(0, options.indexOf(value));
  return (
    <div role="tablist" className="panel relative flex rounded-full p-1">
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-1 rounded-full bg-accent/15 shadow-[inset_0_0_0_1px_rgba(145,70,255,0.45),0_0_24px_-8px_rgba(145,70,255,0.8)] transition-transform duration-300 ease-[var(--ease-reveal)]"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(${index * 100}%)`,
        }}
      />
      {options.map((key) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`relative z-10 flex-1 cursor-pointer rounded-full px-3 py-2 text-sm transition-colors ${
            value === key ? 'font-medium text-accent-text' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          {label(key)}
        </button>
      ))}
    </div>
  );
}
