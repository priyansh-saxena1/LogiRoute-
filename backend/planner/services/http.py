from __future__ import annotations

from functools import lru_cache

import requests
from django.conf import settings
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


class UpstreamError(RuntimeError):
    """A free map service failed or returned nothing usable."""


@lru_cache(maxsize=1)
def session() -> requests.Session:
    s = requests.Session()
    # Retry quick failures (connect errors, 429/5xx) once; never re-wait on a slow read —
    # callers have their own fallbacks and a serverless request budget to respect.
    retry = Retry(total=1, read=0, backoff_factor=0.2, status_forcelist=(429, 500, 502, 503, 504),
                  allowed_methods=("GET",))
    adapter = HTTPAdapter(max_retries=retry, pool_connections=8, pool_maxsize=8)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update({"User-Agent": settings.LOGIROUTE["USER_AGENT"], "Accept": "application/json"})
    return s


CONNECT_TIMEOUT = 3.05


def get_json(url: str, params: dict | None = None, timeout: float | None = None) -> dict | list:
    read_timeout = timeout or settings.LOGIROUTE["HTTP_TIMEOUT"]
    try:
        response = session().get(url, params=params, timeout=(CONNECT_TIMEOUT, read_timeout))
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError) as exc:
        raise UpstreamError(f"{url}: {exc}") from exc
