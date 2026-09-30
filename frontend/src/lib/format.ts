/**
 * All trip times are wall-clock "home terminal time" strings (YYYY-MM-DDTHH:MM).
 * They are parsed as UTC and formatted in UTC so the browser's own time zone
 * and DST rules can never shift them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function parseWall(value: string): Date {
  const [date, time = '00:00'] = value.split('T')
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm))
}

export function addMinutes(value: string, minutes: number): Date {
  return new Date(parseWall(value).getTime() + minutes * 60_000)
}

export function toWallString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(
    date.getUTCHours(),
  )}:${pad(date.getUTCMinutes())}`
}

export function clock(date: Date | string): string {
  const d = typeof date === 'string' ? parseWall(date) : date
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export function shortDate(date: Date | string): string {
  const d = typeof date === 'string' ? parseWall(date) : date
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
}

export function dateTime(date: Date | string): string {
  return `${shortDate(date)} · ${clock(date)}`
}

/** 0 → "0m", 45 → "45m", 630 → "10h 30m", 3000 → "2d 2h" */
export function duration(minutes: number, opts: { days?: boolean } = {}): string {
  const m = Math.max(0, Math.round(minutes))
  const useDays = opts.days ?? true
  if (useDays && m >= 48 * 60) {
    const d = Math.floor(m / 1440)
    const h = Math.floor((m % 1440) / 60)
    const rem = m % 60
    return `${d}d ${h}h${rem ? ` ${rem}m` : ''}`
  }
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h === 0) return `${rem}m`
  return rem ? `${h}h ${String(rem).padStart(2, '0')}m` : `${h}h`
}

/** Log-sheet style "hh:mm" (e.g. 10:30, 24:00). */
export function hhmm(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function miles(value: number, digits = 0): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })} mi`
}

export function hoursLabel(minutes: number): string {
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

/** Default departure: the next whole hour, in the browser's local wall clock. */
export function defaultDeparture(): string {
  const now = new Date()
  now.setMinutes(0, 0, 0)
  now.setHours(now.getHours() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:00`
}
