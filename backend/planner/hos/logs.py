"""Turn a simulated trip into FMCSA-style daily log sheets (one per calendar day)."""

from __future__ import annotations

from datetime import timedelta

from .rules import DEFAULT_RULES, DUTY_LABELS, Duty, HOSRules
from .simulator import MINUTES_PER_DAY, SimulationResult

STATUS_ORDER = (Duty.OFF, Duty.SB, Duty.D, Duty.ON)


def _onduty_between(result: SimulationResult, lo: int, hi: int) -> int:
    """On-duty minutes in [lo, hi), honouring any 34-hr restart completed by `hi`."""
    restarts = [r for r in result.restart_ends if r <= hi]
    lower = lo
    include_history = True
    if restarts:
        lower = max(lo, restarts[-1])
        include_history = False
    total = 0
    if include_history:
        first_day, last_day = result.day_of(lo), result.day_of(hi - 1)
        for i, mins in enumerate(result.history):
            if first_day <= -(i + 1) <= last_day:
                total += mins
    for ev in result.events:
        if not ev.status.is_on_duty:
            continue
        a, b = max(ev.start, lower), min(ev.end, hi)
        if b > a:
            total += b - a
    return total


def build_daily_logs(
    result: SimulationResult,
    start_labels: list[str],
    end_labels: list[str],
    origin_label: str,
    rules: HOSRules = DEFAULT_RULES,
) -> list[dict]:
    events = result.events
    end = result.end_minute
    last_day = result.day_of(max(end - 1, 0))
    sheets: list[dict] = []

    for day in range(0, last_day + 1):
        ds = result.day_start(day)
        de = ds + MINUTES_PER_DAY
        pieces: list[tuple[Duty, int, int, int | None]] = []
        if ds < 0:
            pieces.append((Duty.OFF, 0, -ds, None))
        event_ids: list[int] = []
        for idx, ev in enumerate(events):
            a, b = max(ev.start, ds), min(ev.end, de)
            if b > a:
                pieces.append((ev.status, a - ds, b - ds, idx))
                event_ids.append(idx)
        if end < de:
            pieces.append((Duty.OFF, max(end, ds) - ds, MINUTES_PER_DAY, None))

        # Merge contiguous pieces on the same duty line into grid segments.
        segments: list[dict] = []
        for status, a, b, _ in pieces:
            if segments and segments[-1]["status"] == status.value and segments[-1]["end"] == a:
                segments[-1]["end"] = b
            else:
                segments.append({"status": status.value, "start": a, "end": b})

        totals = {s.value: 0 for s in STATUS_ORDER}
        for seg in segments:
            totals[seg["status"]] += seg["end"] - seg["start"]

        # Remarks: every change of duty status, located ELD-style.
        remarks: list[dict] = []
        for idx in event_ids:
            ev = events[idx]
            if ev.start < ds or ev.continuation:
                continue
            remarks.append({
                "minute": ev.start - ds,
                "status": ev.status.value,
                "kind": ev.kind,
                "location": start_labels[idx],
                "note": ev.note,
                "event": idx,
            })
        if ds <= end < de:
            remarks.append({
                "minute": end - ds,
                "status": Duty.OFF.value,
                "kind": "off",
                "location": end_labels[-1] if end_labels else origin_label,
                "note": "Off duty — trip complete",
                "event": None,
            })

        miles = sum(
            events[i].miles for i in event_ids if events[i].status == Duty.D
        )

        # From / To for the sheet header. Driving is split at midnight by the
        # simulator, so an event overlapping a day boundary is always stationary
        # and its start/end labels describe the same place.
        if ds <= 0 or not event_ids:
            from_label = origin_label
        else:
            from_label = start_labels[event_ids[0]]
        to_label = end_labels[event_ids[-1]] if event_ids else from_label

        a_7 = _onduty_between(result, result.day_start(day - 6), de)
        c_8 = _onduty_between(result, result.day_start(day - 7), de)
        on_duty_today = totals[Duty.D.value] + totals[Duty.ON.value]

        date = (result.start + timedelta(days=day)).date()
        sheets.append({
            "day": day + 1,
            "date": date.isoformat(),
            "weekday": date.strftime("%A"),
            "from": from_label,
            "to": to_label,
            "miles": round(miles, 1),
            "segments": segments,
            "totals": totals,
            "remarks": remarks,
            "events": event_ids,
            "recap": {
                "on_duty_today": on_duty_today,
                "last_7_days": a_7,
                "available_tomorrow": max(0, rules.cycle_limit - a_7),
                "last_8_days": c_8,
                "restart_completed": any(ds < r <= de for r in result.restart_ends),
            },
        })
    return sheets


def status_legend() -> list[dict]:
    return [{"status": s.value, "label": DUTY_LABELS[s], "line": i + 1} for i, s in enumerate(STATUS_ORDER)]
