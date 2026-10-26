# Smart Farm Backend

Express and MongoDB Atlas API server for a Next.js dashboard and an RDK X5 device.

## Start

1. Copy `.env.example` to `.env` and provide the MongoDB Atlas URI, JWT secret, and RDK gateway URL.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm start` for production.

The server exposes `GET /health` without authentication.
## Demo data

Run `npm run seed:demo` to create a repeatable front-end test account, four plants (lettuce, tomato, strawberry, and basil), seven days of 10-minute sensor logs, completed water-command history, activity counters, and notifications. The command refreshes data only for `demo@smartfarm.local` and its demo plants. It leaves camera and zone assignments unset because these sample crops do not prove a physical planting.

- Email: `demo@smartfarm.local`
- Password: `demo1234!`

## Authentication

Web endpoints require `Authorization: Bearer <accessToken>`, received from login or signup. RDK endpoints are intended for a private network and do not use an application-level API key.

Local account signup accepts `{ "email", "phone", "pwd" }`; `pwd` must be at least eight characters. Social authentication needs provider-token verification and is deliberately not exposed through the local-password endpoints.

## API

| Method | Endpoint | Auth | Request body |
| --- | --- | --- | --- |
| POST | `/api/web/users/signup` | - | `name?`, `email`, `phone?`, `pwd` |
| POST | `/api/web/users/login` | - | `email`, `pwd` |
| GET | `/api/web/users/me` | Bearer | - |
| PATCH | `/api/web/users/password` | Bearer | `currentPwd`, `newPwd` |
| POST | `/api/web/plants` | Bearer | `name`, `type`, `rdkCameraId?`, `rdkZone?`, `growthTargetDays?` |
| GET | `/api/web/plants` | Bearer | - |
| GET | `/api/web/plants/with-records` | Bearer | - |
| GET | `/api/web/plants/:plantId` | Bearer | - |
| PATCH | `/api/web/plants/:plantId` | Bearer | `name?`, `type?`, `rdkCameraId?`, `rdkZone?`, `growthTargetDays?` |
| GET | `/api/web/plants/:plantId/current` | Bearer | - |
| POST | `/api/rdk/current` | RDK API Key | `plantId`, current sensor fields, `sampledAt` |
| GET | `/api/web/logs/:plantId?page=1&limit=30` | Bearer | - |
| POST | `/api/web/events` | Bearer | multipart: `plantId`, `title`, `content`, `eventDate?`, `image?` |
| GET | `/api/web/events/:plantId?page=1&limit=30&order=desc` | Bearer | - |
| GET | `/api/web/water/:plantId?page=1&limit=30` | Bearer | - |
| POST | `/api/web/control/water` | Bearer | `plantId`, `volume` |
| GET | `/api/web/activity` | Bearer | - |
| POST | `/api/web/activity/harvest` | Bearer | `plantId` |
| POST | `/api/web/notifications` | Bearer | `title`, `type`, `content`, `notifyAt?` |
| GET | `/api/web/notifications?page=1&limit=30&unreadOnly=false&includeSensor=false` | Bearer | SENSOR 알림 기본 제외, `includeSensor=true`로 포함 |
| PATCH | `/api/web/notifications/:notificationId/read` | Bearer | - |
| GET | `/api/web/admin/cameras` | Admin Bearer | RDK 카메라 목록 |
| GET | `/api/web/admin/cameras/:cameraId/raw` | Admin Bearer | 보정 전 원본 JPEG 1프레임 |
| GET | `/api/web/admin/cameras/:cameraId/frame/:mode` | Admin Bearer | 원본·보정·6×3 그리드 JPEG. `mode=raw/corrected/grid` |
| GET | `/api/web/admin/cameras/:cameraId/status` | Admin Bearer | 프라이버시 상태와 카메라 원본/출력 해상도 |
| GET | `/api/web/admin/cameras/status` | Admin Bearer | 전체 카메라 프레임 수신 상태 |
| GET/PATCH | `/api/web/admin/alerts` | Admin Bearer | Discord 알림 설정 조회/수정 |
| POST | `/api/web/admin/alerts/test` | Admin Bearer | Discord 테스트 알림 전송 |
| GET | `/api/web/admin/cameras/:cameraId/profile` | Admin Bearer | 카메라 송출 FPS 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/profile` | Admin Bearer | 고정 송출 규격 15 FPS 확인(다른 값은 400) |
| GET | `/api/web/admin/cameras/:cameraId/calibration` | Admin Bearer | 현재 18개 셀 좌표 |
| PUT | `/api/web/admin/cameras/:cameraId/calibration` | Admin Bearer | `zones` 전체 18개 셀 좌표 저장 |
| GET | `/api/web/admin/cameras/:cameraId/grid-layouts` | Admin Bearer | 식물별 사용자 지정 영역의 두 앵커와 영역 번호 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/grid-layouts` | Admin Bearer | 최대 144개 영역 배치 저장; 영역 하나가 식물 영상 하나 |
| PATCH | `/api/web/admin/plants/:plantId/camera` | Admin Bearer | 식물을 카메라/영역에 배정 또는 해제 |
| PATCH | `/api/web/admin/plants/:plantId/irrigation` | Admin Bearer | 식물을 Pi/사출구/펌프에 배정 또는 해제 |
| POST | `/api/web/admin/irrigation/commands/:commandId/acknowledge` | Admin Bearer | 현장 확인 후 불확실한 급수 명령 잠금 해제 |
| GET | `/api/web/control/water/:commandId` | User Bearer | 급수 명령 상태 조회 |
| GET | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 베드 평면화 4점 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 원본 기준 네 모서리 저장·즉시 적용 |
| DELETE | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 사용자 보정 초기화, 기존 자동 보정 복귀 |
| POST | `/api/rdk/logs` | RDK API key | `plantId`, `degree`, `moisture_soil`, `moisture_air`, `rux` |
| GET | `/api/rdk/command/:plantId` | RDK API key | Pi: `X-Irrigation-Device-Id` |
| GET | `/api/rdk/commands/active` | RDK API key | Pi: `X-Irrigation-Device-Id` |
| POST | `/api/rdk/command/:commandId/fail` | RDK API key | `reason`, `uncertain`, `estimatedVolume?` |
| POST | `/api/rdk/water` | RDK API key | `plantId`, `commandId`, `volume` |

All persistent models use `timestamps: true`, so MongoDB stores `createdAt` and `updatedAt` automatically.

## RDK sensor flow

The RDK gateway collects ESP32 readings every two seconds. For active camera-zone assignments it pushes a plant-specific latest snapshot every 60 seconds to `POST /api/rdk/current`, while ten-minute averages remain in `POST /api/rdk/logs`. `rux` is `null` when no light sensor is connected.

For an on-demand reading, the web client calls `GET /api/web/plants/:plantId/current` with its Bearer token. After ownership validation, the backend returns the latest snapshot from MongoDB; snapshots older than three minutes return `503`. No request from Render back to the RDK sensor port is needed.

For the current RDK X5 deployment, configure `RDK_STREAM_BASE_URL` as `http://<RDK_X5_TAILSCALE_IP>:5001`, `RDK_STREAM_ADMIN_KEY`, and Render's internal Tailscale HTTP proxy as `RDK_HTTP_PROXY_HOSTPORT`. Set each plant's `rdkCameraId` and `rdkZone`; the backend requests a per-plant assignment and returns a short-lived signed `streamingUrl` from `GET /api/web/plants/:plantId`. Render proxies MJPEG so the browser never needs Tailnet access.
The ready-to-run RDK sample is at [`rdk/rdk_gateway.py`](rdk/rdk_gateway.py). Install its packages with `pip install -r rdk/requirements.txt`, then configure its environment variables before starting it.

