"""Small, dependency-free geodesy helpers."""

from __future__ import annotations

import math
from typing import Sequence

EARTH_RADIUS_M = 6_371_008.8
METERS_PER_MILE = 1609.344

LatLon = tuple[float, float]

_COMPASS_16 = (
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
)
_COMPASS_8 = ("N", "NE", "E", "SE", "S", "SW", "W", "NW")


def haversine_m(a: LatLon, b: LatLon) -> float:
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a: LatLon, b: LatLon) -> float:
    """Initial bearing from a to b, degrees clockwise from north."""
    lat1, lon1 = map(math.radians, a)
    lat2, lon2 = map(math.radians, b)
    dlon = lon2 - lon1
    x = math.sin(dlon) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def compass(bearing: float, points: int = 8) -> str:
    names = _COMPASS_16 if points == 16 else _COMPASS_8
    step = 360 / len(names)
    return names[int((bearing + step / 2) // step) % len(names)]


def interpolate(a: LatLon, b: LatLon, fraction: float) -> LatLon:
    return (a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction)


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    """Decode a Google-style encoded polyline (OSRM uses precision 6)."""
    coords: list[LatLon] = []
    index = lat = lon = 0
    factor = 10 ** precision
    length = len(encoded)
    while index < length:
        for is_lon in (False, True):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if is_lon:
                lon += delta
            else:
                lat += delta
        coords.append((lat / factor, lon / factor))
    return coords


def simplify_indices(points: Sequence[LatLon], tolerance_deg: float) -> list[int]:
    """Ramer–Douglas–Peucker simplification; returns kept indices (iterative).

    Works in a locally scaled lon/lat plane, which is plenty for display.
    """
    n = len(points)
    if n <= 2:
        return list(range(n))
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    tol2 = tolerance_deg * tolerance_deg
    while stack:
        start, end = stack.pop()
        if end <= start + 1:
            continue
        ay, ax = points[start]
        by, bx = points[end]
        scale = math.cos(math.radians((ay + by) / 2))
        ax *= scale
        bx *= scale
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        best_i, best_d = -1, -1.0
        for i in range(start + 1, end):
            py, px = points[i]
            px *= scale
            if seg2 == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
                d = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2
            if d > best_d:
                best_i, best_d = i, d
        if best_d > tol2:
            keep[best_i] = True
            stack.append((start, best_i))
            stack.append((best_i, end))
    return [i for i, k in enumerate(keep) if k]
