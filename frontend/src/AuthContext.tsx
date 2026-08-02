import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AuthContext } from './hooks/useAuth'
import type { AuthUser } from './hooks/useAuth'

const BASE = '/api'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`${BASE}/auth/me`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false))
  }, [])

  async function loginWithGoogleIdToken(idToken: string) {
    const res = await fetch(`${BASE}/auth/google`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_token: idToken }),
    })
    if (!res.ok) throw new Error('Login failed')
    setUser(await res.json())
  }

  async function logout() {
    await fetch(`${BASE}/auth/logout`, { method: 'POST', credentials: 'include' })
    setUser(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: !!user, loading, loginWithGoogleIdToken, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}
