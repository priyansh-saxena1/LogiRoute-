import clsx from 'clsx'
import { Truck } from 'lucide-react'
import { Fragment, useEffect, useRef } from 'react'
import { KIND } from '../lib/duty'
import { clock, duration, miles as fmtMiles, shortDate } from '../lib/format'
import type { Stop, TripPlan } from '../types'

interface Props {
  plan: TripPlan
  playhead: number
  activeStop: number | null
  onSelectStop: (stop: Stop) => void
}

export default function Itinerary({ plan, playhead, activeStop, onSelectStop }: Props) {
  const listRef = useRef<HTMLOListElement>(null)
  const stops = plan.stops
  const currentIdx = stops.findIndex((s) => playhead >= s.arrive_min && playhead < s.depart_min)
  const drivingAfter = currentIdx === -1 ? stops.findLastIndex((s) => s.depart_min <= playhead) : -1

  useEffect(() => {
    const idx = activeStop ?? (currentIdx >= 0 ? stops[currentIdx]?.id : null)
    if (idx == null) return
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>(`[data-stop="${idx}"]`)
    // Scroll only the list — scrollIntoView would also drag the page along.
    if (list && el) list.scrollTo({ top: Math.max(0, el.offsetTop - list.clientHeight / 3), behavior: 'smooth' })
  }, [activeStop, currentIdx, stops])

  return (
    <ol ref={listRef} className="scroll-thin relative h-full overflow-y-auto px-4 py-3">
      {stops.map((stop, i) => {
        const meta = KIND[stop.type]
        const next = stops[i + 1]
        const showDay = i === 0 || stops[i - 1].day !== stop.day
        const isCurrent = i === currentIdx
        const isActive = activeStop === stop.id
        const driveMin = next ? next.arrive_min - stop.depart_min : 0
        const driveMiles = next ? next.mile - stop.mile : 0
        return (
          <Fragment key={stop.id}>
            {showDay && (
              <li className="sticky top-0 z-10 -mx-4 mb-1 bg-white/90 px-4 py-1.5 backdrop-blur">
                <span className="eyebrow">
                  Day {stop.day} · {shortDate(stop.arrive)}
                </span>
              </li>
            )}
            <li data-stop={stop.id}>
              <button
                type="button"
                onClick={() => onSelectStop(stop)}
                className={clsx(
                  'group flex w-full items-start gap-3 rounded-xl px-2 py-2 text-left transition-colors',
                  isActive ? 'bg-blue-50 ring-1 ring-blue-200' : isCurrent ? 'bg-ink-100/60' : 'hover:bg-ink-100/50',
                )}
              >
                <span
                  className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg text-white shadow-sm"
                  style={{ background: meta.color }}
                >
                  <meta.icon className="size-3.5" strokeWidth={2.5} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-ink-900">{stop.title}</span>
                    <span className="shrink-0 font-mono text-[11.5px] text-ink-500 tabular">
                      {clock(stop.arrive)}
                      {stop.duration_min > 0 && `–${clock(stop.depart)}`}
                    </span>
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-ink-500">{stop.location.label}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-600">
                      {duration(stop.duration_min)}
                    </span>
                    <span className="rounded-md bg-ink-100 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-600">
                      mi {Math.round(stop.mile).toLocaleString()}
                    </span>
                    {stop.kinds.includes('fuel') && stop.type !== 'fuel' && (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[10.5px] font-medium text-amber-700">+ fuel</span>
                    )}
                    {stop.notes.some((n) => n.includes('30-min break')) && stop.type === 'fuel' && (
                      <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[10.5px] font-medium text-emerald-700">
                        counts as break
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
            {next && driveMin > 0 && (
              <li className="flex items-center gap-3 py-1 pl-2">
                <span className="flex w-7 justify-center">
                  <span
                    className={clsx(
                      'h-7 w-[3px] rounded-full',
                      drivingAfter === i ? 'bg-emerald-500' : 'bg-[repeating-linear-gradient(to_bottom,#cdd5e3_0,#cdd5e3_3px,transparent_3px,transparent_6px)]',
                    )}
                  />
                </span>
                <span className={clsx('flex items-center gap-1.5 text-[11.5px]', drivingAfter === i ? 'text-emerald-700' : 'text-ink-400')}>
                  <Truck className="size-3" />
                  Drive {duration(driveMin)} · {fmtMiles(driveMiles)}
                </span>
              </li>
            )}
          </Fragment>
        )
      })}
    </ol>
  )
}
