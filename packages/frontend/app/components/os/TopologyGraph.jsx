'use client';

import { useEffect, useRef } from 'react';

// Renders three nodes (agent wallet -> ShieldGuard module -> target contract)
// connected by an animated dashed line. Mode controls the third node's
// color/label and the line color, so a simulated payload visibly reads as
// safe (purple/verified router) or hostile (rose/untrusted spender).
export default function TopologyGraph({ mode }) {
  const canvasRef = useRef(null);
  const offsetRef = useRef(0);
  const rafRef = useRef(null);
  const modeRef = useRef(mode);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    function draw() {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);

      const exploit = modeRef.current === 'exploit';
      const n1 = { x: w * 0.18, y: h * 0.5, label: 'Agent Wallet', color: '#10b981' };
      const n2 = { x: w * 0.5, y: h * 0.5, label: 'ShieldGuard Module', color: '#06b6d4' };
      const n3 = {
        x: w * 0.82,
        y: exploit ? h * 0.25 : h * 0.5,
        label: exploit ? 'Untrusted Spender' : 'Uniswap V3 Router',
        color: exploit ? '#f43f5e' : '#8b5cf6',
      };

      ctx.beginPath();
      ctx.moveTo(n1.x, n1.y);
      ctx.lineTo(n2.x, n2.y);
      ctx.lineTo(n3.x, n3.y);
      ctx.strokeStyle = exploit ? 'rgba(244, 63, 94, 0.4)' : 'rgba(6, 182, 212, 0.4)';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.lineDashOffset = -offsetRef.current;
      ctx.stroke();
      ctx.setLineDash([]);

      [n1, n2, n3].forEach((n) => {
        ctx.beginPath();
        ctx.arc(n.x, n.y, 14, 0, Math.PI * 2);
        ctx.fillStyle = '#050507';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = n.color;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(n.x, n.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();

        ctx.font = "10px 'JetBrains Mono', monospace";
        ctx.fillStyle = '#a1a1aa';
        ctx.textAlign = 'center';
        ctx.fillText(n.label, n.x, n.y + 28);
      });
    }

    function resize() {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
      draw();
    }

    function animate() {
      offsetRef.current += 0.5;
      draw();
      rafRef.current = requestAnimationFrame(animate);
    }

    resize();
    animate();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return <canvas ref={canvasRef} className="w-full h-full block rounded bg-zinc-950/40 border border-zinc-800/50" />;
}
