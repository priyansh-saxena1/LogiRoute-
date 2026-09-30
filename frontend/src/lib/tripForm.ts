import type { LocationPayload, LocationValue, PlaceSuggestion, PlanOptionsInput, PlanRequest } from '../types'
import { defaultDeparture } from './format'

export interface TripFormState {
  current: LocationValue
  pickup: LocationValue
  dropoff: LocationValue
  cycleUsed: number
  useHistory: boolean
  /** On-duty hours for the previous 7 days, index 0 = yesterday. */
  history: number[]
  start: string
  options: PlanOptionsInput
}

export const DEFAULT_OPTIONS: PlanOptionsInput = {
  pre_trip_inspection: true,
  post_trip_inspection: true,
  sleeper_berth: true,
}

export const emptyLocation = (): LocationValue => ({ text: '', place: null })

export function initialForm(): TripFormState {
  return {
    current: emptyLocation(),
    pickup: emptyLocation(),
    dropoff: emptyLocation(),
    cycleUsed: 0,
    useHistory: false,
    history: [0, 0, 0, 0, 0, 0, 0],
    start: defaultDeparture(),
    options: { ...DEFAULT_OPTIONS },
  }
}

function payload(value: LocationValue): LocationPayload {
  const p = value.place
  if (p && p.label === value.text) return { label: p.label, short: p.short, lat: p.lat, lon: p.lon }
  return value.text.trim()
}

export function historyTotal(history: number[]): number {
  return Math.round(history.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0) * 100) / 100
}

export function toRequest(form: TripFormState): PlanRequest {
  const cycle = form.useHistory ? historyTotal(form.history) : form.cycleUsed
  return {
    current_location: payload(form.current),
    pickup_location: payload(form.pickup),
    dropoff_location: payload(form.dropoff),
    current_cycle_used: cycle,
    start_time: form.start,
    ...(form.useHistory ? { cycle_history: form.history.map((h) => h || 0) } : {}),
    ...form.options,
  }
}

function place(label: string, lat: number, lon: number): PlaceSuggestion {
  return { id: `ex:${label}`, label, short: label, name: label.split(',')[0], detail: '', kind: 'city', lat, lon }
}

function fromPayload(value: LocationPayload): LocationValue {
  if (typeof value === 'string') return { text: value, place: null }
  const p: PlaceSuggestion = {
    id: `share:${value.lat},${value.lon}`,
    label: value.label,
    short: value.short || value.label,
    name: value.label.split(',')[0],
    detail: '',
    kind: 'place',
    lat: value.lat,
    lon: value.lon,
  }
  return { text: p.label, place: p }
}

export function formFromRequest(req: PlanRequest): TripFormState {
  const history = req.cycle_history?.length ? [...req.cycle_history, 0, 0, 0, 0, 0, 0, 0].slice(0, 7) : null
  return {
    current: fromPayload(req.current_location),
    pickup: fromPayload(req.pickup_location),
    dropoff: fromPayload(req.dropoff_location),
    cycleUsed: req.current_cycle_used,
    useHistory: Boolean(history),
    history: history ?? [0, 0, 0, 0, 0, 0, 0],
    start: req.start_time,
    options: {
      pre_trip_inspection: req.pre_trip_inspection ?? true,
      post_trip_inspection: req.post_trip_inspection ?? true,
      sleeper_berth: req.sleeper_berth ?? true,
    },
  }
}

// --- Share links: the whole request rides in the URL hash (no server state) ---

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(b64 + '==='.slice((b64.length + 3) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
}

export function encodeShare(req: PlanRequest): string {
  return `#trip=${toBase64Url(JSON.stringify(req))}`
}

export function decodeShare(hash: string): PlanRequest | null {
  const match = hash.match(/trip=([A-Za-z0-9_-]+)/)
  if (!match) return null
  try {
    const req = JSON.parse(fromBase64Url(match[1])) as PlanRequest
    if (!req.current_location || !req.pickup_location || !req.dropoff_location) return null
    return req
  } catch {
    return null
  }
}

// --- Example trips (coordinates included so they plan instantly) ---

export interface ExampleTrip {
  id: string
  title: string
  blurb: string
  current: PlaceSuggestion
  pickup: PlaceSuggestion
  dropoff: PlaceSuggestion
  cycleUsed: number
}

export const EXAMPLES: ExampleTrip[] = [
  {
    id: 'coast',
    title: 'Coast-bound long haul',
    blurb: '2,400 mi · 4 log days · fuel & sleeper rests',
    current: place('Chicago, IL', 41.8781, -87.6298),
    pickup: place('Dallas, TX', 32.7767, -96.797),
    dropoff: place('Los Angeles, CA', 34.0522, -118.2437),
    cycleUsed: 18,
  },
  {
    id: 'restart',
    title: 'Low on hours',
    blurb: '58 hrs used · 34-hr restart gets planned',
    current: place('Atlanta, GA', 33.749, -84.388),
    pickup: place('Nashville, TN', 36.1627, -86.7816),
    dropoff: place('Denver, CO', 39.7392, -104.9903),
    cycleUsed: 58,
  },
  {
    id: 'regional',
    title: 'Pacific Northwest run',
    blurb: '~700 mi · overnight in the sleeper',
    current: place('Seattle, WA', 47.6062, -122.3321),
    pickup: place('Portland, OR', 45.5152, -122.6784),
    dropoff: place('Boise, ID', 43.615, -116.2023),
    cycleUsed: 6,
  },
]

export function exampleForm(example: ExampleTrip, base: TripFormState): TripFormState {
  const loc = (p: PlaceSuggestion): LocationValue => ({ text: p.label, place: p })
  return {
    ...base,
    current: loc(example.current),
    pickup: loc(example.pickup),
    dropoff: loc(example.dropoff),
    cycleUsed: example.cycleUsed,
    useHistory: false,
  }
}
