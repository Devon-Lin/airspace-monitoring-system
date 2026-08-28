import asyncio
import json

from asgiref.sync import sync_to_async
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_exempt

from . import geometry
from .auth import require_ingest_api_key
from .models import PatrolPath, RestrictedZone
from .patrol import PATROL_PATH_CACHE
from .state import STATE
from .zones import ZONE_CACHE


def health(request):
    return JsonResponse({"status": "ok"})


async def _ensure_zones_loaded():
    if not ZONE_CACHE.loaded:
        await sync_to_async(ZONE_CACHE.load_from_db)()


async def _ensure_patrol_loaded():
    if not PATROL_PATH_CACHE.loaded:
        await sync_to_async(PATROL_PATH_CACHE.load_from_db)()


@csrf_exempt
@require_ingest_api_key
async def ingest(request):
    if request.method != 'POST':
        return JsonResponse({'error': 'POST required'}, status=405)

    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({'error': 'invalid JSON'}, status=400)

    await _ensure_zones_loaded()
    await _ensure_patrol_loaded()
    event = STATE.apply_ingest_batch(payload.get('aircraft', []), payload.get('removed', []), ZONE_CACHE, PATROL_PATH_CACHE)
    STATE.publish(event)

    return JsonResponse({'seq': event['seq'], 'aircraft_count': len(STATE.aircraft)})


def aircraft_detail(request, aircraft_id):
    since_param = request.GET.get('trajectory_since')
    try:
        trajectory_since = float(since_param) if since_param else None
    except ValueError:
        trajectory_since = None

    detail = STATE.get_aircraft_detail(aircraft_id, trajectory_since)
    if detail is None:
        return JsonResponse({'error': 'aircraft not found'}, status=404)
    return JsonResponse(detail)


def drone_detail(request, drone_id):
    detail = STATE.get_drone_detail(drone_id)
    if detail is None:
        return JsonResponse({'error': 'drone not found'}, status=404)
    return JsonResponse(detail)


async def snapshot(request):
    await _ensure_zones_loaded()
    await _ensure_patrol_loaded()
    data = STATE.snapshot()
    data['zones'] = [ZONE_CACHE.public_zone(z['id']) for z in ZONE_CACHE.all()]
    data['patrol_path'] = PATROL_PATH_CACHE.coordinates
    return JsonResponse(data)


async def stream(request):
    queue = STATE.subscribe()

    async def event_source():
        try:
            while True:
                event = await queue.get()
                # default=str is defense-in-depth: a non-JSON-native value
                # here (e.g. a stray UUID) would otherwise raise inside this
                # generator and Django's StreamingHttpResponse fallback path
                # masks it as a confusing unrelated TypeError.
                yield f"id: {event['seq']}\ndata: {json.dumps(event, default=str)}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            STATE.unsubscribe(queue)

    response = StreamingHttpResponse(event_source(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


@csrf_exempt
async def zones_collection(request):
    await _ensure_zones_loaded()

    if request.method == 'GET':
        return JsonResponse({'zones': [ZONE_CACHE.public_zone(z['id']) for z in ZONE_CACHE.all()]})

    if request.method == 'POST':
        try:
            payload = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'invalid JSON'}, status=400)

        coordinates = payload.get('coordinates')
        error = geometry.validate_zone_coordinates(coordinates)
        if error:
            return JsonResponse({'error': error}, status=400)

        zone = await sync_to_async(RestrictedZone.objects.create)(
            name=payload.get('name', ''), coordinates=coordinates
        )
        zone_id = str(zone.id)
        ZONE_CACHE.add(zone_id, zone.name, coordinates)

        event = {'seq': STATE.next_sequence(), 'type': 'zone_created', 'zone': ZONE_CACHE.public_zone(zone_id)}
        STATE.publish(event)
        return JsonResponse({'zone': event['zone'], 'seq': event['seq']}, status=201)

    return JsonResponse({'error': 'method not allowed'}, status=405)


@csrf_exempt
async def zone_detail(request, zone_id):
    if request.method != 'DELETE':
        return JsonResponse({'error': 'method not allowed'}, status=405)

    zone_id = str(zone_id)  # <uuid:...> hands us a UUID object; cache keys are strings
    await _ensure_zones_loaded()
    await sync_to_async(RestrictedZone.objects.filter(id=zone_id).delete)()
    ZONE_CACHE.remove(zone_id)

    event = {'seq': STATE.next_sequence(), 'type': 'zone_deleted', 'zone_id': zone_id}
    STATE.publish(event)
    return JsonResponse({'status': 'deleted', 'seq': event['seq']})


@csrf_exempt
async def patrol_path_collection(request):
    await _ensure_patrol_loaded()

    if request.method == 'GET':
        return JsonResponse({'coordinates': PATROL_PATH_CACHE.coordinates})

    if request.method == 'POST':
        try:
            payload = json.loads(request.body)
        except json.JSONDecodeError:
            return JsonResponse({'error': 'invalid JSON'}, status=400)

        coordinates = payload.get('coordinates')
        error = geometry.validate_zone_coordinates(coordinates)  # same min-3/non-self-intersecting rule
        if error:
            return JsonResponse({'error': error}, status=400)

        await sync_to_async(PatrolPath.objects.all().delete)()  # only one row ever exists
        await sync_to_async(PatrolPath.objects.create)(coordinates=coordinates)
        PATROL_PATH_CACHE.set(coordinates)

        event = {'seq': STATE.next_sequence(), 'type': 'patrol_path_updated', 'coordinates': coordinates}
        STATE.publish(event)
        return JsonResponse({'coordinates': coordinates, 'seq': event['seq']}, status=201)

    if request.method == 'DELETE':
        await sync_to_async(PatrolPath.objects.all().delete)()
        PATROL_PATH_CACHE.clear()

        event = {'seq': STATE.next_sequence(), 'type': 'patrol_path_updated', 'coordinates': None}
        STATE.publish(event)
        return JsonResponse({'status': 'cleared', 'seq': event['seq']})

    return JsonResponse({'error': 'method not allowed'}, status=405)
