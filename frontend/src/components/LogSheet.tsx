import { forwardRef, useMemo, useState } from 'react'
import { DUTY, DUTY_ORDER } from '../lib/duty'
import { hhmm, parseWall } from '../lib/format'
import type { DayLog, DriverInfo, DutyStatus } from '../types'

const W = 1100
const GX0 = 158 // grid left
const GX1 = 986 // grid right
const GW = GX1 - GX0
const HEADER_Y = 196
const HEADER_H = 26
const GY0 = HEADER_Y + HEADER_H // first duty row
const RH = 34
const GY1 = GY0 + RH * 4
const REMARKS_Y = GY1 + 8
const REMARKS_H = 178
const FOOT_Y = REMARKS_Y + REMARKS_H + 10
const H = FOOT_Y + 118

const INK = '#1d3f9e'
const RULE = '#0f172a'
const FAINT = '#94a3b8'
const FONT = 'Geist, Helvetica, Arial, sans-serif'
const MONO = '"Geist Mono", Menlo, Consolas, monospace'

const x = (minute: number) => GX0 + (minute / 1440) * GW
const rowTop = (s: DutyStatus) => GY0 + DUTY_ORDER.indexOf(s) * RH
const rowMid = (s: DutyStatus) => rowTop(s) + RH / 2

const SHORT_ACTIVITY: Record<string, string> = {
  pre_trip: 'Pre-trip',
  post_trip: 'Post-trip',
  drive: 'Driving',
  pickup: 'Pickup',
  dropoff: 'Drop-off',
  fuel: 'Fuel',
  break: 'Break',
  rest: '10-hr rest',
  restart: '34-hr restart',
  cycle_wait: 'Off duty',
  off: 'Off duty',
}

function clockOf(minute: number) {
  const m = Math.round(minute)
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

interface RemarkGroup {
  location: string
  minutes: number[]
  items: string[]
  labelX: number
}

function groupRemarks(day: DayLog): RemarkGroup[] {
  const groups: RemarkGroup[] = []
  for (const r of day.remarks) {
    const last = groups[groups.length - 1]
    const item = `${clockOf(r.minute)} ${SHORT_ACTIVITY[r.kind] ?? r.kind}`
    if (last && last.location === r.location) {
      last.minutes.push(r.minute)
      last.items.push(item)
    } else {
      groups.push({ location: r.location, minutes: [r.minute], items: [item], labelX: 0 })
    }
  }
  // Spread labels so slanted text never collides; leaders point back to the true time.
  const MIN_GAP = 34
  let prev = -Infinity
  for (const g of groups) {
    g.labelX = Math.max(x(g.minutes[0]), prev + MIN_GAP)
    prev = g.labelX
  }
  // If the spread pushed labels off the right edge, pack them back from the right.
  let limit = W - 150
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].labelX > limit) groups[i].labelX = limit
    limit = groups[i].labelX - MIN_GAP
  }
  return groups
}

function Field({ x: fx, y, w, label, value, mono }: { x: number; y: number; w: number; label: string; value: string; mono?: boolean }) {
  return (
    <g>
      <text x={fx} y={y + 16} fontSize={13.5} fill={INK} fontFamily={mono ? MONO : FONT} fontWeight={500}>
        {value || ' '}
      </text>
      <line x1={fx} x2={fx + w} y1={y + 22} y2={y + 22} stroke={RULE} strokeWidth={0.8} />
      <text x={fx} y={y + 34} fontSize={9.5} fill="#475569" fontFamily={FONT}>
        {label}
      </text>
    </g>
  )
}

interface Props {
  day: DayLog
  totalDays: number
  tripStart: string
  tripEndMinute: number
  driver: DriverInfo
  playhead?: number | null
  onSeek?: (tripMinute: number) => void
}

