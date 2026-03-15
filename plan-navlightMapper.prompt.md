## Plan: Offline GPS Photo Mapper

Build a greenfield Vue + Vite PWA frontend and Node/Express + MySQL backend that supports: offline JPEG map usage, in-app map calibration, live GPS location, manual start/stop movement tracking, offline photo capture linked to coordinates, online batch sync of photos/locations to server disk + MySQL metadata, responsive UX optimized for mobile phones and large screens, and deployment using Docker images.

**Steps**
1. Phase 1: Project Foundation (*no dependencies*)
2. Initialize `frontend` (Vue 3 + Vite + TypeScript + PWA plugin) and `server` (Express + TypeScript + MySQL client + multer) workspaces with shared env/config conventions and a responsive design baseline (mobile-first layout, scalable spacing/typography tokens, and breakpoint strategy).
3. Set up baseline runtime contracts: client-generated UUIDs for every track point/photo, `syncStatus` flags (`pending`, `syncing`, `synced`, `failed`), and API error shape used by both apps.
4. Add PWA app shell support (service worker + manifest) so the UI loads offline after first online visit, and implement adaptive shell navigation that switches between bottom action bar (mobile) and side/top controls (large screens).
5. Phase 2: Offline Map Download + Calibration (*depends on Phase 1*)
6. Implement map download flow to fetch JPEG while online and store map blob + metadata locally (IndexedDB), scoped to `mapId` (expected volume: 1-3 maps).
7. Build calibration UI: user selects at least 3 control points on image and enters GPS coordinates; persist control points per `mapId`.
8. Implement affine transform utility to convert GPS <-> image pixel coordinates using stored control points; add residual error check and user warning if calibration quality is poor.
9. Render map image with overlays (current location, tracked path, photo markers) using the calibrated transform, with interactions tuned for both touch (mobile) and pointer/keyboard (large screens).
10. Phase 3: GPS + Tracking + Photo Capture Offline (*depends on Phase 2*)
11. Implement geolocation service (`watchPosition`) with permission/error handling and configurable update interval/accuracy.
12. Add movement tracking controls: manual start/stop toggle, create track session, append filtered GPS points to local store, and draw live path on map.
13. Implement photo capture flow supporting multiple photos at same current location; persist photo blob + thumbnail + linked coordinate + timestamp in IndexedDB.
14. Add offline-first UX states: permission denied, GPS unavailable, storage quota warning, explicit pending-sync counters, and responsive control layouts that keep primary actions reachable on small screens.
15. Phase 4: Client Sync Engine (*depends on Phase 3; parallel with backend Phase 5 once API contract is fixed*)
16. Build sync queue processor that runs when online (or via manual `Sync now`) and uploads pending records in bounded batches.
17. Use idempotent upload payloads (client UUIDs, `batchId`) so retries do not duplicate server records.
18. Implement retry/backoff + dead-letter handling on repeated failures, leaving failed records visible and retryable from UI.
19. Mark local records as synced only after server acknowledgment; keep immutable audit fields (`createdAt`, `syncedAt`, `lastError`).
20. Phase 5: Server Ingestion + Persistence (*parallel with client Phase 4 after contracts agreed; blocks final integration*)
21. Create multipart upload endpoint(s) for batched photos + location metadata and track points.
22. Save photo binaries to local disk under deterministic paths (e.g., by upload date/client UUID) and store file path + metadata in MySQL.
23. Create MySQL schema for `maps`, `tracks`, `track_points`, `photos`, `sync_batches` with uniqueness constraints on client UUIDs for dedupe.
24. Add server-side validation: file size/type limits, coordinate bounds, required calibration/map references, and transactional writes per batch.
25. Return per-item result statuses so client can reconcile partial failures without losing successful items.
26. Phase 6: Integration + Hardening (*depends on Phases 4 and 5*)
27. Wire frontend API client to backend contracts and validate end-to-end sync for mixed batches (track points + photos).
28. Add operational safeguards: upload limits, disk space checks, structured logs for sync failures, migration scripts, and Docker image tagging/versioning rules.
29. Confirm offline continuity across reloads/restarts (data and map still available, pending sync preserved), and validate containerized runtime using Docker Compose.
30. Phase 7: Verification (*depends on all prior phases*)
31. Add unit tests for affine transform math, GPS point filtering, and sync queue state transitions.
32. Add integration tests for upload endpoints: success path, duplicate retry path, partial failure path, and invalid payload path.
33. Run manual acceptance tests on mobile and large-screen browsers: offline map display, live current location, photo-at-location capture, movement tracking start/stop, reconnect + successful sync, and layout/usability at each breakpoint.

