import { useRef, useState, type DragEvent } from 'react';

interface Props {
  accept?: string;
  disabled?: boolean;
  label: string;
  hint?: string;
  onFile: (file: File) => void;
}

export function Dropzone({ accept, disabled, label, hint, onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

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
