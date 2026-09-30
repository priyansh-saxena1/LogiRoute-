export type DutyStatus = 'OFF' | 'SB' | 'D' | 'ON'

export type EventKind =
  | 'pre_trip'
  | 'drive'
  | 'pickup'
  | 'dropoff'
  | 'fuel'
  | 'break'
  | 'rest'
  | 'restart'
  | 'cycle_wait'
  | 'post_trip'

export type StopType = EventKind | 'origin'

export interface PlaceSuggestion {
  id: string
  label: string
  short: string
  name: string
  detail: string
  kind: string
  lat: number
  lon: number
}

/** What the trip form holds for each location: free text, or a picked suggestion. */
export interface LocationValue {
  text: string
  place: PlaceSuggestion | null
}

export interface Clocks {
  drive_left: number
  window_left: number
  break_left: number
  cycle_left: number
  shift_active: boolean
}

export interface GeoLabel {
  lat: number
  lon: number
  label: string
  city: string | null
  state: string | null
  miles_from_city: number | null
  direction: string | null
}

export interface TripEvent {
  id: number
  status: DutyStatus
  kind: EventKind
  note: string
  start_min: number
  end_min: number
  duration_min: number
  start: string
  end: string
  day: number
  leg: number
  start_mile: number
  end_mile: number
  location: GeoLabel
  end_location: GeoLabel
  clocks_start: Clocks
  clocks_end: Clocks
  continuation: boolean
}

export interface Stop {
  id: number
  type: StopType
  title: string
  kinds: EventKind[]
  events: number[]
  arrive_min: number
  depart_min: number
  arrive: string
  depart: string
  duration_min: number
  mile: number
  day: number
  location: GeoLabel & { name: string }
  notes: string[]
}

export interface ResolvedPlace {
  role: 'current' | 'pickup' | 'dropoff'
  label: string
  short: string
  lat: number
  lon: number
}

export interface RouteLegGeo {
  index: number
  name: string
  from: ResolvedPlace
  to: ResolvedPlace
  miles: number
  drive_minutes: number
  car_minutes: number
  start_mile: number
  source: 'osrm' | 'estimate' | 'same'
  /** [lat, lon, tripMile] */
  geometry: [number, number, number][]
}

export interface LogSegment {
  status: DutyStatus
  start: number
  end: number
}

export interface LogRemark {
  minute: number
  status: DutyStatus
  kind: EventKind | 'off'
  location: string
  note: string
  event: number | null
}

export interface DayLog {
  day: number
  date: string
  weekday: string
  from: string
  to: string
  miles: number
  segments: LogSegment[]
  totals: Record<DutyStatus, number>
  remarks: LogRemark[]
  events: number[]
  recap: {
    on_duty_today: number
    last_7_days: number
    available_tomorrow: number
    last_8_days: number
    restart_completed: boolean
  }
}

export interface AuditCheck {
  id: string
  rule: string
  citation: string
  passed: boolean
  value: string
  limit: string
  detail: string
}

export interface TripSummary {
  total_miles: number
  drive_minutes: number
  on_duty_minutes: number
  trip_minutes: number
  start: string
  end: string
  pickup_arrival: string
  dropoff_arrival: string
  dropoff_complete: string
  log_days: number
  fuel_stops: number
  breaks: number
  rests: number
  restarts: number
  cycle_waits: number
  cycle_used_start: number
  cycle_left_end: number
  avg_mph: number
  compliant: boolean
}

export interface PlanOptionsInput {
  pre_trip_inspection: boolean
  post_trip_inspection: boolean
  sleeper_berth: boolean
}

export interface TripPlan {
  inputs: {
    places: Record<'current' | 'pickup' | 'dropoff', ResolvedPlace>
    current_cycle_used: number
    cycle_history: number[]
    start_time: string
    options: PlanOptionsInput
  }
  summary: TripSummary
  route: { legs: RouteLegGeo[]; total_miles: number; bounds: [[number, number], [number, number]] }
  events: TripEvent[]
  stops: Stop[]
  days: DayLog[]
  audit: AuditCheck[]
  legend: { status: DutyStatus; label: string; line: number }[]
  warnings: string[]
  assumptions: string[]
  meta: { computed_ms: number; geocode_ms: number; routing_ms: number; simulation_ms: number; events: number }
}

export type LocationPayload = string | { label: string; short?: string; lat: number; lon: number }

export interface PlanRequest {
  current_location: LocationPayload
  pickup_location: LocationPayload
  dropoff_location: LocationPayload
  current_cycle_used: number
  start_time: string
  cycle_history?: number[]
  pre_trip_inspection: boolean
  post_trip_inspection: boolean
  sleeper_berth: boolean
}

export interface DriverInfo {
  driverName: string
  coDriver: string
  carrier: string
  mainOffice: string
  homeTerminal: string
  truckNumber: string
  trailerNumber: string
  shippingDoc: string
  shipper: string
  commodity: string
}
