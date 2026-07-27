import { useEffect, useRef } from 'react';

export default function Heartbeat({ online = true, speed = 1.5 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let width = canvas.width = canvas.offsetWidth;
    let height = canvas.height = canvas.offsetHeight;

    const handleResize = () => {
      width = canvas.width = canvas.offsetWidth;
      height = canvas.height = canvas.offsetHeight;
    };
    window.addEventListener('resize', handleResize);

    const points = [];
    const maxPoints = 120;

    // Get theme color signals dynamically
    const style = getComputedStyle(document.documentElement);
    const successColor = style.getPropertyValue('--success').trim() || '#1FE877';
    const errorColor = style.getPropertyValue('--error').trim() || '#FF3B30';
    const signalColor = online ? successColor : errorColor;

    let phase = 0;
    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      let y = height / 2;
      
      if (online) {
        const cycle = (phase % 100);
        if (cycle > 35 && cycle < 60) {
          const t = (cycle - 35) / 25; // 0 to 1
          if (t < 0.2) {
            // P wave
            y -= Math.sin(t * 5 * Math.PI) * (height * 0.1);
          } else if (t >= 0.2 && t < 0.3) {
            // Q wave drop
            y += (t - 0.2) * 10 * (height * 0.15);
          } else if (t >= 0.3 && t < 0.5) {
            // R wave spike
            y -= Math.sin((t - 0.3) * 5 * Math.PI) * (height * 0.45);
          } else if (t >= 0.5 && t < 0.6) {
            // S wave drop
            y += Math.sin((t - 0.5) * 10 * Math.PI) * (height * 0.2);
          } else if (t >= 0.6 && t < 0.8) {
            // T wave
            y -= Math.sin((t - 0.6) * 5 * Math.PI) * (height * 0.15);
          }
        }
      } else {
        // Flatline with small micro-voltage variance
        y += (Math.random() - 0.5) * 0.8;
      }

      points.push({ x: width, y });
      if (points.length > maxPoints) {
        points.shift();
      }

      const step = width / maxPoints;
      ctx.beginPath();
      ctx.lineWidth = 1.75;
      ctx.strokeStyle = signalColor;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      // Subtle glow shadow in canvas
      ctx.shadowBlur = 4;
      ctx.shadowColor = signalColor;

      for (let i = 0; i < points.length; i++) {
        points[i].x = i * step;
        if (i === 0) {
          ctx.moveTo(points[i].x, points[i].y);
        } else {
          ctx.lineTo(points[i].x, points[i].y);
        }
      }
      ctx.stroke();

      phase += speed;
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
      window.removeEventListener('resize', handleResize);
    };
  }, [online, speed]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ width: '100%', height: '100%', display: 'block', background: 'transparent' }} 
    />
  );
}
