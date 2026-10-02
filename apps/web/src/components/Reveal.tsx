import type { CSSProperties, ElementType, ReactNode } from 'react';
import { useInView } from '../lib/useInView';

interface Props {
  children: ReactNode;
  /** Stagger, in milliseconds. */
  delay?: number;
  /** Rise distance in px. */
  distance?: number;
  blur?: number;
  as?: ElementType;
  className?: string;
}

/** Fades, rises and un-blurs its children the first time they scroll into view. */
export function Reveal({ children, delay = 0, distance, blur, as: Tag = 'div', className = '' }: Props) {
  const [ref, inView] = useInView<HTMLElement>({ once: true });
  const style = {
    '--reveal-delay': `${delay}ms`,
    ...(distance !== undefined && { '--reveal-distance': `${distance}px` }),
    ...(blur !== undefined && { '--reveal-blur': `${blur}px` }),
  } as CSSProperties;
  return (
    <Tag ref={ref} className={`reveal ${className}`} data-in={inView} style={style}>
      {children}
    </Tag>
  );
}
