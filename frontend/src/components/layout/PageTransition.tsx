import { type ReactNode } from 'react'

interface PageTransitionProps {
  children: ReactNode
  pageKey: string
}

/** Render navigation immediately; route feedback should not wait for animation. */
export function PageTransition({ children, pageKey }: PageTransitionProps) {
  return <div key={pageKey}>{children}</div>
}
