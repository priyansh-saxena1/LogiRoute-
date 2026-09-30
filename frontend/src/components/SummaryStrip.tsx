import { CalendarRange, Clock4, Flag, Fuel, Gauge, Route, type LucideIcon } from 'lucide-react'
import { clock, duration, hhmm, shortDate } from '../lib/format'
import type { TripPlan } from '../types'

function Tile({ icon: Icon, label, value, sub, accent }: { icon: LucideIcon; label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="card relative overflow-hidden px-4 py-3.5">
      <div className="flex items-center justify-between">
        <span className="eyebrow">{label}</span>
        <Icon className="size-4" style={{ color: accent }} strokeWidth={2.2} />
      </div>
      <div className="mt-1.5 font-mono text-[22px] leading-tight font-semibold tracking-tight text-ink-900 tabular">{value}</div>
      <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-400">{sub}</div>
    </div>
  )
}

export default function SummaryStrip({ plan }: { plan: TripPlan }) {
  const s = plan.summary
  const [toPickup, loaded] = plan.route.legs
  const restBits = [
    s.rests && `${s.rests} rest${s.rests > 1 ? 's' : ''}`,
    s.restarts && `${s.restarts} restart`,
    s.cycle_waits && `${s.cycle_waits} cycle wait`,
  ].filter(Boolean)
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <Tile
        icon={Route}
        label="Distance"
        value={`${Math.round(s.total_miles).toLocaleString()} mi`}
        sub={`${Math.round(toPickup.miles).toLocaleString()} empty · ${Math.round(loaded.miles).toLocaleString()} loaded`}
        accent="#2563eb"
      />
      <Tile icon={Clock4} label="Driving" value={hhmm(s.drive_minutes)} sub={`avg ${s.avg_mph} mph · ${hhmm(s.on_duty_minutes)} on duty`} accent="#10b981" />
      <Tile
        icon={Flag}
        label="Arrival"
        value={clock(s.dropoff_arrival)}
        sub={`${shortDate(s.dropoff_arrival)} · ${duration(s.trip_minutes)} total`}
        accent="#e11d48"
      />
      <Tile
        icon={CalendarRange}
        label="Log sheets"
        value={`${s.log_days} day${s.log_days > 1 ? 's' : ''}`}
        sub={restBits.length ? restBits.join(' · ') : 'no overnight rest needed'}
        accent="#8b5cf6"
      />
      <Tile
        icon={Fuel}
        label="Fuel stops"
        value={String(s.fuel_stops)}
        sub={`${s.breaks} separate 30-min break${s.breaks === 1 ? '' : 's'}`}
        accent="#f59e0b"
      />
      <Tile
        icon={Gauge}
        label="Cycle left"
        value={hhmm(s.cycle_left_end)}
        sub={`of 70:00 · ${hhmm(s.cycle_used_start)} used at start`}
        accent="#0b1220"
      />
    </div>
  )
}
