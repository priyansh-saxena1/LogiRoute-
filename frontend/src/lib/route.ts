import type { RouteLegGeo, TripEvent } from '../types'

export type LatLng = [number, number]

/** Flatten both legs into one polyline with trip-cumulative mileage per vertex. */
export function flattenRoute(legs: RouteLegGeo[]): { points: LatLng[]; miles: number[] } {
  const points: LatLng[] = []
  const miles: number[] = []
  for (const leg of legs) {
    for (const [lat, lon, mile] of leg.geometry) {
      if (miles.length && mile < miles[miles.length - 1]) continue
      points.push([lat, lon])
      miles.push(mile)
    }
  }
  return { points, miles }
}

function lowerIndex(miles: number[], mile: number): number {
  let lo = 0
  let hi = miles.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (miles[mid] <= mile) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function pointAtMile(route: { points: LatLng[]; miles: number[] }, mile: number): LatLng {
  const { points, miles } = route
  if (!points.length) return [39.5, -98.35]
  if (mile <= miles[0]) return points[0]
  if (mile >= miles[miles.length - 1]) return points[points.length - 1]
  const i = lowerIndex(miles, mile)
  const span = miles[i + 1] - miles[i]
  const f = span > 0 ? (mile - miles[i]) / span : 0
  return [points[i][0] + (points[i + 1][0] - points[i][0]) * f, points[i][1] + (points[i + 1][1] - points[i][1]) * f]
}

/** Sub-polyline between two trip miles (inclusive, interpolated ends). */
export function sliceByMiles(route: { points: LatLng[]; miles: number[] }, from: number, to: number): LatLng[] {
  const { points, miles } = route
  if (points.length < 2 || to <= from) return []
  const out: LatLng[] = [pointAtMile(route, from)]
  const start = lowerIndex(miles, from) + 1
  for (let i = start; i < points.length && miles[i] < to; i++) out.push(points[i])
  out.push(pointAtMile(route, to))
  return out
}

export function eventAt(events: TripEvent[], minute: number): TripEvent {
  let lo = 0
  let hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (events[mid].start_min <= minute) lo = mid
    else hi = mid - 1
  }
  return events[lo]
}

export function mileAt(events: TripEvent[], minute: number): number {
  const ev = eventAt(events, minute)
  if (ev.status !== 'D' || ev.duration_min === 0) return ev.start_mile
  const f = Math.min(1, Math.max(0, (minute - ev.start_min) / ev.duration_min))
  return ev.start_mile + (ev.end_mile - ev.start_mile) * f
}
