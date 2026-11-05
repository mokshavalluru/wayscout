# WayScout (Python + React)

Backend (FastAPI, Ant Colony Optimization):
    cd backend
    python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    uvicorn app.main:app --reload --port 8000           # docs at http://localhost:8000/docs

Frontend (React + Leaflet):
    cd frontend
    npm install
    npm run dev                                         # http://localhost:5173 (proxies /api to :8000)

Notes: place search uses photon and road distances use the public OSRM demo server (light use only).
If OSRM is unreachable the backend falls back to straight-line distance x 1.3 and says so in the response.
Fuzzy logic plugs in later by replacing the distance matrix with fuzzy edge costs before calling solve().
