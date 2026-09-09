import { useEffect, useRef } from 'react';

/**
 * Procedural dot-grid background (see Editools DotField spec):
 * a rigid grid of dots whose radius/opacity are driven by a rounded-square
 * ring SDF field + traveling wave + deterministic noise. Seamless loop,
 * canvas-rendered, honors prefers-reduced-motion.
 */

const CONFIG = {
  loopSeconds: 12,
  grid: {
    targetSpacing: 17, // px at dpr 1; grid density derives from viewport
    minSpacing: 13,
  },
  dots: {
    baseRadius: 0.9,
    maxRadius: 3.1,
    minOpacity: 0.14,
    maxOpacity: 1,
  },
  field: {
    softness: 0.16,
    noiseAmount: 0.07,
    waveFrequency: 5,
    waveAmount: 0.22,
  },
  // Black + violet palette: dim dots are deep purple, hot dots near-white.
  colorDim: [124, 90, 230] as const,
  colorHot: [237, 233, 254] as const,
};

const TAU = Math.PI * 2;

/** Signed distance from a point to a rounded box centered at the origin. */
function roundedBoxSDF(px: number, py: number, bx: number, by: number, r: number): number {
  const qx = Math.abs(px) - bx + r;
  const qy = Math.abs(py) - by + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - r;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Deterministic per-dot noise (never re-rolled between frames). */
function hashNoise(ix: number, iy: number): number {
  const s = Math.sin(ix * 127.1 + iy * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Time-varying field parameters — every frequency is an integer multiple of the loop, so the loop is seamless. */
function fieldParams(t: number, w: number) {
  return {
    outerSize: 0.52 + 0.13 * Math.sin(w * t) + 0.05 * Math.sin(2 * w * t + 1.7),
    innerRatio: 0.55 + 0.14 * Math.sin(2 * w * t + 0.9),
    cornerRadius: 0.1 + 0.055 * Math.sin(3 * w * t + 4.2),
    rotation: 0.24 * Math.sin(w * t + 2.6),
    offsetX: 0.05 * Math.sin(2 * w * t + 5.1),
    offsetY: 0.05 * Math.sin(w * t + 0.4),
    wavePhase: w * 3 * t,
  };
}

function intensityAt(
  nx: number,
  ny: number,
  p: ReturnType<typeof fieldParams>,
  noise: number,
): number {
  // Center + rotate the sample point.
  const cx = nx - 0.5 - p.offsetX;
  const cy = ny - 0.5 - p.offsetY;
  const cos = Math.cos(p.rotation);
  const sin = Math.sin(p.rotation);
  const rx = cx * cos - cy * sin;
  const ry = cx * sin + cy * cos;

  const { softness, waveFrequency, waveAmount, noiseAmount } = CONFIG.field;
  const half = p.outerSize / 2;
  const inner = half * p.innerRatio;
  const corner = Math.min(half, p.cornerRadius);

  const dOuter = roundedBoxSDF(rx, ry, half, half, corner);
  const dInner = roundedBoxSDF(rx, ry, inner, inner, corner * p.innerRatio);

  // Soft rounded-square ring: inside the outer box but outside the inner one.
  const ring = smoothstep(softness, -softness * 0.4, dOuter) * smoothstep(-softness * 0.5, softness, dInner);

  // Traveling wave radiating from the center.
  const dist = Math.hypot(cx, cy);
  const wave = 0.5 + 0.5 * Math.sin(dist * waveFrequency * TAU - p.wavePhase);

  const intensity = ring * (1 - waveAmount + waveAmount * wave) + 0.05 * wave * (1 - ring) + (noise - 0.5) * noiseAmount;
  return Math.min(1, Math.max(0, intensity));
}

interface DotFieldProps {
  className?: string;
  /** Multiplies the animation speed (1 = spec default). */
  speed?: number;
}

export function DotField({ className = '', speed = 1 }: DotFieldProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    // Precomputed grid (positions + per-dot noise), rebuilt on resize only.
    let xs = new Float32Array(0);
    let ys = new Float32Array(0);
    let noise = new Float32Array(0);
    let count = 0;

    const rebuild = () => {
      const rect = container.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const spacing = Math.max(CONFIG.grid.minSpacing, Math.min(CONFIG.grid.targetSpacing, width / 46));
      const cols = Math.ceil(width / spacing) + 1;
      const rows = Math.ceil(height / spacing) + 1;
      count = cols * rows;
      xs = new Float32Array(count);
      ys = new Float32Array(count);
      noise = new Float32Array(count);
      const offsetX = (width - (cols - 1) * spacing) / 2;
      const offsetY = (height - (rows - 1) * spacing) / 2;
      let i = 0;
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < cols; c += 1) {
          xs[i] = offsetX + c * spacing;
          ys[i] = offsetY + r * spacing;
          noise[i] = hashNoise(c, r);
          i += 1;
        }
      }
    };

    const [dimR, dimG, dimB] = CONFIG.colorDim;
    const [hotR, hotG, hotB] = CONFIG.colorHot;
    const { baseRadius, maxRadius, minOpacity, maxOpacity } = CONFIG.dots;
    const w = (TAU / CONFIG.loopSeconds) * speed;
    // The field is sampled on a square normalized space to keep the shape square.
    const renderFrame = (tSeconds: number) => {
      ctx.clearRect(0, 0, width, height);
      const p = fieldParams(tSeconds, w);
      const scale = Math.min(width, height);
      const marginX = (width - scale) / 2;
      const marginY = (height - scale) / 2;
      for (let i = 0; i < count; i += 1) {
        const nx = (xs[i] - marginX) / scale;
        const ny = (ys[i] - marginY) / scale;
        const k = intensityAt(nx, ny, p, noise[i]);
        const radius = baseRadius + (maxRadius - baseRadius) * k;
        const alpha = minOpacity + (maxOpacity - minOpacity) * k;
        const cr = Math.round(dimR + (hotR - dimR) * k);
        const cg = Math.round(dimG + (hotG - dimG) * k);
        const cb = Math.round(dimB + (hotB - dimB) * k);
        ctx.beginPath();
        ctx.arc(xs[i], ys[i], radius, 0, TAU);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    rebuild();

    let frame = 0;
    if (reducedMotion) {
      renderFrame(2.4); // a pleasant static moment of the loop
    } else {
      const start = performance.now();
      const tick = (now: number) => {
        renderFrame(((now - start) / 1000) % (CONFIG.loopSeconds / Math.max(0.0001, speed)));
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }

    const observer = new ResizeObserver(() => {
      rebuild();
      if (reducedMotion) renderFrame(2.4);
    });
    observer.observe(container);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [speed]);

  return (
    <div ref={containerRef} className={className} aria-hidden>
      <canvas ref={canvasRef} className="h-full w-full" />
    </div>
  );
}
