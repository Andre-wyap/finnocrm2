export function jitteredDelayMinutes(delayMinutes: number): number {
  if (delayMinutes <= 0) return 0
  const range = Math.min(15, Math.max(1, Math.round(delayMinutes * 0.1)))
  const delta = Math.floor(Math.random() * (range * 2 + 1)) - range
  return Math.max(0, delayMinutes + delta)
}

export function flowDurationLabel(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes} ${totalMinutes === 1 ? 'min' : 'mins'}`
  if (totalMinutes < 1440) {
    const hours = totalMinutes / 60
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} ${hours === 1 ? 'hr' : 'hrs'}`
  }
  const days = totalMinutes / 1440
  return `${Number.isInteger(days) ? days : days.toFixed(1)} ${days === 1 ? 'day' : 'days'}`
}
