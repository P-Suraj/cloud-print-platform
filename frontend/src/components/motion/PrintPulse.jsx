import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function PrintPulse() {
  const [pulses, setPulses] = useState([]);

  useEffect(() => {
    const handleTrigger = (e) => {
      const id = Date.now() + Math.random();
      const x = e.detail?.x !== undefined ? e.detail.x : window.innerWidth / 2;
      const y = e.detail?.y !== undefined ? e.detail.y : window.innerHeight / 2;
      
      setPulses((prev) => [...prev, { id, x, y }]);
    };

    window.addEventListener('print-pulse', handleTrigger);
    return () => window.removeEventListener('print-pulse', handleTrigger);
  }, []);

  const handleAnimationComplete = (id) => {
    setPulses((prev) => prev.filter((p) => p.id !== id));
  };

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 9999, overflow: 'hidden' }}>
      <AnimatePresence>
        {pulses.map((pulse) => (
          <motion.div
            key={pulse.id}
            initial={{
              position: 'absolute',
              left: pulse.x,
              top: pulse.y,
              width: 0,
              height: 0,
              borderRadius: '50%',
              border: '1.25px solid var(--primary-light)',
              transform: 'translate(-50%, -50%)',
              opacity: 0.6,
              boxShadow: '0 0 8px var(--primary-glow)'
            }}
            animate={{
              width: '250vmax',
              height: '250vmax',
              opacity: 0
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 1.0,
              ease: [0.1, 0.8, 0.15, 1.0] // Expanding pressure wave cubic-bezier
            }}
            onAnimationComplete={() => handleAnimationComplete(pulse.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
