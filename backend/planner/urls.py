from django.urls import path

from . import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("rules", views.rules, name="rules"),
    path("geocode/search", views.geocode_search, name="geocode-search"),
    path("geocode/reverse", views.geocode_reverse, name="geocode-reverse"),
    path("trips/plan", views.plan_trip, name="plan-trip"),
]
