import { FileCheck2, Fuel, Route, ShieldCheck } from 'lucide-react'
import type { DayLog, DriverInfo } from '../types'
import LogSheet from './LogSheet'

const SAMPLE_DAY: DayLog = {
  day: 1,
  date: '2026-10-01',
  weekday: 'Thursday',
  from: 'Chicago, IL',
  to: '12 mi E Lonoke, AR',
  miles: 614,
  segments: [
    { status: 'OFF', start: 0, end: 360 },
    { status: 'ON', start: 360, end: 375 },
    { status: 'D', start: 375, end: 855 },
    { status: 'OFF', start: 855, end: 885 },
    { status: 'D', start: 885, end: 1065 },
    { status: 'ON', start: 1065, end: 1080 },
    { status: 'SB', start: 1080, end: 1440 },
  ],
  totals: { OFF: 390, SB: 360, D: 660, ON: 30 },
  remarks: [
    { minute: 360, status: 'ON', kind: 'pre_trip', location: 'Chicago, IL', note: '', event: 0 },
    { minute: 375, status: 'D', kind: 'drive', location: 'Chicago, IL', note: '', event: 1 },
    { minute: 855, status: 'OFF', kind: 'break', location: '2 mi NE Hayti, MO', note: '', event: 2 },
    { minute: 885, status: 'D', kind: 'drive', location: '2 mi NE Hayti, MO', note: '', event: 3 },
    { minute: 1065, status: 'ON', kind: 'post_trip', location: '12 mi E Lonoke, AR', note: '', event: 4 },
    { minute: 1080, status: 'SB', kind: 'rest', location: '12 mi E Lonoke, AR', note: '', event: 5 },
  ],
  events: [],
  recap: { on_duty_today: 690, last_7_days: 1770, available_tomorrow: 2430, last_8_days: 1770, restart_completed: false },
}

const SAMPLE_DRIVER: DriverInfo = {
  driverName: 'Jordan Rivera',
  coDriver: '',
  carrier: 'LogiRoute Freight Lines',
  mainOffice: '1200 Commerce St, Dallas, TX',
  homeTerminal: 'Chicago, IL',
  truckNumber: '4127',
  trailerNumber: '53-8821',
  shippingDoc: 'BOL-20261001-4127',
  shipper: 'Dallas, TX',
  commodity: 'General freight',
}

const FEATURES = [
  { icon: Route, title: 'Real road routing', body: 'OSRM on OpenStreetMap, truck speed-capped at 65 mph.' },
  { icon: Fuel, title: 'Every stop scheduled', body: 'Breaks, fuel ≤ 1,000 mi, 10-hr rests and 34-hr restarts.' },
  { icon: FileCheck2, title: 'Paper-accurate logs', body: '24-hr grid, ELD-style remarks and the 70-hr recap.' },
  { icon: ShieldCheck, title: 'Audited, not trusted', body: 'An independent checker re-verifies every plan.' },
]

export default function EmptyState() {
  return (
    <div className="mx-auto flex max-w-[1180px] flex-col gap-10 px-5 py-10 sm:px-8 lg:py-16">
      <div className="max-w-2xl animate-fade-up">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-medium text-ink-600 shadow-card">
          <span className="size-1.5 rounded-full bg-emerald-500" /> Property-carrying · 70 hr / 8 day
        </span>
        <h1 className="mt-5 text-[34px] leading-[1.08] font-semibold tracking-tight text-ink-900 sm:text-[46px]">
          Plan the haul.
          <br />
          <span className="text-ink-400">The logbook fills itself.</span>
        </h1>
        <p className="mt-4 max-w-xl text-[15.5px] leading-relaxed text-ink-500">
          Tell LogiRoute where the truck is, where it loads and unloads, and how many cycle hours are used. It routes
          the trip over real roads, schedules every break, fuel stop and rest the hours-of-service rules demand — then
          draws the driver’s daily log for each day on the road.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f, i) => (
          <div key={f.title} className="card animate-fade-up p-4" style={{ animationDelay: `${80 + i * 60}ms` }}>
            <f.icon className="size-5 text-blue-600" strokeWidth={2} />
            <div className="mt-3 text-[14px] font-semibold text-ink-900">{f.title}</div>
            <div className="mt-1 text-[13px] leading-snug text-ink-500">{f.body}</div>
          </div>
        ))}
      </div>

      <figure className="animate-fade-up" style={{ animationDelay: '320ms' }}>
        <div className="relative">
          <div className="absolute -inset-3 -z-10 rounded-[28px] bg-gradient-to-br from-blue-100/70 via-transparent to-amber-100/60 blur-xl" />
          <div className="card overflow-x-auto p-3 sm:p-5">
            <div className="min-w-[760px]">
              <LogSheet
                day={SAMPLE_DAY}
                totalDays={4}
                tripStart="2026-10-01T06:00"
                tripEndMinute={4701}
                driver={SAMPLE_DRIVER}
              />
            </div>
          </div>
        </div>
        <figcaption className="mt-3 text-center text-[12.5px] text-ink-400">
          A sample sheet. Yours are generated from your trip — one per calendar day, ready to print.
        </figcaption>
      </figure>
    </div>
  )
}
