"""Build data/traffic_profile.csv from the UCI 'Metro Interstate Traffic Volume' file.

Run from the backend folder:
    python tools/build_profile.py Metro_Interstate_Traffic_Volume.csv      (.csv, .csv.gz or .zip all work)
The busiest hour of the day becomes 10, every other hour is scaled against it.
"""
import csv
import gzip
import io
import os
import sys
import zipfile
from collections import defaultdict


def open_text(path):
    if path.endswith(".gz"):
        return io.TextIOWrapper(gzip.open(path), encoding="utf-8")
    if path.endswith(".zip"):
        z = zipfile.ZipFile(path)
        return io.TextIOWrapper(z.open(next(n for n in z.namelist() if n.endswith(".csv"))), encoding="utf-8")
    return open(path, newline="", encoding="utf-8")


if len(sys.argv) != 2:
    sys.exit("Usage: python tools/build_profile.py <path to Metro_Interstate_Traffic_Volume file>")

sums, counts = defaultdict(float), defaultdict(int)
with open_text(sys.argv[1]) as f:
    for row in csv.DictReader(f):
        h = int(row["date_time"][11:13])          # "2012-10-02 09:00:00" -> 9
        sums[h] += float(row["traffic_volume"])
        counts[h] += 1

avg = {h: sums[h] / counts[h] for h in range(24)}
top = max(avg.values())
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "traffic_profile.csv")
with open(out, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["hour", "congestion"])
    for h in range(24):
        w.writerow([h, round(10 * avg[h] / top, 1)])
print("Wrote", os.path.abspath(out))
