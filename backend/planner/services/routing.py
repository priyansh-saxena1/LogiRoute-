"""Road routing through public OSRM servers (free, keyless) with graceful fallback."""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor

from django.conf import settings
from django.core.cache import cache

from ..geo import LatLon, decode_polyline, haversine_m
from ..route import RouteLeg
from .http import UpstreamError, get_json

log = logging.getLogger(__name__)

SAME_PLACE_M = 150.0


def _osrm_leg(base: str, a: LatLon, b: LatLon) -> RouteLeg:
    coords = f"{a[1]:.6f},{a[0]:.6f};{b[1]:.6f},{b[0]:.6f}"
    data = get_json(
        f"{base.rstrip('/')}/route/v1/driving/{coords}",
        params={
            "overview": "full",
            "geometries": "polyline6",
            "annotations": "distance,duration",
            "steps": "false",
        },
    )
    if not isinstance(data, dict) or data.get("code") != "Ok" or not data.get("routes"):
        raise UpstreamError(f"OSRM {base}: {data.get('code') if isinstance(data, dict) else 'bad payload'}")
    route = data["routes"][0]
    leg = route["legs"][0]
    points = decode_polyline(route["geometry"], precision=6)
    annotation = leg.get("annotation") or {}
    seg_m = annotation.get("distance") or []
    seg_s = annotation.get("duration") or []
    if len(points) < 2:
        raise UpstreamError("OSRM returned an empty geometry")
    if len(seg_m) != len(points) - 1 or len(seg_s) != len(points) - 1:
        # Rebuild per-segment values from geometry, spreading the leg time by distance.
        seg_m = [haversine_m(points[i], points[i + 1]) for i in range(len(points) - 1)]
        total_m = sum(seg_m) or 1.0
        seg_s = [leg["duration"] * d / total_m for d in seg_m]
    result = RouteLeg.from_segments(points, seg_m, seg_s, source="osrm")
    result.meta = {"engine": base, "car_minutes": round(route["duration"] / 60, 1)}
    return result


def route_leg(a: LatLon, b: LatLon) -> tuple[RouteLeg, str | None]:
    """Return (leg, warning). Never raises: falls back to a distance estimate."""
    if haversine_m(a, b) < SAME_PLACE_M:
        return RouteLeg.from_segments([a, b], [0.0], [0.0], source="same"), None

    key = f"route:v2:{a[0]:.5f},{a[1]:.5f}:{b[0]:.5f},{b[1]:.5f}"
    cached = cache.get(key)
    if cached is not None:
        return cached, None

    errors = []
    for base in settings.LOGIROUTE["OSRM_URLS"]:
        try:
            leg = _osrm_leg(base, a, b)
            cache.set(key, leg)
            return leg, None
        except (UpstreamError, KeyError, IndexError, TypeError) as exc:
            errors.append(str(exc))
            log.warning("OSRM failed on %s: %s", base, exc)
    leg = RouteLeg.estimate(a, b)
    return leg, (
        "Road routing is temporarily unavailable, so this leg uses a straight-line estimate "
        "(great-circle distance × 1.2 at 55 mph). HOS scheduling is still exact for that distance."
    )


def route_trip(points: list[LatLon]) -> tuple[list[RouteLeg], list[str]]:
    pairs = list(zip(points, points[1:]))
    with ThreadPoolExecutor(max_workers=len(pairs)) as pool:
        results = list(pool.map(lambda p: route_leg(*p), pairs))
    legs = [leg for leg, _ in results]
    warnings = sorted({w for _, w in results if w})
    return legs, warnings
