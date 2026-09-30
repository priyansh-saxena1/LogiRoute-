import clsx from 'clsx'
import { Download, FileImage, MapPinned, Printer, UserRound, X } from 'lucide-react'
import { memo, useRef, useState } from 'react'
import { DUTY } from '../lib/duty'
import { downloadPng, downloadSvg } from '../lib/exportSvg'
import { hhmm, shortDate } from '../lib/format'
import type { DayLog, DriverInfo, TripPlan } from '../types'
import LogSheet from './LogSheet'

const MemoSheet = memo(LogSheet)

const FIELDS: { key: keyof DriverInfo; label: string; placeholder: string }[] = [
  { key: 'driverName', label: 'Driver name (signature)', placeholder: 'Jordan Rivera' },
  { key: 'coDriver', label: 'Co-driver', placeholder: 'None' },
  { key: 'carrier', label: 'Carrier', placeholder: 'Carrier name' },
  { key: 'mainOffice', label: 'Main office address', placeholder: 'Street, City, ST' },
  { key: 'homeTerminal', label: 'Home terminal address', placeholder: 'City, ST' },
  { key: 'truckNumber', label: 'Truck / tractor #', placeholder: '4127' },
  { key: 'trailerNumber', label: 'Trailer #', placeholder: '53-8821' },
  { key: 'shippingDoc', label: 'Pro / shipping #', placeholder: 'BOL-…' },
  { key: 'shipper', label: 'Shipper', placeholder: 'Shipper name' },
  { key: 'commodity', label: 'Commodity', placeholder: 'General freight' },
]

interface Props {
  plan: TripPlan
  driver: DriverInfo
  driverOverrides: Partial<DriverInfo>
  onDriverOverrides: (d: Partial<DriverInfo>) => void
  playhead: number
  onSeek: (minute: number) => void
  focusDay: number | null
  onFocusDay: (day: number | null) => void
  onZoomDay: (day: number) => void
}

