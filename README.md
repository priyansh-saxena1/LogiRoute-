# LogiRoute — HOS trip planner & ELD daily logs

Enter where the truck is, the pickup, the drop-off and the hours already used in the
70-hour cycle. LogiRoute routes the trip over real roads, schedules every break, fuel
stop, rest and restart the FMCSA hours-of-service rules require, and draws a filled-in
**driver's daily log sheet for every calendar day** of the trip.

**Stack:** Django 5 + Django REST Framework (API) · React 19 + TypeScript + Vite + Tailwind (UI) ·
Leaflet · OSRM / Photon / GeoNames (free, keyless map data) · deployed as one Vercel project.

---

## What you get

| | |
|---|---|
| **Route map** | Real road route (OSRM), empty leg vs loaded leg, a pin for every stop, light / streets / satellite basemaps. |
| **Itinerary** | Every stop with arrival–departure times, duration, odometer and an ELD-style location (`12 mi NE Amarillo, TX`). |
| **HOS replay** | Scrub or play the whole trip: the truck moves on the map while live gauges count down the 11-hr, 14-hr, 8-hr-break and 70-hr clocks. |
| **Daily log sheets** | SVG sheets modelled on the paper *Driver's Daily Log*: 24-hour grid with quarter-hour ticks, the duty line, per-line totals summing to 24:00, bracketed remarks at each change of duty status, shipping documents and the 70-hour recap. Print / save as PDF, or export PNG/SVG. Click a grid to jump the replay to that minute. |
| **Compliance audit** | An independent checker re-derives shifts, breaks and the rolling 8-day cycle from the finished logs and reports each rule with its CFR citation. |
| **Share links** | The full request rides in the URL hash, so a link reproduces the exact plan — no database needed. |

## HOS rules implemented

Property-carrying driver, 70 hours / 8 days, no adverse conditions (49 CFR 395.3):

- **11 hours** driving after 10 consecutive hours off duty.
- **14-hour window** — no driving after the 14th hour since coming on duty (on-duty work may continue).
- **30-minute break** after 8 cumulative hours of driving; any 30 consecutive non-driving minutes count (off duty, sleeper *or* on duty — e.g. fueling).
- **10 consecutive hours off** resets the 11/14-hour clocks (logged in the sleeper berth by default).
- **70 hours on duty in any 8 consecutive days**; a **34-hour restart** resets the cycle.
- Trip assumptions: fuel at least every **1,000 miles** (30 min, on duty), **1 hour** on duty for pickup and for drop-off, optional 15-min pre-/post-trip inspections.

### Scheduling decisions worth knowing

The simulator (`backend/planner/hos/simulator.py`) is a minute-resolution state machine. Before
every stretch of driving it settles whatever blocks the wheel (cycle, 11/14-hour limits, break,
fuel), then drives the longest stretch no limit, fuel threshold, midnight or destination interrupts.
On top of plain compliance it makes a few dispatcher-style choices:

- **Fuel at planned stops.** If the tank will not reach the next planned stop, the driver fuels
  at the current one (shipper, 30-minute break, or before parking for the night) instead of making
  an extra stop later. A fuel stop that lands on a required break *is* the break.
- **Restart instead of rest.** If, after a required 10-hour rest, the cycle could not cover the rest
  of the trip, the rest is extended into the 34-hour restart that is needed anyway.
- **Roll-off vs restart.** When the cycle runs out, it compares waiting for old hours to drop off
  the 8-day window (at midnight) against a 34-hour restart and takes whichever is sooner. Enter the
  last 7 days day-by-day to use this; with a single "cycle used" number, prior hours are
  conservatively treated as worked yesterday.
- **Only driving is capped at 70 hours.** Drop-off and post-trip work can still be logged after the
  cycle is used up, so a trip is never pushed into a needless restart.

Drive times come from OSRM, with every road segment capped at a 65 mph governed truck speed.
Locations along the route are described the way ELDs do (distance and direction from the nearest
town), using an offline GeoNames index so dozens of stops label instantly.

## Architecture

```
frontend/  React + Vite SPA ─────────────┐  same origin in production
api/index.py  Vercel Python entry (WSGI) ─┤  /api/* → Django
backend/
  config/            settings (stateless, no DB), urls
  planner/
    views.py         DRF endpoints: trips/plan, geocode/search, geocode/reverse, health
    planning.py      orchestrates: resolve places → route → simulate → logs → audit
    hos/rules.py     HOS limits as integer minutes
    hos/simulator.py the scheduler
    hos/logs.py      events → midnight-to-midnight sheets, totals, remarks, recap
    hos/audit.py     independent compliance checker (shares no code with the simulator)
    route.py         route legs as distance/time profiles
    places.py        offline nearest-town index + instant city search (GeoNames)
    services/        OSRM routing (hedged across two servers, estimate fallback),
                     Photon geocoding (Nominatim fallback)
```

The API is stateless: every plan is computed from its inputs in ~1–3 s, most of it routing.

### API

`POST /api/trips/plan`

```json
{
  "current_location": "Chicago, IL",
  "pickup_location": { "label": "Dallas, TX", "lat": 32.7767, "lon": -96.797 },
  "dropoff_location": "Los Angeles, CA",
  "current_cycle_used": 18,
  "start_time": "2026-10-01T06:00",
  "cycle_history": [10, 9.5, 11, 0, 0, 8, 12],
  "pre_trip_inspection": true,
  "post_trip_inspection": true,
  "sleeper_berth": true
}
```

Locations accept free text or `{label, lat, lon}`. `cycle_history` (optional) is on-duty hours for
the previous 7 days, most recent first. The response contains the route geometry, a duty-status
event timeline with clock snapshots, grouped stops, one object per daily log sheet, the audit and a
summary. Errors come back as `{"error": {"code", "message", "field"}}`.

## Run locally

```bash
# API (Python 3.11+)
cd backend
python -m venv .venv && .venv/Scripts/activate      # macOS/Linux: source .venv/bin/activate
pip install -r requirements-dev.txt
python manage.py runserver 8000
```

```bash
# Web (Node 20+) — proxies /api to :8000
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

### Tests

```bash
cd backend && pytest
```

The suite includes 300 randomized trips (random distances, speeds, start times, cycle histories and
options) that must all pass the independent audit, plus hand-built violations the auditor must catch.

## Deploy (Vercel)

The repo deploys as a single Vercel project: `vercel.json` builds the Vite app to static files and
serves `api/index.py` (Django) as a Python function under `/api`.

1. Import the repository at [vercel.com/new](https://vercel.com/new) — no settings to change — or run
   `npx vercel --prod` from the repo root.
2. Optional environment variables: `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS` (Vercel domains are
   allowed automatically), `OSRM_URLS`, `PHOTON_URL`.

## Data & credits

Road routing © [OSRM](https://project-osrm.org) on OpenStreetMap data · geocoding by
[Photon](https://photon.komoot.io) / [Nominatim](https://nominatim.org) · places ©
[GeoNames](https://www.geonames.org) (CC BY 4.0) · basemaps © Esri. LogiRoute is a planning aid;
drivers remain responsible for their records of duty status.
