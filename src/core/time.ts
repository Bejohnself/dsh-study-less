/**
 * Local-date helpers.
 *
 * The study day is the local date, not the UTC one: a review scheduled for
 * "tomorrow" means tomorrow where the user lives. Dates are stored as
 * `YYYY-MM-DD`; timestamps are ISO strings with offset.
 */

/** Format a date as a local `YYYY-MM-DD`. */
export function localDate(date: Date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Parse a local `YYYY-MM-DD` into a date at local noon (DST safe). */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`invalid local date: ${value}`)
  }
  return new Date(year, month - 1, day, 12, 0, 0, 0)
}

/** Add whole days to a local date string. */
export function addDays(value: string, days: number): string {
  const date = parseLocalDate(value)
  date.setDate(date.getDate() + days)
  return localDate(date)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) / 86_400_000)
}

/** Whether `value` is a `YYYY-MM-DD` local date. */
export function isLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

/** Minutes since local midnight for `HH:MM`. */
export function minutesOfDay(clock: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock)
  if (match === null) throw new Error(`invalid clock: ${clock}`)
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) throw new Error(`invalid clock: ${clock}`)
  return hours * 60 + minutes
}
