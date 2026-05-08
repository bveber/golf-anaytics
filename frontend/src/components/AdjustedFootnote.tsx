import React from 'react'

interface Props {
  elevation: number
  temperature: number
}

export default function AdjustedFootnote({ elevation, temperature }: Props): React.ReactElement {
  return (
    <p className="text-xs text-slate-500 mt-4">
      ~ Values include an approximate Rapsodo calibration adjustment (~1.2–1.4% club speed, ~1.7–2.0% ball speed, ~3–5% carry) computed at {elevation} ft, {temperature}°F.{' '}
      Toggle <span className="text-slate-400">Raw</span> to see Rapsodo-reported values.
    </p>
  )
}