The administrator page at `/admin/` has a `카메라 설정` screen for source, bed-plane flattening, corrected, and numbered region views. Drag four circles from the tray below the raw video to set perspective corners. Drag two triangles from the tray below the corrected video to place each plant region. One rectangle creates one plant crop; up to 144 regions can be saved per camera, with stable region IDs matching zone numbers. The `스트리밍` admin screen assigns each plant to an available camera region. Existing assigned zones cannot be removed until the plants are moved. The earlier individual cell editor remains available for the original eighteen-cell layout. User-facing output is fixed at 1280×720 and 15 FPS. These endpoints are protected by the administrator JWT and backend-to-RDK `RDK_STREAM_ADMIN_KEY`.

The same camera settings screen also has a **실제 재배 배치** map. It stores operator-entered crop hints independently from subscribed `Plant` records in one MongoDB `BedLayout` document. Every camera has exactly 18 row-major cells matching its RDK zone number; the admin displays them as 6 columns by 3 rows. The bulk editor accepts three rows of six values per camera. The camera number and API/DB ID now match: 캠1=`c110-1` (top-right), 캠2=`c110-2` (top-left), 캠3=`c110-3` (bottom-left), 캠4=`c110-4` (bottom-right); the physical map is `2 1 / 3 4`. The RDK `/api/availability` response includes every configured image `zone_id` alongside its existing free `zones`, so the admin can warn when the crop map references a missing video region. This crop map is reference data only: it does not create subscriptions or modify RDK assignment.

To load a reviewed, complete 72-cell layout from JSON, run `npm run seed:bed-layout -- --file <layout.json>` to validate it without connecting to MongoDB. Add `--apply` to save only when no `main-farm` layout exists; `--apply --force` explicitly replaces the existing four-camera layout. The JSON must be `{ "cameras": [...] }`, with all four existing camera IDs, 18 ordered cells per camera, and each `productId` set to a catalog ID or `null`. This seed command only updates `BedLayout`; it does not modify plants or camera assignments.

