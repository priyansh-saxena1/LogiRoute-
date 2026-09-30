import clsx from 'clsx'
import { CalendarDays } from 'lucide-react'
import { parseWall } from '../lib/format'
import { historyTotal } from '../lib/tripForm'

interface Props {
  cycleUsed: number
  onCycleUsed: (hours: number) => void
  useHistory: boolean
  onUseHistory: (on: boolean) => void
  history: number[]
  onHistory: (history: number[]) => void
  departure: string
  error?: string
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function CycleInput({
  cycleUsed,
  onCycleUsed,
  useHistory,
  onUseHistory,
  history,
  onHistory,
  departure,
  error,
}: Props) {
  const used = useHistory ? historyTotal(history) : cycleUsed
  const over = used > 70
  const available = Math.max(0, 70 - used)
  const pct = Math.min(100, (used / 70) * 100)
  const tone = over ? '#f43f5e' : used >= 60 ? '#f59e0b' : '#3b82f6'

  const base = departure ? parseWall(departure) : new Date()
  const dayLabel = (i: number) => {
    const d = new Date(base.getTime() - (i + 1) * 86_400_000)
    return { weekday: WEEKDAY[d.getUTCDay()], date: d.getUTCDate() }
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor="cycle-used" className="text-[12px] font-medium text-ink-300">
          Current cycle used <span className="text-ink-500">(70 hr / 8 day)</span>
        </label>
      </div>

      <div className="rounded-xl border border-ink-700 bg-ink-850 p-3">
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-baseline gap-1.5">
            <input
              id="cycle-used"
              type="number"
              inputMode="decimal"
              min={0}
              max={70}
              step={0.25}
              disabled={useHistory}
              value={useHistory ? used : Number.isFinite(cycleUsed) ? cycleUsed : ''}
              onChange={(e) => onCycleUsed(e.target.value === '' ? 0 : Number(e.target.value))}
              className="w-[4.5ch] bg-transparent font-mono text-[28px] leading-none font-semibold text-white tabular focus:outline-none disabled:text-ink-200"
              aria-describedby="cycle-help"
            />
            <span className="text-[13px] text-ink-400">hrs used</span>
          </div>
          <div className="text-right">
            <div className="font-mono text-[15px] font-semibold tabular" style={{ color: over ? '#fb7185' : '#e7ebf3' }}>
              {available.toFixed(available % 1 ? 1 : 0)}h
            </div>
            <div className="text-[11px] text-ink-400">available</div>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={70}
          step={0.5}
          value={Math.min(70, used)}
          disabled={useHistory}
          onChange={(e) => onCycleUsed(Number(e.target.value))}
          aria-label="Current cycle used in hours"
          className="range mt-3 w-full disabled:opacity-60"
          style={{ background: `linear-gradient(90deg, ${tone} ${pct}%, #1d2a45 ${pct}%)` }}
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-500">
          <span>0</span>
          <span>35</span>
          <span>70</span>
        </div>

        <button
          type="button"
          onClick={() => onUseHistory(!useHistory)}
          className={clsx(
            'mt-2.5 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] transition-colors',
            useHistory ? 'bg-blue-500/10 text-blue-300' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-200',
          )}
          aria-pressed={useHistory}
        >
          <CalendarDays className="size-3.5" />
          {useHistory ? 'Using day-by-day hours (rolling 8-day window)' : 'Enter the last 7 days instead'}
        </button>

        {useHistory && (
          <div className="mt-2 grid grid-cols-7 gap-1">
            {history.map((h, i) => {
              const { weekday, date } = dayLabel(i)
              return (
                <label key={i} className="flex flex-col items-center gap-1">
                  <span className="text-[10px] leading-none text-ink-500">{weekday}</span>
                  <span className="text-[10px] leading-none text-ink-400">{date}</span>
                  <input
                    type="number"
                    min={0}
                    max={24}
                    step={0.5}
                    value={h}
                    onChange={(e) => {
                      const next = [...history]
                      next[i] = Math.min(24, Math.max(0, Number(e.target.value) || 0))
                      onHistory(next)
                    }}
                    className="h-8 w-full rounded-md border border-ink-700 bg-ink-900 text-center font-mono text-[12px] text-white tabular focus:border-blue-500 focus:outline-none"
                    aria-label={`On-duty hours ${i + 1} day${i ? 's' : ''} before departure`}
                  />
                </label>
              )
            })}
          </div>
        )}
      </div>
      <p id="cycle-help" className={clsx('mt-1.5 text-[11.5px]', over || error ? 'text-rose-400' : 'text-ink-500')}>
        {error ??
          (over
            ? 'More than 70 hours — the cycle is already exhausted.'
            : useHistory
              ? 'Older days roll off at midnight, freeing hours mid-trip.'
              : 'On-duty hours in the last 8 days, including today.')}
      </p>
    </div>
  )
}