**Relevant files**
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/package.json` - frontend dependencies/scripts (Vue, PWA, map rendering, IndexedDB helpers).
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/vite.config.ts` - PWA plugin/service worker integration and build settings.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/App.vue` - app shell layout, sync status, top-level state orchestration.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/styles/responsive.css` - mobile-first breakpoints, touch target sizing, and desktop layout rules.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/components/MapView.vue` - JPEG map render + overlays (current position, path, photo markers).
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/components/CalibrationView.vue` - control-point capture UI and calibration persistence.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/components/TrackingControls.vue` - manual start/stop tracking controls and session status.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/components/PhotoCapturePanel.vue` - multi-photo capture and attachment to current location.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/services/geolocationService.ts` - geolocation watch lifecycle and permission/error handling.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/services/calibrationService.ts` - affine transform creation and coordinate conversion utilities.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/services/syncService.ts` - queued upload processor, retries, and reconciliation.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/src/db/indexedDb.ts` - IndexedDB schema/stores for maps, track points, photos, sync batches.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/package.json` - backend dependencies/scripts.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/src/index.ts` - server bootstrap and middleware wiring.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/src/routes/syncRoutes.ts` - upload/status endpoints for track/photo batch ingestion.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/src/services/storageService.ts` - local-disk file persistence strategy and path generation.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/src/services/syncIngestService.ts` - payload validation, dedupe, and transactional DB writes.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/src/db/migrations/001_init.sql` - MySQL tables and indexes for maps/tracks/points/photos/batches.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/uploads/` - runtime photo binary storage root.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/frontend/Dockerfile` - production frontend image build.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/server/Dockerfile` - API image build with runtime deps.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/docker-compose.yml` - local/prod-like multi-container orchestration for frontend, API, and MySQL.
- `c:/Users/dougl/Documents/Rogaine/Navlight-Mapper/.dockerignore` - image build context optimization.

**Verification**
1. Frontend offline check: install/load app once online, then switch browser to offline mode and verify app shell + selected JPEG map still render.
2. GPS check: verify current position marker updates with `watchPosition` and shows permission/accuracy status.
3. Tracking check: start tracking, move location (real/simulated), stop tracking, confirm persisted polyline reloads after refresh.
4. Photo check: capture multiple photos at one point and at multiple points while offline; confirm local markers and photo counts match stored records.
5. Sync check: reconnect online, trigger sync, verify pending count drops to zero and no duplicate inserts on repeated sync attempts.
6. Server check: confirm uploaded files exist under `server/uploads/` and corresponding metadata rows exist in MySQL for tracks, points, photos, and batches.
7. Failure-path check: force one invalid photo and verify partial batch handling marks only failed item(s) for retry while successful items stay synced.
8. Responsive UX check: validate in portrait/landscape mobile and large desktop widths that map, controls, camera flow, and sync actions remain usable without overlap or hidden primary actions.
9. Container deployment check: build frontend and server Docker images, run `docker compose up`, and verify API, DB, and uploads volume persistence all work end-to-end.

**Decisions**
- Chosen stack: Vue + Vite PWA frontend, Node/Express backend, MySQL.
- Offline map model: downloadable JPEG map (not tile-based maps), with in-app 3-point calibration.
- Device map volume: 1-3 maps per user.
- Initial server file storage: local disk; MySQL stores metadata and references.
- Auth scope: no login/auth in MVP.
- Deployment model: Docker images for frontend and server, orchestrated with Docker Compose.
- Included scope: offline capture and queueing, online sync, location display, movement tracking, calibration UI, and responsive UX for mobile phones and large screens.
- Excluded scope: background tracking while app is closed, multi-user auth/roles, cloud object storage, GIS-grade map toolchain.

**Further Considerations**
1. Migration path: design `storageService` behind an interface now so moving from local disk to S3 later is a config change, not a schema rewrite.
2. Data retention: define optional auto-archive/purge policy for old local photos to prevent long-term device storage pressure.
3. Accuracy policy: define a minimum acceptable GPS accuracy threshold before allowing photo capture (for example, warn if accuracy is worse than 30m).
