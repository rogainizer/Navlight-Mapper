# Navlight Mapper

Offline-first web app for field mapping with GPS, photo capture, and online sync.

## Features
- Offline JPEG map storage (IndexedDB)
- In-app 3-point map calibration
- Live GPS position display on calibrated map
- Manual start/stop movement tracking
- Multiple photo capture tied to current location
- Queue-based sync to Node/Express API + MySQL
- Mobile and large-screen responsive layout
- Docker image deployment with Docker Compose

## Project Layout
- `frontend/` Vue + Vite PWA app
- `server/` Express + MySQL sync API
- `docker-compose.yml` full-stack orchestration

## Run With Docker
1. Build and start all services:
   ```bash
   docker compose up --build
   ```
2. Open app:
   - Frontend: `http://localhost:8080`
   - API health: `http://localhost:3000/api/health`

## Run Locally Without Docker
### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Server
```bash
cd server
npm install
npm run dev
```

Configure server with values from `server/.env.example`.

Photo upload storage location is configurable with `UPLOAD_DIR`.

- Local run example: `UPLOAD_DIR=./uploads`
- Absolute path example: `UPLOAD_DIR=C:/data/navlight-uploads`

## Notes
- The API auto-creates schema tables at startup.
- Uploaded photos are stored under `UPLOAD_DIR` (defaults to `./uploads` for local runs).
- Docker Compose defaults to `${SERVER_UPLOAD_DIR:-/app/uploads}` for the server's in-container upload path.
- Docker Compose storage source is configurable via `${UPLOADS_VOLUME_SOURCE:-uploads-data}`.
- Example host bind path: `UPLOADS_VOLUME_SOURCE=./data/uploads`
- Sync endpoint: `POST /api/sync/batch`.
