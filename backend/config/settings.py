"""
Django settings for the LogiRoute API.

The API is stateless: every trip plan is computed on demand from its inputs,
so there is no database. That keeps the app trivially deployable as a
serverless function (Vercel) while share links stay reproducible — the link
carries the inputs, not a row id.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str = "") -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


SECRET_KEY = os.environ.get(
    "DJANGO_SECRET_KEY",
    # Only used for local development. No sessions, auth or signing depend on it.
    "dev-insecure-logiroute-key-change-me",
)

# Vercel sets VERCEL=1 in its build and runtime environment.
ON_VERCEL = os.environ.get("VERCEL") == "1"
DEBUG = env_bool("DJANGO_DEBUG", default=not ON_VERCEL)

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,.vercel.app")
# Vercel exposes the deployment's own hostnames (including custom production domains).
for _var in ("VERCEL_URL", "VERCEL_BRANCH_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
    if os.environ.get(_var):
        ALLOWED_HOSTS.append(os.environ[_var])
if DEBUG:
    ALLOWED_HOSTS.append("*")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "corsheaders",
    "rest_framework",
    "planner",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {"context_processors": ["django.template.context_processors.request"]},
    },
]

WSGI_APPLICATION = "config.wsgi.application"

# Stateless service — no database.
DATABASES: dict = {}

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.locmem.LocMemCache",
        "LOCATION": "logiroute",
        "TIMEOUT": 60 * 60 * 6,
        "OPTIONS": {"MAX_ENTRIES": 2000},
    }
}

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = False
USE_TZ = False  # Trip times are wall-clock "home terminal time", never converted.

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
    "EXCEPTION_HANDLER": "planner.exceptions.api_exception_handler",
}

CORS_ALLOWED_ORIGINS = env_list(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
)
CORS_ALLOWED_ORIGIN_REGEXES = [r"^https://.*\.vercel\.app$"]

# Outbound map services. All are free and keyless; each has a fallback.
LOGIROUTE = {
    "OSRM_URLS": env_list(
        "OSRM_URLS",
        "https://router.project-osrm.org,https://routing.openstreetmap.de/routed-car",
    ),
    "PHOTON_URL": os.environ.get("PHOTON_URL", "https://photon.komoot.io"),
    "NOMINATIM_URL": os.environ.get("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
    "HTTP_TIMEOUT": float(os.environ.get("HTTP_TIMEOUT", "12")),
    "USER_AGENT": os.environ.get(
        "HTTP_USER_AGENT", "LogiRoute/1.0 (ELD trip planner; https://github.com/priyansh-saxena1/LogiRoute-)"
    ),
}

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": "INFO"},
}
