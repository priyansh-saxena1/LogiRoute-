from planner.geo import decode_polyline, simplify_indices
from planner.places import describe, search_local
from planner.route import RouteLeg


def test_describe_in_town():
    assert describe((35.2220, -101.8313)).label == "Amarillo, TX"


def test_describe_uses_eld_distance_and_direction():
    desc = describe((35.40, -101.60))  # north-east of Amarillo on open range
    assert desc.direction is not None
    assert desc.label.startswith(f"{desc.miles:.0f} mi {desc.direction} ")
    assert desc.label.endswith(", TX")


def test_describe_far_offshore_falls_back_to_coordinates():
    assert describe((0.0, -140.0)).city is None


def test_local_search_prefers_big_city_and_filters_state():
    assert search_local("dall")[0].name == "Dallas"
    springfield = search_local("springfield, mo")
    assert springfield and all(p.state == "MO" for p in springfield)


def test_polyline_decoding():
    # Google's reference example, precision 5.
    assert decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5) == [
        (38.5, -120.2), (40.7, -120.95), (43.252, -126.453)
    ]


def test_simplify_keeps_endpoints():
    pts = [(0, i / 100) for i in range(101)]
    idx = simplify_indices(pts, 0.001)
    assert idx == [0, 100]


def test_truck_speed_cap_slows_fast_segments():
    # 1,000 m in 20 s is 112 mph; the governed truck must take longer.
    leg = RouteLeg.from_segments([(0, 0), (0, 0.009)], [1000.0], [20.0])
    assert leg.minutes > 20 / 60
    assert abs(leg.minutes - 1000 / (65 * 1609.344 / 3600) / 60) < 1e-9
