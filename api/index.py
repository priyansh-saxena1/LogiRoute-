"""Vercel serverless entry point: exposes the Django API as a WSGI `app`.

vercel.json rewrites /api/:path* here. Vercel normally passes the original
path through, so Django's URLconf works unchanged; if a request ever arrives
as the rewrite target itself (/api/index?path=...), it is mapped back.
"""

import os
import sys
from pathlib import Path
from urllib.parse import parse_qs

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

django_app = get_wsgi_application()


def app(environ, start_response):
    if environ.get("PATH_INFO", "").rstrip("/") == "/api/index":
        target = parse_qs(environ.get("QUERY_STRING", "")).get("path", [""])[0]
        environ["PATH_INFO"] = f"/api/{target}"
    return django_app(environ, start_response)
