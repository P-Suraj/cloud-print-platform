import { useEffect, useState } from 'react';
import { animate } from 'framer-motion';

export default function NumberRoll({ value, duration = 0.6, prefix = '', suffix = '' }) {
  const [displayValue, setDisplayValue] = useState(value);

  useEffect(() => {
    const controls = animate(displayValue, value, {
      duration,
      ease: [0.16, 1, 0.3, 1], // easeOutExpo
      onUpdate: (latest) => {
        setDisplayValue(Math.floor(latest));
      }
    });
    return () => controls.stop();
  }, [value, duration]);

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--font-mono)' }}>
      {prefix}{displayValue}{suffix}
    </span>
  );
}
