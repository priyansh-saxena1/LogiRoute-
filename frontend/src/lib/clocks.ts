import type { Clocks, TripEvent } from '../types'

export interface ClockState extends Clocks {
  /** Set while a rest is in progress: minutes until the clocks reset. */
  resetIn: number | null
  resetKind: 'rest' | 'restart' | 'break' | null
}

const lerp = (a: number, b: number, f: number) => a + (b - a) * f

/**
 * Clock values at `minute` inside `ev`. Every clock falls linearly while on duty
 * or driving; during a rest the clocks hold (except the 14-hour window, which
 * keeps running) and reset only when the rest completes.
 */
export function clocksAt(ev: TripEvent, minute: number): ClockState {
  const f = ev.duration_min > 0 ? Math.min(1, Math.max(0, (minute - ev.start_min) / ev.duration_min)) : 1
  const s = ev.clocks_start
  const e = ev.clocks_end
  if (ev.status === 'D' || ev.status === 'ON') {
    return {
      drive_left: lerp(s.drive_left, e.drive_left, f),
      window_left: lerp(s.window_left, e.window_left, f),
      break_left: lerp(s.break_left, e.break_left, f),
      cycle_left: lerp(s.cycle_left, e.cycle_left, f),
      shift_active: true,
      resetIn: null,
      resetKind: null,
    }
  }
  const elapsed = minute - ev.start_min
  const resetKind =
    ev.kind === 'restart' ? 'restart' : ev.kind === 'rest' || ev.kind === 'cycle_wait' ? 'rest' : ev.kind === 'break' ? 'break' : null
  if (f >= 1) return { ...e, resetIn: null, resetKind: null }
  return {
    drive_left: s.drive_left,
    window_left: s.shift_active ? Math.max(0, s.window_left - elapsed) : s.window_left,
    break_left: s.break_left,
    cycle_left: s.cycle_left,
    shift_active: s.shift_active,
    resetIn: resetKind ? ev.end_min - minute : null,
    resetKind,
  }
}
