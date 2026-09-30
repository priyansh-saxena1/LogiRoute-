"""Offline "nearest town" lookup used to describe positions along a route.

FMCSA's ELD rule (49 CFR 395.26 / appendix to subpart B, 4.3.2.2) describes a
driver's location as a distance and direction from the nearest city, town or
village plus the state abbreviation — e.g. "12 mi NE Amarillo, TX". Doing this
offline (GeoNames extract bundled with the app) means one route can label dozens
of stops in microseconds without hammering a public reverse-geocoder.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .geo import LatLon, METERS_PER_MILE, bearing_deg, compass, haversine_m

DATA_FILE = Path(__file__).resolve().parent / "data" / "us_places.json"
CELL_DEG = 1.0
# Beyond this the nearest bundled town is not a meaningful reference
# (outside the continental US, offshore, ...).
MAX_REFERENCE_MILES = 150


@dataclass(frozen=True)
class Place:
    name: str
    state: str
    lat: float
    lon: float
    population: int


@dataclass(frozen=True)
class LocationDescription:
    label: str
    city: str | None
    state: str | None
    miles: float | None
    direction: str | None

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "city": self.city,
            "state": self.state,
            "miles_from_city": None if self.miles is None else round(self.miles, 1),
            "direction": self.direction,
        }


class PlaceIndex:
    def __init__(self, places: list[Place]):
        self.places = places
        self._grid: dict[tuple[int, int], list[Place]] = {}
        for place in places:
            self._grid.setdefault(self._cell(place.lat, place.lon), []).append(place)

    @staticmethod
    def _cell(lat: float, lon: float) -> tuple[int, int]:
        return (math.floor(lat / CELL_DEG), math.floor(lon / CELL_DEG))

    def nearest(self, point: LatLon) -> tuple[Place, float] | None:
        lat, lon = point
        cy, cx = self._cell(lat, lon)
        best: tuple[Place, float] | None = None
        # Expand square rings of cells until the ring is provably farther than the best hit.
        for ring in range(0, 8):
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if max(abs(dy), abs(dx)) != ring:
                        continue
                    for place in self._grid.get((cy + dy, cx + dx), ()):
                        d = haversine_m(point, (place.lat, place.lon))
                        if best is None or d < best[1]:
                            best = (place, d)
            # A ring of cells spans at least ~ring * 111 km * cos(lat) in the worst direction.
            ring_reach_m = ring * CELL_DEG * 111_000 * max(0.3, math.cos(math.radians(lat)))
            if best is not None and best[1] <= ring_reach_m:
                break
        return best

    def describe(self, point: LatLon) -> LocationDescription:
        hit = self.nearest(point)
        if hit is None or hit[1] / METERS_PER_MILE > MAX_REFERENCE_MILES:
            return LocationDescription(
                label=f"{point[0]:.3f}, {point[1]:.3f}", city=None, state=None, miles=None, direction=None
            )
        place, meters = hit
        miles = meters / METERS_PER_MILE
        town = f"{place.name}, {place.state}"
        if miles < 1.0:
            return LocationDescription(label=town, city=place.name, state=place.state, miles=miles, direction=None)
        direction = compass(bearing_deg((place.lat, place.lon), point), points=8)
        return LocationDescription(
            label=f"{miles:.0f} mi {direction} {town}",
            city=place.name,
            state=place.state,
            miles=miles,
            direction=direction,
        )


def _norm(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum() or ch == " ").strip()


def search_local(query: str, limit: int = 6) -> list[Place]:
    """Instant city search: "dal" → Dallas, TX; "springfield, mo" → Springfield, MO.

    Ranks prefix matches by population so the obvious city wins.
    """
    raw = query.strip()
    state = None
    if "," in raw:
        raw, tail = raw.split(",", 1)
        tail = tail.strip().upper()
        if tail:
            state = US_STATE_ABBR.get(tail.title(), tail)
    q = _norm(raw)
    if not q:
        return []
    hits: list[tuple[int, int, Place]] = []
    for place in get_index().places:
        if state and not place.state.startswith(state[:2]):
            continue
        name = _norm(place.name)
        if name == q:
            rank = 0
        elif name.startswith(q):
            rank = 1
        elif f" {q}" in f" {name}":
            rank = 2
        else:
            continue
        hits.append((rank, -place.population, place))
    hits.sort(key=lambda h: (h[0], h[1]))
    return [h[2] for h in hits[:limit]]


@lru_cache(maxsize=1)
def get_index() -> PlaceIndex:
    raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    places = [Place(name, state, lat, lon, pop) for name, state, lat, lon, pop in raw["places"]]
    return PlaceIndex(places)


def describe(point: LatLon) -> LocationDescription:
    return get_index().describe(point)


US_STATE_ABBR = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA",
    "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "District of Columbia": "DC",
    "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL",
    "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY",
    "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
    "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY",
    "Puerto Rico": "PR",
}
