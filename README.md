# Navlight Mapper

Offline-first web app for field mapping with GPS, photo capture, and online sync.

## Features
- Server-backed map library with calibration persistence
- Single offline JPEG map cache (IndexedDB)
- In-app 3-point map calibration
- Live GPS position display on calibrated map
- Manual start/stop movement tracking
- Multiple photo capture tied to current location
- Text comments tied to current GPS or map-selected location
- Queue-based sync to Node/Express API + MySQL
- Online route creation (name, color, map-selected points)
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

## Map Workflow
1. Go online and open Map Selection.
2. In Server Map, choose one of:
   - Existing server map (loads it for use)
   - Create new map (shows map name + file/URL import controls)
3. For Create new map: enter map name, load a local image or download from URL.
4. Calibrate the map using 3 control points.
5. Click Save Calibration to persist the new map and calibration details.

Important behavior:
- The map is persisted only when calibration is saved.
- Map image bytes are stored as-is on the server (no resize/transcode).
- The app keeps one offline map at a time; selecting/saving another map replaces the previous offline cache.
- Loading a new map from file or URL clears local browser map data (offline map, calibration, tracks, points, and photos) before starting calibration.
- The app asks for confirmation before clearing local browser data for a new map load.
- Existing maps are chosen from the server list while online.
- Selecting an existing server map also downloads all server photos and photo locations for that map into local browser cache.
- Route creation is online-only and only available for saved calibrated maps.
- Route points are selected by tapping the map and are saved to the server with route name and color.
- Routes can be removed while online from the route list in the Create Route panel.
- Comments can be added offline at current GPS or map-selected location and are synced in the same queue flow as photos.
- Tapping a comment marker opens a popup where comments can be edited or deleted.
- Editing works offline (queued for sync); deleting comments requires online mode.
- If photo and comment markers overlap at the tapped location, the app prompts you to choose which marker type to open.
- If current GPS is outside map bounds, photo and comment location modes default to map selection.
- When an existing server map is selected, create/import controls and calibration details for new-map creation are hidden.
- Server data is not deleted when local browser data is cleared.

Map endpoints:
- `GET /api/maps`
- `GET /api/maps/:mapId/image`
- `GET /api/maps/:mapId/photos`
- `GET /api/maps/:mapId/comments`
- `PUT /api/maps/:mapId/comments/:commentId`
- `DELETE /api/maps/:mapId/comments/:commentId`
- `GET /api/maps/:mapId/routes`
- `POST /api/maps`
- `POST /api/maps/:mapId/routes`
- `DELETE /api/maps/:mapId/routes/:routeId`
- `PUT /api/maps/:mapId/calibration`

## GitHub Droplet Deploy

This repository now includes a GitHub Actions deploy workflow at .github/workflows/deploy-droplet.yml.

Trigger mode:
- Manual only (run via GitHub Actions "Run workflow").

What it does:
- Builds and pushes frontend and backend images to GHCR.
- Uploads the deploy bundle under deploy/ to the droplet.
- Runs an idempotent SQL migration script against your existing MySQL database.
- Pulls and starts the frontend/backend with Docker Compose on the droplet.

Deployment files:
- deploy/docker-compose.droplet.yml
- deploy/sql/001_navlight_mapper_migration.sql
- deploy/scripts/deploy-on-droplet.sh
- deploy/caddy/planner.rogainizer.com.Caddyfile

Required GitHub repository secrets:
- DROPLET_HOST
- DROPLET_USER
- DROPLET_SSH_KEY
- DROPLET_PORT (optional, defaults to 22)
- GHCR_READ_USER
- GHCR_READ_TOKEN (PAT with read:packages)
- DB_HOST
- DB_PORT
- DB_USER
- DB_PASSWORD
- DB_NAME
- CADDY_DOCKER_NETWORK (optional, defaults to caddy)
- UPLOADS_VOLUME_SOURCE (optional, defaults to /opt/navlight-mapper/uploads)
- SERVER_UPLOAD_DIR (optional, defaults to /app/uploads)

Optional GitHub repository variable:
- DEPLOY_PATH (default /opt/navlight-mapper)

Caddy routing:
- If your droplet uses caddy-docker-proxy, deploy/docker-compose.droplet.yml already includes labels for planner.rogainizer.com.
- If your droplet uses a static Caddyfile, use deploy/caddy/planner.rogainizer.com.Caddyfile and ensure Caddy is on the same Docker network as navlight-mapper-frontend.

Note:
- Frontend already proxies /api and /uploads to the backend service internally, so planner.rogainizer.com only needs to reverse proxy to navlight-mapper-frontend:80.

## Test Map

https://rogaine-results.com/2026/akaroa-rogaine/6hr/map.jpg

Point 1 X 858.2  Y 623.5  Lat -43.739000 Lng 172.972000
Point 2 X 1686.8 Y 1185.1 Lat -43.787000 Lng 173.008000
Point 3 X 564.5  Y 1103.8 Lat -43.746000 Lng 172.921000 
