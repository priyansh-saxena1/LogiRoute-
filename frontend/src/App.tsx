import clsx from 'clsx'
import { AlertTriangle, Check, Link2, Printer, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AuditPanel from './components/AuditPanel'
import EmptyState from './components/EmptyState'
import Itinerary from './components/Itinerary'
import LoadingOverlay from './components/LoadingOverlay'
import LogSheets from './components/LogSheets'
import Replay from './components/Replay'
import RouteMap from './components/RouteMap'
import SummaryStrip from './components/SummaryStrip'
import TripForm, { type FieldErrors } from './components/TripForm'
import { ApiError, api } from './lib/api'
import { dateTime } from './lib/format'
import { flattenRoute, mileAt } from './lib/route'
import { load, save } from './lib/storage'
import {
  decodeShare,
  encodeShare,
  exampleForm,
  type ExampleTrip,
  formFromRequest,
  initialForm,
  toRequest,
  type TripFormState,
} from './lib/tripForm'
import type { DriverInfo, LocationValue, Stop, TripPlan } from './types'

const FIELD_MAP: Record<string, keyof FieldErrors> = {
  current_location: 'current',
  current: 'current',
  pickup_location: 'pickup',
  pickup: 'pickup',
  dropoff_location: 'dropoff',
  dropoff: 'dropoff',
  current_cycle_used: 'cycle',
  cycle_history: 'cycle',
  start_time: 'start',
}

const DRIVER_KEY = 'logiroute.driver.v1'

function sampleDriver(plan: TripPlan): DriverInfo {
  const date = plan.summary.start.slice(0, 10).replace(/-/g, '')
  return {
    driverName: 'Jordan Rivera',
    coDriver: '',
    carrier: 'LogiRoute Freight Lines',
    mainOffice: '1200 Commerce St, Dallas, TX',
    homeTerminal: plan.inputs.places.current.short,
    truckNumber: '4127',
    trailerNumber: '53-8821',
    shippingDoc: `BOL-${date}-4127`,
    shipper: plan.inputs.places.pickup.short,
    commodity: 'General freight',
  }
}

function withResolved(form: TripFormState, plan: TripPlan): TripFormState {
  const resolve = (value: LocationValue, role: 'current' | 'pickup' | 'dropoff'): LocationValue => {
    if (value.place) return value
    const p = plan.inputs.places[role]
    return {
      text: p.label,
      place: { id: `resolved:${role}`, label: p.label, short: p.short, name: p.label, detail: '', kind: 'place', lat: p.lat, lon: p.lon },
    }
  }
  return {
    ...form,
    current: resolve(form.current, 'current'),
    pickup: resolve(form.pickup, 'pickup'),
    dropoff: resolve(form.dropoff, 'dropoff'),
  }
}

type ZoomTarget = { kind: 'day' | 'stop' | 'all'; id: number; nonce: number }

export default function App() {
  const sharedRequest = useMemo(() => decodeShare(window.location.hash), [])
  const [form, setForm] = useState<TripFormState>(() => (sharedRequest ? formFromRequest(sharedRequest) : initialForm()))
  const [plan, setPlan] = useState<TripPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [playhead, setPlayhead] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [focusDay, setFocusDay] = useState<number | null>(null)
  const [activeStop, setActiveStop] = useState<number | null>(null)
  const [zoomTarget, setZoomTarget] = useState<ZoomTarget | null>(null)
  const [copied, setCopied] = useState(false)
  const [driverOverrides, setDriverOverrides] = useState<Partial<DriverInfo>>(() => load(DRIVER_KEY, {}))
  const abortRef = useRef<AbortController | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  const runPlan = useCallback(async (f: TripFormState) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    setFieldErrors({})
    setPlaying(false)
    try {
      const result = await api.plan(toRequest(f), controller.signal)
      const resolved = withResolved(f, result)
      setPlan(result)
      setForm(resolved)
      setPlayhead(0)
      setActiveStop(null)
      setFocusDay(null)
      setZoomTarget(null)
      window.history.replaceState(null, '', encodeShare(toRequest(resolved)))
      if (window.innerWidth < 1024) {
        window.setTimeout(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
      } else {
        resultsRef.current?.scrollTo?.({ top: 0 })
        window.scrollTo({ top: 0, behavior: 'smooth' })
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      if (err instanceof ApiError) {
        const field = err.field ? FIELD_MAP[err.field] : undefined
        if (field) setFieldErrors({ [field]: err.message })
        setError(err.message)
      } else {
        setError('Something went wrong while planning. Please try again.')
      }
    } finally {
      if (abortRef.current === controller) setLoading(false)
    }
  }, [])

  // A shared link plans itself on load.
  useEffect(() => {
    if (!sharedRequest) return
    const timer = window.setTimeout(() => runPlan(formFromRequest(sharedRequest)), 0)
    return () => window.clearTimeout(timer)
  }, [sharedRequest, runPlan])

  useEffect(() => save(DRIVER_KEY, driverOverrides), [driverOverrides])

  const route = useMemo(() => (plan ? flattenRoute(plan.route.legs) : null), [plan])
  const driver = useMemo<DriverInfo | null>(() => {
    if (!plan) return null
    const base = sampleDriver(plan)
    const merged = { ...base }
    for (const [k, v] of Object.entries(driverOverrides)) if (v) merged[k as keyof DriverInfo] = v
    return merged
  }, [plan, driverOverrides])

  const playMile = plan ? mileAt(plan.events, playhead) : null

  const onSeek = useCallback((minute: number) => {
    setPlaying(false)
    setPlayhead(minute)
  }, [])

  const onStopClick = useCallback((stop: Stop) => {
    setPlaying(false)
    setActiveStop(stop.id)
    setPlayhead(stop.arrive_min)
    setZoomTarget({ kind: 'stop', id: stop.id, nonce: Date.now() })
  }, [])

  const onZoomDay = useCallback((day: number) => {
    setZoomTarget({ kind: 'day', id: day, nonce: Date.now() })
    document.getElementById('route')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const onExample = (example: ExampleTrip) => {
    const next = exampleForm(example, form)
    setForm(next)
    runPlan(next)
  }

  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}${encodeShare(toRequest(form))}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      window.prompt('Copy this link', url)
    }
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  const places = plan?.inputs.places

  return (
    <div className="min-h-dvh lg:flex">
      {/* ---------------- Sidebar ---------------- */}
      <aside className="no-print flex shrink-0 flex-col bg-ink-900 text-white lg:sticky lg:top-0 lg:h-dvh lg:w-[392px]">
        <div className="flex items-center justify-between px-5 pt-5 pb-4">
          <a href="/" className="flex items-center gap-2.5" onClick={(e) => { e.preventDefault(); window.history.replaceState(null, '', '/'); setPlan(null) }}>
            <img src="/favicon.svg" alt="" className="size-8 rounded-lg ring-1 ring-white/10" />
            <div className="leading-tight">
              <div className="text-[16px] font-semibold tracking-tight">LogiRoute</div>
              <div className="text-[11px] text-ink-400">HOS trip planner & ELD logs</div>
            </div>
          </a>
          <a
            href="https://github.com/priyansh-saxena1/LogiRoute-"
            target="_blank"
            rel="noreferrer"
            className="grid size-8 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-800 hover:text-white"
            aria-label="Source on GitHub"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden>
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </div>
        <div className="scroll-dark flex-1 overflow-y-auto px-5 pb-6">
          <TripForm
            form={form}
            onChange={(f) => {
              setForm(f)
              if (Object.keys(fieldErrors).length) setFieldErrors({})
            }}
            onSubmit={() => runPlan(form)}
            onExample={onExample}
            loading={loading}
            errors={fieldErrors}
          />
        </div>
        <div className="hidden border-t border-ink-800 px-5 py-3 text-[11px] leading-relaxed text-ink-500 lg:block">
          FMCSA 49 CFR Part 395 · Map data © OpenStreetMap · Routing OSRM · Places © GeoNames
        </div>
      </aside>

      {/* ---------------- Main ---------------- */}
      <main ref={resultsRef} className="relative min-w-0 flex-1 scroll-mt-4">
        {loading && <LoadingOverlay />}

        {error && (
          <div className="no-print sticky top-0 z-[900] px-4 pt-4 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1400px] animate-fade-up items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800 shadow-card">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="text-rose-500 hover:text-rose-800">
                <X className="size-4" />
              </button>
            </div>
          </div>
        )}

        {!plan || !route || !driver || !places ? (
          <EmptyState />
        ) : (
          <div key={plan.summary.start + plan.route.total_miles} className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
            <header className="no-print flex animate-fade-up flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold',
                      plan.summary.compliant ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700',
                    )}
                  >
                    <span className={clsx('size-1.5 rounded-full', plan.summary.compliant ? 'bg-emerald-500' : 'bg-rose-500')} />
                    {plan.summary.compliant ? 'HOS compliant' : 'Needs review'}
                  </span>
                  <span className="text-[12px] text-ink-400">
                    Departs {dateTime(plan.summary.start)} · arrives {dateTime(plan.summary.dropoff_arrival)}
                  </span>
                </div>
                <h1 className="mt-2 flex flex-wrap items-center gap-x-2 text-[22px] font-semibold tracking-tight text-ink-900 sm:text-[26px]">
                  <span>{places.current.short}</span>
                  <span className="text-ink-300">→</span>
                  <span className="text-blue-600">{places.pickup.short}</span>
                  <span className="text-ink-300">→</span>
                  <span className="text-rose-600">{places.dropoff.short}</span>
                </h1>
                <nav className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
                  {[
                    ['route', 'Route & stops'],
                    ['replay', 'HOS replay'],
                    ['logs', `Log sheets (${plan.days.length})`],
                    ['audit', 'Compliance'],
                  ].map(([id, label]) => (
                    <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }) }} className="rounded-full border border-line bg-white px-3 py-1 text-ink-600 transition-colors hover:border-ink-200 hover:text-ink-900">
                      {label}
                    </a>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" className="btn-ghost" onClick={share}>
                  {copied ? <Check className="size-4 text-emerald-600" /> : <Link2 className="size-4" />}
                  {copied ? 'Link copied' : 'Share trip'}
                </button>
                <button type="button" className="btn-ghost" onClick={() => window.print()}>
                  <Printer className="size-4" /> Print logs
                </button>
              </div>
            </header>

            {plan.warnings.length > 0 && (
              <div className="no-print flex flex-col gap-2">
                {plan.warnings.map((w) => (
                  <div key={w} className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" /> {w}
                  </div>
                ))}
              </div>
            )}

            <div className="no-print animate-fade-up" style={{ animationDelay: '60ms' }}>
              <SummaryStrip plan={plan} />
            </div>

            <section id="route" className="no-print grid scroll-mt-6 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
              <div className="card relative h-[420px] overflow-hidden sm:h-[500px] lg:h-[560px]">
                <RouteMap
                  plan={plan}
                  route={route}
                  playMile={playMile}
                  focusDay={focusDay}
                  activeStop={activeStop}
                  zoomTarget={zoomTarget}
                  onStopClick={onStopClick}
                />
                <div className="pointer-events-none absolute bottom-6 left-3 z-[500] hidden flex-wrap sm:flex gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-[11px] text-ink-600 shadow-card backdrop-blur">
                  <span className="flex items-center gap-1.5">
                    <span className="h-0 w-5 border-t-[3px] border-dotted border-ink-500" /> Empty to pickup
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-[3px] w-5 rounded bg-blue-600" /> Loaded
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-[3px] w-5 rounded bg-emerald-500" /> Replayed
                  </span>
                  {focusDay != null && (
                    <span className="flex items-center gap-1.5">
                      <span className="h-[4px] w-5 rounded bg-amber-500" /> Day {focusDay}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setZoomTarget({ kind: 'all', id: 0, nonce: Date.now() })}
                  className="absolute top-3 left-3 z-[500] rounded-lg bg-white/95 px-2.5 py-1.5 text-[11.5px] font-medium text-ink-700 shadow-card hover:bg-white"
                >
                  Fit route
                </button>
              </div>
              <div className="card flex h-[420px] flex-col overflow-hidden sm:h-[500px] lg:h-[560px]">
                <div className="flex items-center justify-between border-b border-line px-4 py-3">
                  <h2 className="text-[14px] font-semibold text-ink-900">Itinerary</h2>
                  <span className="text-[12px] text-ink-400">{plan.stops.length} stops</span>
                </div>
                <div className="min-h-0 flex-1">
                  <Itinerary plan={plan} playhead={playhead} activeStop={activeStop} onSelectStop={onStopClick} />
                </div>
              </div>
            </section>

            <section id="replay" className="no-print scroll-mt-6">
              <div className="mb-3">
                <h2 className="text-[18px] font-semibold tracking-tight text-ink-900">HOS replay</h2>
                <p className="text-[13px] text-ink-500">
                  Scrub or play the trip — the truck moves on the map and the 11 / 14 / 8 / 70-hour clocks count down live.
                </p>
              </div>
              <Replay
                plan={plan}
                playhead={playhead}
                onPlayhead={setPlayhead}
                playing={playing}
                onPlaying={setPlaying}
                speed={speed}
                onSpeed={setSpeed}
              />
            </section>

            <section id="logs" className="scroll-mt-6">
              <LogSheets
                plan={plan}
                driver={driver}
                driverOverrides={driverOverrides}
                onDriverOverrides={setDriverOverrides}
                playhead={playhead}
                onSeek={onSeek}
                focusDay={focusDay}
                onFocusDay={setFocusDay}
                onZoomDay={onZoomDay}
              />
            </section>

            <section id="audit" className="no-print scroll-mt-6">
              <AuditPanel plan={plan} />
            </section>

            <footer className="no-print pb-4 text-center text-[11.5px] text-ink-400">
              Planning aid only — drivers remain responsible for their records of duty status.
            </footer>
          </div>
        )}
      </main>
    </div>
  )
}
