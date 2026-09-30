import clsx from 'clsx'
import { Building2, Check, Crosshair, Loader2, MapPin, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { LocationValue, PlaceSuggestion } from '../types'

interface Props {
  label: string
  placeholder: string
  icon: LucideIcon
  accent: string
  value: LocationValue
  onChange: (value: LocationValue) => void
  error?: string
  geolocate?: boolean
  autoFocus?: boolean
}

function merge(local: PlaceSuggestion[], remote: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>()
  const out: PlaceSuggestion[] = []
  for (const s of [...local, ...remote]) {
    const key = s.label.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(s)
  }
  return out.slice(0, 8)
}

export default function LocationInput({
  label,
  placeholder,
  icon: Icon,
  accent,
  value,
  onChange,
  error,
  geolocate,
  autoFocus,
}: Props) {
  const id = useId()
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<PlaceSuggestion[]>([])
  const [remote, setRemote] = useState<PlaceSuggestion[]>([])
  const [remoteLoading, setRemoteLoading] = useState(false)
  const [active, setActive] = useState(0)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const query = value.place ? '' : value.text.trim()

  useEffect(() => {
    if (query.length < 2) {
      setLocal([])
      setRemote([])
      setRemoteLoading(false)
      return
    }
    const controller = new AbortController()
    const localTimer = window.setTimeout(() => {
      api.searchPlaces(query, 'local', controller.signal).then(setLocal).catch(() => {})
    }, 60)
    const remoteTimer = window.setTimeout(() => {
      setRemoteLoading(true)
      api
        .searchPlaces(query, 'remote', controller.signal)
        .then(setRemote)
        .catch(() => {})
        .finally(() => !controller.signal.aborted && setRemoteLoading(false))
    }, 320)
    return () => {
      controller.abort()
      window.clearTimeout(localTimer)
      window.clearTimeout(remoteTimer)
    }
  }, [query])

  const suggestions = merge(local, remote)
  const showList = open && query.length >= 2 && (suggestions.length > 0 || remoteLoading)

  useEffect(() => setActive(0), [query])

  function pick(s: PlaceSuggestion) {
    onChange({ text: s.label, place: s })
    setOpen(false)
    setRemote([])
    setLocal([])
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showList) {
      if (e.key === 'ArrowDown') setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && suggestions[active]) {
      e.preventDefault()
      pick(suggestions[active])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setGeoError('Location is not available in this browser.')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const place = await api.reverse(pos.coords.latitude, pos.coords.longitude)
          onChange({ text: place.label, place })
        } catch {
          setGeoError('Could not look up your position.')
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        setGeoError('Location permission was denied.')
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    )
  }

  const message = error ?? geoError

  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1.5 flex items-center justify-between text-[12px] font-medium text-ink-300">
        <span>{label}</span>
        {value.place && (
          <span className="flex items-center gap-1 text-[11px] font-normal text-emerald-400/90">
            <Check className="size-3" strokeWidth={3} /> located
          </span>
        )}
      </label>
      <div
        className={clsx(
          'group flex items-center gap-2.5 rounded-xl border bg-ink-850 pr-1.5 pl-3 transition-colors',
          message ? 'border-rose-500/70' : 'border-ink-700 focus-within:border-blue-500/80 hover:border-ink-600',
        )}
      >
        <span
          className="grid size-6 shrink-0 place-items-center rounded-md"
          style={{ background: `${accent}22`, color: accent }}
          aria-hidden
        >
          <Icon className="size-3.5" strokeWidth={2.4} />
        </span>
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-invalid={Boolean(message)}
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          className="h-11 min-w-0 flex-1 bg-transparent text-[14px] text-white placeholder:text-ink-500 focus:outline-none"
          placeholder={placeholder}
          value={value.text}
          onChange={(e) => {
            onChange({ text: e.target.value, place: null })
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
        {geolocate && (
          <button
            type="button"
            onClick={locate}
            disabled={locating}
            title="Use my current location"
            aria-label="Use my current location"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-400 transition-colors hover:bg-ink-700 hover:text-white"
          >
            {locating ? <Loader2 className="size-4 animate-spin" /> : <Crosshair className="size-4" />}
          </button>
        )}
      </div>
      {message && <p className="mt-1.5 text-[12px] text-rose-400">{message}</p>}

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="scroll-dark absolute inset-x-0 top-full z-30 mt-1.5 max-h-80 overflow-auto rounded-xl border border-ink-700 bg-ink-850 p-1 shadow-float"
        >
          {suggestions.map((s, i) => {
            const SIcon = s.kind === 'city' || s.kind === 'town' ? Building2 : MapPin
            return (
              <li
                key={s.id + i}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(s)
                }}
                onMouseEnter={() => setActive(i)}
                className={clsx(
                  'flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2',
                  i === active ? 'bg-ink-700' : 'hover:bg-ink-800',
                )}
              >
                <SIcon className="size-4 shrink-0 text-ink-400" />
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-white">{s.name}</div>
                  <div className="truncate text-[12px] text-ink-400">{s.detail || s.label}</div>
                </div>
              </li>
            )
          })}
          {remoteLoading && (
            <li className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ink-400">
              <Loader2 className="size-3.5 animate-spin" /> Searching addresses…
            </li>
          )}
        </ul>
      )}
    </div>
  )
}
