const MYT_OFFSET_MINUTES = 8 * 60
const MINUTE_MS = 60_000

export const DEFAULT_WA_DAILY_SEND_CAP = 150
export const DEFAULT_WA_QUIET_HOURS = '21-9'
export const WA_MAX_SEND_ATTEMPTS = 3

export type QuietHours = {
  startHour: number
  endHour: number
  label: string
}

function parseHour(value: string): number | null {
  const hour = Number(value)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null
}

export function parseQuietHours(value?: string): QuietHours {
  const raw = value?.trim() || DEFAULT_WA_QUIET_HOURS
  const [startValue, endValue, extra] = raw.split('-')
  const startHour = parseHour(startValue)
  const endHour = parseHour(endValue)
  if (extra !== undefined || startHour === null || endHour === null || startHour === endHour) {
    return { startHour: 21, endHour: 9, label: DEFAULT_WA_QUIET_HOURS }
  }
  return { startHour, endHour, label: `${startHour}-${endHour}` }
}

export function getWhatsAppSafetyConfig(): {
  dailySendCap: number
  quietHours: QuietHours
  maxAttempts: number
} {
  const configuredCap = Number(process.env.WA_DAILY_SEND_CAP)
  const dailySendCap =
    Number.isInteger(configuredCap) && configuredCap > 0 && configuredCap <= 10_000
      ? configuredCap
      : DEFAULT_WA_DAILY_SEND_CAP
  return {
    dailySendCap,
    quietHours: parseQuietHours(process.env.WA_QUIET_HOURS),
    maxAttempts: WA_MAX_SEND_ATTEMPTS,
  }
}

function mytDateParts(date: Date): {
  year: number
  month: number
  day: number
  minuteOfDay: number
} {
  const local = new Date(date.getTime() + MYT_OFFSET_MINUTES * MINUTE_MS)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    minuteOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  }
}

function mytTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number
): Date {
  return new Date(Date.UTC(year, month, day, hour) - MYT_OFFSET_MINUTES * MINUTE_MS)
}

export function nextAllowedWhatsAppSendAt(
  now: Date,
  quietHours: QuietHours = parseQuietHours()
): Date {
  const parts = mytDateParts(now)
  const startMinute = quietHours.startHour * 60
  const endMinute = quietHours.endHour * 60

  if (startMinute > endMinute) {
    if (parts.minuteOfDay >= startMinute) {
      return mytTimeToUtc(parts.year, parts.month, parts.day + 1, quietHours.endHour)
    }
    if (parts.minuteOfDay < endMinute) {
      return mytTimeToUtc(parts.year, parts.month, parts.day, quietHours.endHour)
    }
    return now
  }

  if (parts.minuteOfDay >= startMinute && parts.minuteOfDay < endMinute) {
    return mytTimeToUtc(parts.year, parts.month, parts.day, quietHours.endHour)
  }
  return now
}

export function nextWhatsAppDailyWindowAt(
  now: Date,
  quietHours: QuietHours = parseQuietHours()
): Date {
  const parts = mytDateParts(now)
  const nextLocalMidnight = mytTimeToUtc(parts.year, parts.month, parts.day + 1, 0)
  return nextAllowedWhatsAppSendAt(nextLocalMidnight, quietHours)
}

export function retryBackoffMinutes(attemptNumber: number): number {
  if (attemptNumber <= 1) return 2
  return 5
}

export function bulkStaggerMinutes(senderPosition: number): number {
  return Math.max(0, senderPosition)
}

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
