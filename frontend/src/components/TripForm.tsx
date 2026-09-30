import clsx from 'clsx'
import { ArrowDownUp, ChevronDown, Clock3, Flag, Loader2, Navigation, Package, Route, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { EXAMPLES, type ExampleTrip, type TripFormState } from '../lib/tripForm'
import type { PlanOptionsInput } from '../types'
import CycleInput from './CycleInput'
import LocationInput from './LocationInput'

export type FieldErrors = Partial<Record<'current' | 'pickup' | 'dropoff' | 'cycle' | 'start', string>>

interface Props {
  form: TripFormState
  onChange: (form: TripFormState) => void
  onSubmit: () => void
  onExample: (example: ExampleTrip) => void
  loading: boolean
  errors: FieldErrors
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 py-2">
      <span>
        <span className="block text-[13px] text-ink-100">{label}</span>
        <span className="block text-[11.5px] text-ink-500">{hint}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={clsx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-blue-500' : 'bg-ink-700',
        )}
      >
        <span
          className={clsx(
            'absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
    </label>
  )
}

export default function TripForm({ form, onChange, onSubmit, onExample, loading, errors }: Props) {
  const [showOptions, setShowOptions] = useState(false)
  const set = <K extends keyof TripFormState>(key: K, value: TripFormState[K]) => onChange({ ...form, [key]: value })
  const setOption = (key: keyof PlanOptionsInput, value: boolean) =>
    onChange({ ...form, options: { ...form.options, [key]: value } })

  const ready = [form.current, form.pickup, form.dropoff].every((l) => l.text.trim().length >= 2)

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!loading) onSubmit()
      }}
      noValidate
    >
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow !text-ink-400">Trip</h2>
          <button
            type="button"
            onClick={() => onChange({ ...form, pickup: form.dropoff, dropoff: form.pickup })}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-ink-400 transition-colors hover:bg-ink-800 hover:text-ink-100"
            title="Swap pickup and drop-off"
          >
            <ArrowDownUp className="size-3" /> Swap stops
          </button>
        </div>
        <div className="relative flex flex-col gap-3">
          <span
            aria-hidden
            className="pointer-events-none absolute top-[46px] bottom-[34px] left-[23px] w-px border-l border-dashed border-ink-600"
          />
          <LocationInput
            label="Current location"
            placeholder="Where is the truck now?"
            icon={Navigation}
            accent="#e7ebf3"
            value={form.current}
            onChange={(v) => set('current', v)}
            error={errors.current}
            geolocate
          />
          <LocationInput
            label="Pickup"
            placeholder="Shipper city or address"
            icon={Package}
            accent="#60a5fa"
            value={form.pickup}
            onChange={(v) => set('pickup', v)}
            error={errors.pickup}
          />
          <LocationInput
            label="Drop-off"
            placeholder="Receiver city or address"
            icon={Flag}
            accent="#fb7185"
            value={form.dropoff}
            onChange={(v) => set('dropoff', v)}
            error={errors.dropoff}
          />
        </div>
      </section>

      <CycleInput
        cycleUsed={form.cycleUsed}
        onCycleUsed={(h) => set('cycleUsed', h)}
        useHistory={form.useHistory}
        onUseHistory={(on) => set('useHistory', on)}
        history={form.history}
        onHistory={(h) => set('history', h)}
        departure={form.start}
        error={errors.cycle}
      />

      <div>
        <label htmlFor="departure" className="mb-1.5 block text-[12px] font-medium text-ink-300">
          Departure <span className="text-ink-500">(home terminal time)</span>
        </label>
        <div className="flex items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 pr-2 pl-3 focus-within:border-blue-500/80">
          <Clock3 className="size-4 text-ink-400" />
          <input
            id="departure"
            type="datetime-local"
            value={form.start}
            step={900}
            onChange={(e) => e.target.value && set('start', e.target.value.slice(0, 16))}
            className="h-11 min-w-0 flex-1 bg-transparent font-mono text-[13px] text-white [color-scheme:dark] focus:outline-none"
          />
        </div>
        {errors.start && <p className="mt-1.5 text-[12px] text-rose-400">{errors.start}</p>}
      </div>

      <div className="rounded-xl border border-ink-700/70">
        <button
          type="button"
          onClick={() => setShowOptions((s) => !s)}
          className="flex w-full items-center justify-between px-3 py-2.5 text-[12.5px] text-ink-300 hover:text-white"
          aria-expanded={showOptions}
        >
          <span>Log options</span>
          <span className="flex items-center gap-2 text-[11px] text-ink-500">
            {[form.options.pre_trip_inspection && 'pre', form.options.post_trip_inspection && 'post', form.options.sleeper_berth && 'sleeper']
              .filter(Boolean)
              .join(' · ') || 'none'}
            <ChevronDown className={clsx('size-4 transition-transform', showOptions && 'rotate-180')} />
          </span>
        </button>
        {showOptions && (
          <div className="divide-y divide-ink-800 border-t border-ink-700/70 px-3 pb-1">
            <Toggle
              checked={form.options.pre_trip_inspection}
              onChange={(v) => setOption('pre_trip_inspection', v)}
              label="Pre-trip inspection"
              hint="15 min on duty at the start of each shift"
            />
            <Toggle
              checked={form.options.post_trip_inspection}
              onChange={(v) => setOption('post_trip_inspection', v)}
              label="Post-trip inspection"
              hint="15 min on duty before each rest"
            />
            <Toggle
              checked={form.options.sleeper_berth}
              onChange={(v) => setOption('sleeper_berth', v)}
              label="Rest in sleeper berth"
              hint="Log 10-hr rests on line 2 instead of line 1"
            />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={loading || !ready}
        className="group relative flex h-12 items-center justify-center gap-2 overflow-hidden rounded-xl bg-blue-600 text-[14.5px] font-semibold text-white shadow-[0_8px_24px_-8px_rgb(37_99_235/0.7)] transition-all hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-ink-400 disabled:shadow-none"
      >
        {loading ? <Loader2 className="size-4 animate-spin" /> : <Route className="size-4" />}
        {loading ? 'Planning trip…' : 'Plan trip & draw logs'}
      </button>

      <section>
        <h2 className="eyebrow mb-2 flex items-center gap-1.5 !text-ink-500">
          <Sparkles className="size-3" /> Try an example
        </h2>
        <div className="flex flex-col gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.id}
              type="button"
              disabled={loading}
              onClick={() => onExample(ex)}
              className="group rounded-xl border border-ink-800 bg-ink-850/60 px-3 py-2.5 text-left transition-colors hover:border-ink-600 hover:bg-ink-800 disabled:opacity-50"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12.5px] font-medium text-ink-100">{ex.title}</span>
                <span className="text-[11px] text-ink-500 group-hover:text-blue-300">Plan →</span>
              </div>
              <div className="mt-0.5 truncate text-[11.5px] text-ink-400">
                {ex.current.short.split(',')[0]} → {ex.pickup.short.split(',')[0]} → {ex.dropoff.short.split(',')[0]} ·{' '}
                {ex.blurb}
              </div>
            </button>
          ))}
        </div>
      </section>
    </form>
  )
}
