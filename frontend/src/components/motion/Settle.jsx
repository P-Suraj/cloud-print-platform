import { motion } from 'framer-motion';

export default function Settle({ children, delay = 0, yOffset = -12, className = "", style = {} }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: yOffset }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        type: 'spring',
        stiffness: 260,
        damping: 24,
        delay
      }}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  );
}
