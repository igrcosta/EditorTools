import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';

const styles: Record<Variant, string> = {
  primary: 'btn-primary font-semibold text-white disabled:opacity-50',
  secondary:
    'border border-white/10 bg-white/[0.03] text-zinc-200 hover:border-accent/50 hover:bg-accent/[0.06] active:scale-[0.98] disabled:opacity-50 disabled:hover:border-white/10 disabled:hover:bg-white/[0.03]',
  ghost: 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100 disabled:opacity-50',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-6 py-2.5 text-sm transition disabled:cursor-not-allowed ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
