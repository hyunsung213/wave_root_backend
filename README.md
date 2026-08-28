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
| POST | `/api/web/plants` | Bearer | `name`, `type`, `streamingPort?` (생략 시 5000) |
| GET | `/api/web/plants` | Bearer | - |
| GET | `/api/web/plants/with-records` | Bearer | - |
| GET | `/api/web/plants/:plantId` | Bearer | - |
| PATCH | `/api/web/plants/:plantId` | Bearer | `name?`, `type?`, `streamingPort?` |
| GET | `/api/web/plants/:plantId/current` | Bearer | - |
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
| POST | `/api/rdk/logs` | Private network | `plantId`, `degree`, `moisture_soil`, `moisture_air`, `rux` |
| GET | `/api/rdk/command/:plantId` | Private network | - |
| POST | `/api/rdk/water` | Private network | `plantId`, `commandId`, `volume` |

All persistent models use `timestamps: true`, so MongoDB stores `createdAt` and `updatedAt` automatically.

## RDK sensor flow

The RDK gateway collects ESP32 readings every two seconds, keeps the latest reading in memory, and sends a five-minute average every ten minutes to `POST /api/rdk/logs`. `rux` is optional when no light sensor is connected.

For an on-demand reading, the web client calls `GET /api/web/plants/:plantId/current`. After confirming that the plant belongs to the signed-in user, the backend requests the RDK gateway's `GET /api/rdk/current` using `RDK_CURRENT_API_URL`. The gateway must be reachable from the backend network.

For the current RDK Flask server, configure `RDK_STREAMING_BASE_URL` as `http://<RDK_X5_IP>/video_feed` and set each connected plant's `streamingPort` to `5000`. The backend returns the resulting MJPEG address as `streamingUrl` from `GET /api/web/plants/:plantId`.
The ready-to-run RDK sample is at [`rdk/rdk_gateway.py`](rdk/rdk_gateway.py). Install its packages with `pip install -r rdk/requirements.txt`, then configure its environment variables before starting it.

## RDK water-command polling flow

1. The web client posts a water request. The server creates a `Command` with `PENDING` status.
2. The RDK polls `GET /api/rdk/command/:plantId`. The oldest command becomes `DISPATCHED` and is returned.
3. After pumping, the RDK posts `/api/rdk/water` with the returned `commandId`. A `Water` record is written and the command becomes `COMPLETED`.

`commandId` makes the completion report safe to retry. The device should persist the received command ID until it has received a successful completion response.
