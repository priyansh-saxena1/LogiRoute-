import pytest
from rest_framework.test import APIClient

from planner.route import RouteLeg
from planner.tests.helpers import CHICAGO, DALLAS, LOS_ANGELES


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture(autouse=True)
def offline_routing(monkeypatch):
    """Route along straight lines so the tests never touch the network."""

    def fake_route_trip(points):
        return [RouteLeg.straight(a, b, mph=55, circuity=1.2) for a, b in zip(points, points[1:])], []

    monkeypatch.setattr("planner.planning.route_trip", fake_route_trip)


def place(label, point):
    return {"label": label, "short": label, "lat": point[0], "lon": point[1]}


def payload(**overrides):
    body = {
        "current_location": place("Chicago, IL", CHICAGO),
        "pickup_location": place("Dallas, TX", DALLAS),
        "dropoff_location": place("Los Angeles, CA", LOS_ANGELES),
        "current_cycle_used": 20,
        "start_time": "2026-10-01T06:00",
    }
    body.update(overrides)
    return body


def test_health(client):
    assert client.get("/api/health").json()["status"] == "ok"


def test_plan_shape_and_compliance(client):
    response = client.post("/api/trips/plan", payload(), format="json")
    assert response.status_code == 200
    data = response.json()
    assert data["summary"]["compliant"] is True
    assert all(check["passed"] for check in data["audit"])
    assert len(data["route"]["legs"]) == 2
    assert data["route"]["legs"][0]["geometry"][0][2] == 0
    assert data["days"][0]["date"] == "2026-10-01"
    for day in data["days"]:
        assert sum(day["totals"].values()) == 1440
        assert day["segments"][0]["start"] == 0
        assert day["segments"][-1]["end"] == 1440
    types = [stop["type"] for stop in data["stops"]]
    assert types[0] == "origin"
    assert "pickup" in types and types[-1] == "dropoff"
    # Event timeline is contiguous and matches the summary.
    events = data["events"]
    assert all(a["end_min"] == b["start_min"] for a, b in zip(events, events[1:]))
    assert data["summary"]["trip_minutes"] == events[-1]["end_min"]


def test_free_text_locations_resolve_offline_for_city_state(client):
    body = payload(
        current_location="Chicago, IL", pickup_location="Dallas, TX", dropoff_location="Los Angeles, CA"
    )
    response = client.post("/api/trips/plan", body, format="json")
    assert response.status_code == 200
    assert response.json()["inputs"]["places"]["pickup"]["short"] == "Dallas, TX"


def test_cycle_history_overrides_total(client):
    response = client.post("/api/trips/plan", payload(cycle_history=[10, 10, 10, 0, 0, 0, 0]), format="json")
    assert response.status_code == 200
    assert response.json()["inputs"]["current_cycle_used"] == 30


@pytest.mark.parametrize(
    "overrides, field",
    [
        ({"current_cycle_used": 71}, "current_cycle_used"),
        ({"current_cycle_used": -1}, "current_cycle_used"),
        ({"pickup_location": ""}, "pickup_location"),
        ({"dropoff_location": {"lat": 200, "lon": 0}}, "dropoff_location"),
        ({"cycle_history": [24, 24, 24, 0, 0, 0, 0]}, "cycle_history"),
    ],
)
def test_validation_errors(client, overrides, field):
    response = client.post("/api/trips/plan", payload(**overrides), format="json")
    assert response.status_code == 400
    assert response.json()["error"]["field"] == field


def test_same_pickup_and_dropoff_is_rejected(client):
    response = client.post(
        "/api/trips/plan", payload(dropoff_location=place("Dallas, TX", DALLAS)), format="json"
    )
    assert response.status_code == 422
    assert response.json()["error"]["field"] == "dropoff"


def test_local_geocode_is_instant_and_offline(client):
    results = client.get("/api/geocode/search", {"q": "amaril", "source": "local"}).json()["results"]
    assert results[0]["label"] == "Amarillo, TX"
