import { motion, useReducedMotion } from 'framer-motion'
import { type ReactNode } from 'react'

const variants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
}

interface PageTransitionProps {
  children: ReactNode
  /** Unique key for AnimatePresence to detect page changes */
  pageKey: string
}

export function PageTransition({ children, pageKey }: PageTransitionProps) {
  const prefersReducedMotion = useReducedMotion()

  if (prefersReducedMotion) {
    return <div key={pageKey}>{children}</div>
  }

  return (
    <motion.div
      key={pageKey}
      variants={variants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ duration: 0.2, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
