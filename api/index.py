"""Vercel serverless entry point: exposes the Django API as a WSGI `app`.

Vercel routes /api/* here (see vercel.json); Django receives the original
path, so the URLconf in backend/config/urls.py works unchanged.
"""

import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

from django.core.wsgi import get_wsgi_application  # noqa: E402

app = get_wsgi_application()
