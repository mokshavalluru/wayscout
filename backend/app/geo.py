"""Geocoding (Nominatim) and road distances (OSRM), with a straight-line fallback."""
import math
import httpx

HEADERS = {"User-Agent": "WayScout/1.0 (student project)"}
PHOTON = "https://photon.komoot.io/api/"
OSRM = "https://router.project-osrm.org"   # public demo server: light use only
ROAD_FACTOR, FALLBACK_KMH = 1.3, 30


async def geocode(q, lat=None, lng=None, limit=6):
    """Search-as-you-type places via Photon, biased towards the user's location."""
    params = {"q": q, "limit": limit}
    if lat is not None and lng is not None:
        params.update(lat=lat, lon=lng)
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as c:
        r = await c.get(PHOTON, params=params)
        r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        p, (lon, la) = f["properties"], f["geometry"]["coordinates"]
        name = p.get("name") or p.get("street") or q
        parts = []
        for x in (name, p.get("street") if p.get("name") else None,
                  p.get("district"), p.get("city"), p.get("state"), p.get("country")):
            if x and x not in parts:
                parts.append(x)
        out.append({"name": name, "label": ", ".join(parts), "lat": la, "lng": lon})
    return out


def _haversine_km(a, b):
    p1, p2 = math.radians(a["lat"]), math.radians(b["lat"])
    dl = math.radians(b["lng"] - a["lng"])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def _estimate(pts):
    dist = [[_haversine_km(a, b) * ROAD_FACTOR for b in pts] for a in pts]
    dur = [[km / FALLBACK_KMH * 3600 for km in row] for row in dist]
    return dist, dur


def _coords(pts):
    return ";".join(f"{p['lng']},{p['lat']}" for p in pts)


async def matrices(pts):
    """Return (distance km matrix, duration s matrix, source)."""
    try:
        async with httpx.AsyncClient(timeout=15, headers=HEADERS) as c:
            r = await c.get(f"{OSRM}/table/v1/driving/{_coords(pts)}",
                            params={"annotations": "distance,duration"})
            j = r.json()
        if j.get("code") != "Ok" or any(v is None for row in j["distances"] for v in row):
            raise ValueError("no road data")
        return [[v / 1000 for v in row] for row in j["distances"]], j["durations"], "road"
    except Exception:
        dist, dur = _estimate(pts)
        return dist, dur, "estimate"


async def geometry(ordered, source):
    """Polyline [[lat, lng], ...] following roads when available."""
    if source == "road":
        try:
            async with httpx.AsyncClient(timeout=15, headers=HEADERS) as c:
                r = await c.get(f"{OSRM}/route/v1/driving/{_coords(ordered)}",
                                params={"overview": "full", "geometries": "geojson"})
                j = r.json()
            if j.get("code") == "Ok":
                return [[lat, lng] for lng, lat in j["routes"][0]["geometry"]["coordinates"]]
        except Exception:
            pass
    return [[p["lat"], p["lng"]] for p in ordered]
