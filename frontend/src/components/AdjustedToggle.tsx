import React from 'react'

interface Props {
  adjusted: boolean
  onToggle: () => void
}

export default function AdjustedToggle({ adjusted, onToggle }: Props): React.ReactElement {
  return (
    <button
      onClick={onToggle}
      className={`text-xs px-2 py-1 rounded border transition-colors ${
        adjusted
          ? 'border-green-600 text-green-400 bg-green-950'
          : 'border-slate-600 text-slate-400 bg-slate-800'
      }`}
    >
      {adjusted ? '~ Adjusted' : 'Raw'}
    </button>
  )
}
