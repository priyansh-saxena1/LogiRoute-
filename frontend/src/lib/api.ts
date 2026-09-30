import type { PlaceSuggestion, PlanRequest, TripPlan } from '../types'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''

export class ApiError extends Error {
  status: number
  field?: string
  details?: Record<string, string[]>

  constructor(message: string, status: number, field?: string, details?: Record<string, string[]>) {
    super(message)
    this.status = status
    this.field = field
    this.details = details
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${BASE}/api${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init?.headers },
    })
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    throw new ApiError('Could not reach the planning service. Check your connection and try again.', 0)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const e = body?.error
    throw new ApiError(e?.message ?? `Request failed (${response.status})`, response.status, e?.field, e?.details)
  }
  return body as T
}

export const api = {
  async searchPlaces(q: string, source: 'local' | 'remote', signal?: AbortSignal): Promise<PlaceSuggestion[]> {
    const params = new URLSearchParams({ q, source, limit: '6' })
    const data = await request<{ results: PlaceSuggestion[] }>(`/geocode/search?${params}`, { signal })
    return data.results
  },

  async reverse(lat: number, lon: number): Promise<PlaceSuggestion> {
    const params = new URLSearchParams({ lat: lat.toFixed(6), lon: lon.toFixed(6) })
    const data = await request<{ result: PlaceSuggestion }>(`/geocode/reverse?${params}`)
    return data.result
  },

  plan(body: PlanRequest, signal?: AbortSignal): Promise<TripPlan> {
    return request<TripPlan>('/trips/plan', { method: 'POST', body: JSON.stringify(body), signal })
  },
}
