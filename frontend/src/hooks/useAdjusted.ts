import { useState } from 'react'

export function useAdjusted(defaultOn = true): { adjusted: boolean; toggleAdjusted: () => void } {
  const [adjusted, setAdjusted] = useState(defaultOn)
  return { adjusted, toggleAdjusted: () => setAdjusted((v) => !v) }
}
