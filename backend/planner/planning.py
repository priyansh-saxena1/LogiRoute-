"""Orchestrates a trip plan: resolve places → route → simulate HOS → logs → audit."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta

from .geo import LatLon
from .hos.audit import Span, audit_timeline
from .hos.logs import build_daily_logs, status_legend
from .hos.rules import DEFAULT_RULES, Duty, HOSRules, PlanOptions
from .hos.simulator import Event, SimulationResult, TripSimulator, history_from_cycle_used
from .places import describe
from .route import TRUCK_MAX_MPH, RouteLeg
from .services import geocoding
from .services.routing import route_trip

ROLES = ("current", "pickup", "dropoff")

STOP_PRIORITY = ("dropoff", "pickup", "restart", "cycle_wait", "rest", "fuel", "break", "post_trip", "pre_trip")


class PlanningError(Exception):
    def __init__(self, message: str, field: str | None = None):
        super().__init__(message)
        self.field = field


@dataclass
class Place:
    role: str
    label: str
    short: str
    lat: float
    lon: float

    @property
    def point(self) -> LatLon:
        return (self.lat, self.lon)

    def as_dict(self) -> dict:
        return {"role": self.role, "label": self.label, "short": self.short, "lat": self.lat, "lon": self.lon}


def _resolve(role: str, value: dict) -> Place:
    lat, lon = value.get("lat"), value.get("lon")
    label = (value.get("label") or "").strip()
    if lat is not None and lon is not None:
        short = (value.get("short") or "").strip()
        if not label:
            label = describe((lat, lon)).label
        return Place(role, label, short or label, float(lat), float(lon))
    try:
        hit = geocoding.resolve(label)
    except LookupError:
        raise PlanningError(f"Couldn't find “{label}”. Try a city and state, e.g. “Amarillo, TX”.", field=role)
    return Place(role, hit["label"], hit.get("short") or hit["label"], hit["lat"], hit["lon"])


def _fmt_time(start: datetime, minute: int) -> str:
    return (start + timedelta(minutes=minute)).strftime("%Y-%m-%dT%H:%M")


def _stop_title(kind: str, kinds: list[str], places: dict[str, Place]) -> str:
    if kind == "origin":
        return f"Depart · {places['current'].short}"
    if kind == "pickup":
        return f"Pickup · {places['pickup'].short}"
    if kind == "dropoff":
        return f"Drop-off · {places['dropoff'].short}"
    if kind == "restart":
        return "34-hr restart"
    if kind == "cycle_wait":
        return "Off duty · cycle hours roll off"
    if kind == "rest":
        return "10-hr rest + fuel" if "fuel" in kinds else "10-hr rest"
    if kind == "fuel":
        return "Fuel stop"
    if kind == "break":
        return "30-min break"
    return "Inspection"


def _group_stops(result: SimulationResult, labels: list[dict], places: dict[str, Place]) -> list[dict]:
    events = result.events
    groups: list[list[int]] = []
    current: list[int] = []
    for i, ev in enumerate(events):
        if ev.status == Duty.D:
            if current:
                groups.append(current)
                current = []
        else:
            current.append(i)
    if current:
        groups.append(current)

    stops = []
    for n, ids in enumerate(groups):
        kinds = [events[i].kind for i in ids]
        primary = next((k for k in STOP_PRIORITY if k in kinds), kinds[0])
        first, last = events[ids[0]], events[ids[-1]]
        if first.start == 0 and primary in ("pre_trip", "restart", "cycle_wait", "rest") and first.start_mile == 0:
            primary = "origin" if primary == "pre_trip" else primary
        if primary == "fuel" and any("30-min break" in events[i].note for i in ids):
            title = "Fuel + 30-min break"
        else:
            title = _stop_title(primary, kinds, places)
        name = {
            "origin": places["current"].short,
            "pickup": places["pickup"].short,
            "dropoff": places["dropoff"].short,
        }.get(primary)
        loc = labels[ids[0]]
        stops.append({
            "id": n,
            "type": primary,
            "title": title,
            "kinds": kinds,
            "events": ids,
            "arrive_min": first.start,
            "depart_min": last.end,
            "arrive": _fmt_time(result.start, first.start),
            "depart": _fmt_time(result.start, last.end),
            "duration_min": last.end - first.start,
            "mile": round(first.start_mile, 1),
            "day": result.day_of(first.start) + 1,
            "location": {**loc, "name": name or loc["label"]},
            "notes": [events[i].note for i in ids],
        })
    return stops


def _event_json(i: int, ev: Event, start: datetime, day_of, loc: dict, end_loc: dict) -> dict:
    return {
        "id": i,
        "status": ev.status.value,
        "kind": ev.kind,
        "note": ev.note,
        "start_min": ev.start,
        "end_min": ev.end,
        "duration_min": ev.minutes,
        "start": _fmt_time(start, ev.start),
        "end": _fmt_time(start, ev.end),
        "day": day_of(ev.start) + 1,
        "leg": ev.leg,
        "start_mile": round(ev.start_mile, 2),
        "end_mile": round(ev.end_mile, 2),
        "location": loc,
        "end_location": end_loc,
        "clocks_start": ev.clocks_start.as_dict(),
        "clocks_end": ev.clocks_end.as_dict(),
        "continuation": ev.continuation,
    }


def build_plan(data: dict, rules: HOSRules = DEFAULT_RULES) -> dict:
    t0 = time.perf_counter()
    inputs = {
        "current": data["current_location"],
        "pickup": data["pickup_location"],
        "dropoff": data["dropoff_location"],
    }
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {role: pool.submit(_resolve, role, value) for role, value in inputs.items()}
        places = {role: f.result() for role, f in futures.items()}

    t_geo = time.perf_counter()
    legs, warnings = route_trip([places[r].point for r in ROLES])
    t_route = time.perf_counter()
    if legs[1].length_m < 200:
        raise PlanningError("Pickup and drop-off are the same place — nothing to haul.", field="dropoff")

    history_hours = data.get("cycle_history")
    if history_hours:
        history = [int(round(h * 60)) for h in history_hours]
        cycle_used_min = sum(history)
    else:
        cycle_used_min = int(round(data["current_cycle_used"] * 60))
        history = history_from_cycle_used(data["current_cycle_used"])

    start: datetime = data.get("start_time") or datetime.now().replace(second=0, microsecond=0)
    options = PlanOptions(
        pre_trip_inspection=data.get("pre_trip_inspection", True),
        post_trip_inspection=data.get("post_trip_inspection", True),
        sleeper_berth=data.get("sleeper_berth", True),
    )
    sim = TripSimulator(legs, start, history=history, rules=rules, options=options)
    result = sim.run()
    events = result.events
    t_sim = time.perf_counter()

    cache: dict[tuple[float, float], dict] = {}

    def locate(point: LatLon) -> dict:
        key = (round(point[0], 4), round(point[1], 4))
        if key not in cache:
            d = describe(point)
            cache[key] = {"lat": round(point[0], 5), "lon": round(point[1], 5), **d.as_dict()}
        return cache[key]

    start_locs = [locate(ev.start_point) for ev in events]
    end_locs = [locate(ev.end_point) for ev in events]
    origin_label = start_locs[0]["label"] if start_locs else places["current"].short

    days = build_daily_logs(
        result,
        [l["label"] for l in start_locs],
        [l["label"] for l in end_locs],
        origin_label=origin_label,
        rules=rules,
    )
    audit = audit_timeline(
        [Span(e.status, e.kind, e.start, e.end, e.start_mile, e.end_mile) for e in events],
        history=result.history,
        start_offset=result.start_offset,
        total_miles=sim.total_miles,
        daily_totals=[sum(d["totals"].values()) for d in days],
        rules=rules,
    )

    # Route geometry with trip-cumulative mileage per vertex, for map slicing/animation.
    route_legs = []
    mile_offset = 0.0
    lat_min = lon_min = 90.0 * 4
    lat_max = lon_max = -90.0 * 4
    leg_names = ("To pickup", "To drop-off")
    for i, leg in enumerate(legs):
        geometry = [[lat, lon, round(mile_offset + m, 3)] for lat, lon, m in leg.simplified()]
        for lat, lon, _ in geometry:
            lat_min, lat_max = min(lat_min, lat), max(lat_max, lat)
            lon_min, lon_max = min(lon_min, lon), max(lon_max, lon)
        route_legs.append({
            "index": i,
            "name": leg_names[i],
            "from": places[ROLES[i]].as_dict(),
            "to": places[ROLES[i + 1]].as_dict(),
            "miles": round(leg.miles, 1),
            "drive_minutes": round(leg.minutes),
            "car_minutes": round(leg.car_minutes or 0),
            "start_mile": round(mile_offset, 2),
            "source": leg.source,
            "geometry": geometry,
        })
        mile_offset += leg.miles

    drive_min = sum(e.minutes for e in events if e.status == Duty.D)
    on_duty_min = sum(e.minutes for e in events if e.status.is_on_duty)
    kinds = [e.kind for e in events]
    pickup_ev = next(e for e in events if e.kind == "pickup")
    dropoff_ev = next(e for e in events if e.kind == "dropoff")

    if legs[0].source == "same":
        warnings.append("You're already at the pickup, so the trip starts with loading.")
    if cycle_used_min >= rules.cycle_limit:
        warnings.append("No hours left in the 70-hr cycle — the trip starts with a 34-hr restart.")

    summary = {
        "total_miles": round(sim.total_miles, 1),
        "drive_minutes": drive_min,
        "on_duty_minutes": on_duty_min,
        "trip_minutes": result.end_minute,
        "start": _fmt_time(start, 0),
        "end": _fmt_time(start, result.end_minute),
        "pickup_arrival": _fmt_time(start, pickup_ev.start),
        "dropoff_arrival": _fmt_time(start, dropoff_ev.start),
        "dropoff_complete": _fmt_time(start, dropoff_ev.end),
        "log_days": len(days),
        "fuel_stops": kinds.count("fuel"),
        "breaks": kinds.count("break"),
        "rests": kinds.count("rest"),
        "restarts": kinds.count("restart"),
        "cycle_waits": kinds.count("cycle_wait"),
        "cycle_used_start": cycle_used_min,
        "cycle_left_end": events[-1].clocks_end.cycle_left if events else rules.cycle_limit,
        "avg_mph": round(sim.total_miles / (drive_min / 60), 1) if drive_min else 0,
        "compliant": all(c["passed"] for c in audit),
    }

    return {
        "inputs": {
            "places": {r: places[r].as_dict() for r in ROLES},
            "current_cycle_used": round(cycle_used_min / 60, 2),
            "cycle_history": [round(m / 60, 2) for m in history],
            "start_time": _fmt_time(start, 0),
            "options": {
                "pre_trip_inspection": options.pre_trip_inspection,
                "post_trip_inspection": options.post_trip_inspection,
                "sleeper_berth": options.sleeper_berth,
            },
        },
        "summary": summary,
        "route": {
            "legs": route_legs,
            "total_miles": round(sim.total_miles, 1),
            "bounds": [[lat_min, lon_min], [lat_max, lon_max]],
        },
        "events": [
            _event_json(i, ev, start, result.day_of, start_locs[i], end_locs[i]) for i, ev in enumerate(events)
        ],
        "stops": _group_stops(result, start_locs, places),
        "days": days,
        "audit": audit,
        "legend": status_legend(),
        "warnings": warnings,
        "assumptions": [
            "Property-carrying driver on the 70-hour / 8-day cycle; no adverse driving conditions.",
            "The driver starts the trip rested (at least 10 consecutive hours off duty).",
            "Prior cycle hours are treated as worked yesterday unless a day-by-day history is given, "
            "so they stay in the 8-day window as long as possible.",
            f"Drive times come from OSRM road routing, capped at a {TRUCK_MAX_MPH:.0f} mph governed truck speed.",
            "1 hour on duty for pickup and for drop-off; fueling (30 min, on duty) at least every 1,000 miles.",
            "Any 30 consecutive minutes off the wheel satisfy the 8-hour break rule, including fueling.",
            "Times are home-terminal time; logs run midnight to midnight.",
        ],
        "meta": {
            "computed_ms": round((time.perf_counter() - t0) * 1000),
            "geocode_ms": round((t_geo - t0) * 1000),
            "routing_ms": round((t_route - t_geo) * 1000),
            "simulation_ms": round((t_sim - t_route) * 1000),
            "events": len(events),
        },
    }
