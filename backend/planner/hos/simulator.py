"""Trip simulator: drives a truck along route legs while obeying the HOS rules.

The simulation is a minute-resolution state machine. Before each stretch of
driving it settles every obligation that blocks the wheel (cycle exhausted,
11/14-hour limits, 30-minute break, fuel), then drives the longest stretch that
no limit, fuel threshold, midnight or destination interrupts.

Scheduling heuristics worth calling out:

* A fuel stop is 30 min on duty, and any 30 consecutive non-driving minutes
  satisfy the break rule, so when a break is due and the tank will not last until
  the next break opportunity, the break *is* the fuel stop (saves 30 min).
* If a required 10-hour rest is followed by too few cycle hours to finish the
  trip, the rest is extended into the 34-hour restart that is needed anyway — the
  restart subsumes the 10-hour rest instead of stacking after it.
* When the 70-hour cycle runs out, the simulator compares waiting for old hours
  to roll off the 8-day window (at midnight) against a 34-hour restart and takes
  whichever lets the driver roll first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import datetime
from typing import Callable

from ..geo import METERS_PER_MILE, LatLon
from ..route import RouteLeg
from .rules import DEFAULT_RULES, Duty, HOSRules, PlanOptions

MINUTES_PER_DAY = 1440


class SimulationError(RuntimeError):
    pass


@dataclass
class Clocks:
    drive_left: int
    window_left: int
    break_left: int
    cycle_left: int
    shift_active: bool

    def as_dict(self) -> dict:
        return {
            "drive_left": self.drive_left,
            "window_left": self.window_left,
            "break_left": self.break_left,
            "cycle_left": self.cycle_left,
            "shift_active": self.shift_active,
        }


@dataclass
class Event:
    status: Duty
    kind: str
    start: int  # minutes since trip start
    end: int
    start_point: LatLon
    end_point: LatLon
    start_mile: float
    end_mile: float
    leg: int
    clocks_start: Clocks
    clocks_end: Clocks
    note: str = ""
    continuation: bool = False  # a driving stretch split only by midnight

    @property
    def minutes(self) -> int:
        return self.end - self.start

    @property
    def miles(self) -> float:
        return self.end_mile - self.start_mile


@dataclass
class SimulationResult:
    events: list[Event]
    start: datetime
    start_offset: int  # minutes after midnight on day 0
    history: list[int]  # prior on-duty minutes, index 0 = yesterday
    restart_ends: list[int] = field(default_factory=list)

    @property
    def end_minute(self) -> int:
        return self.events[-1].end if self.events else 0

    def day_of(self, minute: int) -> int:
        return (self.start_offset + minute) // MINUTES_PER_DAY

    def day_start(self, day: int) -> int:
        return day * MINUTES_PER_DAY - self.start_offset


class TripSimulator:
    def __init__(
        self,
        legs: list[RouteLeg],
        start: datetime,
        history: list[int] | None = None,
        rules: HOSRules = DEFAULT_RULES,
        options: PlanOptions = PlanOptions(),
    ):
        if len(legs) != 2:
            raise ValueError("Expected two legs: current → pickup and pickup → drop-off")
        self.legs = legs
        self.start = start.replace(second=0, microsecond=0)
        self.rules = rules
        self.opts = options
        self.history = [int(round(m)) for m in (history or [])][:7]
        self.start_offset = self.start.hour * 60 + self.start.minute

        self.total_miles = sum(leg.miles for leg in legs)
        total_min = sum(leg.minutes for leg in legs)
        self.avg_mph = (self.total_miles / (total_min / 60)) if total_min > 0 else 50.0

        # --- mutable state ---
        self.t = 0
        self.leg_idx = 0
        self.pos_m = 0.0
        self.leg_start_mile = 0.0
        # The driver starts fresh: coming off at least 10 hours off duty.
        self.shift_start: int | None = None
        self.drive_in_shift = 0
        self.drive_since_break = 0
        self.nondrive_streak = 0
        self.off_streak = rules.daily_rest
        self.last_fuel_mile = 0.0
        self.restart_end: int | None = None
        self.restart_ends: list[int] = []
        self.pickup_done = False
        self.onduty: list[tuple[int, int]] = []
        self.events: list[Event] = []

    # ------------------------------------------------------------------ time
    def day_of(self, minute: int) -> int:
        return (self.start_offset + minute) // MINUTES_PER_DAY

    def day_start(self, day: int) -> int:
        return day * MINUTES_PER_DAY - self.start_offset

    def next_midnight(self, minute: int) -> int:
        return self.day_start(self.day_of(minute) + 1)

    # ----------------------------------------------------------------- cycle
    def cycle_used(self, minute: int) -> int:
        """On-duty minutes inside the rolling 8-day window ending at `minute`."""
        day = self.day_of(minute)
        first_day = day - (self.rules.cycle_days - 1)
        lower = self.day_start(first_day)
        used = 0
        if self.restart_end is None:
            for i, mins in enumerate(self.history):
                if -(i + 1) >= first_day:
                    used += mins
        else:
            lower = max(lower, self.restart_end)
        for s, e in self.onduty:
            lo, hi = max(s, lower), min(e, minute)
            if hi > lo:
                used += hi - lo
        return used

    def cycle_available(self, minute: int) -> int:
        return self.rules.cycle_limit - self.cycle_used(minute)

    # -------------------------------------------------------------- position
    @property
    def leg(self) -> RouteLeg:
        return self.legs[self.leg_idx]

    @property
    def mile(self) -> float:
        return self.leg_start_mile + self.pos_m / METERS_PER_MILE

    @property
    def point(self) -> LatLon:
        return self.leg.point_at(self.pos_m)

    def remaining_drive_minutes(self) -> float:
        rest = self.leg.minutes - self.leg.minute_at(self.pos_m)
        return rest + sum(leg.minutes for leg in self.legs[self.leg_idx + 1:])

    def remaining_cycle_need(self) -> float:
        """On-duty minutes that must still fit in the cycle *before the last minute of driving*.

        Only driving is barred once the 70 hours are used, so drop-off and the
        final post-trip inspection never need cycle time.
        """
        r = self.rules
        drive = self.remaining_drive_minutes()
        if drive <= 0:
            return 0.0
        need = drive
        if not self.pickup_done and self.legs[1].minutes > 0:
            need += r.pickup
        shifts = max(1, math.ceil(drive / r.max_driving))
        if self.opts.pre_trip_inspection:
            need += shifts * r.pre_trip
        if self.opts.post_trip_inspection:
            need += (shifts - 1) * r.post_trip
        fuel_stops = max(0, math.ceil((self.total_miles - self.last_fuel_mile) / r.fuel_interval_miles) - 1)
        return need + fuel_stops * r.fuel_stop

    def _trip_minute(self, leg_index: int, dist_m: float) -> float:
        before = sum(leg.minutes for leg in self.legs[:leg_index])
        return before + self.legs[leg_index].minute_at(dist_m)

    def minutes_to_fuel(self) -> float:
        """Driving minutes until the 1,000-mile fuel threshold (any leg), or inf if the trip ends first."""
        fuel_mile = self.last_fuel_mile + self.rules.fuel_interval_miles
        if fuel_mile >= self.total_miles - 1e-6:
            return math.inf
        leg_start = 0.0
        for i, leg in enumerate(self.legs):
            if fuel_mile <= leg_start + leg.miles or i == len(self.legs) - 1:
                offset_m = (fuel_mile - leg_start) * METERS_PER_MILE
                return self._trip_minute(i, offset_m) - self._trip_minute(self.leg_idx, self.pos_m)
            leg_start += leg.miles
        return math.inf

    def drive_until_next_stop(self, fresh_shift: bool) -> float:
        """Driving minutes until the next planned stop, assuming a stop now.

        After a mid-shift stop the next one is the end of the shift; after a
        rest it is the 8-hour break. Arriving at the pickup is also a stop.
        """
        r = self.rules
        if fresh_shift:
            window = r.max_window - (r.pre_trip if self.opts.pre_trip_inspection else 0)
            horizon = min(r.max_driving, window, r.break_after_driving)
        else:
            window_used = self.t + r.fuel_stop - (self.shift_start if self.shift_start is not None else self.t)
            horizon = min(r.max_driving - self.drive_in_shift, r.max_window - window_used, r.break_after_driving)
        if self.leg_idx == 0 and not self.pickup_done:
            horizon = min(horizon, self.leg.minutes - self.leg.minute_at(self.pos_m))
        return max(0.0, horizon)

    def fuel_runs_out_within(self, drive_minutes: float) -> bool:
        return self.minutes_to_fuel() <= drive_minutes

    # ---------------------------------------------------------------- clocks
    def clocks(self) -> Clocks:
        r = self.rules
        if self.shift_start is None:
            drive_left, window_left = r.max_driving, r.max_window
        else:
            drive_left = max(0, r.max_driving - self.drive_in_shift)
            window_left = max(0, r.max_window - (self.t - self.shift_start))
        return Clocks(
            drive_left=drive_left,
            window_left=window_left,
            break_left=max(0, r.break_after_driving - self.drive_since_break),
            cycle_left=max(0, self.cycle_available(self.t)),
            shift_active=self.shift_start is not None,
        )

    # ---------------------------------------------------------------- events
    def _record(self, status: Duty, kind: str, minutes: int, note: str = "",
                end_pos_m: float | None = None) -> Event:
        if minutes <= 0:
            raise SimulationError(f"Non-positive duration for {kind}")
        r = self.rules
        start, end = self.t, self.t + minutes
        start_point, start_mile = self.point, self.mile
        clocks_start = self.clocks()

        continuation = bool(
            status == Duty.D
            and self.events
            and self.events[-1].status == Duty.D
            and self.events[-1].end == start
        )

        if status.is_on_duty:
            if self.shift_start is None:
                self.shift_start = start
            self.onduty.append((start, end))
            self.off_streak = 0
        if status == Duty.D:
            self.drive_in_shift += minutes
            self.drive_since_break += minutes
            self.nondrive_streak = 0
        else:
            self.nondrive_streak += minutes
            if self.nondrive_streak >= r.break_length:
                self.drive_since_break = 0
        if status.is_rest:
            self.off_streak += minutes
            if self.off_streak >= r.daily_rest:
                self.shift_start = None
                self.drive_in_shift = 0
            if self.off_streak >= r.restart:
                self.restart_end = end
                if not self.restart_ends or self.restart_ends[-1] != start:
                    self.restart_ends.append(end)
                else:
                    self.restart_ends[-1] = end

        if end_pos_m is not None:
            self.pos_m = end_pos_m
        self.t = end

        event = Event(
            status=status,
            kind=kind,
            start=start,
            end=end,
            start_point=start_point,
            end_point=self.point,
            start_mile=start_mile,
            end_mile=self.mile,
            leg=self.leg_idx,
            clocks_start=clocks_start,
            clocks_end=self.clocks(),
            note=note,
            continuation=continuation,
        )
        self.events.append(event)
        return event

    # ------------------------------------------------------------ obligations
    def _start_shift(self) -> None:
        if self.opts.pre_trip_inspection:
            self._record(Duty.ON, "pre_trip", self.rules.pre_trip, "Pre-trip inspection")
        else:
            self.shift_start = self.t

    def _post_trip_if_needed(self) -> None:
        if (
            self.opts.post_trip_inspection
            and self.shift_start is not None
            and not (self.events and self.events[-1].kind == "post_trip")
        ):
            self._record(Duty.ON, "post_trip", self.rules.post_trip, "Post-trip inspection")

    def _rest_status(self) -> Duty:
        return Duty.SB if self.opts.sleeper_berth else Duty.OFF

    def _fuel_before_parking(self) -> None:
        """Top off at an overnight stop if the tank will not reach the next day's first stop."""
        if self.fuel_runs_out_within(self.drive_until_next_stop(fresh_shift=True)):
            self._fuel(note="Fueling before the rest — tank would not reach the next stop")

    def _daily_rest(self) -> None:
        r = self.rules
        self._fuel_before_parking()
        self._post_trip_if_needed()
        available_after_rest = r.cycle_limit - self.cycle_used(self.t + r.daily_rest)
        if available_after_rest < self.remaining_cycle_need():
            self._record(
                Duty.OFF, "restart", r.restart,
                "34-hr restart — taken in place of the 10-hr rest because the remaining "
                "70-hr cycle cannot cover the rest of the trip",
            )
            return
        self._record(self._rest_status(), "rest", r.daily_rest, "10-hr rest — resets 11/14-hr limits")

    def _rolloff_resume(self) -> int | None:
        """Earliest time ≥10 h away at which hours rolling off the 8-day window free enough cycle."""
        r = self.rules
        need = min(60 + (r.pre_trip if self.opts.pre_trip_inspection else 0), self.remaining_cycle_need())
        today = self.day_of(self.t)
        for k in range(1, r.cycle_days + 1):
            candidate = max(self.day_start(today + k), self.t + r.daily_rest)
            if r.cycle_limit - self.cycle_used(candidate) >= need:
                return candidate
        return None

    def _cycle_reset(self) -> None:
        r = self.rules
        self._fuel_before_parking()
        self._post_trip_if_needed()
        resume = self._rolloff_resume()
        if resume is not None and resume - self.t < r.restart:
            self._record(
                self._rest_status(), "cycle_wait", resume - self.t,
                "Off duty until older hours roll off the 70-hr/8-day window",
            )
        else:
            self._record(Duty.OFF, "restart", r.restart, "34-hr restart — 70-hr cycle reset")

    def _fuel(self, note: str = "Fueling") -> None:
        self._record(Duty.ON, "fuel", self.rules.fuel_stop, note)
        self.last_fuel_mile = self.mile

    def _rest_break(self) -> None:
        if self.fuel_runs_out_within(self.drive_until_next_stop(fresh_shift=False)):
            self._fuel(note="Fueling — also satisfies the 30-min break (any 30 min not driving counts)")
        else:
            self._record(Duty.OFF, "break", self.rules.break_length, "30-min break after 8 hrs driving")

    def _prepare_to_drive(self) -> None:
        r = self.rules
        for _ in range(100):
            need = 1
            if self.shift_start is None and self.opts.pre_trip_inspection:
                need += r.pre_trip
            if self.cycle_available(self.t) < need:
                self._cycle_reset()
                continue
            if self.shift_start is None:
                self._start_shift()
                continue
            if self.drive_in_shift >= r.max_driving or self.t - self.shift_start >= r.max_window:
                self._daily_rest()
                continue
            if self.drive_since_break >= r.break_after_driving:
                self._rest_break()
                continue
            if self.minutes_to_fuel() < 1:
                self._fuel(note="Fueling — 1,000-mile interval reached")
                continue
            return
        raise SimulationError("Could not satisfy HOS obligations before driving")

    # ---------------------------------------------------------------- driving
    def _drive_leg(self, index: int) -> None:
        r = self.rules
        self.leg_idx = index
        self.pos_m = 0.0
        self.leg_start_mile = sum(leg.miles for leg in self.legs[:index])
        leg = self.leg
        guard = 0
        while leg.length_m - self.pos_m > 1.0:
            guard += 1
            if guard > 5000:
                raise SimulationError("Driving loop did not converge")
            self._prepare_to_drive()
            current = leg.minute_at(self.pos_m)
            to_end = leg.minutes - current
            limit = min(
                r.max_driving - self.drive_in_shift,
                r.max_window - (self.t - self.shift_start),
                r.break_after_driving - self.drive_since_break,
                self.cycle_available(self.t),
                self.next_midnight(self.t) - self.t,
            )
            to_fuel = self.minutes_to_fuel()
            if not math.isinf(to_fuel):
                limit = min(limit, math.floor(to_fuel))
            if limit <= 0:
                raise SimulationError("No drivable time after satisfying obligations")
            arrive = math.ceil(to_end - 1e-9)
            if arrive <= 0:
                self.pos_m = leg.length_m
                break
            if arrive <= limit:
                self._record(Duty.D, "drive", arrive, "Driving", end_pos_m=leg.length_m)
            else:
                self._record(Duty.D, "drive", limit, "Driving", end_pos_m=leg.dist_at(current + limit))
        self.pos_m = leg.length_m

    def _stop_work(self, kind: str, minutes: int, note: str) -> None:
        if self.shift_start is None:
            self._start_shift()
        self._record(Duty.ON, kind, minutes, note)

    # -------------------------------------------------------------------- run
    def run(self) -> SimulationResult:
        r = self.rules
        self._drive_leg(0)
        self._stop_work("pickup", r.pickup, "Pickup — loading (1 hr)")
        self.pickup_done = True
        self.leg_idx, self.pos_m, self.leg_start_mile = 1, 0.0, self.legs[0].miles
        if self.fuel_runs_out_within(self.drive_until_next_stop(fresh_shift=False)):
            self._fuel(note="Fueling at the shipper — tank would not reach the next stop")
        self._drive_leg(1)
        self._stop_work("dropoff", r.dropoff, "Drop-off — unloading (1 hr)")
        self._post_trip_if_needed()
        return SimulationResult(
            events=self.events,
            start=self.start,
            start_offset=self.start_offset,
            history=self.history,
            restart_ends=list(self.restart_ends),
        )


def history_from_cycle_used(hours: float) -> list[int]:
    """Without a day-by-day breakdown, place all prior hours on the most recent day.

    That is the conservative reading: none of those hours roll off the 8-day
    window until as late as possible, so available time is never overstated.
    """
    return [int(round(hours * 60))] + [0] * 6
