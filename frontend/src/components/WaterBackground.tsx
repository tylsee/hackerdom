import { useEffect, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

// A local, resolution-independent canvas. Nothing is sent outside the browser.
export function WaterBackground() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ctx = element.getContext('2d');
    if (!ctx) return;
    let width = 1,
      height = 1,
      frame = 0;
    let pointer = { x: 0.65, y: 0.35 },
      current = { ...pointer };
    const ripples: { x: number; y: number; born: number }[] = [];
    let lastRipple = 0;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = width * dpr;
      element.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const move = (event: PointerEvent) => {
      pointer = { x: event.clientX / width, y: event.clientY / height };
      if (performance.now() - lastRipple > 170 && !reduced) {
        ripples.push({ x: event.clientX, y: event.clientY, born: performance.now() });
        if (ripples.length > 8) ripples.shift();
        lastRipple = performance.now();
      }
      element.dataset.pointer = `${Math.round(event.clientX)},${Math.round(event.clientY)}`;
    };
    const draw = (now: number) => {
      current.x += (pointer.x - current.x) * 0.035;
      current.y += (pointer.y - current.y) * 0.035;
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, width, height);
      const time = reduced ? 0 : now * 0.00015;
      const pools = [
        { x: 0.12, y: 0.4, color: '173,206,230' },
        { x: 0.83, y: 0.23, color: '196,173,237' },
        { x: 0.64, y: 0.87, color: '155,219,199' },
        { x: current.x, y: current.y, color: '167,191,236' },
        { x: current.x + 0.12, y: current.y - 0.09, color: '186,160,224' },
      ];
      pools.forEach((pool, index) => {
        const x = pool.x * width + Math.sin(time + index) * 40;
        const y = pool.y * height + Math.cos(time * 0.7 + index) * 35;
        const radius = Math.max(width * 0.32, 290);
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(${pool.color},${index > 2 ? 0.32 : 0.23})`);
        gradient.addColorStop(1, `rgba(${pool.color},0)`);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
      });
      // Fine, slow caustic lines suggest water without overpowering the interface.
      ctx.lineWidth = 1;
      for (let line = 0; line < 7; line++) {
        ctx.beginPath();
        for (let x = 0; x <= width; x += 14) {
          const distance = (x - current.x * width) / width;
          const y =
            height * (0.2 + line * 0.13) +
            Math.sin(x / 180 + time + line) * 25 +
            Math.cos(distance * 5 + time) * 15;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,.3)';
        ctx.stroke();
      }
      ripples.forEach((ripple) => {
        const age = (now - ripple.born) / 1400;
        if (age >= 1) return;
        ctx.beginPath();
        ctx.ellipse(ripple.x, ripple.y, 15 + age * 90, 8 + age * 44, -0.2, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(122,163,192,${(1 - age) * 0.1})`;
        ctx.stroke();
      });
      if (!reduced) frame = requestAnimationFrame(draw);
    };
    resize();
    draw(performance.now());
    window.addEventListener('resize', resize);
    if (!reduced) window.addEventListener('pointermove', move, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', move);
    };
  }, [reduced]);
  return (
    <canvas
      ref={canvas}
      className="water-background"
      aria-hidden="true"
      data-testid="water-background"
    />
  );
}
