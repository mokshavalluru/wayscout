import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Polyline, Circle, CircleMarker, ZoomControl, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";

const j = async (r) => {
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Something went wrong. Try again.");
  return r.json();
};
const geocode = (q, loc) =>
  fetch(`/api/geocode?q=${encodeURIComponent(q)}${loc ? `&lat=${loc.lat}&lng=${loc.lng}` : ""}`).then(j);
const optimize = (body) =>
  fetch("/api/optimize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(j);

const rad = (d) => (d * Math.PI) / 180;
const dist = (a, b) => {   // metres
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(h));
};
const bearing = (a, b) => {   // degrees clockwise from north
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
};
const fmt = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(1)} km`);
const compass = (b) => ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][Math.round(b / 45) % 8];
const ANT_SVG = `<svg class="ant" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
  <g class="legs gA"><path d="M17.2 14.5L11 10L7 12.5"/><path d="M23.4 17.5L30 17L33.5 20"/><path d="M17 20L10.5 24L8 29"/></g>
  <g class="legs gB"><path d="M22.8 14.5L29 10L33 12.5"/><path d="M16.6 17.5L10 17L6.5 20"/><path d="M23 20L29.5 24L32 29"/></g>
  <path class="feel" d="M18.6 6.2Q16 2.5 12.5 3.2M21.4 6.2Q24 2.5 27.5 3.2"/>
  <ellipse cx="20" cy="29" rx="5.4" ry="8" fill="#7c3aed" stroke="#fff" stroke-width="1.2"/>
  <ellipse cx="18.2" cy="26" rx="1.7" ry="4.2" fill="#fff" opacity=".3"/>
  <ellipse cx="20" cy="17.2" rx="3.7" ry="4.4" fill="#6d2fd6" stroke="#fff" stroke-width="1.2"/>
  <circle cx="20" cy="9.4" r="4.1" fill="#7c3aed" stroke="#fff" stroke-width="1.2"/>
  <circle cx="18.5" cy="8.6" r=".9" fill="#fff"/><circle cx="21.5" cy="8.6" r=".9" fill="#fff"/>
</svg>`;
const meIcon = (h, moving) =>
  L.divIcon({
    className: "", iconSize: [40, 40], iconAnchor: [20, 20],
    html: `<div class="me${moving ? " walk" : ""}" style="transform:rotate(${h ?? 0}deg)">${ANT_SVG}</div>`,
  });

const pin = (label, kind) =>
  L.divIcon({ className: "", html: `<div class="pin ${kind}">${label}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] });

function Fit({ points }) {
  const map = useMap();
  useEffect(() => { if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 }); }, [points, map]);
  return null;
}
function MapClick({ onAdd, enabled }) {
  useMapEvents({ click: (e) => { if (enabled) onAdd(e.latlng.lat, e.latlng.lng); } });
  return null;
}
// Flies to the user on the first GPS fix (if no stops yet) and whenever the locate button is pressed.
function Locate({ me, tick, hasStops }) {
  const map = useMap();
  const first = useRef(true);
  useEffect(() => {
    if (me && first.current && !hasStops) map.flyTo([me.lat, me.lng], 15);
    if (me) first.current = false;
  }, [me]);
  useEffect(() => { if (tick && me) map.flyTo([me.lat, me.lng], 16); }, [tick]);
  return null;
}

