import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../AuthContext'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
          }) => void
          renderButton: (parent: HTMLElement, options: { theme: string; size: string }) => void
        }
      }
    }
  }
}

export default function Login() {
  const { loginWithGoogleIdToken } = useAuth()
  const buttonRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  useEffect(() => {
    if (!clientId || !buttonRef.current) return

    function render() {
      if (!window.google || !buttonRef.current) return
      window.google.accounts.id.initialize({
        client_id: clientId!,
        callback: async (response) => {
          try {
            await loginWithGoogleIdToken(response.credential)
          } catch {
            setError('Sign-in failed. Please try again.')
          }
        },
      })
      window.google.accounts.id.renderButton(buttonRef.current, { theme: 'filled_black', size: 'large' })
    }

    if (window.google) {
      render()
    } else {
      const interval = setInterval(() => {
        if (window.google) {
          clearInterval(interval)
          render()
        }
      }, 100)
      return () => clearInterval(interval)
    }
  }, [clientId, loginWithGoogleIdToken])

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <span className="text-green-400 font-bold text-2xl">⛳ Golf Analytics</span>
        <p className="text-slate-400 text-sm">Sign in to see your data</p>
        {!clientId && (
          <p className="text-red-400 text-sm max-w-xs text-center">
            VITE_GOOGLE_CLIENT_ID is not configured. Set it in frontend/.env to enable sign-in.
          </p>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div ref={buttonRef} />
      </div>
    </div>
  )
}
