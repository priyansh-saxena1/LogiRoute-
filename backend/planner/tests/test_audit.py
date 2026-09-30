"""The auditor must catch violations, not just bless the simulator's output."""

from planner.hos.audit import Span, audit_timeline
from planner.hos.rules import Duty

H = 60


def run(spans, history=None, total_miles=None, start_offset=6 * H):
    total = total_miles if total_miles is not None else max((s.end_mile for s in spans), default=0)
    checks = audit_timeline(spans, history or [], start_offset, total, [1440])
    return {c["id"]: c["passed"] for c in checks}


def span(status, kind, start_h, end_h, m0=0.0, m1=0.0):
    return Span(status, kind, int(start_h * H), int(end_h * H), m0, m1)


def legal_day():
    return [
        span(Duty.ON, "pickup", 0, 1),
        span(Duty.D, "drive", 1, 9, 0, 440),
        span(Duty.OFF, "break", 9, 9.5, 440, 440),
        span(Duty.D, "drive", 9.5, 12.5, 440, 605),
        span(Duty.ON, "dropoff", 12.5, 13.5, 605, 605),
    ]


def test_legal_day_passes():
    assert all(run(legal_day()).values())


def test_detects_more_than_eleven_hours_driving():
    spans = [
        span(Duty.ON, "pickup", 0, 1),
        span(Duty.D, "drive", 1, 8, 0, 385),
        span(Duty.OFF, "break", 8, 8.5, 385, 385),
        span(Duty.D, "drive", 8.5, 13.5, 385, 660),
        span(Duty.ON, "dropoff", 13.5, 14.5, 660, 660),
    ]
    assert run(spans)["driving_11"] is False


def test_detects_driving_after_fourteenth_hour():
    spans = [
        span(Duty.ON, "pickup", 0, 1),
        span(Duty.OFF, "break", 1, 5),
        span(Duty.D, "drive", 5, 12, 0, 385),
        span(Duty.OFF, "break", 12, 12.5, 385, 385),
        span(Duty.D, "drive", 12.5, 15, 385, 520),
        span(Duty.ON, "dropoff", 15, 16, 520, 520),
    ]
    result = run(spans)
    assert result["window_14"] is False
    assert result["driving_11"] is True


def test_detects_missing_thirty_minute_break():
    spans = [
        span(Duty.ON, "pickup", 0, 1),
        span(Duty.D, "drive", 1, 10, 0, 495),
        span(Duty.ON, "dropoff", 10, 11, 495, 495),
    ]
    assert run(spans)["break_30"] is False


def test_short_stop_does_not_count_as_break():
    spans = [
        span(Duty.ON, "pickup", 0, 1),
        span(Duty.D, "drive", 1, 6, 0, 275),
        span(Duty.OFF, "break", 6, 6.25, 275, 275),
        span(Duty.D, "drive", 6.25, 10, 275, 480),
        span(Duty.ON, "dropoff", 10, 11, 480, 480),
    ]
    assert run(spans)["break_30"] is False


def test_detects_cycle_overrun_from_prior_hours():
    assert run(legal_day(), history=[65 * H] + [0] * 6)["cycle_70"] is False
    assert run(legal_day(), history=[50 * H] + [0] * 6)["cycle_70"] is True


def test_detects_fuel_gap():
    spans = legal_day()
    assert run(spans, total_miles=1200)["fuel_1000"] is False


def test_detects_gap_in_record():
    spans = legal_day()
    spans[2] = span(Duty.OFF, "break", 9.1, 9.5, 440, 440)
    assert run(spans)["continuity"] is False
