import { motion } from 'framer-motion';

export default function Appear({ children, delay = 0, duration = 0.4, className = "", style = {} }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96, filter: 'blur(4px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      transition={{
        duration,
        delay,
        ease: [0.16, 1, 0.3, 1] // Precision custom easeOutExpo
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
