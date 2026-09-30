from __future__ import annotations

from rest_framework import serializers


class LocationField(serializers.Field):
    """Accepts either free text ("Amarillo, TX") or {label, lat, lon} from autocomplete."""

    default_error_messages = {
        "invalid": "Enter a place name or pick a suggestion.",
        "coords": "Latitude must be within ±90 and longitude within ±180.",
    }

    def to_internal_value(self, data):
        if isinstance(data, str):
            text = data.strip()
            if len(text) < 2:
                self.fail("invalid")
            return {"label": text[:300]}
        if not isinstance(data, dict):
            self.fail("invalid")
        label = str(data.get("label") or "").strip()[:300]
        short = str(data.get("short") or "").strip()[:120]
        lat, lon = data.get("lat"), data.get("lon")
        if lat is None or lon is None:
            if len(label) < 2:
                self.fail("invalid")
            return {"label": label}
        try:
            lat, lon = float(lat), float(lon)
        except (TypeError, ValueError):
            self.fail("coords")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            self.fail("coords")
        return {"label": label, "short": short, "lat": lat, "lon": lon}

    def to_representation(self, value):
        return value


class TripPlanRequestSerializer(serializers.Serializer):
    current_location = LocationField()
    pickup_location = LocationField()
    dropoff_location = LocationField()
    current_cycle_used = serializers.FloatField(min_value=0, max_value=70)
    start_time = serializers.DateTimeField(
        required=False,
        allow_null=True,
        input_formats=["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "iso-8601"],
    )
    cycle_history = serializers.ListField(
        child=serializers.FloatField(min_value=0, max_value=24),
        required=False,
        allow_empty=True,
        max_length=7,
        help_text="On-duty hours for each of the previous 7 days, most recent first.",
    )
    pre_trip_inspection = serializers.BooleanField(required=False, default=True)
    post_trip_inspection = serializers.BooleanField(required=False, default=True)
    sleeper_berth = serializers.BooleanField(required=False, default=True)

    def validate_start_time(self, value):
        if value is None:
            return None
        # Wall-clock "home terminal time": drop any offset the client sent.
        return value.replace(tzinfo=None, second=0, microsecond=0)

    def validate_cycle_history(self, value):
        if value and sum(value) > 70:
            raise serializers.ValidationError("The last 7 days add up to more than 70 hours.")
        return value


class GeocodeQuerySerializer(serializers.Serializer):
    q = serializers.CharField(min_length=2, max_length=200)
    limit = serializers.IntegerField(min_value=1, max_value=10, required=False, default=6)
    source = serializers.ChoiceField(choices=["local", "remote"], required=False, default="remote")
    lat = serializers.FloatField(min_value=-90, max_value=90, required=False)
    lon = serializers.FloatField(min_value=-180, max_value=180, required=False)


class ReverseQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)
