from django.urls import path

from . import views

urlpatterns = [
    path('health/', views.health, name='health'),
    path('ingest/', views.ingest, name='ingest'),
    path('snapshot/', views.snapshot, name='snapshot'),
    path('aircraft/<str:aircraft_id>/', views.aircraft_detail, name='aircraft-detail'),
    path('drones/<str:drone_id>/', views.drone_detail, name='drone-detail'),
    path('stream/', views.stream, name='stream'),
    path('zones/', views.zones_collection, name='zones-collection'),
    path('zones/<uuid:zone_id>/', views.zone_detail, name='zone-detail'),
    path('patrol-path/', views.patrol_path_collection, name='patrol-path'),
]
