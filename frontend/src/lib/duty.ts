import {
  BedDouble,
  ClipboardCheck,
  Coffee,
  Flag,
  Fuel,
  Hourglass,
  type LucideIcon,
  Navigation,
  Package,
  RotateCcw,
  Truck,
} from 'lucide-react'
import type { DutyStatus, EventKind, StopType } from '../types'

export const DUTY: Record<DutyStatus, { label: string; short: string; line: number; color: string; tint: string }> = {
  OFF: { label: 'Off Duty', short: 'Off', line: 1, color: '#94A3B8', tint: '#F1F5F9' },
  SB: { label: 'Sleeper Berth', short: 'Sleeper', line: 2, color: '#8B5CF6', tint: '#F3EEFF' },
  D: { label: 'Driving', short: 'Driving', line: 3, color: '#10B981', tint: '#E7F8F1' },
  ON: { label: 'On Duty (Not Driving)', short: 'On duty', line: 4, color: '#F59E0B', tint: '#FEF5E6' },
}

export const DUTY_ORDER: DutyStatus[] = ['OFF', 'SB', 'D', 'ON']

export const KIND: Record<EventKind | 'origin' | 'off', { label: string; icon: LucideIcon; color: string }> = {
  origin: { label: 'Departure', icon: Navigation, color: '#0B1220' },
  pre_trip: { label: 'Pre-trip inspection', icon: ClipboardCheck, color: '#F59E0B' },
  post_trip: { label: 'Post-trip inspection', icon: ClipboardCheck, color: '#F59E0B' },
  drive: { label: 'Driving', icon: Truck, color: '#10B981' },
  pickup: { label: 'Pickup', icon: Package, color: '#2563EB' },
  dropoff: { label: 'Drop-off', icon: Flag, color: '#E11D48' },
  fuel: { label: 'Fuel stop', icon: Fuel, color: '#F59E0B' },
  break: { label: '30-min break', icon: Coffee, color: '#64748B' },
  rest: { label: '10-hr rest', icon: BedDouble, color: '#8B5CF6' },
  restart: { label: '34-hr restart', icon: RotateCcw, color: '#6D28D9' },
  cycle_wait: { label: 'Cycle wait', icon: Hourglass, color: '#6D28D9' },
  off: { label: 'Off duty', icon: Flag, color: '#94A3B8' },
}

export function stopMeta(type: StopType) {
  return KIND[type]
}
