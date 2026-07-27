import { useState, useEffect } from 'react';
import { animate } from 'framer-motion';

export function useCounter(value, duration = 0.6) {
  const [count, setCount] = useState(value);

  useEffect(() => {
    const controls = animate(count, value, {
      duration,
      ease: [0.16, 1, 0.3, 1], // easeOutExpo
      onUpdate: (latest) => setCount(Math.floor(latest))
    });
    return () => controls.stop();
  }, [value, duration]);

  return count;
}

export function useSettle(delay = 0, yOffset = -12) {
  return {
    initial: { opacity: 0, y: yOffset },
    animate: { opacity: 1, y: 0 },
    transition: {
      type: 'spring',
      stiffness: 260,
      damping: 24,
      delay
    }
  };
}

export function useSignal(isActive, colorActive = '--success', colorInactive = '--text-muted') {
  const [color, setColor] = useState(colorInactive);

  useEffect(() => {
    const activeVal = getComputedStyle(document.documentElement).getPropertyValue(colorActive).trim();
    const inactiveVal = getComputedStyle(document.documentElement).getPropertyValue(colorInactive).trim();
    setColor(isActive ? activeVal : inactiveVal);
  }, [isActive, colorActive, colorInactive]);

  return color;
}