const LogSheet = forwardRef<SVGSVGElement, Props>(function LogSheet(
  { day, totalDays, tripStart, tripEndMinute, driver, playhead, onSeek },
  ref,
) {
  const [hover, setHover] = useState<number | null>(null)
  const start = parseWall(tripStart)
  const startOffset = start.getUTCHours() * 60 + start.getUTCMinutes()
  const dayStartTrip = (day.day - 1) * 1440 - startOffset
  const date = parseWall(day.date)
  const groups = useMemo(() => groupRemarks(day), [day])

  const playMinute = playhead != null ? playhead - dayStartTrip : null
  const showPlay = playMinute != null && playMinute >= 0 && playMinute <= 1440

  const statusAt = (minute: number): DutyStatus =>
    (day.segments.find((s) => minute >= s.start && minute < s.end) ?? day.segments[day.segments.length - 1]).status

  // Duty line path: horizontal runs joined by vertical risers.
  let path = ''
  day.segments.forEach((s, i) => {
    const y = rowMid(s.status)
    if (i === 0) path += `M${x(s.start)},${y}`
    else path += `L${x(s.start)},${y}`
    path += `L${x(s.end)},${y}`
  })

  const toMinute = (clientX: number, rect: DOMRect) => {
    const svgX = ((clientX - rect.left) / rect.width) * W
    return Math.round(Math.min(1440, Math.max(0, ((svgX - GX0) / GW) * 1440)))
  }

  const truckTrailer = [driver.truckNumber && `Truck ${driver.truckNumber}`, driver.trailerNumber && `Trailer ${driver.trailerNumber}`]
    .filter(Boolean)
    .join(' / ')

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full select-none"
      role="img"
      aria-label={`Driver's daily log for ${day.weekday} ${day.date}`}
      xmlns="http://www.w3.org/2000/svg"
      fontFamily={FONT}
    >
      <rect x={0} y={0} width={W} height={H} fill="#ffffff" />

      {/* ---------- Header ---------- */}
      <text x={24} y={40} fontSize={24} fontWeight={700} fill={RULE} letterSpacing={0.5}>
        DRIVER’S DAILY LOG
      </text>
      <text x={24} y={58} fontSize={10.5} fill="#475569" letterSpacing={0.4}>
        ONE CALENDAR DAY — 24 HOURS · U.S. DEPARTMENT OF TRANSPORTATION · 49 CFR 395.8
      </text>

      {/* Date */}
      {[
        { v: String(date.getUTCMonth() + 1).padStart(2, '0'), l: 'month' },
        { v: String(date.getUTCDate()).padStart(2, '0'), l: 'day' },
        { v: String(date.getUTCFullYear()), l: 'year' },
      ].map((d, i) => {
        const bx = 700 + i * 78
        return (
          <g key={d.l}>
            <text x={bx + 30} y={40} fontSize={20} fontWeight={600} fill={INK} textAnchor="middle" fontFamily={MONO}>
              {d.v}
            </text>
            <line x1={bx} x2={bx + 60} y1={47} y2={47} stroke={RULE} strokeWidth={0.8} />
            <text x={bx + 30} y={59} fontSize={9.5} fill="#475569" textAnchor="middle">
              ({d.l})
            </text>
            {i < 2 && (
              <text x={bx + 69} y={40} fontSize={20} fill={FAINT} textAnchor="middle">
                /
              </text>
            )}
          </g>
        )
      })}
      <g>
        <rect x={948} y={20} width={128} height={40} rx={8} fill="#0b1220" />
        <text x={1012} y={37} fontSize={10} fill="#a5b1c9" textAnchor="middle" letterSpacing={1}>
          SHEET
        </text>
        <text x={1012} y={53} fontSize={14} fill="#ffffff" textAnchor="middle" fontWeight={600} fontFamily={MONO}>
          {day.day} of {totalDays}
        </text>
      </g>

      <Field x={24} y={70} w={500} label="From" value={day.from} />
      <Field x={552} y={70} w={524} label="To" value={day.to} />

      {/* Mileage boxes */}
      {[
        { l: 'Total Miles Driving Today', v: day.miles.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
        { l: 'Total Mileage Today', v: day.miles.toLocaleString('en-US', { maximumFractionDigits: 0 }) },
      ].map((b, i) => (
        <g key={b.l}>
          <rect x={24 + i * 168} y={116} width={158} height={56} rx={4} fill="none" stroke={RULE} strokeWidth={0.9} />
          <text x={24 + i * 168 + 79} y={145} fontSize={20} fontWeight={600} fill={INK} textAnchor="middle" fontFamily={MONO}>
            {b.v}
          </text>
          <text x={24 + i * 168 + 79} y={164} fontSize={9.5} fill="#475569" textAnchor="middle">
            {b.l}
          </text>
        </g>
      ))}
      <Field x={360} y={108} w={340} label="Name of Carrier or Carriers" value={driver.carrier} />
      <Field x={724} y={108} w={352} label="Main Office Address" value={driver.mainOffice} />
      <Field x={360} y={144} w={340} label="Truck/Tractor and Trailer Numbers" value={truckTrailer} mono />
      <Field x={724} y={144} w={352} label="Home Terminal Address" value={driver.homeTerminal} />

      {/* ---------- Grid ---------- */}
      <rect x={24} y={HEADER_Y} width={W - 48} height={HEADER_H} fill="#0b1220" />
      <text x={32} y={HEADER_Y + 17} fontSize={10} fill="#cdd5e3" letterSpacing={0.6}>
        DUTY STATUS
      </text>
      <line x1={GX1 + 16} x2={GX1 + 16} y1={HEADER_Y + 5} y2={HEADER_Y + HEADER_H - 5} stroke="#2b3a5a" />
      <text x={(GX1 + 16 + W - 24) / 2} y={HEADER_Y + 17} fontSize={10} fill="#cdd5e3" textAnchor="middle" letterSpacing={0.6}>
        TOTAL HRS
      </text>
      {Array.from({ length: 25 }, (_, h) => {
        const label = h === 0 || h === 24 ? 'Mid' : h === 12 ? 'Noon' : String(h % 12)
        return (
          <text
            key={h}
            x={x(h * 60)}
            y={HEADER_Y + 17}
            fontSize={h % 12 === 0 ? 9.5 : 11}
            fontWeight={h % 12 === 0 ? 600 : 500}
            fill="#ffffff"
            textAnchor="middle"
            fontFamily={h % 12 === 0 ? FONT : MONO}
          >
            {label}
          </text>
        )
      })}

      {/* Status tint behind each run */}
      {day.segments.map((s, i) => (
        <rect
          key={`tint-${i}`}
          x={x(s.start)}
          y={rowTop(s.status) + 3}
          width={Math.max(0, x(s.end) - x(s.start))}
          height={RH - 6}
          fill={DUTY[s.status].color}
          opacity={0.17}
        />
      ))}

      {DUTY_ORDER.map((s, i) => {
        const top = GY0 + i * RH
        return (
          <g key={s}>
            <rect x={24} y={top} width={GX0 - 24} height={RH} fill={i % 2 ? '#f8fafc' : '#ffffff'} stroke={RULE} strokeWidth={0.8} />
            <circle cx={36} cy={top + RH / 2} r={4} fill={DUTY[s].color} />
            <text x={46} y={top + RH / 2 + 4} fontSize={11.5} fill={RULE} fontWeight={500}>
              {`${i + 1}. ${s === 'ON' ? 'On Duty' : DUTY[s].label}`}
            </text>
            {s === 'ON' && (
              <text x={46} y={top + RH / 2 + 15} fontSize={8.5} fill="#64748b">
                (not driving)
              </text>
            )}
            <rect x={GX0} y={top} width={GW} height={RH} fill="none" stroke={RULE} strokeWidth={0.8} />
            {/* quarter-hour ticks hanging from the top of each row */}
            {Array.from({ length: 24 * 4 }, (_, q) => {
              if (q % 4 === 0) return null
              const len = q % 2 === 0 ? 11 : 6
              const tx = x(q * 15)
              return <line key={q} x1={tx} x2={tx} y1={top} y2={top + len} stroke={RULE} strokeWidth={0.55} />
            })}
            <rect x={GX1 + 8} y={top} width={W - 24 - GX1 - 8} height={RH} fill="#ffffff" stroke={RULE} strokeWidth={0.8} />
            <text
              x={(GX1 + 8 + W - 24) / 2}
              y={top + RH / 2 + 5}
              fontSize={14}
              fontWeight={600}
              fill={day.totals[s] ? INK : '#cbd5e1'}
              textAnchor="middle"
              fontFamily={MONO}
            >
              {hhmm(day.totals[s])}
            </text>
          </g>
        )
      })}
      {Array.from({ length: 25 }, (_, h) => (
        <line key={h} x1={x(h * 60)} x2={x(h * 60)} y1={GY0} y2={GY1} stroke={RULE} strokeWidth={h % 6 === 0 ? 1.1 : 0.7} />
      ))}
      <text x={(GX1 + 8 + W - 24) / 2} y={GY1 + 18} fontSize={12} fontWeight={700} fill={RULE} textAnchor="middle" fontFamily={MONO}>
        = {hhmm(DUTY_ORDER.reduce((a, s) => a + day.totals[s], 0))}
      </text>

      {/* The duty line itself */}
      <path d={path} fill="none" stroke={INK} strokeWidth={2.6} strokeLinejoin="miter" strokeLinecap="square" />
      {day.segments.slice(1).map((s, i) => (
        <circle key={`j-${i}`} cx={x(s.start)} cy={rowMid(s.status)} r={2.3} fill={INK} />
      ))}

      {/* ---------- Remarks ---------- */}
      <text x={24} y={REMARKS_Y + 22} fontSize={11} fontWeight={700} fill={RULE} letterSpacing={0.8}>
        REMARKS
      </text>
      <text x={24} y={REMARKS_Y + 36} fontSize={8.5} fill="#64748b">
        Location at each
      </text>
      <text x={24} y={REMARKS_Y + 47} fontSize={8.5} fill="#64748b">
        change of duty status
      </text>
      <line x1={24} x2={W - 24} y1={REMARKS_Y + REMARKS_H} y2={REMARKS_Y + REMARKS_H} stroke={RULE} strokeWidth={0.8} />
      {groups.map((g, gi) => {
        const x0 = x(g.minutes[0])
        const x1 = x(g.minutes[g.minutes.length - 1])
        const bracketY = GY1 + 12
        const anchorY = bracketY + 16
        return (
          <g key={gi}>
            {g.minutes.map((m, mi) => (
              <line key={mi} x1={x(m)} x2={x(m)} y1={GY1} y2={bracketY} stroke={INK} strokeWidth={1} />
            ))}
            {x1 > x0 && <line x1={x0} x2={x1} y1={bracketY} y2={bracketY} stroke={INK} strokeWidth={1.4} />}
            <line x1={x0} x2={g.labelX} y1={bracketY} y2={anchorY} stroke={INK} strokeWidth={0.8} strokeDasharray={g.labelX > x0 + 1 ? '2 2' : undefined} />
            <g transform={`translate(${g.labelX + 3}, ${anchorY + 4}) rotate(48)`}>
              <text x={0} y={0} fontSize={10.5} fontWeight={600} fill={INK}>
                {g.location}
              </text>
              <text x={0} y={12} fontSize={9} fill="#475569" fontFamily={MONO}>
                {g.items.slice(0, 3).join(' · ')}
                {g.items.length > 3 ? ' …' : ''}
              </text>
            </g>
          </g>
        )
      })}

      {/* ---------- Footer: shipping + recap + certification ---------- */}
      <text x={24} y={FOOT_Y + 14} fontSize={10.5} fontWeight={700} fill={RULE} letterSpacing={0.5}>
        SHIPPING DOCUMENTS
      </text>
      <Field x={24} y={FOOT_Y + 18} w={250} label="DVL or Manifest No. / Pro or Shipping No." value={driver.shippingDoc} mono />
      <Field x={24} y={FOOT_Y + 58} w={250} label="Shipper & Commodity" value={[driver.shipper, driver.commodity].filter(Boolean).join(' — ')} />

      <g>
        <rect x={300} y={FOOT_Y} width={480} height={104} rx={6} fill="#f8fafc" stroke={RULE} strokeWidth={0.8} />
        <text x={314} y={FOOT_Y + 18} fontSize={10.5} fontWeight={700} fill={RULE} letterSpacing={0.5}>
          RECAP · 70 HOUR / 8 DAY
        </text>
        {day.recap.restart_completed && (
          <text x={766} y={FOOT_Y + 18} fontSize={9.5} fill="#6d28d9" textAnchor="end" fontWeight={600}>
            34-hr restart completed today
          </text>
        )}
        {[
          ['On duty today (lines 3 & 4)', day.recap.on_duty_today],
          ['A. Total on duty last 7 days incl. today', day.recap.last_7_days],
          ['B. Total hours available tomorrow (70 − A)', day.recap.available_tomorrow],
          ['C. Total on duty last 8 days incl. today', day.recap.last_8_days],
        ].map(([label, value], i) => (
          <g key={label as string}>
            <text x={314} y={FOOT_Y + 38 + i * 17} fontSize={10.5} fill="#334155">
              {label}
            </text>
            <text x={766} y={FOOT_Y + 38 + i * 17} fontSize={12} fontWeight={600} fill={INK} textAnchor="end" fontFamily={MONO}>
              {hhmm(value as number)}
            </text>
          </g>
        ))}
      </g>

      <g>
        <text x={800} y={FOOT_Y + 14} fontSize={10.5} fontWeight={700} fill={RULE} letterSpacing={0.5}>
          CERTIFICATION
        </text>
        <text x={800} y={FOOT_Y + 46} fontSize={driver.driverName ? 18 : 12} fill={INK} fontStyle="italic" fontFamily="'Brush Script MT', 'Segoe Script', cursive">
          {driver.driverName || ' '}
        </text>
        <line x1={800} x2={1076} y1={FOOT_Y + 52} y2={FOOT_Y + 52} stroke={RULE} strokeWidth={0.8} />
        <text x={800} y={FOOT_Y + 64} fontSize={9.5} fill="#475569">
          Driver’s signature — entries are true and correct
        </text>
        <Field x={800} y={FOOT_Y + 68} w={276} label="Name of Co-Driver" value={driver.coDriver} />
      </g>

      {/* ---------- Interactivity: hover guide + playhead ---------- */}
      {showPlay && (
        <g pointerEvents="none">
          <line x1={x(playMinute!)} x2={x(playMinute!)} y1={GY0 - 4} y2={GY1 + 4} stroke="#2563eb" strokeWidth={2} />
          <circle cx={x(playMinute!)} cy={GY0 - 5} r={4} fill="#2563eb" />
        </g>
      )}
      {hover != null && (
        <g pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={GY0} y2={GY1} stroke="#0f172a" strokeWidth={1} strokeDasharray="3 3" />
          <g transform={`translate(${Math.min(Math.max(x(hover), GX0 + 50), GX1 - 50)}, ${GY0 - 30})`}>
            <rect x={-52} y={-2} width={104} height={24} rx={6} fill="#0b1220" />
            <text x={0} y={14} fontSize={11} fill="#ffffff" textAnchor="middle" fontFamily={MONO}>
              {clockOf(hover)} · {DUTY[statusAt(hover)].short}
            </text>
          </g>
        </g>
      )}
      <rect
        x={GX0}
        y={GY0}
        width={GW}
        height={RH * 4}
        fill="transparent"
        style={{ cursor: onSeek ? 'pointer' : 'default' }}
        onMouseMove={(e) => setHover(toMinute(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()))}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          if (!onSeek) return
          const m = toMinute(e.clientX, (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect())
          onSeek(Math.min(tripEndMinute, Math.max(0, dayStartTrip + m)))
        }}
      />
    </svg>
  )
})

export default LogSheet