// The route: a trail that draws itself, with little dots marching along it like ants.
function RouteLine({ positions }) {
  const base = useRef(null);
  useEffect(() => {
    const el = base.current?.getElement?.();
    if (!el?.getTotalLength || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const len = el.getTotalLength();
    el.style.transition = "none";
    el.style.strokeDasharray = len;
    el.style.strokeDashoffset = len;
    el.getBoundingClientRect();   // force a reflow so the transition starts from here
    el.style.transition = "stroke-dashoffset 1.4s ease-out";
    el.style.strokeDashoffset = 0;
    const t = setTimeout(() => { el.style.transition = ""; el.style.strokeDasharray = ""; el.style.strokeDashoffset = ""; }, 1500);
    return () => clearTimeout(t);
  }, [positions]);
  return (
    <>
      <Polyline ref={base} positions={positions} pathOptions={{ color: "#f0a02b", weight: 7, opacity: 0.6, lineCap: "round", lineJoin: "round" }} />
      <Polyline positions={positions} pathOptions={{ color: "#14213d", weight: 4, dashArray: "1 14", lineCap: "round", className: "march" }} />
    </>
  );
}

// Keeps the map centred on the traveller until they drag it away.
function Follow({ me, on, onDrag }) {
  const map = useMap();
  useMapEvents({ dragstart: onDrag });
  useEffect(() => { if (on && me) map.setView([me.lat, me.lng], Math.max(map.getZoom(), 17), { animate: true }); }, [me, on]);
  return null;
}

// Re-measures the map after it grows or shrinks, then re-frames the route.
function Resize({ expanded, points }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    if (points.length) map.fitBounds(points, { padding: [40, 40], maxZoom: 15 });
  }, [expanded]);
  return null;
}

