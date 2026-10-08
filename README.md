# Smart Farm Backend

Express and MongoDB Atlas API server for a Next.js dashboard and an RDK X5 device.

## Start

1. Copy `.env.example` to `.env` and provide the MongoDB Atlas URI, JWT secret, and RDK gateway URL.
2. Run `npm install`.
3. Run `npm run dev` for development, or `npm start` for production.

The server exposes `GET /health` without authentication.
## Demo data

Run `npm run seed:demo` to create a repeatable front-end test account, two plants (lettuce and tomato), seven days of 10-minute sensor logs, completed water-command history, activity counters, and notifications. The command refreshes data only for `demo@smartfarm.local` and its two demo plants.

- Email: `demo@smartfarm.local`
- Password: `demo1234!`

## Authentication

Web endpoints require `Authorization: Bearer <accessToken>`, received from login or signup. RDK endpoints are intended for a private network and do not use an application-level API key.

Local account signup accepts `{ "email", "phone", "pwd" }`; `pwd` must be at least eight characters. Social authentication needs provider-token verification and is deliberately not exposed through the local-password endpoints.

## API

| Method | Endpoint | Auth | Request body |
| --- | --- | --- | --- |
| POST | `/api/web/users/signup` | - | `email`, `phone?`, `pwd` |
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
| GET | `/api/web/notifications?page=1&limit=30&unreadOnly=false` | Bearer | - |
| PATCH | `/api/web/notifications/:notificationId/read` | Bearer | - |
| GET | `/api/web/admin/cameras` | Admin Bearer | RDK 카메라 목록 |
| GET | `/api/web/admin/cameras/:cameraId/raw` | Admin Bearer | 보정 전 원본 JPEG 1프레임 |
| GET | `/api/web/admin/cameras/:cameraId/frame/:mode` | Admin Bearer | 원본·보정·6×3 그리드 JPEG. `mode=raw/corrected/grid` |
| GET | `/api/web/admin/cameras/:cameraId/status` | Admin Bearer | 프라이버시 상태와 카메라 원본/출력 해상도 |
| GET | `/api/web/admin/cameras/:cameraId/profile` | Admin Bearer | 카메라 송출 FPS 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/profile` | Admin Bearer | 고정 송출 규격 15 FPS 확인(다른 값은 400) |
| GET | `/api/web/admin/cameras/:cameraId/calibration` | Admin Bearer | 현재 18개 셀 좌표 |
| PUT | `/api/web/admin/cameras/:cameraId/calibration` | Admin Bearer | `zones` 전체 18개 셀 좌표 저장 |
| GET | `/api/web/admin/cameras/:cameraId/grid-layouts` | Admin Bearer | 식물별 사용자 지정 영역의 두 앵커와 영역 번호 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/grid-layouts` | Admin Bearer | 최대 144개 영역 배치 저장; 영역 하나가 식물 영상 하나 |
| PATCH | `/api/web/admin/plants/:plantId/camera` | Admin Bearer | 식물을 카메라/영역에 배정 또는 해제 |
| GET | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 베드 평면화 4점 조회 |
| PUT | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 원본 기준 네 모서리 저장·즉시 적용 |
| DELETE | `/api/web/admin/cameras/:cameraId/perspective` | Admin Bearer | 사용자 보정 초기화, 기존 자동 보정 복귀 |
| POST | `/api/rdk/logs` | Private network | `plantId`, `degree`, `moisture_soil`, `moisture_air`, `rux` |
| GET | `/api/rdk/command/:plantId` | Private network | - |
| POST | `/api/rdk/water` | Private network | `plantId`, `commandId`, `volume` |

All persistent models use `timestamps: true`, so MongoDB stores `createdAt` and `updatedAt` automatically.

## RDK sensor flow

The RDK gateway collects ESP32 readings every two seconds. For active camera-zone assignments it pushes a plant-specific latest snapshot every 60 seconds to `POST /api/rdk/current`, while ten-minute averages remain in `POST /api/rdk/logs`. `rux` is `null` when no light sensor is connected.

For an on-demand reading, the web client calls `GET /api/web/plants/:plantId/current` with its Bearer token. After ownership validation, the backend returns the latest snapshot from MongoDB; snapshots older than three minutes return `503`. No request from Render back to the RDK sensor port is needed.

For the current RDK X5 deployment, configure `RDK_STREAM_BASE_URL` as `http://<RDK_X5_TAILSCALE_IP>:5001`, `RDK_STREAM_ADMIN_KEY`, and Render's internal Tailscale HTTP proxy as `RDK_HTTP_PROXY_HOSTPORT`. Set each plant's `rdkCameraId` and `rdkZone`; the backend requests a per-plant assignment and returns a short-lived signed `streamingUrl` from `GET /api/web/plants/:plantId`. Render proxies MJPEG so the browser never needs Tailnet access.
The ready-to-run RDK sample is at [`rdk/rdk_gateway.py`](rdk/rdk_gateway.py). Install its packages with `pip install -r rdk/requirements.txt`, then configure its environment variables before starting it.

The administrator page at `/admin/` has a `카메라 설정` screen for source, bed-plane flattening, corrected, and numbered region views. Drag four circles from the tray below the raw video to set perspective corners. Drag two triangles from the tray below the corrected video to place each plant region. One rectangle creates one plant crop; up to 144 regions can be saved per camera, with stable region IDs matching zone numbers. The `스트리밍` admin screen assigns each plant to an available camera region. Existing assigned zones cannot be removed until the plants are moved. The earlier individual cell editor remains available for the original eighteen-cell layout. User-facing output is fixed at 1280×720 and 15 FPS. These endpoints are protected by the administrator JWT and backend-to-RDK `RDK_STREAM_ADMIN_KEY`.

## RDK water-command polling flow

1. The web client posts a water request. The server creates a `Command` with `PENDING` status.
2. The RDK polls `GET /api/rdk/command/:plantId`. The oldest command becomes `DISPATCHED` and is returned.
3. After pumping, the RDK posts `/api/rdk/water` with the returned `commandId`. A `Water` record is written and the command becomes `COMPLETED`.

`commandId` makes the completion report safe to retry. The device should persist the received command ID until it has received a successful completion response.
