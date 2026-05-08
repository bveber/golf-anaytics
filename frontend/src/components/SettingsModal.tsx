import React, { useState, useEffect } from 'react'
import { api } from '../api'
import type { UserSettings } from '../api'

interface Props {
  onClose: () => void
  onSaved: (s: UserSettings) => void
}

export default function SettingsModal({ onClose, onSaved }: Props): React.ReactElement {
  const [elevation, setElevation] = useState(900)
  const [temperature, setTemperature] = useState(70)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setElevation(s.elevation_ft)
      setTemperature(s.temperature_f)
      setLoading(false)
    })
  }, [])

  async function handleSave(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.updateSettings({ elevation_ft: elevation, temperature_f: temperature })
      onSaved(updated)
      onClose()
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-lg p-6 w-80 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-white font-semibold text-lg mb-4">Conditions</h2>
        {loading ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : (
          <div className="space-y-4">
            <label className="block">
              <span className="text-slate-300 text-sm">Elevation</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={elevation}
                  min={0}
                  max={14000}
                  onChange={(e) => setElevation(Number(e.target.value))}
                  className="flex-1 bg-slate-700 text-white rounded px-3 py-1.5 text-sm"
                />
                <span className="text-slate-400 text-sm">ft</span>
              </div>
            </label>
            <label className="block">
              <span className="text-slate-300 text-sm">Temperature</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number"
                  value={temperature}
                  min={-40}
                  max={120}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  className="flex-1 bg-slate-700 text-white rounded px-3 py-1.5 text-sm"
                />
                <span className="text-slate-400 text-sm">°F</span>
              </div>
            </label>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-green-700 hover:bg-green-600 text-white text-sm py-1.5 rounded transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onClose}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm py-1.5 rounded transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
