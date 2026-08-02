import { createContext, useContext } from 'react'

export interface AuthUser {
  email: string
  display_name: string | null
}

export interface AuthContextValue {
  user: AuthUser | null
  isAuthenticated: boolean
  loading: boolean
  loginWithGoogleIdToken: (idToken: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  isAuthenticated: false,
  loading: true,
  loginWithGoogleIdToken: async () => {},
  logout: async () => {},
})

export const useAuth = () => useContext(AuthContext)
