"""Route legs as a distance/time profile the HOS simulator can drive along."""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field

from .geo import METERS_PER_MILE, LatLon, haversine_m, interpolate, simplify_indices

# Tractor-trailers are commonly speed-governed around 65 mph; routing engines are
# tuned for cars. Every route segment is driven no faster than this.
TRUCK_MAX_MPH = 65.0
TRUCK_MAX_MPS = TRUCK_MAX_MPH * METERS_PER_MILE / 3600

# Fallback when no routing engine is reachable: great-circle distance times a
# typical road circuity factor, at a conservative truck average speed.
ROAD_CIRCUITY = 1.2
FALLBACK_MPH = 55.0


@dataclass
class RouteLeg:
    """A polyline with cumulative distance (m) and truck drive time (min) per vertex."""

    coords: list[LatLon]
    cum_m: list[float]
    cum_min: list[float]
    source: str = "osrm"
    car_minutes: float | None = None
    meta: dict = field(default_factory=dict)

    @property
    def length_m(self) -> float:
        return self.cum_m[-1]

    @property
    def miles(self) -> float:
        return self.cum_m[-1] / METERS_PER_MILE

    @property
    def minutes(self) -> float:
        return self.cum_min[-1]

    # --- profile lookups -------------------------------------------------
    def minute_at(self, dist_m: float) -> float:
        dist_m = min(max(dist_m, 0.0), self.length_m)
        i = bisect.bisect_right(self.cum_m, dist_m) - 1
        if i >= len(self.cum_m) - 1:
            return self.cum_min[-1]
        span = self.cum_m[i + 1] - self.cum_m[i]
        frac = 0.0 if span <= 0 else (dist_m - self.cum_m[i]) / span
        return self.cum_min[i] + frac * (self.cum_min[i + 1] - self.cum_min[i])

    def dist_at(self, minute: float) -> float:
        minute = min(max(minute, 0.0), self.minutes)
        i = bisect.bisect_right(self.cum_min, minute) - 1
        if i >= len(self.cum_min) - 1:
            return self.cum_m[-1]
        span = self.cum_min[i + 1] - self.cum_min[i]
        frac = 0.0 if span <= 0 else (minute - self.cum_min[i]) / span
        return self.cum_m[i] + frac * (self.cum_m[i + 1] - self.cum_m[i])

    def point_at(self, dist_m: float) -> LatLon:
        dist_m = min(max(dist_m, 0.0), self.length_m)
        i = bisect.bisect_right(self.cum_m, dist_m) - 1
        if i >= len(self.coords) - 1:
            return self.coords[-1]
        span = self.cum_m[i + 1] - self.cum_m[i]
        frac = 0.0 if span <= 0 else (dist_m - self.cum_m[i]) / span
        return interpolate(self.coords[i], self.coords[i + 1], frac)

    def simplified(self, tolerance_deg: float = 0.0015, max_points: int = 1500) -> list[tuple[float, float, float]]:
        """Display geometry: [(lat, lon, miles_from_leg_start), ...]."""
        tol = tolerance_deg
        idx = simplify_indices(self.coords, tol)
        while len(idx) > max_points:
            tol *= 1.6
            idx = simplify_indices(self.coords, tol)
        return [
            (round(self.coords[i][0], 5), round(self.coords[i][1], 5), round(self.cum_m[i] / METERS_PER_MILE, 3))
            for i in idx
        ]

    # --- constructors -----------------------------------------------------
    @classmethod
    def from_segments(
        cls,
        coords: list[LatLon],
        seg_m: list[float],
        seg_s: list[float],
        source: str = "osrm",
        max_mps: float = TRUCK_MAX_MPS,
    ) -> "RouteLeg":
        if len(coords) < 2:
            coords = [coords[0], coords[0]] if coords else [(0.0, 0.0), (0.0, 0.0)]
            seg_m, seg_s = [0.0], [0.0]
        cum_m = [0.0]
        cum_min = [0.0]
        car_s = 0.0
        for dist, secs in zip(seg_m, seg_s):
            dist = max(0.0, float(dist))
            secs = max(0.0, float(secs))
            car_s += secs
            truck_s = max(secs, dist / max_mps)
            cum_m.append(cum_m[-1] + dist)
            cum_min.append(cum_min[-1] + truck_s / 60.0)
        return cls(coords=coords, cum_m=cum_m, cum_min=cum_min, source=source, car_minutes=car_s / 60.0)

    @classmethod
    def straight(cls, a: LatLon, b: LatLon, mph: float, circuity: float = 1.0, source: str = "estimate",
                 samples: int = 64) -> "RouteLeg":
        """A great-circle-ish leg at constant speed (fallback + tests)."""
        n = max(2, samples)
        coords = [interpolate(a, b, i / (n - 1)) for i in range(n)]
        seg_m = [haversine_m(coords[i], coords[i + 1]) * circuity for i in range(n - 1)]
        mps = mph * METERS_PER_MILE / 3600
        seg_s = [d / mps if mps > 0 else 0.0 for d in seg_m]
        return cls.from_segments(coords, seg_m, seg_s, source=source, max_mps=math.inf)

    @classmethod
    def estimate(cls, a: LatLon, b: LatLon) -> "RouteLeg":
        return cls.straight(a, b, mph=FALLBACK_MPH, circuity=ROAD_CIRCUITY, source="estimate")
