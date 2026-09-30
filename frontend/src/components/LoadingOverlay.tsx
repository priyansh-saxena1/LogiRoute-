import clsx from 'clsx'
import { Check, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'

const STEPS = [
  'Finding the three stops',
  'Routing over real roads',
  'Scheduling hours of service',
  'Drawing daily log sheets',
]
const DELAYS = [700, 1900, 2600]

export default function LoadingOverlay() {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const timers = DELAYS.map((ms, i) => window.setTimeout(() => setStep(i + 1), ms))
    return () => timers.forEach(window.clearTimeout)
  }, [])

  return (
    <div className="no-print absolute inset-0 z-[1000] flex items-start justify-center bg-canvas/70 pt-28 backdrop-blur-[3px]">
      <div className="card w-[320px] animate-fade-up p-5 shadow-float" role="status" aria-live="polite">
        <div className="text-[14px] font-semibold text-ink-900">Planning your trip</div>
        <ol className="mt-3 flex flex-col gap-2.5">
          {STEPS.map((label, i) => (
            <li key={label} className={clsx('flex items-center gap-2.5 text-[13px]', i > step ? 'text-ink-300' : 'text-ink-700')}>
              <span
                className={clsx(
                  'grid size-5 place-items-center rounded-full',
                  i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-blue-50 text-blue-600' : 'bg-ink-100',
                )}
              >
                {i < step ? (
                  <Check className="size-3" strokeWidth={3} />
                ) : i === step ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : null}
              </span>
              {label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
