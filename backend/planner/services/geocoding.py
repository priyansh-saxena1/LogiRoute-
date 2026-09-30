"""Place search via Photon (OSM, keyless, autocomplete-friendly) with a Nominatim fallback."""

from __future__ import annotations

import hashlib
import logging

from django.conf import settings
from django.core.cache import cache

from ..geo import LatLon
from ..places import US_STATE_ABBR, describe, search_local
from .http import UpstreamError, get_json

log = logging.getLogger(__name__)

US_BBOX = "-180,17,-64,72"  # lower 48 + Alaska + Hawaii
US_CENTER = (39.5, -98.35)


def _abbr(state: str | None) -> str | None:
    if not state:
        return None
    return US_STATE_ABBR.get(state, state)


def _compose(primary: str | None, locality: str | None, state: str | None, postcode: str | None = None) -> str:
    parts = [p for p in (primary, locality) if p]
    # Avoid "Dallas, Dallas, TX".
    if len(parts) == 2 and parts[0] == parts[1]:
        parts = parts[:1]
    tail = " ".join(p for p in (_abbr(state), postcode) if p)
    if tail:
        parts.append(tail)
    return ", ".join(parts)


def _from_photon(feature: dict) -> dict | None:
    props = feature.get("properties", {})
    if props.get("countrycode") != "US":
        return None
    lon, lat = feature["geometry"]["coordinates"]
    kind = props.get("type") or props.get("osm_value") or "place"
    name = props.get("name")
    city = props.get("city") or props.get("town") or props.get("village") or props.get("district")
    state = props.get("state")
    street = props.get("street")
    if props.get("housenumber") and street:
        primary = f"{props['housenumber']} {street}"
    elif kind == "street" and name:
        primary = name
    else:
        primary = name or street

    if kind in ("city", "town", "village", "locality", "hamlet"):
        label = _compose(primary, None, state)
        short = label
    elif kind == "state":
        label = short = primary or state or "United States"
    else:
        locality = city or props.get("county")
        label = _compose(primary, locality, state, props.get("postcode") if props.get("housenumber") else None)
        short = _compose(city or primary, None, state)

    return {
        "id": f"osm:{props.get('osm_type', '')}{props.get('osm_id', '')}",
        "label": label,
        "short": short,
        "name": primary or label,
        "detail": _compose(None, city if city != primary else None, state) or "United States",
        "kind": kind,
        "lat": round(lat, 6),
        "lon": round(lon, 6),
    }


def _from_nominatim(item: dict) -> dict | None:
    address = item.get("address", {})
    if address.get("country_code") != "us":
        return None
    city = address.get("city") or address.get("town") or address.get("village") or address.get("hamlet")
    state = address.get("state")
    name = item.get("name") or (item.get("display_name", "").split(",")[0])
    kind = item.get("addresstype") or item.get("type") or "place"
    if kind in ("city", "town", "village", "hamlet"):
        label = short = _compose(name, None, state)
    else:
        road = address.get("road")
        primary = f"{address['house_number']} {road}" if address.get("house_number") and road else (name or road)
        label = _compose(primary, city or address.get("county"), state)
        short = _compose(city or primary, None, state)
    return {
        "id": f"nominatim:{item.get('osm_type', '')}{item.get('osm_id', '')}",
        "label": label,
        "short": short,
        "name": name or label,
        "detail": _compose(None, city if city != name else None, state) or "United States",
        "kind": kind,
        "lat": round(float(item["lat"]), 6),
        "lon": round(float(item["lon"]), 6),
    }


def _dedupe(results: list[dict]) -> list[dict]:
    seen, out = set(), []
    for r in results:
        key = (r["label"].lower(), round(r["lat"], 2), round(r["lon"], 2))
        if key not in seen:
            seen.add(key)
            out.append(r)
    return out


def local_search(query: str, limit: int = 6) -> list[dict]:
    """Instant, offline city matches from the bundled GeoNames extract."""
    return [
        {
            "id": f"geonames:{p.state}:{p.name}",
            "label": f"{p.name}, {p.state}",
            "short": f"{p.name}, {p.state}",
            "name": p.name,
            "detail": f"{p.state} · pop. {p.population:,}",
            "kind": "city",
            "lat": p.lat,
            "lon": p.lon,
        }
        for p in search_local(query, limit)
    ]


def search(query: str, limit: int = 6, near: LatLon | None = None, fallback: bool = True) -> list[dict]:
    """Photon search; Nominatim only when `fallback` (its policy forbids autocomplete use)."""
    query = " ".join(query.split())
    if len(query) < 2:
        return []
    bias = near or US_CENTER
    cache_key = "geo:" + hashlib.sha1(f"{query.lower()}|{bias[0]:.1f},{bias[1]:.1f}|{limit}".encode()).hexdigest()
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    results: list[dict] = []
    try:
        data = get_json(
            f"{settings.LOGIROUTE['PHOTON_URL']}/api/",
            params={
                "q": query, "limit": 12, "lang": "en", "bbox": US_BBOX,
                "lat": bias[0], "lon": bias[1], "location_bias_scale": 0.2 if near else 0.05,
            },
            timeout=5,
        )
        results = [r for r in (_from_photon(f) for f in data.get("features", [])) if r]
    except UpstreamError as exc:
        log.warning("Photon search failed: %s", exc)

    if not results and fallback:
        try:
            data = get_json(
                f"{settings.LOGIROUTE['NOMINATIM_URL']}/search",
                params={"q": query, "format": "jsonv2", "countrycodes": "us", "limit": limit, "addressdetails": 1},
                timeout=8,
            )
            results = [r for r in (_from_nominatim(i) for i in data) if r]
        except UpstreamError as exc:
            log.warning("Nominatim search failed: %s", exc)

    results = _dedupe(results)[:limit]
    cache.set(cache_key, results, 60 * 60 * 24)
    return results


def reverse(point: LatLon) -> dict:
    lat, lon = point
    key = f"rev:{lat:.4f},{lon:.4f}"
    cached = cache.get(key)
    if cached is not None:
        return cached
    result = None
    try:
        data = get_json(f"{settings.LOGIROUTE['PHOTON_URL']}/reverse", params={"lat": lat, "lon": lon, "lang": "en"},
                        timeout=6)
        features = data.get("features", [])
        if features:
            result = _from_photon(features[0])
    except UpstreamError as exc:
        log.warning("Photon reverse failed: %s", exc)
    if result is None:
        desc = describe(point)
        result = {
            "id": f"pt:{lat:.5f},{lon:.5f}", "label": desc.label, "short": desc.label, "name": desc.label,
            "detail": "Near your location", "kind": "point", "lat": round(lat, 6), "lon": round(lon, 6),
        }
    # Keep the exact device position; the label is just a description.
    result = {**result, "lat": round(lat, 6), "lon": round(lon, 6)}
    cache.set(key, result, 60 * 60 * 24)
    return result


def resolve(text: str) -> dict:
    """Best single match for free text. "City, ST" resolves offline and instantly."""
    if "," in text and len(text.split(",", 1)[1].strip()) >= 2:
        local = local_search(text, limit=1)
        if local and local[0]["name"].lower() == text.split(",")[0].strip().lower():
            return local[0]
    results = search(text, limit=1)
    if not results:
        results = local_search(text, limit=1)
    if not results:
        raise LookupError(text)
    return results[0]
