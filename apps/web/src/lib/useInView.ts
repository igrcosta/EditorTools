import { useEffect, useRef, useState } from 'react';

/**
 * True while the element is on screen. With `once`, it latches to true on first sight
 * (scroll reveals); without it, it follows visibility (pausing looping demos off-screen).
 */
export function useInView<T extends Element>({ once = false, margin = '0px 0px -10% 0px' } = {}) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { rootMargin: margin, threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [once, margin]);

  return [ref, inView] as const;
}
