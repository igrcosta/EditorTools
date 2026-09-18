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
      className={`w-full cursor-pointer rounded-lg border-2 border-dashed p-10 text-center transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        dragOver ? 'border-accent bg-accent/5' : 'border-zinc-700 hover:border-zinc-500'
      }`}
    >
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
