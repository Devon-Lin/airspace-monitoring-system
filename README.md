# Map-Based Data Visualization

Real-time map visualization of simulated aircraft, restricted zones, and
autonomous drone response. See `Design Analysis.md` for the design
reasoning and `Execution Checklist.md` for what was built and verified.

## Running locally

Requires Docker, Python 3.11+, and Node.js 18+.

### 1. Database

```bash
docker compose up -d postgres
```

### 2. Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
uvicorn config.asgi:application --port 8000
```

### 3. Telemetry generator (in a new terminal)

```bash
cd generator
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py
```

### 4. Frontend (in a new terminal)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Aircraft should appear and start moving within
a few seconds.

No `.env` files are required for local dev. Every setting has a default
matching the values above. Use `.env` files only to override something (see
each service's config file for the full list of variables).

## Deployment

See `DEPLOYMENT.md`.
