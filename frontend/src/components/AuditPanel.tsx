import clsx from 'clsx'
import { CheckCircle2, ChevronDown, Info, ShieldCheck, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { TripPlan } from '../types'

export default function AuditPanel({ plan }: { plan: TripPlan }) {
  const [showAssumptions, setShowAssumptions] = useState(false)
  const passed = plan.audit.filter((c) => c.passed).length
  const allGood = passed === plan.audit.length
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div className="flex items-center gap-3">
          <span
            className={clsx(
              'grid size-10 place-items-center rounded-xl',
              allGood ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600',
            )}
          >
            <ShieldCheck className="size-5" />
          </span>
          <div>
            <h3 className="text-[15px] font-semibold text-ink-900">
              HOS compliance audit · {passed}/{plan.audit.length} passed
            </h3>
            <p className="text-[12.5px] text-ink-500">
              Re-verified independently from the finished logs — the auditor shares no code with the planner.
            </p>
          </div>
        </div>
        <span className="font-mono text-[11px] text-ink-400">
          planned in {plan.meta.computed_ms.toLocaleString()} ms · {plan.meta.events} duty events
        </span>
      </div>
      <ul className="grid gap-px bg-line sm:grid-cols-2">
        {plan.audit.map((c) => (
          <li key={c.id} className="flex items-start gap-3 bg-white px-5 py-3.5">
            {c.passed ? (
              <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-emerald-500" />
            ) : (
              <XCircle className="mt-0.5 size-4.5 shrink-0 text-rose-500" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-ink-900">{c.rule}</span>
                <span className="shrink-0 font-mono text-[11.5px] text-ink-500 tabular">
                  {c.value} <span className="text-ink-300">/ {c.limit}</span>
                </span>
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-500">{c.detail}</p>
              <p className="mt-1 font-mono text-[10.5px] text-ink-400">{c.citation}</p>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-line">
        <button
          type="button"
          onClick={() => setShowAssumptions((s) => !s)}
          className="flex w-full items-center justify-between px-5 py-3 text-[12.5px] font-medium text-ink-600 hover:bg-ink-100/40"
          aria-expanded={showAssumptions}
        >
          <span className="flex items-center gap-2">
            <Info className="size-4 text-ink-400" /> Planning assumptions
          </span>
          <ChevronDown className={clsx('size-4 text-ink-400 transition-transform', showAssumptions && 'rotate-180')} />
        </button>
        {showAssumptions && (
          <ul className="list-disc space-y-1 px-10 pb-4 text-[12.5px] text-ink-500 marker:text-ink-300">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
