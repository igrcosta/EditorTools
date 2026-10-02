/** Real progress when `value` is 0–100; indeterminate animation when null (never fake numbers). */
export function ProgressBar({ value }: { value: number | null }) {
  return (
    <div
      className="relative h-2 w-full overflow-hidden rounded-full bg-white/[0.06]"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? undefined}
    >
      {value === null ? (
        <div className="progress-indeterminate absolute top-0 h-full w-1/3 rounded-full bg-gradient-to-r from-accent-strong to-accent-text" />
      ) : (
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-strong to-accent-text shadow-[0_0_12px_rgba(145,70,255,0.7)] transition-[width] duration-300"
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      )}
    </div>
  );
}
