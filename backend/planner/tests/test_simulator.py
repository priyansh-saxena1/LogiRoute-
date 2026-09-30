import random
from datetime import datetime

import pytest

from planner.hos.rules import Duty, PlanOptions
from planner.tests.helpers import simulate


def kinds(result):
    return [e.kind for e in result.events]


def assert_valid(result, days, audit):
    failed = [c for c in audit if not c["passed"]]
    assert not failed, failed
    events = result.events
    assert events[0].start == 0
    assert all(a.end == b.start for a, b in zip(events, events[1:]))
    assert all(sum(d["totals"].values()) == 1440 for d in days)
    assert kinds(result).count("pickup") == 1
    assert kinds(result).count("dropoff") == 1


def test_short_local_trip_fits_in_one_day():
    sim, result, days, audit = simulate(20, 150, cycle_hours=10)
    assert_valid(result, days, audit)
    assert len(days) == 1
    assert kinds(result) == ["pre_trip", "drive", "pickup", "drive", "dropoff", "post_trip"]
    assert "rest" not in kinds(result)


def test_thirty_minute_break_after_eight_hours_driving():
    # 480 min at 55 mph = 440 mi; 520 mi of driving forces one break.
    sim, result, days, audit = simulate(0, 520, options=PlanOptions(pre_trip_inspection=False))
    assert_valid(result, days, audit)
    drives = [e for e in result.events if e.status == Duty.D]
    assert drives[0].minutes == 480
    assert result.events[result.events.index(drives[0]) + 1].kind == "break"


def test_eleven_hour_limit_triggers_ten_hour_rest():
    sim, result, days, audit = simulate(0, 900)
    assert_valid(result, days, audit)
    rest = next(e for e in result.events if e.kind == "rest")
    assert rest.minutes == 600
    assert rest.status == Duty.SB
    driven_before = sum(e.minutes for e in result.events if e.status == Duty.D and e.end <= rest.start)
    assert driven_before == 660


def test_rest_logged_off_duty_without_sleeper_berth():
    sim, result, days, audit = simulate(0, 900, options=PlanOptions(sleeper_berth=False))
    assert_valid(result, days, audit)
    assert next(e for e in result.events if e.kind == "rest").status == Duty.OFF


def test_fourteen_hour_window_limits_driving_after_long_pickup_day():
    # Long deadhead + 1 h loading: the window, not the 11 h clock, can bind.
    sim, result, days, audit = simulate(560, 400)
    assert_valid(result, days, audit)


def test_fuel_at_least_every_thousand_miles():
    sim, result, days, audit = simulate(300, 2600)
    assert_valid(result, days, audit)
    fuel_miles = [0.0] + [e.start_mile for e in result.events if e.kind == "fuel"] + [sim.total_miles]
    assert len(fuel_miles) >= 4
    assert max(b - a for a, b in zip(fuel_miles, fuel_miles[1:])) <= 1000


def test_exhausted_cycle_starts_with_restart():
    sim, result, days, audit = simulate(100, 400, cycle_hours=70)
    assert_valid(result, days, audit)
    assert result.events[0].kind == "restart"
    assert result.events[0].minutes == 34 * 60


def test_low_cycle_extends_rest_into_restart():
    # 60 h used: ~10 h available, far short of a ~40 h trip → the 34 h restart
    # replaces the first 10 h rest rather than stacking on top of it.
    sim, result, days, audit = simulate(100, 2000, cycle_hours=60)
    assert_valid(result, days, audit)
    assert kinds(result).count("restart") == 1
    first_stop = next(e for e in result.events if e.kind in ("rest", "restart"))
    assert first_stop.kind == "restart"


def test_dropoff_allowed_after_cycle_is_used_up():
    # Only driving is barred at 70 h; on-duty work (unloading) may continue.
    sim, result, days, audit = simulate(0, 440, cycle_hours=60, options=PlanOptions(pre_trip_inspection=False))
    assert_valid(result, days, audit)
    assert "restart" not in kinds(result)


def test_hours_rolling_off_beat_a_restart():
    # 10 h on each of the last 7 days = 70 h. At midnight the oldest day drops out
    # of the 8-day window, which is sooner than a 34 h restart.
    history = [600] * 7
    sim, result, days, audit = simulate(100, 500, history=history, start=datetime(2026, 10, 1, 8, 0))
    assert_valid(result, days, audit)
    assert result.events[0].kind == "cycle_wait"
    assert result.events[0].end == 16 * 60  # waits until midnight
    assert "restart" not in kinds(result)


def test_driver_already_at_pickup():
    sim, result, days, audit = simulate(0, 300)
    assert_valid(result, days, audit)
    assert kinds(result)[:2] == ["pre_trip", "pickup"]


def test_driving_never_spans_midnight_and_continuations_are_flagged():
    sim, result, days, audit = simulate(0, 700, start=datetime(2026, 10, 1, 18, 0))
    assert_valid(result, days, audit)
    for e in result.events:
        if e.status == Duty.D:
            assert result.day_of(e.start) == result.day_of(e.end - 1)
    assert any(e.continuation for e in result.events)


def test_daily_log_recap_counts_prior_hours():
    sim, result, days, audit = simulate(0, 100, cycle_hours=30)
    recap = days[0]["recap"]
    assert recap["last_8_days"] == 30 * 60 + recap["on_duty_today"]
    assert recap["available_tomorrow"] == 70 * 60 - recap["last_7_days"]


@pytest.mark.parametrize("seed", range(300))
def test_random_trips_are_always_compliant(seed):
    rng = random.Random(seed)
    options = PlanOptions(
        pre_trip_inspection=rng.random() < 0.7,
        post_trip_inspection=rng.random() < 0.7,
        sleeper_berth=rng.random() < 0.5,
    )
    if rng.random() < 0.3:
        daily = [rng.randint(0, 14 * 60) for _ in range(7)]
        while sum(daily) > 70 * 60:
            daily[rng.randrange(7)] //= 2
        kwargs = {"history": daily}
    else:
        kwargs = {"cycle_hours": rng.choice([0, 12.5, 35, 55, 64, 69.5, rng.uniform(0, 70)])}
    start = datetime(2026, 10, 1, rng.randrange(24), rng.randrange(60))
    sim, result, days, audit = simulate(
        rng.choice([0, rng.uniform(1, 400), rng.uniform(400, 1500)]),
        rng.uniform(5, 3200),
        start=start,
        mph=rng.uniform(40, 65),
        options=options,
        **kwargs,
    )
    assert_valid(result, days, audit)
