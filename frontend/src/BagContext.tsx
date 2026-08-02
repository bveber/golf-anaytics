import { useState } from 'react'
import type { ReactNode } from 'react'
import { BagContext, bagKey } from './hooks/useBag'

export function BagProvider({ children }: { children: ReactNode }) {
  const [disabledClubs, setDisabledClubs] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('bag_disabled_clubs_v2')
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })

  function toggleClub(clubType: string, club: string) {
    const key = bagKey(clubType, club)
    setDisabledClubs((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      localStorage.setItem('bag_disabled_clubs_v2', JSON.stringify([...next]))
      return next
    })
  }

  return (
    <BagContext.Provider value={{ disabledClubs, toggleClub, isActive: (ct, club) => !disabledClubs.has(bagKey(ct, club)) }}>
      {children}
    </BagContext.Provider>
  )
}
