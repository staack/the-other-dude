import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from 0 to a target value using requestAnimationFrame.
 * Respects prefers-reduced-motion by displaying the value instantly.
 *
 * @param target - The target number to animate to
 * @param duration - Animation duration in milliseconds (default 800)
 * @param decimals - Number of decimal places to round to (default 0)
 * @returns The current animated display value
 */
export function useAnimatedCounter(
  target: number,
  duration = 800,
  decimals = 0,
): number {
  const [value, setValue] = useState(0)
  const frameRef = useRef<number>(0)
  const startTimeRef = useRef<number>(0)
  const startValueRef = useRef<number>(0)

  useEffect(() => {
    // Check reduced motion preference
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (prefersReduced) {
      setValue(round(target, decimals))
      return
    }

    // Cancel any in-progress animation
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current)
    }

    startValueRef.current = value
    startTimeRef.current = 0

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) {
        startTimeRef.current = timestamp
      }

      const elapsed = timestamp - startTimeRef.current
      const progress = Math.min(elapsed / duration, 1)

      // Ease-out cubic: t => 1 - (1 - t)^3
      const eased = 1 - Math.pow(1 - progress, 3)

      const current =
        startValueRef.current + (target - startValueRef.current) * eased
      setValue(round(current, decimals))

      if (progress < 1) {
        frameRef.current = requestAnimationFrame(animate)
      }
    }

    frameRef.current = requestAnimationFrame(animate)

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration, decimals])

  return value
}

function round(value: number, decimals: number): number {
  if (decimals === 0) return Math.round(value)
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}
