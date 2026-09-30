import L from 'leaflet'
import { Truck } from 'lucide-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap, ZoomControl } from 'react-leaflet'
import { KIND } from '../lib/duty'
import { clock, dateTime, duration, miles as fmtMiles } from '../lib/format'
import { type LatLng, pointAtMile, sliceByMiles } from '../lib/route'
import type { Stop, TripPlan } from '../types'

type FlatRoute = { points: LatLng[]; miles: number[] }

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const ROUTING = 'Routing © <a href="https://project-osrm.org">OSRM</a> / <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'

type Basemap = 'light' | 'streets' | 'satellite'

const BASEMAPS: Record<Basemap, { label: string; layers: { url: string; maxNativeZoom: number }[]; attribution: string }> = {
  light: {
    label: 'Light',
    layers: [
      { url: `${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
      { url: `${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 16 },
    ],
    attribution: `Tiles © <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, © OpenStreetMap · ${ROUTING}`,
  },
  streets: {
    label: 'Streets',
    layers: [{ url: `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 }],
    attribution: `Tiles © <a href="https://www.esri.com">Esri</a> — Esri, HERE, Garmin, USGS, © OpenStreetMap · ${ROUTING}`,
  },
  satellite: {
    label: 'Satellite',
    layers: [
      { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 },
      { url: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, maxNativeZoom: 19 },
    ],
    attribution: `Imagery © <a href="https://www.esri.com">Esri</a>, Maxar, Earthstar Geographics · ${ROUTING}`,
  },
}

const iconCache = new Map<string, L.DivIcon>()

function stopIcon(stop: Stop, active: boolean): L.DivIcon {
  const key = `${stop.type}-${active}`
  const cached = iconCache.get(key)
  if (cached) return cached
  const meta = KIND[stop.type]
  const major = ['origin', 'pickup', 'dropoff'].includes(stop.type)
  const size = major ? 34 : 26
  const svg = renderToStaticMarkup(<meta.icon size={major ? 17 : 13} strokeWidth={2.4} color="#fff" />)
  const html = `<div style="width:${size}px;height:${size}px;border-radius:${major ? 12 : 999}px;background:${meta.color};
    border:${active ? 3 : 2.5}px solid #fff;display:grid;place-items:center;
    box-shadow:0 4px 14px -2px rgba(15,23,42,.45)${active ? ',0 0 0 4px rgba(37,99,235,.35)' : ''};
    transform:${major ? 'rotate(0)' : 'none'}">${svg}</div>`
  const icon = L.divIcon({ html, className: 'stop-pin', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
  iconCache.set(key, icon)
  return icon
}

const truckIcon = L.divIcon({
  className: 'stop-pin',
  iconSize: [40, 40],
  iconAnchor: [20, 20],
  html: `<div style="position:relative;width:40px;height:40px;display:grid;place-items:center">
    <span class="pulse-ring" style="position:absolute;inset:4px;border-radius:999px;background:rgba(37,99,235,.35)"></span>
    <span style="position:relative;width:30px;height:30px;border-radius:999px;background:#0b1220;border:2.5px solid #fff;display:grid;place-items:center;box-shadow:0 6px 18px -4px rgba(15,23,42,.6)">
    ${renderToStaticMarkup(<Truck size={15} strokeWidth={2.4} color="#34d399" />)}</span></div>`,
})

/** Wheel-zoom only after the map is clicked, so scrolling the page never gets hijacked. */
function WheelGuard() {
  const map = useMap()
  useEffect(() => {
    map.scrollWheelZoom.disable()
    const enable = () => map.scrollWheelZoom.enable()
    const disable = () => map.scrollWheelZoom.disable()
    map.on('click', enable)
    map.on('mouseout', disable)
    return () => {
      map.off('click', enable)
      map.off('mouseout', disable)
    }
  }, [map])
  return null
}

function Fit({ bounds, focus }: { bounds: L.LatLngBoundsExpression; focus: L.LatLngBoundsExpression | null }) {
  const map = useMap()
  useEffect(() => {
    // Fit once layout has settled, and re-fit on resize until the user takes over.
    const container = map.getContainer()
    let touched = false
    const markTouched = () => (touched = true)
    const fit = () => {
      map.invalidateSize()
      if (!touched) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 })
    }
    const raf = requestAnimationFrame(fit)
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    container.addEventListener('pointerdown', markTouched)
    container.addEventListener('wheel', markTouched, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      container.removeEventListener('pointerdown', markTouched)
      container.removeEventListener('wheel', markTouched)
    }
  }, [map, bounds])
  useEffect(() => {
    if (focus) map.flyToBounds(focus, { padding: [70, 70], maxZoom: 10, duration: 0.8 })
  }, [map, focus])
  return null
}

interface Props {
  plan: TripPlan
  route: FlatRoute
  playMile: number | null
  focusDay: number | null
  activeStop: number | null
  zoomTarget: { kind: 'day' | 'stop' | 'all'; id: number; nonce: number } | null
  onStopClick: (stop: Stop) => void
}

function RouteMap({ plan, route, playMile, focusDay, activeStop, zoomTarget, onStopClick }: Props) {
  const [basemap, setBasemap] = useState<Basemap>('light')
  const legs = useMemo(
    () => plan.route.legs.map((leg) => leg.geometry.map(([lat, lon]) => [lat, lon] as LatLng)),
    [plan],
  )

  const dayRuns = useMemo(() => {
    if (focusDay == null) return []
    return plan.events
      .filter((e) => e.status === 'D' && e.day === focusDay)
      .map((e) => sliceByMiles(route, e.start_mile, e.end_mile))
  }, [plan, route, focusDay])

  const bounds = useMemo(() => L.latLngBounds(plan.route.bounds as L.LatLngBoundsLiteral).pad(0.02), [plan])

  const focus = useMemo(() => {
    if (!zoomTarget) return null
    if (zoomTarget.kind === 'all') return bounds
    if (zoomTarget.kind === 'stop') {
      const s = plan.stops.find((st) => st.id === zoomTarget.id)
      if (!s) return null
      return L.latLng(s.location.lat, s.location.lon).toBounds(40_000)
    }
    const pts = plan.events
      .filter((e) => e.day === zoomTarget.id)
      .flatMap((e) => [
        [e.location.lat, e.location.lon] as LatLng,
        [e.end_location.lat, e.end_location.lon] as LatLng,
      ])
    return pts.length ? L.latLngBounds(pts) : null
  }, [zoomTarget, bounds, plan])

  const progress = useMemo(
    () => (playMile != null && playMile > 0 ? sliceByMiles(route, 0, playMile) : []),
    [route, playMile],
  )
  const truckAt = playMile != null ? pointAtMile(route, playMile) : null

  return (
    <>
    <MapContainer
      bounds={bounds}
      zoomControl={false}
      zoomSnap={0.25}
      scrollWheelZoom={false}
      className="h-full w-full"
      attributionControl
      preferCanvas={false}
    >
      {BASEMAPS[basemap].layers.map((layer, i) => (
        <TileLayer
          key={`${basemap}-${i}`}
          url={layer.url}
          attribution={i === 0 ? BASEMAPS[basemap].attribution : ''}
          maxNativeZoom={layer.maxNativeZoom}
          maxZoom={19}
        />
      ))}
      <ZoomControl position="topright" />
      <WheelGuard />
      <Fit bounds={bounds} focus={focus} />

      {legs.map((pts, i) => (
        <Polyline key={`case-${i}`} positions={pts} pathOptions={{ color: '#ffffff', weight: 9, opacity: 0.95 }} />
      ))}
      {legs[0].length > 1 && (
        <Polyline
          positions={legs[0]}
          pathOptions={{ color: '#475569', weight: 4.5, dashArray: '1 9', lineCap: 'round', opacity: 0.9 }}
        />
      )}
      <Polyline positions={legs[1]} pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.9, lineJoin: 'round' }} />

      {progress.length > 1 && (
        <Polyline positions={progress} pathOptions={{ color: '#10b981', weight: 5.5, opacity: 1, lineJoin: 'round' }} />
      )}

      {dayRuns.map((pts, i) =>
        pts.length > 1 ? (
          <Polyline
            key={`day-${focusDay}-${i}`}
            positions={pts}
            pathOptions={{ color: '#f59e0b', weight: 8, opacity: 0.9, lineCap: 'round' }}
          />
        ) : null,
      )}

      {plan.stops.map((stop) => {
        const meta = KIND[stop.type]
        const major = ['origin', 'pickup', 'dropoff'].includes(stop.type)
        return (
          <Marker
            key={stop.id}
            position={[stop.location.lat, stop.location.lon]}
            icon={stopIcon(stop, activeStop === stop.id)}
            zIndexOffset={major ? 1000 : activeStop === stop.id ? 800 : 0}
            eventHandlers={{ click: () => onStopClick(stop) }}
          >
            {major && (
              <Tooltip permanent direction="top" offset={[0, -18]} className="!rounded-lg !border-0 !px-2 !py-1 !text-[11px] !font-semibold !shadow-card">
                {stop.type === 'origin' ? 'Start' : meta.label} · {stop.location.name.split(',')[0]}
              </Tooltip>
            )}
            <Popup closeButton={false} offset={[0, -8]}>
              <div className="min-w-[210px]">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: meta.color }} />
                  <span className="text-[13px] font-semibold text-ink-900">{stop.title}</span>
                </div>
                <div className="mt-1 text-[12px] text-ink-500">{stop.location.label}</div>
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
                  <span className="text-ink-400">Arrive</span>
                  <span className="text-right font-mono text-ink-800">{dateTime(stop.arrive)}</span>
                  <span className="text-ink-400">Depart</span>
                  <span className="text-right font-mono text-ink-800">
                    {stop.type === 'dropoff' ? clock(stop.depart) : dateTime(stop.depart)}
                  </span>
                  <span className="text-ink-400">Duration</span>
                  <span className="text-right font-mono text-ink-800">{duration(stop.duration_min)}</span>
                  <span className="text-ink-400">Odometer</span>
                  <span className="text-right font-mono text-ink-800">{fmtMiles(stop.mile)}</span>
                </div>
              </div>
            </Popup>
          </Marker>
        )
      })}

      {truckAt && <Marker position={truckAt} icon={truckIcon} zIndexOffset={2000} interactive={false} />}
    </MapContainer>
    <div className="absolute top-3 right-14 z-[500] flex rounded-lg bg-white/95 p-0.5 text-[11.5px] font-medium shadow-card">
      {(Object.keys(BASEMAPS) as Basemap[]).map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => setBasemap(key)}
          className={
            basemap === key
              ? 'rounded-md bg-ink-900 px-2.5 py-1 text-white'
              : 'rounded-md px-2.5 py-1 text-ink-600 hover:text-ink-900'
          }
        >
          {BASEMAPS[key].label}
        </button>
      ))}
    </div>
    </>
  )
}

export default memo(RouteMap)
