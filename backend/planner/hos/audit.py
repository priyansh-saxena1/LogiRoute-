"""Independent HOS compliance audit.

This deliberately shares no state or logic with the simulator: it re-derives
shifts, breaks and the rolling 8-day cycle from nothing but the finished duty
timeline, the same way an auditor would read a stack of paper logs. If the
simulator ever produced a violation, this is where it would surface.
"""

from __future__ import annotations

from dataclasses import dataclass

from .rules import DEFAULT_RULES, Duty, HOSRules
from .simulator import MINUTES_PER_DAY


@dataclass(frozen=True)
class Span:
    status: Duty
    kind: str
    start: int
    end: int
    start_mile: float
    end_mile: float


def _fmt(minutes: float) -> str:
    minutes = int(round(minutes))
    return f"{minutes // 60}h {minutes % 60:02d}m"


def audit_timeline(
    spans: list[Span],
    history: list[int],
    start_offset: int,
    total_miles: float,
    daily_totals: list[int],
    rules: HOSRules = DEFAULT_RULES,
) -> list[dict]:
    checks: list[dict] = []

    # Treat the driver as rested before the trip (the planner's stated assumption).
    shift_start: int | None = None
    shift_drive = 0
    since_break = 0
    nondrive = 0
    off = rules.daily_rest
    max_shift_drive = 0
    max_window_used = 0
    max_since_break = 0
    shifts = 0
    restart_points: list[int] = []

    for s in spans:
        dur = s.end - s.start
        if s.status == Duty.D:
            if shift_start is None:
                shift_start = s.start
                shifts += 1
            shift_drive += dur
            since_break += dur
            nondrive = 0
            off = 0
            max_shift_drive = max(max_shift_drive, shift_drive)
            max_since_break = max(max_since_break, since_break)
            max_window_used = max(max_window_used, s.end - shift_start)
        else:
            nondrive += dur
            if nondrive >= rules.break_length:
                since_break = 0
            if s.status == Duty.ON:
                off = 0
                if shift_start is None:
                    shift_start = s.start
                    shifts += 1
            else:
                off += dur
                if off >= rules.daily_rest:
                    shift_start = None
                    shift_drive = 0
                if off >= rules.restart:
                    if restart_points and restart_points[-1] == s.start:
                        restart_points[-1] = s.end
                    else:
                        restart_points.append(s.end)

    checks.append({
        "id": "driving_11",
        "rule": "11-hour driving limit",
        "citation": "49 CFR 395.3(a)(3)(i)",
        "passed": max_shift_drive <= rules.max_driving,
        "value": _fmt(max_shift_drive),
        "limit": _fmt(rules.max_driving),
        "detail": f"Most driving in any shift: {_fmt(max_shift_drive)} across {shifts} shift(s).",
    })
    checks.append({
        "id": "window_14",
        "rule": "14-hour driving window",
        "citation": "49 CFR 395.3(a)(2)",
        "passed": max_window_used <= rules.max_window,
        "value": _fmt(max_window_used),
        "limit": _fmt(rules.max_window),
        "detail": f"Latest driving ended {_fmt(max_window_used)} after coming on duty.",
    })
    checks.append({
        "id": "break_30",
        "rule": "30-minute break after 8 hours driving",
        "citation": "49 CFR 395.3(a)(3)(ii)",
        "passed": max_since_break <= rules.break_after_driving,
        "value": _fmt(max_since_break),
        "limit": _fmt(rules.break_after_driving),
        "detail": f"Longest driving without a 30-min interruption: {_fmt(max_since_break)}.",
    })

    # Rolling 70-hour / 8-day cycle, evaluated at the end of every driving minute block
    # (and just before each midnight, when the window slides).
    on_duty = [(s.start, s.end) for s in spans if s.status.is_on_duty]

    def day_of(m: int) -> int:
        return (start_offset + m) // MINUTES_PER_DAY

    def day_start(d: int) -> int:
        return d * MINUTES_PER_DAY - start_offset

    def used_through(m: int) -> int:
        d = day_of(m - 1)
        lower = day_start(d - rules.cycle_days + 1)
        restarts = [r for r in restart_points if r < m]
        total = 0
        if restarts:
            lower = max(lower, restarts[-1])
        else:
            for i, mins in enumerate(history):
                if -(i + 1) >= d - rules.cycle_days + 1:
                    total += mins
        for a, b in on_duty:
            lo, hi = max(a, lower), min(b, m)
            if hi > lo:
                total += hi - lo
        return total

    peak = 0
    for s in spans:
        if s.status != Duty.D:
            continue
        cursor = s.start
        while cursor < s.end:
            boundary = min(s.end, day_start(day_of(cursor) + 1))
            peak = max(peak, used_through(boundary))
            cursor = boundary
    checks.append({
        "id": "cycle_70",
        "rule": "70-hour / 8-day limit",
        "citation": "49 CFR 395.3(b)(2)",
        "passed": peak <= rules.cycle_limit,
        "value": _fmt(peak),
        "limit": _fmt(rules.cycle_limit),
        "detail": (
            f"Peak on-duty hours in the rolling 8-day window while driving: {_fmt(peak)}"
            + (f"; {len(restart_points)} × 34-hr restart." if restart_points else ".")
        ),
    })

    fuel_miles = [0.0] + [s.start_mile for s in spans if s.kind == "fuel"] + [total_miles]
    gaps = [b - a for a, b in zip(fuel_miles, fuel_miles[1:])]
    max_gap = max(gaps) if gaps else 0.0
    checks.append({
        "id": "fuel_1000",
        "rule": "Fuel at least every 1,000 miles",
        "citation": "Trip assumption",
        "passed": max_gap <= rules.fuel_interval_miles + 0.5,
        "value": f"{max_gap:,.0f} mi",
        "limit": f"{rules.fuel_interval_miles:,.0f} mi",
        "detail": f"{len(fuel_miles) - 2} fuel stop(s); longest stretch between fills {max_gap:,.0f} mi.",
    })

    pickups = [s for s in spans if s.kind == "pickup"]
    dropoffs = [s for s in spans if s.kind == "dropoff"]
    stop_ok = (
        len(pickups) == 1 and len(dropoffs) == 1
        and all(s.end - s.start == rules.pickup and s.status == Duty.ON for s in pickups)
        and all(s.end - s.start == rules.dropoff and s.status == Duty.ON for s in dropoffs)
    )
    checks.append({
        "id": "stops_1h",
        "rule": "1 hour on duty for pickup and drop-off",
        "citation": "Trip assumption",
        "passed": stop_ok,
        "value": "1h + 1h" if stop_ok else "mismatch",
        "limit": "1h each",
        "detail": "Loading and unloading are logged on line 4 (on duty, not driving).",
    })

    sheets_ok = all(total == MINUTES_PER_DAY for total in daily_totals)
    checks.append({
        "id": "log_24h",
        "rule": "Each daily log accounts for 24 hours",
        "citation": "49 CFR 395.8",
        "passed": sheets_ok,
        "value": f"{len(daily_totals)} sheet(s)",
        "limit": "24h each",
        "detail": "Every sheet's four duty lines sum to exactly 24:00.",
    })

    contiguous = all(a.end == b.start for a, b in zip(spans, spans[1:]))
    checks.append({
        "id": "continuity",
        "rule": "Continuous duty record",
        "citation": "49 CFR 395.8(e)",
        "passed": contiguous,
        "value": "no gaps" if contiguous else "gap found",
        "limit": "no gaps",
        "detail": "The duty-status line is unbroken from departure to arrival.",
    })
    return checks