export default function App() {
  const [tab, setTab] = useState("plan");
  const [stops, setStops] = useState([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [none, setNone] = useState(false);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [me, setMe] = useState(null);
  const [locMsg, setLocMsg] = useState("");
  const [tick, setTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [leg, setLeg] = useState(null);      // index of the stop being travelled to, null = no trip
  const [follow, setFollow] = useState(true);
  const [done, setDone] = useState(false);
  const prev = useRef(null);
  const moveAt = useRef(0);
  useEffect(() => {   // the ant stops walking when no new movement arrives
    const t = setInterval(() => setMe((m) => (m && m.moving && Date.now() - moveAt.current > 4000 ? { ...m, moving: false } : m)), 2000);
    return () => clearInterval(t);
  }, []);
  const [fuzzy, setFuzzy] = useState(true);
  const meRef = useRef(null);
  meRef.current = me;

  // Live location
  useEffect(() => {
    if (!navigator.geolocation) { setLocMsg("Location isn't supported on this device."); return; }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const c = p.coords, cur = { lat: c.latitude, lng: c.longitude };
        let h = c.heading;
        if ((h == null || Number.isNaN(h)) && prev.current && dist(prev.current, cur) > 8) h = bearing(prev.current, cur);
        const moved = prev.current && dist(prev.current, cur) > 8;
        if (!prev.current || moved) prev.current = cur;
        if ((c.speed ?? 0) > 0.8 || moved) moveAt.current = Date.now();
        setMe((m) => ({ ...cur, acc: c.accuracy, heading: h == null || Number.isNaN(h) ? m?.heading ?? null : h, moving: Date.now() - moveAt.current < 4000 }));
        setLocMsg("");
      },
      () => setLocMsg("Location is off. Allow it in your browser to see where you are."),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Esc closes the full-screen map
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => e.key === "Escape" && setExpanded(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  // Suggestions while typing (waits 400 ms after the last key press)
  useEffect(() => {
    if (q.trim().length < 3) { setHits([]); setNone(false); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await geocode(q.trim(), meRef.current);
        if (live) { setHits(r); setNone(r.length === 0); setError(""); }
      } catch (err) { if (live) setError(err.message); }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const add = (name, lat, lng) => {
    setStops((s) => [...s, { name: name || `Stop ${s.length}`, lat, lng }]);
    setResult(null); setHits([]); setQ("");
  };
  const startHere = () => {
    setStops((s) => [{ name: "My location", lat: me.lat, lng: me.lng }, ...s]);
    setResult(null);
  };
  const remove = (i) => { setStops((s) => s.filter((_, k) => k !== i)); setResult(null); };
  const setPriority = (i, p) => { setStops((s) => s.map((x, k) => (k === i ? { ...x, priority: p } : x))); setResult(null); };

  const run = async () => {
    setBusy(true); setError("");
    try { setResult(await optimize({ stops, use_fuzzy: fuzzy, hour: new Date().getHours() })); setTab("route"); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  const visit = result ? result.order.map((i) => stops[i]) : stops;
  const targets = result ? [...visit.slice(1), visit[0]] : [];   // each stop in order, then back to start
  const target = leg !== null ? targets[leg] : null;
  const toTarget = target && me ? { d: dist(me, target), b: bearing(me, target) } : null;
  const startTrip = () => { setLeg(0); setFollow(true); setDone(false); };
  const skip = () => (leg + 1 < targets.length ? setLeg(leg + 1) : (setLeg(null), setDone(true)));

  useEffect(() => { if (!result) setLeg(null); }, [result]);
  useEffect(() => {   // arrive at a stop -> move on to the next one
    if (leg === null || !me || !targets[leg]) return;
    if (dist(me, targets[leg]) < Math.max(40, Math.min(me.acc, 100))) skip();
  }, [me]);
  useEffect(() => {   // keep the screen awake while travelling
    if (leg === null || !navigator.wakeLock) return;
    let lock;
    navigator.wakeLock.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => lock?.release();
  }, [leg === null]);

  const points = useMemo(
    () => (result?.geometry?.length ? result.geometry : stops.map((s) => [s.lat, s.lng])),
    [result, stops]
  );

  return (
    <div className="app">
      <div className={`map${expanded ? " full" : ""}`}>
        <MapContainer center={[16.5062, 80.648]} zoom={11} zoomControl={false}>
          <TileLayer attribution="&copy; OpenStreetMap" url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <MapClick onAdd={(la, ln) => add("", la, ln)} enabled={!expanded} />
          <Fit points={points} />
          <Resize expanded={expanded} points={points} />
          <Follow me={me} on={leg !== null && follow} onDrag={() => setFollow(false)} />
          {expanded && <ZoomControl position="topleft" />}
          <Locate me={me} tick={tick} hasStops={stops.length > 0} />
          {me && <Circle center={[me.lat, me.lng]} radius={me.acc} pathOptions={{ color: "#7c3aed", weight: 1, fillOpacity: 0.12 }} />}
          {me && <Marker position={[me.lat, me.lng]} icon={meIcon(me.heading, me.moving)} zIndexOffset={1000} />}
          {result && <RouteLine positions={result.geometry} />}
          {visit.map((s, k) => (
            <Marker key={`${s.lat}${s.lng}${k}`} position={[s.lat, s.lng]} icon={pin(k === 0 ? "S" : k, k === 0 ? "start" : "stop")} />
          ))}
        </MapContainer>
        <button className="locate" onClick={() => { setTick((t) => t + 1); setFollow(true); }} aria-label="Show my location" disabled={!me}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          </svg>
        </button>
        <button className="expand" onClick={() => setExpanded((v) => !v)} aria-pressed={expanded}
          aria-label={expanded ? "Close full-screen map" : "Open full-screen map"}>
          {expanded ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          )}
        </button>
        {expanded && <span className="pill">Tap-to-add is paused</span>}
        {target && (
          <div className="navbar">
            <svg className="navarrow" style={{ transform: `rotate(${toTarget ? toTarget.b : 0}deg)` }} width="34" height="34" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l7 18-7-4-7 4z" />
            </svg>
            <div className="navtxt">
              <b>{leg === targets.length - 1 ? "Back to start" : target.name}</b>
              <span>{toTarget ? `${fmt(toTarget.d)} · head ${compass(toTarget.b)}` : "Waiting for location…"} · {leg + 1}/{targets.length}</span>
            </div>
            <button onClick={skip}>Skip</button>
            <button className="end" onClick={() => setLeg(null)}>End</button>
          </div>
        )}
      </div>

      <div className="panel" role="tabpanel">
        {tab === "plan" && (
          <>
            <h1>Plan your route</h1>
            <form onSubmit={(e) => { e.preventDefault(); if (hits[0]) add(hits[0].name, hits[0].lat, hits[0].lng); }}>
              <div className="row">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a place or address" aria-label="Search a place" autoComplete="off" />
              </div>
            </form>
            {hits.length > 0 && (
              <ul className="sugg">{hits.map((h, i) => (
                <li key={i} className="hit" onClick={() => add(h.name, h.lat, h.lng)}>
                  <span className="name"><b>{h.name}</b><small>{h.label}</small></span>
                </li>))}</ul>
            )}
            {none && <p className="note">No places found. Try a fuller name or tap the map.</p>}
            {error && <p className="msg">{error}</p>}
            {locMsg && <p className="note">{locMsg}</p>}
            {me && !stops.some((s) => s.name === "My location") && (
              <button className="ghost" onClick={startHere}>Start from my location</button>
            )}
            <p className="note">The first stop is your start. You can also tap the map to add stops.</p>
            <ul>{stops.map((s, i) => (
              <li key={i}>
                <span className={`badge ${i === 0 ? "start" : "stop"}`}>{i === 0 ? "S" : i}</span>
                <span className="name">{s.name}</span>
                {i > 0 && (
                  <select value={s.priority ?? 1} onChange={(e) => setPriority(i, +e.target.value)} aria-label={`Priority for ${s.name}`}>
                    <option value={1}>Normal</option><option value={2}>High</option><option value={3}>Urgent</option>
                  </select>
                )}
                <button className="x" onClick={() => remove(i)} aria-label={`Remove ${s.name}`}>Remove</button>
              </li>))}</ul>
            <label className="toggle">
              <input type="checkbox" checked={fuzzy} onChange={(e) => setFuzzy(e.target.checked)} />
              Use fuzzy traffic, weather and priority scoring
            </label>
            <button className="go" disabled={stops.length < 2 || busy} onClick={run}>
              {busy ? "Finding the best route…" : "Optimize route"}
            </button>
          </>
        )}

        {tab === "route" && (
          <>
            <h1>Optimized route</h1>
            {!result ? <p className="note">Add at least two stops on the Plan tab, then optimize.</p> : (
              <>
                <div className="stats">
                  <div className="stat"><b>{result.distance_km} km</b><span>Total distance</span></div>
                  <div className="stat"><b>{result.duration_min} min</b><span>Driving time</span></div>
                </div>
                {leg === null && (
                  <button className="go" disabled={!me} onClick={startTrip}>{me ? "Start trip" : "Turn on location to start"}</button>
                )}
                {done && <p className="note">Trip complete. You're back at the start.</p>}
                {result.source === "estimate" && <p className="note">Road data was unavailable, so distances are straight-line estimates.</p>}
                <ul>{visit.map((s, k) => (
                  <li key={k}>
                    <span className={`badge ${k === 0 ? "start" : "stop"}`}>{k === 0 ? "S" : k}</span>
                    <span className="name">{s.name}</span>
                  </li>))}</ul>
              </>
            )}
          </>
        )}

        {tab === "conditions" && (
          <>
            <h1>Conditions</h1>
            {result?.history?.length > 1 ? (
              <>
                <p className="note">How the ants shortened the route over {result.history.length - 1} rounds.</p>
                <Spark data={result.history} />
              </>
            ) : <p className="note">Optimize a route to see how the search improved it.</p>}
            {result?.conditions ? (
              <>
                <div className="cond">
                  <div className="stat"><b>{result.conditions.traffic_label}</b><span>Traffic {result.conditions.traffic}/10 at {result.conditions.hour}:00</span></div>
                  <div className="stat">
                    <b>{result.fuzzy ? result.conditions.weather_label : "Not used"}</b>
                    <span>{result.fuzzy ? `Weather ${result.conditions.weather}/10${result.conditions.weather_source === "live" ? "" : " (no live data)"}` : "Fuzzy scoring is off"}</span>
                  </div>
                </div>
                <p className="note">
                  {result.fuzzy
                    ? "Fuzzy logic scored every road leg using distance, traffic, weather and stop priority. The ants then searched for the cheapest route. Driving time includes a traffic slowdown estimate."
                    : "Fuzzy scoring was off, so this route uses road distance only."}
                </p>
              </>
            ) : <div className="later">Optimize a route to see traffic and weather conditions.</div>}
          </>
        )}
      </div>

      <div className="tabs" role="tablist">
        {[["plan", "Plan"], ["route", "Route"], ["conditions", "Conditions"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

function Spark({ data }) {
  const lo = Math.min(...data), hi = Math.max(...data), span = hi - lo || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 300},${85 - ((v - lo) / span) * 80}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 300 90" preserveAspectRatio="none" role="img" aria-label="Best route length per round">
      <polyline points={pts} fill="none" stroke="#f0a02b" strokeWidth="3" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}