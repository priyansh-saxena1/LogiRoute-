from __future__ import annotations

from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from .hos.rules import DEFAULT_RULES
from .planning import build_plan
from .serializers import GeocodeQuerySerializer, ReverseQuerySerializer, TripPlanRequestSerializer
from .services import geocoding


@api_view(["GET"])
def health(request: Request) -> Response:
    return Response({"status": "ok", "service": "logiroute-api"})


@api_view(["GET"])
def rules(request: Request) -> Response:
    r = DEFAULT_RULES
    return Response({
        "cycle": "70-hour / 8-day",
        "max_driving_hours": r.max_driving / 60,
        "driving_window_hours": r.max_window / 60,
        "break_after_driving_hours": r.break_after_driving / 60,
        "break_minutes": r.break_length,
        "daily_rest_hours": r.daily_rest / 60,
        "restart_hours": r.restart / 60,
        "cycle_limit_hours": r.cycle_limit / 60,
        "pickup_minutes": r.pickup,
        "dropoff_minutes": r.dropoff,
        "fuel_stop_minutes": r.fuel_stop,
        "fuel_interval_miles": r.fuel_interval_miles,
    })


@api_view(["GET"])
def geocode_search(request: Request) -> Response:
    params = GeocodeQuerySerializer(data=request.query_params)
    params.is_valid(raise_exception=True)
    q = params.validated_data
    if q["source"] == "local":
        return Response({"results": geocoding.local_search(q["q"], limit=q["limit"]), "source": "local"})
    near = (q["lat"], q["lon"]) if "lat" in q and "lon" in q else None
    results = geocoding.search(q["q"], limit=q["limit"], near=near, fallback=False)
    return Response({"results": results, "source": "photon"})


@api_view(["GET"])
def geocode_reverse(request: Request) -> Response:
    params = ReverseQuerySerializer(data=request.query_params)
    params.is_valid(raise_exception=True)
    point = (params.validated_data["lat"], params.validated_data["lon"])
    return Response({"result": geocoding.reverse(point)})


@api_view(["POST"])
def plan_trip(request: Request) -> Response:
    serializer = TripPlanRequestSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(build_plan(serializer.validated_data))
