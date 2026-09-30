import clsx from 'clsx'
import { Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { clocksAt } from '../lib/clocks'
import { DUTY, DUTY_ORDER, KIND } from '../lib/duty'
import { addMinutes, clock, duration, miles as fmtMiles, shortDate } from '../lib/format'
import { eventAt, mileAt } from '../lib/route'
import type { TripPlan } from '../types'

interface Props {
  plan: TripPlan
  playhead: number
  onPlayhead: (minute: number) => void
  playing: boolean
  onPlaying: (playing: boolean) => void
  speed: number
  onSpeed: (speed: number) => void
}

const FULL_TRIP_SECONDS = 26

function Gauge({ label, sub, left, total, note }: { label: string; sub: string; left: number; total: number; note?: string | null }) {
  const ratio = Math.max(0, Math.min(1, left / total))
  const color = ratio > 0.25 ? '#10b981' : ratio > 0.08 ? '#f59e0b' : '#f43f5e'
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2.5">
      <svg viewBox="0 0 56 56" className="size-12 shrink-0 -rotate-90" aria-hidden>
        <circle cx={28} cy={28} r={r} fill="none" stroke="#eef1f6" strokeWidth={6} />
        <circle
          cx={28}
          cy={28}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={6}
          strokeLinecap="round"
          strokeDasharray={`${c * ratio} ${c}`}
          style={{ transition: 'stroke-dasharray 120ms linear, stroke 200ms' }}
        />
      </svg>
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-ink-400">{label}</div>
        <div className="font-mono text-[17px] leading-tight font-semibold text-ink-900 tabular">
          {duration(Math.floor(left), { days: false })}
        </div>
        <div className="truncate text-[11px] text-ink-400">{note ?? sub}</div>
      </div>
    </div>
  )
}