### Strict plant-assignment reconciliation

`GET /api/assignments` on the RDK is an admin-key-protected, read-only assignment snapshot. `PUT /api/assignments/reconcile` atomically replaces the SQLite assignment set only when `expected_assignments` still matches the full current set. Existing plant IDs whose camera/zone do not change keep their stream-token nonce; moved or unassigned plants receive no valid old stream token. The RDK service was updated from `RDKx5/main_service.py` and `RDKx5/features/streaming/assignments.py` on 2026-10-27. `smartfarm-main.service` is active, `/api/availability` returns HTTP 200, and unauthenticated `GET /api/assignments` returns HTTP 401 as expected. Production plant assignments were not changed. Before running reconciliation, confirm the backend's `RDK_STREAM_BASE_URL` points to this service version.

Run `node scripts/reconcilePlantAssignments.js` from `rootBackend` for a read-only MongoDB/RDK dry-run. The command prints each plant, exact match method, target or unassignment reason, summary and a SHA-256 `planHash`; it requires live MongoDB/RDK connectivity and stops if their existing assignments differ. Existing unassigned plants are reported as unassigned and are not added to the move set. Order-linked plants match only the linked `Order.productId`; demo plants match only when `Plant.name` or `Plant.type` is an exact catalog product name. Crop families, substrings, and aliases are never inferred. A target must be an exact BedLayout product cell and a zone present in the RDK camera image `zoneIds`; otherwise the plant is unassigned. Multiple plants for one product consume distinct eligible cells in stable creation-time/ID order.

After manually reviewing every row and preserving the dry-run output, apply only that unchanged plan with `node scripts/reconcilePlantAssignments.js --apply --confirm-plan <planHash>`. The script saves a mode-0600 JSON backup before writing, updates MongoDB and RDK, verifies the RDK response, and attempts to restore both systems on failure. A stale plan hash or a changed RDK snapshot refuses application. This operation changes existing plant camera/zone assignments and invalidates old stream tokens for moved plants; do not deploy or run `--apply` without reviewing and explicitly authorizing the production plan.

The order confirmation modal sorts exact `productId` crop matches first, marks the match, and warns if the administrator selects a different crop or no exact crop cell exists. It never substitutes a related crop automatically.

Set `DISCORD_WEBHOOK_URL` in the backend environment to enable Discord signup, new-order, and camera frame interruption/recovery alerts. Event delivery toggles and a test-message action are available at `/admin/`; the webhook URL is never returned to the browser. Camera health checks ignore idle readers and require two consecutive failed frame checks before an alert.

## RDK water-command polling flow

Pi 4 irrigation integration: an administrator assigns a plant using
`PATCH /api/web/admin/plants/:plantId/irrigation` with
`{ "deviceId": "pi4-1", "outletIndex": 0, "pumpId": 1, "enabled": true }`.
Camera `rdkZone` is independent of irrigation `outletIndex` (0-9).
The existing user `POST /api/web/control/water` still accepts `plantId` and
`volume` (mL, greater than 0 and at most 100). Its response command ID can be
checked with `GET /api/web/control/water/:commandId`. At most one pending or
dispatched water command is accepted per plant.
The Pi polls the existing plant command endpoint with `X-Irrigation-Device-Id`
and `X-Rdk-Api-Key`. Its reported `Water.volume` is an estimated amount, not a
flowmeter measurement. `GET /api/rdk/commands/active` lets a restarted Pi find
stranded dispatched commands; `POST /api/rdk/command/:commandId/fail` records
an error without replaying a physically uncertain dose. The Pi service must
remain disabled until servo positions, pump flow and relay operation are
calibrated and verified.
An unassigned plant returns `command: null` even if a legacy pending command
exists. `X-Irrigation-Device-Id` is a routing identifier, not a separate
device credential; keep the shared `X-Rdk-Api-Key` confidential.
An uncertain failure enters `NEEDS_REVIEW` and blocks further watering for
that plant. After confirming the pump is off and inspecting the plant, an
administrator may acknowledge it; this changes the command to `FAILED` while
retaining the uncertainty flag and does not create a measured water record.

1. The web client posts a water request. The server creates a `Command` with `PENDING` status.
2. The RDK polls `GET /api/rdk/command/:plantId`. The oldest command becomes `DISPATCHED` and is returned.
3. After pumping, the RDK posts `/api/rdk/water` with the returned `commandId`. A `Water` record is written and the command becomes `COMPLETED`.

`commandId` makes the completion report safe to retry. The device should persist the received command ID until it has received a successful completion response.