function SheetCard({
  day,
  plan,
  driver,
  playhead,
  onSeek,
  focused,
  onFocusDay,
  onZoomDay,
}: {
  day: DayLog
  plan: TripPlan
  driver: DriverInfo
  playhead: number | null
  onSeek: (m: number) => void
  focused: boolean
  onFocusDay: (d: number | null) => void
  onZoomDay: (d: number) => void
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const filename = `driver-log-${day.date}-day${day.day}`
  const offDuty = day.totals.OFF + day.totals.SB
  return (
    <article
      className={clsx('log-sheet card overflow-hidden transition-shadow', focused && 'ring-2 ring-amber-300/70')}
      onMouseEnter={() => onFocusDay(day.day)}
      onMouseLeave={() => onFocusDay(null)}
    >
      <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="grid size-8 place-items-center rounded-lg bg-ink-900 font-mono text-[13px] font-semibold text-white">
            {day.day}
          </span>
          <div>
            <div className="text-[14px] font-semibold text-ink-900">{shortDate(day.date)}</div>
            <div className="text-[12px] text-ink-500">
              {day.from === day.to ? day.from : `${day.from} → ${day.to}`}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 sm:ml-2">
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-700">
              {Math.round(day.miles).toLocaleString()} mi
            </span>
            {(['D', 'ON'] as const).map((s) => (
              <span
                key={s}
                className="rounded-md px-2 py-0.5 font-mono text-[11px]"
                style={{ background: DUTY[s].tint, color: s === 'D' ? '#047857' : '#b45309' }}
              >
                {s === 'D' ? 'Drive' : 'On duty'} {hhmm(day.totals[s])}
              </span>
            ))}
            <span className="rounded-md bg-ink-100 px-2 py-0.5 font-mono text-[11px] text-ink-600">Off {hhmm(offDuty)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost !px-2.5 !py-1.5 !text-[12px]" onClick={() => onZoomDay(day.day)}>
            <MapPinned className="size-3.5" /> Map
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1.5 !text-[12px]"
            onClick={() => svgRef.current && downloadPng(svgRef.current, `${filename}.png`)}
          >
            <FileImage className="size-3.5" /> PNG
          </button>
          <button
            type="button"
            className="btn-ghost !px-2.5 !py-1.5 !text-[12px]"
            onClick={() => svgRef.current && downloadSvg(svgRef.current, `${filename}.svg`)}
          >
            <Download className="size-3.5" /> SVG
          </button>
        </div>
      </header>
      <div className="overflow-x-auto bg-white p-2 sm:p-4">
        <div className="min-w-[760px]">
          <MemoSheet
            ref={svgRef}
            day={day}
            totalDays={plan.days.length}
            tripStart={plan.summary.start}
            tripEndMinute={plan.summary.trip_minutes}
            driver={driver}
            playhead={playhead}
            onSeek={onSeek}
          />
        </div>
      </div>
    </article>
  )
}

export default function LogSheets({
  plan,
  driver,
  driverOverrides,
  onDriverOverrides,
  playhead,
  onSeek,
  focusDay,
  onFocusDay,
  onZoomDay,
}: Props) {
  const [editing, setEditing] = useState(false)
  const [, hh] = plan.summary.start.split('T')
  const startOffset = Number(hh.slice(0, 2)) * 60 + Number(hh.slice(3, 5))
  const customized = Object.values(driverOverrides).some(Boolean)

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[18px] font-semibold tracking-tight text-ink-900">Daily log sheets</h2>
          <p className="text-[13px] text-ink-500">
            One FMCSA-style sheet per calendar day, drawn from the duty timeline. Click a grid to jump the replay there.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => setEditing((e) => !e)} aria-expanded={editing}>
            <UserRound className="size-4" /> Driver & carrier
          </button>
          <button type="button" className="btn-primary" onClick={() => window.print()}>
            <Printer className="size-4" /> Print / save PDF
          </button>
        </div>
      </div>

      {!customized && !editing && (
        <div className="no-print rounded-xl border border-dashed border-ink-200 bg-white/60 px-4 py-2.5 text-[12.5px] text-ink-500">
          Sheets are filled with sample driver and carrier details.{' '}
          <button type="button" onClick={() => setEditing(true)} className="font-medium text-blue-600 hover:underline">
            Add yours
          </button>{' '}
          — they’re saved in this browser only.
        </div>
      )}

      {editing && (
        <div className="no-print card animate-fade-up p-4 sm:p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink-900">Driver & carrier details</h3>
            <div className="flex items-center gap-2">
              {customized && (
                <button type="button" className="text-[12px] text-ink-500 hover:text-ink-900" onClick={() => onDriverOverrides({})}>
                  Reset to sample
                </button>
              )}
              <button type="button" onClick={() => setEditing(false)} className="grid size-7 place-items-center rounded-lg hover:bg-ink-100" aria-label="Close">
                <X className="size-4" />
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="text-[11.5px] font-medium text-ink-500">{f.label}</span>
                <input
                  value={driverOverrides[f.key] ?? ''}
                  placeholder={driver[f.key] || f.placeholder}
                  onChange={(e) => onDriverOverrides({ ...driverOverrides, [f.key]: e.target.value })}
                  className="h-9 rounded-lg border border-line bg-white px-2.5 text-[13px] text-ink-900 placeholder:text-ink-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="print-area flex flex-col gap-5">
        {plan.days.map((day) => {
          const dayStart = (day.day - 1) * 1440 - startOffset
          const inDay = playhead >= dayStart && playhead <= dayStart + 1440
          return (
            <SheetCard
              key={`${plan.summary.start}-${day.day}`}
              day={day}
              plan={plan}
              driver={driver}
              playhead={inDay ? playhead : null}
              onSeek={onSeek}
              focused={focusDay === day.day}
              onFocusDay={onFocusDay}
              onZoomDay={onZoomDay}
            />
          )
        })}
      </div>
    </div>
  )
}
