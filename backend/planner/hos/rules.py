"""FMCSA hours-of-service parameters for a property-carrying driver (49 CFR 395.3).

All durations are integer minutes so every limit comparison is exact and the
daily log grid never suffers from floating-point drift.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class Duty(str, Enum):
    OFF = "OFF"  # Line 1 — Off duty
    SB = "SB"    # Line 2 — Sleeper berth
    D = "D"      # Line 3 — Driving
    ON = "ON"    # Line 4 — On duty (not driving)

    @property
    def is_on_duty(self) -> bool:
        return self in (Duty.D, Duty.ON)

    @property
    def is_rest(self) -> bool:
        return self in (Duty.OFF, Duty.SB)


DUTY_LABELS = {
    Duty.OFF: "Off Duty",
    Duty.SB: "Sleeper Berth",
    Duty.D: "Driving",
    Duty.ON: "On Duty (Not Driving)",
}


@dataclass(frozen=True)
class HOSRules:
    # 395.3(a)(3): 11 hours driving after 10 consecutive hours off duty.
    max_driving: int = 11 * 60
    # 395.3(a)(2): no driving beyond the 14th hour after coming on duty.
    max_window: int = 14 * 60
    # 395.3(a)(3)(ii): 30-minute interruption after 8 cumulative hours of driving.
    # Any non-driving status (off duty, sleeper, on duty) satisfies it.
    break_after_driving: int = 8 * 60
    break_length: int = 30
    # 395.3(a)(1): 10 consecutive hours off duty resets the 11/14-hour clocks.
    daily_rest: int = 10 * 60
    # 395.3(c): 34 consecutive hours off duty restarts the 70-hour/8-day period.
    restart: int = 34 * 60
    # 395.3(b)(2): 70 hours on duty in any 8 consecutive days.
    cycle_limit: int = 70 * 60
    cycle_days: int = 8

    # Trip assumptions from the brief.
    pickup: int = 60
    dropoff: int = 60
    fuel_stop: int = 30
    fuel_interval_miles: float = 1000.0

    # Daily vehicle inspections (395.3 counts them as on-duty time).
    pre_trip: int = 15
    post_trip: int = 15


@dataclass(frozen=True)
class PlanOptions:
    pre_trip_inspection: bool = True
    post_trip_inspection: bool = True
    # Log 10-hour rests in the sleeper berth (line 2) instead of off duty (line 1).
    sleeper_berth: bool = True


DEFAULT_RULES = HOSRules()
