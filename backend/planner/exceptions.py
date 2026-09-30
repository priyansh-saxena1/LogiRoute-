from __future__ import annotations

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import exception_handler

from .hos.simulator import SimulationError
from .planning import PlanningError

log = logging.getLogger(__name__)


def _error(code: str, message: str, http_status: int, details=None, field: str | None = None) -> Response:
    body = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    if field:
        body["error"]["field"] = field
    return Response(body, status=http_status)


def api_exception_handler(exc, context):
    if isinstance(exc, PlanningError):
        return _error("unprocessable", str(exc), status.HTTP_422_UNPROCESSABLE_ENTITY, field=exc.field)
    if isinstance(exc, SimulationError):
        log.exception("Simulation failed")
        return _error("simulation_failed", "The trip could not be scheduled. Please try different inputs.",
                      status.HTTP_422_UNPROCESSABLE_ENTITY)

    response = exception_handler(exc, context)
    if response is None:
        log.exception("Unhandled API error")
        return _error("server_error", "Something went wrong on our side.", status.HTTP_500_INTERNAL_SERVER_ERROR)

    data = response.data
    if isinstance(data, dict) and "detail" not in data:
        first_field = next(iter(data), None)
        first = data.get(first_field)
        msg = first[0] if isinstance(first, list) and first else "Please check the highlighted fields."
        return _error("invalid", str(msg), response.status_code, details=data, field=first_field)
    detail = data.get("detail") if isinstance(data, dict) else data
    return _error("error", str(detail), response.status_code)
