import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { SyncJob, UserSettings } from '../api'

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

  const [credsConfigured, setCredsConfigured] = useState<boolean | null>(null)
  const [rcloudEmail, setRcloudEmail] = useState('')
  const [rcloudPassword, setRcloudPassword] = useState('')
  const [credsSaving, setCredsSaving] = useState(false)
  const [credsError, setCredsError] = useState<string | null>(null)

  const [syncJob, setSyncJob] = useState<SyncJob | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    api.getSettings().then((s) => {
      setElevation(s.elevation_ft)
      setTemperature(s.temperature_f)
      setLoading(false)
    })
    api.rcloudCredentialsStatus().then((s) => setCredsConfigured(s.configured))
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
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

  async function handleSaveCredentials(): Promise<void> {
    setCredsSaving(true)
    setCredsError(null)
    try {
      await api.setRcloudCredentials(rcloudEmail, rcloudPassword)
      setCredsConfigured(true)
      setRcloudEmail('')
      setRcloudPassword('')
    } catch {
      setCredsError('Failed to save Rapsodo credentials')
    } finally {
      setCredsSaving(false)
    }
  }

  async function handleRemoveCredentials(): Promise<void> {
    setCredsSaving(true)
    setCredsError(null)
    try {
      await api.deleteRcloudCredentials()
      setCredsConfigured(false)
    } catch {
      setCredsError('Failed to remove Rapsodo credentials')
    } finally {
      setCredsSaving(false)
    }
  }

  function pollJob(jobId: number) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const job = await api.getSyncJob(jobId)
      setSyncJob(job)
      if (job.status === 'success' || job.status === 'failed') {
        if (pollRef.current) clearInterval(pollRef.current)
      }
    }, 3000)
  }

  async function handleSyncNow(): Promise<void> {
    const job = await api.triggerSync()
    setSyncJob(job)
    pollJob(job.job_id)
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 rounded-lg p-6 w-96 shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
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

        <hr className="border-slate-700 my-5" />

        <h2 className="text-white font-semibold text-lg mb-4">Rapsodo Account</h2>
        {credsConfigured === null ? (
          <p className="text-slate-400 text-sm">Loading…</p>
        ) : credsConfigured ? (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">Rapsodo credentials are configured.</p>
            <button
              onClick={handleRemoveCredentials}
              disabled={credsSaving}
              className="w-full bg-red-800 hover:bg-red-700 text-white text-sm py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {credsSaving ? 'Removing…' : 'Remove credentials'}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block">
              <span className="text-slate-300 text-sm">Rapsodo email</span>
              <input
                type="email"
                value={rcloudEmail}
                onChange={(e) => setRcloudEmail(e.target.value)}
                className="mt-1 w-full bg-slate-700 text-white rounded px-3 py-1.5 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-slate-300 text-sm">Rapsodo password</span>
              <input
                type="password"
                value={rcloudPassword}
                onChange={(e) => setRcloudPassword(e.target.value)}
                className="mt-1 w-full bg-slate-700 text-white rounded px-3 py-1.5 text-sm"
              />
            </label>
            {credsError && <p className="text-red-400 text-sm">{credsError}</p>}
            <button
              onClick={handleSaveCredentials}
              disabled={credsSaving || !rcloudEmail || !rcloudPassword}
              className="w-full bg-green-700 hover:bg-green-600 text-white text-sm py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {credsSaving ? 'Saving…' : 'Save credentials'}
            </button>
          </div>
        )}

        {credsConfigured && (
          <>
            <hr className="border-slate-700 my-5" />
            <h2 className="text-white font-semibold text-lg mb-4">Sync</h2>
            <button
              onClick={handleSyncNow}
              disabled={syncJob?.status === 'queued' || syncJob?.status === 'running'}
              className="w-full bg-green-700 hover:bg-green-600 text-white text-sm py-1.5 rounded transition-colors disabled:opacity-50"
            >
              {syncJob?.status === 'queued' || syncJob?.status === 'running' ? 'Syncing…' : 'Sync now'}
            </button>
            {syncJob && (
              <p className="text-slate-400 text-sm mt-2">
                {syncJob.status === 'success' && `Done — ${syncJob.result}`}
                {syncJob.status === 'failed' && `Failed — ${syncJob.error}`}
                {syncJob.status === 'queued' && 'Queued…'}
                {syncJob.status === 'running' && (syncJob.progress ?? 'Starting sync…')}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