export default function Replay({ plan, playhead, onPlayhead, playing, onPlaying, speed, onSpeed }: Props) {
  const total = plan.summary.trip_minutes
  const trackRef = useRef<HTMLDivElement>(null)
  const headRef = useRef(playhead)
  headRef.current = playhead

  // Playback loop.
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const perMs = (total / (FULL_TRIP_SECONDS * 1000)) * speed
    const tick = (now: number) => {
      const dt = now - last
      last = now
      acc += dt
      if (acc >= 32) {
        const next = headRef.current + perMs * acc
        acc = 0
        if (next >= total) {
          onPlayhead(total)
          onPlaying(false)
          return
        }
        onPlayhead(next)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, total, onPlayhead, onPlaying])

  const startOffset = useMemo(() => {
    const [, t] = plan.summary.start.split('T')
    const [h, m] = t.split(':').map(Number)
    return h * 60 + m
  }, [plan])

  const midnights = useMemo(() => {
    const out: { minute: number; label: string }[] = []
    for (let d = 1; d * 1440 - startOffset < total; d++) {
      const minute = d * 1440 - startOffset
      out.push({ minute, label: shortDate(addMinutes(plan.summary.start, minute)) })
    }
    return out
  }, [plan, startOffset, total])

  const ev = eventAt(plan.events, playhead)
  const clocks = clocksAt(ev, playhead)
  const mile = mileAt(plan.events, playhead)
  const now = addMinutes(plan.summary.start, playhead)
  const day = Math.floor((startOffset + playhead) / 1440) + 1
  const meta = KIND[ev.kind]

  const markers = plan.stops.filter((s) => ['pickup', 'dropoff', 'fuel', 'restart'].includes(s.type))

  const seekFromPointer = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    const f = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    onPlayhead(f * total)
  }

  const pct = (m: number) => `${(m / total) * 100}%`
  const resetNote =
    clocks.resetIn != null
      ? clocks.resetKind === 'restart'
        ? `resets in ${duration(clocks.resetIn)}`
        : clocks.resetKind === 'rest'
          ? `resets in ${duration(clocks.resetIn)}`
          : null
      : null

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              if (playhead >= total) onPlayhead(0)
              onPlaying(!playing)
            }}
            className="grid size-10 place-items-center rounded-full bg-ink-900 text-white shadow-card transition-transform hover:scale-105 active:scale-95"
            aria-label={playing ? 'Pause replay' : 'Play replay'}
          >
            {playing ? <Pause className="size-4" fill="currentColor" /> : <Play className="ml-0.5 size-4" fill="currentColor" />}
          </button>
          <button
            type="button"
            onClick={() => {
              onPlaying(false)
              onPlayhead(0)
            }}
            className="grid size-8 place-items-center rounded-full text-ink-400 hover:bg-ink-100 hover:text-ink-800"
            aria-label="Rewind to departure"
          >
            <RotateCcw className="size-4" />
          </button>
          <div className="ml-1 flex rounded-lg border border-line p-0.5 text-[11px] font-medium">
            {[1, 3, 8].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSpeed(s)}
                className={clsx('rounded-md px-2 py-1', speed === s ? 'bg-ink-900 text-white' : 'text-ink-500 hover:text-ink-900')}
              >
                {s}×
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className="font-mono text-[15px] font-semibold text-ink-900 tabular">
              Day {day} · {shortDate(now)} · {clock(now)}
            </span>
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
              style={{ background: DUTY[ev.status].tint, color: ev.status === 'OFF' ? '#475569' : DUTY[ev.status].color }}
            >
              <meta.icon className="size-3" strokeWidth={2.6} />
              {ev.kind === 'drive' ? 'Driving' : meta.label}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-ink-500">
            {ev.status === 'D' ? `En route from ${ev.location.label}` : ev.location.label} · odometer{' '}
            <span className="font-mono text-ink-700">{fmtMiles(mile)}</span> of {fmtMiles(plan.summary.total_miles)}
          </div>
        </div>
      </div>

      {/* Duty-status Gantt for the whole trip */}
      <div className="px-5 pt-4 pb-5">
        <div className="flex">
          <div className="w-[78px] shrink-0 pt-[22px]">
            {DUTY_ORDER.map((s) => (
              <div key={s} className="flex h-6 items-center gap-1.5 text-[11px] text-ink-500">
                <span className="size-2 rounded-full" style={{ background: DUTY[s].color }} />
                {DUTY[s].short}
              </div>
            ))}
          </div>
          <div
            ref={trackRef}
            className="relative flex-1 cursor-ew-resize touch-none select-none"
            role="slider"
            tabIndex={0}
            aria-label="Trip timeline"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={Math.round(playhead)}
            aria-valuetext={`${shortDate(now)} ${clock(now)}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              onPlaying(false)
              seekFromPointer(e.clientX)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) seekFromPointer(e.clientX)
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 240 : 15
              if (e.key === 'ArrowRight') onPlayhead(Math.min(total, playhead + step))
              else if (e.key === 'ArrowLeft') onPlayhead(Math.max(0, playhead - step))
              else if (e.key === 'Home') onPlayhead(0)
              else if (e.key === 'End') onPlayhead(total)
              else if (e.key === ' ') {
                e.preventDefault()
                onPlaying(!playing)
              } else return
              e.preventDefault()
            }}
          >
            {/* stop markers row */}
            <div className="relative h-[22px]">
              {markers.map((s) => {
                const m = KIND[s.type]
                return (
                  <span
                    key={s.id}
                    className="absolute top-0.5 grid size-4 -translate-x-1/2 place-items-center rounded-full ring-2 ring-white"
                    style={{ left: pct(s.arrive_min), background: m.color }}
                    title={`${s.title} · ${clock(s.arrive)}`}
                  >
                    <m.icon className="size-2.5 text-white" strokeWidth={3} />
                  </span>
                )
              })}
            </div>
            <div className="relative h-24 overflow-hidden rounded-md bg-[repeating-linear-gradient(to_bottom,#f8fafc_0,#f8fafc_24px,#ffffff_24px,#ffffff_48px)] ring-1 ring-line">
              {plan.events.map((e) => (
                <div
                  key={e.id}
                  className="absolute h-4"
                  style={{
                    left: pct(e.start_min),
                    width: `max(1px, ${pct(e.duration_min)})`,
                    top: DUTY_ORDER.indexOf(e.status) * 24 + 4,
                    background: DUTY[e.status].color,
                    borderRadius: 3,
                  }}
                  title={`${e.note} · ${clock(e.start)}–${clock(e.end)}`}
                />
              ))}
              {midnights.map((m) => (
                <div key={m.minute} className="absolute top-0 bottom-0 border-l border-dashed border-ink-200" style={{ left: pct(m.minute) }} />
              ))}
              <div className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-blue-600" style={{ left: pct(playhead) }}>
                <span className="absolute -top-1 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-blue-600 ring-2 ring-white" />
              </div>
            </div>
            <div className="relative mt-1.5 h-4 text-[10.5px] text-ink-400">
              {(midnights.length === 0 || midnights[0].minute / total > 0.09) && (
                <span className="absolute left-0">{clock(plan.summary.start)}</span>
              )}
              {midnights.map((m) => (
                <span key={m.minute} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(m.minute) }}>
                  {m.label}
                </span>
              ))}
              {(midnights.length === 0 || midnights[midnights.length - 1].minute / total < 0.91) && (
                <span className="absolute right-0">{clock(plan.summary.end)}</span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Gauge label="Driving (11 hr)" sub="left this shift" left={clocks.drive_left} total={660} note={resetNote} />
          <Gauge
            label="Duty window (14 hr)"
            sub={clocks.shift_active ? 'left in window' : 'starts at next duty'}
            left={clocks.window_left}
            total={840}
            note={resetNote}
          />
          <Gauge
            label="Until 30-min break"
            sub="driving before a break"
            left={clocks.break_left}
            total={480}
            note={clocks.resetKind === 'break' && clocks.resetIn != null ? `break ends in ${duration(clocks.resetIn)}` : null}
          />
          <Gauge
            label="Cycle (70 hr / 8 day)"
            sub="on-duty hours left"
            left={clocks.cycle_left}
            total={4200}
            note={clocks.resetKind === 'restart' ? resetNote : null}
          />
        </div>
      </div>
    </div>
  )
}
