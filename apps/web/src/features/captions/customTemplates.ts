import type { CustomCaptionStyle } from '@editools/shared';

export interface CustomTemplate {
  id: string;
  name: string;
  style: CustomCaptionStyle;
}

const STORAGE_KEY = 'editools.captions.customTemplates';
const MAX_TEMPLATES = 12;

/** Per-browser convenience only — never required for the tool to work, so failures are silent. */
export function loadCustomTemplates(): CustomTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as CustomTemplate[]) : [];
  } catch {
    return [];
  }
}

export function saveCustomTemplate(name: string, style: CustomCaptionStyle): CustomTemplate[] {
  const existing = loadCustomTemplates();
  const next = [...existing, { id: crypto.randomUUID(), name, style }].slice(-MAX_TEMPLATES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or unavailable — the new template just won't persist past this session
  }
  return next;
}

export function deleteCustomTemplate(id: string): CustomTemplate[] {
  const next = loadCustomTemplates().filter((t) => t.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // ignore — same as above
  }
  return next;
}
