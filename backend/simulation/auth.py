from functools import wraps

from django.conf import settings
from django.http import JsonResponse


def require_ingest_api_key(view_func):
    """Guards the telemetry ingest endpoint with a static API key.

    See Design Analysis.md §4.1: auth scope is deliberately limited to this
    one endpoint, no end-user login. Works for both sync and async views.
    """

    @wraps(view_func)
    async def wrapped(request, *args, **kwargs):
        provided = request.headers.get('X-API-Key')
        if provided != settings.SIMULATION['INGEST_API_KEY']:
            return JsonResponse({'error': 'invalid or missing API key'}, status=401)
        return await view_func(request, *args, **kwargs)

    return wrapped
