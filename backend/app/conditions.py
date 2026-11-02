"""Traffic (time-of-day profile) and weather (Open-Meteo, no API key) on a 0-10 scale."""
import csv
import os
from datetime import datetime

import httpx

# Typical city rush-hour curve, used when data/traffic_profile.csv is missing or invalid.
DEFAULT_PROFILE = [1, 1, 1, 1, 1, 2, 3, 5, 8, 7, 5, 4, 4, 4, 4, 5, 6, 8, 9, 8, 6, 4, 3, 2]
PROFILE_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "traffic_profile.csv")


def load_profile():
    try:
        with open(PROFILE_CSV, newline="") as f:
            rows = {int(r["hour"]): float(r["congestion"]) for r in csv.DictReader(f)}
        return [min(10.0, max(0.0, rows[h])) for h in range(24)]
    except Exception:
        return [float(v) for v in DEFAULT_PROFILE]


PROFILE = load_profile()


def traffic_level(hour=None):
    h = datetime.now().hour if hour is None else hour % 24
    return PROFILE[h], h


async def weather_level(lat, lng):
    """Rain and wind now at the start point -> severity 0-10. Falls back to 0 if offline."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get("https://api.open-meteo.com/v1/forecast",
                            params={"latitude": lat, "longitude": lng, "current": "precipitation,wind_speed_10m"})
            r.raise_for_status()
            cur = r.json()["current"]
        severity = 2 * cur["precipitation"] + 0.15 * max(0.0, cur["wind_speed_10m"] - 20)
        return round(min(10.0, severity), 1), "live"
    except Exception:
        return 0.0, "unavailable"


def label(value, names):
    return names[0] if value < 3 else names[1] if value < 6 else names[2]


TRAFFIC_NAMES = ("Light", "Moderate", "Heavy")
WEATHER_NAMES = ("Clear", "Unsettled", "Severe")
