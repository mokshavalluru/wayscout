from fastapi import FastAPI, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import geo
from .aco import solve
from .conditions import TRAFFIC_NAMES, WEATHER_NAMES, label, traffic_level, weather_level
from .fuzzy import fuzzy_cost

app = FastAPI(title="WayScout API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class Stop(BaseModel):
    name: str = "Stop"
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    priority: int = Field(1, ge=1, le=3)   # 1 normal, 2 high, 3 urgent


class OptimizeIn(BaseModel):
    stops: list[Stop] = Field(min_length=2, max_length=60)   # stops[0] is the start
    return_to_start: bool = True
    iterations: int = Field(100, ge=10, le=500)
    ants: int | None = Field(None, ge=2, le=100)
    use_fuzzy: bool = True
    hour: int | None = Field(None, ge=0, le=23)   # local hour of day; the browser sends it


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/geocode")
async def geocode(q: str = Query(min_length=2), lat: float | None = None, lng: float | None = None):
    try:
        return await geo.geocode(q, lat, lng)
    except Exception:
        raise HTTPException(502, "Place search is unavailable right now. Tap the map to add a stop instead.")


@app.post("/api/optimize")
async def optimize(req: OptimizeIn):
    pts = [s.model_dump() for s in req.stops]
    dist, dur, source = await geo.matrices(pts)

    traffic, hour = traffic_level(req.hour)
    weather, weather_src = (0.0, "off")
    cost = dist
    if req.use_fuzzy:
        weather, weather_src = await weather_level(pts[0]["lat"], pts[0]["lng"])
        cost = fuzzy_cost(dist, [s.priority for s in req.stops], traffic, weather)

    order, _, history = await run_in_threadpool(solve, cost, req.return_to_start, req.ants, req.iterations)
    if req.use_fuzzy and req.return_to_start and len(order) > 3:
        # A closed loop can be driven either way round: pick the direction that reaches urgent stops sooner
        # (as long as the real distance stays within 5%).
        rev = [order[0]] + order[1:][::-1]
        real = lambda t: sum(dist[a][b] for a, b in zip(t, t[1:] + [t[0]]))
        wait = lambda t: sum(req.stops[j].priority * k for k, j in enumerate(t))
        if wait(rev) < wait(order) and real(rev) <= real(order) * 1.05:
            order = rev
    seq = order + ([order[0]] if req.return_to_start else [])
    legs = list(zip(seq, seq[1:]))
    slowdown = 1 + 0.06 * traffic if req.use_fuzzy else 1.0   # simple assumption: heavy traffic = up to 1.6x slower
    return {
        "order": order,
        "distance_km": round(sum(dist[a][b] for a, b in legs), 2),      # real distance, not fuzzy cost
        "duration_min": round(sum(dur[a][b] for a, b in legs) * slowdown / 60),
        "geometry": await geo.geometry([pts[i] for i in seq], source),
        "history": [round(h, 2) for h in history],                       # route cost per round
        "source": source,
        "fuzzy": req.use_fuzzy,
        "conditions": {
            "hour": hour,
            "traffic": traffic, "traffic_label": label(traffic, TRAFFIC_NAMES),
            "weather": weather, "weather_label": label(weather, WEATHER_NAMES), "weather_source": weather_src,
        },
    }
