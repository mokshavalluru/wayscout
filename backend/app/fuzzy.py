"""Mamdani fuzzy inference that turns (distance, traffic, weather, priority) into an edge cost.

No external fuzzy library: only numpy, so it installs cleanly on any Python version.
"""
import numpy as np

BIG = 1e9


def trap(x, a, b, c, d):
    """Trapezoid membership: 0 below a, rises to 1 at b, stays 1 until c, falls to 0 at d."""
    x = np.asarray(x, dtype=float)
    up = np.clip((x - a) / (b - a), 0, 1) if b > a else (x >= b).astype(float)
    down = np.clip((d - x) / (d - c), 0, 1) if d > c else (x <= c).astype(float)
    return np.minimum(up, down)


# Input sets: name -> (a, b, c, d)
SETS = {
    "dist":    {"short": (-BIG, -BIG, 1, 4), "medium": (1, 4, 4, 10), "long": (4, 10, BIG, BIG)},   # km
    "traffic": {"low": (-BIG, -BIG, 2, 5), "moderate": (2, 5, 5, 8), "heavy": (5, 8, BIG, BIG)},    # 0-10
    "weather": {"clear": (-BIG, -BIG, 1, 3), "unsettled": (1, 3, 3, 6), "severe": (3, 6, BIG, BIG)},  # 0-10
    "prio":    {"normal": (-BIG, -BIG, 1, 2), "high": (1, 2, 2, 3), "urgent": (2, 3, BIG, BIG)},     # 1-3
}
# Output "effort" on 0..1
OUT = {"low": (0, 0, 0.15, 0.4), "medium": (0.2, 0.5, 0.5, 0.8),
       "high": (0.5, 0.75, 0.75, 1.0), "very_high": (0.75, 1.0, 1.0, 1.0)}

RULES = [
    ([("traffic", "heavy"), ("dist", "long")], "very_high"),
    ([("traffic", "heavy"), ("dist", "medium")], "high"),
    ([("traffic", "heavy"), ("dist", "short")], "medium"),
    ([("traffic", "moderate"), ("dist", "long")], "high"),
    ([("traffic", "moderate"), ("dist", "medium")], "medium"),
    ([("traffic", "moderate"), ("dist", "short")], "low"),
    ([("traffic", "low"), ("dist", "long")], "medium"),
    ([("traffic", "low"), ("dist", "medium")], "low"),
    ([("traffic", "low"), ("dist", "short")], "low"),
    ([("weather", "severe"), ("dist", "long")], "very_high"),
    ([("weather", "severe")], "high"),
    ([("weather", "unsettled"), ("dist", "long")], "high"),
    ([("weather", "unsettled")], "medium"),
    ([("prio", "urgent")], "low"),
    ([("prio", "high"), ("traffic", "low")], "low"),
]
Y = np.linspace(0, 1, 101)


def effort(dist_km, traffic, weather, prio):
    """dist_km and prio are (n, n) arrays; traffic and weather are single numbers. Returns (n, n) in 0..1."""
    shape = dist_km.shape
    vals = {"dist": dist_km, "traffic": traffic, "weather": weather, "prio": prio}
    mu = {(v, k): np.broadcast_to(trap(vals[v], *p), shape) for v, sets in SETS.items() for k, p in sets.items()}
    fire = {k: np.zeros(shape) for k in OUT}
    for antecedents, out in RULES:
        strength = np.minimum.reduce([mu[a] for a in antecedents])   # AND = min
        fire[out] = np.maximum(fire[out], strength)                  # same output from several rules = max
    agg = np.max([np.minimum(fire[k][..., None], trap(Y, *OUT[k])) for k in OUT], axis=0)
    area = agg.sum(-1)
    return np.where(area > 1e-9, (agg * Y).sum(-1) / np.maximum(area, 1e-9), 0.5)   # centroid


def fuzzy_cost(dist_km, priorities, traffic, weather):
    """Edge cost = real distance x (0.6 .. 2.0). Urgent stops get cheaper, bad conditions get dearer."""
    d = np.asarray(dist_km, dtype=float)
    prio = np.tile(np.asarray(priorities, dtype=float), (len(d), 1))   # priority of the destination stop
    return d * (0.6 + 1.4 * effort(d, traffic, weather, prio))
