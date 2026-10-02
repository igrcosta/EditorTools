import { useEffect, useRef, useState, type DragEvent } from 'react';

interface Props {
  accept?: string;
  disabled?: boolean;
  label: string;
  hint?: string;
  /** Enables Ctrl+V clipboard paste and shows this line below the hint. Opt-in per caller. */
  pasteHint?: string;
  onFile: (file: File) => void;
}

function matchesAccept(type: string, accept?: string): boolean {
  if (!accept) return true;
  return accept.split(',').some((pattern) => {
    const p = pattern.trim();
    if (p === type) return true;
    const [category] = p.split('/');
    return p.endsWith('/*') && type.split('/')[0] === category;
  });
}

export function Dropzone({ accept, disabled, label, hint, pasteHint, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  useEffect(() => {
    if (!pasteHint || disabled) return;
    const onWindowPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.kind === 'file' && matchesAccept(item.type, accept)) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            onFile(file);
            return;
          }
        }
      }
    };
    window.addEventListener('paste', onWindowPaste);
    return () => window.removeEventListener('paste', onWindowPaste);
  }, [pasteHint, disabled, accept, onFile]);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={`group w-full cursor-pointer rounded-xl border border-dashed p-10 text-center transition duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
        dragOver
          ? 'scale-[1.01] border-accent bg-accent/10 shadow-[0_0_40px_-12px_rgba(145,70,255,0.8)]'
          : 'border-white/15 bg-white/[0.02] hover:border-accent/50 hover:bg-accent/[0.04]'
      }`}
    >
      <span
        className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/5 text-lg transition duration-300 group-hover:-translate-y-0.5 group-hover:border-accent/40 group-hover:text-accent-text ${
          dragOver ? 'border-accent/60 text-accent-text' : 'text-zinc-400'
        }`}
        aria-hidden="true"
      >
        <i className="fi-rr-upload" />
      </span>
      <p className="font-medium text-zinc-200">{label}</p>
      {hint && <p className="mt-1 text-sm text-zinc-500">{hint}</p>}
      {pasteHint && <p className="mt-1 text-sm text-zinc-500">{pasteHint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = '';
        }}
      />
    </button>
  );
}
