from __future__ import annotations

from datetime import datetime

from planner.hos.audit import Span, audit_timeline
from planner.hos.logs import build_daily_logs
from planner.hos.rules import PlanOptions
from planner.hos.simulator import TripSimulator, history_from_cycle_used
from planner.route import RouteLeg

CHICAGO = (41.8781, -87.6298)
DALLAS = (32.7767, -96.797)
LOS_ANGELES = (34.0522, -118.2437)
ST_LOUIS = (38.627, -90.1994)
INDIANAPOLIS = (39.7684, -86.1581)


def leg_of_miles(miles: float, mph: float = 55.0, origin=(35.0, -100.0)) -> RouteLeg:
    """A due-east straight leg of exactly `miles` at a constant speed."""
    if miles <= 0:
        return RouteLeg.from_segments([origin, origin], [0.0], [0.0], source="same")
    leg = RouteLeg.straight(origin, (origin[0], origin[1] + 1), mph=mph)
    scale = miles / leg.miles
    leg.cum_m = [m * scale for m in leg.cum_m]
    leg.cum_min = [t * scale for t in leg.cum_min]
    return leg


def simulate(miles_to_pickup: float, miles_to_dropoff: float, cycle_hours: float = 0.0,
             start: datetime = datetime(2026, 10, 1, 6, 0), history: list[int] | None = None,
             mph: float = 55.0, options: PlanOptions = PlanOptions()):
    legs = [leg_of_miles(miles_to_pickup, mph), leg_of_miles(miles_to_dropoff, mph, origin=(36.0, -99.0))]
    sim = TripSimulator(legs, start, history=history or history_from_cycle_used(cycle_hours), options=options)
    result = sim.run()
    labels = [f"stop-{i}" for i in range(len(result.events))]
    days = build_daily_logs(result, labels, labels, "origin")
    audit = audit_timeline(
        [Span(e.status, e.kind, e.start, e.end, e.start_mile, e.end_mile) for e in result.events],
        history=result.history,
        start_offset=result.start_offset,
        total_miles=sim.total_miles,
        daily_totals=[sum(d["totals"].values()) for d in days],
    )
    return sim, result, days, audit
