import { createContext, useContext } from 'react'

// Key format: "{club_type}|{club}" e.g. "lw|TaylorMade Hi-Toe"
export function bagKey(clubType: string, club: string) {
  return `${clubType}|${club}`
}

export interface BagContextValue {
  disabledClubs: Set<string>
  toggleClub: (clubType: string, club: string) => void
  isActive: (clubType: string, club: string) => boolean
}

export const BagContext = createContext<BagContextValue>({
  disabledClubs: new Set(),
  toggleClub: () => {},
  isActive: () => true,
})

export const useBag = () => useContext(BagContext)
