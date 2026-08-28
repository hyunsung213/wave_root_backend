# 스마트팜 백엔드 API 레퍼런스

프론트엔드(Next.js)가 호출할 API와 RDK X5가 호출할 API를 현재 백엔드 구현 기준으로 정리한 문서입니다.

## 1. 기본 정보

| 항목 | 값 |
| --- | --- |
| 개발 서버 기본 주소 | `http://localhost:5000` |
| 실제 서버 주소 예시 | `http://192.168.200.182:5000` |
| 응답 형식 | JSON |
| 웹 API 접두사 | `/api/web` |
| RDK 기기 API 접두사 | `/api/rdk` |

프론트의 Axios 인스턴스는 **서버 주소까지만** `baseURL`로 설정합니다. 아래 문서의 모든 경로를 그대로 전달하면 됩니다.

```ts
import axios from "axios";

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5000",
  headers: { "Content-Type": "application/json" },
});
```

## 2. 인증 규칙

### 웹 API

로그인·회원가입을 제외한 `/api/web/*` API에는 JWT가 필요합니다.

```ts
const headers = {
  Authorization: `Bearer ${accessToken}`,
};

const response = await api.get("/api/web/plants", { headers });
```

`accessToken`은 회원가입 또는 로그인 성공 응답의 `accessToken` 필드입니다.

### RDK API

현재 `/api/rdk/*` API는 앱 수준 API 키를 사용하지 않습니다. RDK 전용 API는 프론트에서 직접 호출하지 말고, 사설망 또는 방화벽으로 접근을 제한해야 합니다.

### 2.1 API 빠른 목록

| 구분 | 메서드 | 경로 | 인증 | 용도 |
| --- | --- | --- | --- | --- |
| 공통 | GET | `/health` | 없음 | 서버 상태 확인 |
| 인증 | POST | `/api/web/users/signup` | 없음 | 회원가입 및 JWT 발급 |
| 인증 | POST | `/api/web/users/login` | 없음 | 로그인 및 JWT 발급 |
| 사용자 | GET | `/api/web/users/me` | Bearer JWT | 내 사용자 정보 조회 |
| 사용자 | PATCH | `/api/web/users/password` | Bearer JWT | 현재 비밀번호 확인 후 변경 |
| 식물 | POST | `/api/web/plants` | Bearer JWT | 식물 생성·스트리밍 포트 저장 |
| 식물 | GET | `/api/web/plants` | Bearer JWT | 내 식물 목록 |
| 식물 | GET | `/api/web/plants/with-records` | Bearer JWT | 식물·급수·성장 기록 통합 조회 |
| 식물 | GET | `/api/web/plants/:plantId` | Bearer JWT | 단일 식물·스트리밍 URL 조회 |
| 식물 | PATCH | `/api/web/plants/:plantId` | Bearer JWT | 식물 정보·스트리밍 포트 수정 |
| 센서 | GET | `/api/web/plants/:plantId/current` | Bearer JWT | RDK 최신 센서값 조회 |
| 센서 | GET | `/api/web/logs/:plantId` | Bearer JWT | 10분 평균 센서 로그 조회 |
| 성장 | POST | `/api/web/events` | Bearer JWT | 성장 이벤트·이미지 등록 |
| 성장 | GET | `/api/web/events/:plantId` | Bearer JWT | 성장 타임라인 조회 |
| 급수 | POST | `/api/web/control/water` | Bearer JWT | 급수 명령 생성 |
| 급수 | GET | `/api/web/water/:plantId` | Bearer JWT | 완료된 급수 이력 조회 |
| 활동 | GET | `/api/web/activity` | Bearer JWT | 사용자 활동 카운터 조회 |
| 활동 | POST | `/api/web/activity/harvest` | Bearer JWT | 수확 카운터 증가 |
| 알림 | POST | `/api/web/notifications` | Bearer JWT | 알림 생성 |
| 알림 | GET | `/api/web/notifications` | Bearer JWT | 알림 목록·미읽음 수 조회 |
| 알림 | PATCH | `/api/web/notifications/:notificationId/read` | Bearer JWT | 알림 읽음 처리 |
| 이미지 | GET | `/uploads/events/:filename` | 없음 | 업로드된 이벤트 이미지 표시 |
| RDK | POST | `/api/rdk/logs` | 사설망 | 센서 평균 로그 저장 |
| RDK | GET | `/api/rdk/command/:plantId` | 사설망 | 대기 급수 명령 폴링 |
| RDK | POST | `/api/rdk/water` | 사설망 | 급수 완료 보고 |
## 3. 공통 응답과 오류

성공 응답은 항상 `success: true`를 포함합니다.

```json
{
  "success": true
}
```

오류 응답은 아래 형식입니다.

```json
{
  "success": false,
  "message": "오류 내용"
}
```

| 상태 코드 | 의미 |
| --- | --- |
| `200` | 조회 또는 처리 성공 |
| `201` | 생성 성공 |
| `400` | 요청 본문 또는 `plantId` 형식 오류 |
| `401` | JWT가 없거나 만료됨 |
| `404` | 대상 식물·명령을 찾을 수 없음 |
| `409` | 이메일 중복 또는 처리할 수 없는 명령 상태 |
| `503` | RDK 실시간 게이트웨이를 사용할 수 없음 |

## 4. 프론트엔드용 API

### 4.1 서버 상태 확인

```http
GET /health
```

인증 없이 사용할 수 있습니다.

```json
{
  "success": true,
  "status": "ok"
}
```

### 4.2 회원가입

```http
POST /api/web/users/signup
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "phone": "010-1234-5678",
  "pwd": "password1234"
}
```

- `phone`은 선택값입니다.
- `pwd`는 최소 8자입니다.
- 일반 회원가입은 `isSocial: false`로 생성됩니다.

성공 응답: `201 Created`

```json
{
  "success": true,
  "user": {
    "_id": "사용자 ObjectId",
    "email": "user@example.com",
    "phone": "010-1234-5678",
    "isSocial": false,
    "createdAt": "2026-07-25T00:00:00.000Z",
    "updatedAt": "2026-07-25T00:00:00.000Z"
  },
  "accessToken": "JWT"
}
```

### 4.3 로그인

```http
POST /api/web/users/login
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "pwd": "password1234"
}
```

성공 응답: `200 OK`

```json
{
  "success": true,
  "user": {
    "_id": "사용자 ObjectId",
    "email": "user@example.com"
  },
  "accessToken": "JWT"
}
```

로그인 후 `accessToken`을 보관하고 이후 웹 API의 `Authorization: Bearer <token>` 헤더에 사용합니다.

### 4.3.1 내 사용자 정보 조회

```http
GET /api/web/users/me
Authorization: Bearer <accessToken>
```

현재 JWT의 사용자 정보를 반환합니다. 비밀번호와 `passwordChangedAt`은 절대 반환하지 않습니다.

```json
{
  "success": true,
  "user": {
    "_id": "사용자 ObjectId",
    "email": "user@example.com",
    "phone": "010-1234-5678",
    "isSocial": false,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

### 4.3.2 비밀번호 변경

```http
PATCH /api/web/users/password
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "currentPwd": "현재비밀번호",
  "newPwd": "새비밀번호1234"
}
```

- 일반 계정만 사용할 수 있습니다. 소셜 로그인 계정은 비밀번호를 변경할 수 없습니다.
- `newPwd`는 8자 이상이어야 하며 현재 비밀번호와 달라야 합니다.
- 현재 비밀번호가 일치해야 변경됩니다.
- 성공하면 새 `accessToken`이 반환됩니다. 프론트는 저장된 토큰을 이 값으로 즉시 교체해야 하며, 기존 토큰은 비밀번호 변경 시점 이전에 발급된 경우 사용할 수 없습니다.

성공 응답: `200 OK`

```json
{
  "success": true,
  "message": "Password updated.",
  "accessToken": "새 JWT"
}
```
### 4.4 식물 생성

```http
POST /api/web/plants
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "name": "상추",
  "type": "청상추",
  "streamingPort": 5000
}
```

성공 응답: `201 Created`

```json
{
  "success": true,
  "plant": {
    "_id": "plantId",
    "userId": "사용자 ObjectId",
    "name": "상추",
    "type": "청상추",
    "streamingPort": 5000,
    "createdAt": "2026-07-25T00:00:00.000Z",
    "updatedAt": "2026-07-25T00:00:00.000Z"
  }
}
```

반환된 `plant._id`가 이후 센서·로그·급수 API에 사용하는 `plantId`입니다.

### 4.4.1 단일 식물 조회·RDK 스트리밍

```http
GET /api/web/plants/:plantId
Authorization: Bearer <accessToken>
```

프론트는 RDK에 직접 접근하지 않고 이 API로 식물 정보와 `streamingUrl`을 받습니다. 현재 RDK Flask 서버의 MJPEG 스트림 경로는 `http://<RDK_IP>:5000/video_feed`입니다.

```json
{
  "success": true,
  "plant": {
    "_id": "plantId",
    "name": "상추",
    "type": "청상추",
    "streamingPort": 5000,
    "streamingUrl": "http://192.168.200.100:5000/video_feed"
  }
}
```

`streamingUrl`은 `<img src={streamingUrl}>`로 표시하는 MJPEG 주소입니다. 이 RDK 코드에서는 카메라 한 대(`Camera(0)`)와 `/video_feed` 한 개를 제공하므로, 해당 RDK를 사용하는 식물은 모두 `streamingPort: 5000`을 사용합니다.

식물 생성 시 `streamingPort`를 생략하면 기본값 `5000`이 자동 저장됩니다. 다른 포트를 사용하려면 생성 요청에 직접 전달하세요. 식물 생성·수정 시 포트 설정:

```http
PATCH /api/web/plants/:plantId
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "streamingPort": 5000
}
```

`name`, `type`, `streamingPort` 중 최소 하나를 전달해야 합니다. `streamingPort: null`로 기존 포트를 제거할 수 있으며, 포트 또는 `RDK_STREAMING_BASE_URL`이 없으면 `streamingUrl`은 `null`입니다.

### 4.5 내 식물 목록

```http
GET /api/web/plants
Authorization: Bearer <accessToken>
```

성공 응답: `200 OK`

```json
{
  "success": true,
  "plants": [
    {
      "_id": "plantId",
      "name": "상추",
      "type": "청상추",
      "streamingPort": 5000,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 4.5.1 식물별 급수·성장 기록 통합 조회

```http
GET /api/web/plants/with-records
Authorization: Bearer <accessToken>
```

로그인 사용자의 모든 식물을 기준으로 식물 정보, 전체 급수 이력(`waterRecords`), 성장 이벤트(`eventRecords`)를 한 번에 반환합니다. 각 기록 배열은 최신순이며, 다른 사용자의 식물·기록은 포함되지 않습니다. 이 통합 API에는 페이지네이션이 없으므로 대시보드 초기 화면처럼 기록량이 적은 경우에 사용하고, 장기 이력·차트는 각각의 페이지네이션 API를 사용하세요.

```json
{
  "success": true,
  "plants": [
    {
      "_id": "plantId",
      "name": "상추",
      "type": "청상추",
      "streamingPort": 5000,
      "createdAt": "...",
      "updatedAt": "...",
      "waterRecords": [
        { "_id": "waterId", "volume": 150, "createdAt": "..." }
      ],
      "eventRecords": [
        {
          "_id": "eventId",
          "title": "싹이 났어요 🌱",
          "content": "작고 귀여운 싹이 흙 위로 올라왔어요.",
          "imageUrl": null,
          "eventDate": "..."
        }
      ]
    }
  ]
}
```

### 4.6 최신 센서값 즉시 조회

```http
GET /api/web/plants/:plantId/current
Authorization: Bearer <accessToken>
```

프론트는 RDK가 아니라 백엔드에 요청합니다. 백엔드는 RDK Flask 서버의 `GET http://<RDK_IP>:5000/api/rdk/current`을 호출해 최신 ESP32 값을 그대로 전달합니다. 이 값은 MongoDB에 10분마다 저장되는 평균 로그와 다릅니다.

```ts
const { data } = await api.get(
  `/api/web/plants/${plantId}/current`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);

if (data.success) {
  const sensor = data.sensor;
  setSensors({
    temp: sensor.degree,
    humidity: sensor.moisture_air,
    moisture: sensor.moisture_soil,
    light: sensor.rux,
  });
  setLastUpdate(new Date(sensor.timestamp * 1000));
}
```

성공 응답:

```json
{
  "success": true,
  "sensor": {
    "degree": 24.5,
    "moisture_air": 45.2,
    "moisture_soil": 2900,
    "rux": 1200,
    "timestamp": 1722253800
  }
}
```

| 백엔드 센서 필드 | 프론트 표시 필드 예시 |
| --- | --- |
| `degree` | `temp` |
| `moisture_air` | `humidity` |
| `moisture_soil` | `moisture` |
| `rux` | `light` |

RDK는 ESP32의 `rux` 값을 우선 사용하고, ESP32가 `lux`로 보내는 경우 이를 `rux`로 변환합니다. RDK가 꺼져 있거나 백엔드에서 RDK의 `5000` 포트에 접근할 수 없으면 `503`이 반환됩니다. `timestamp`는 Unix 초 단위입니다.
### 4.7 센서 평균 로그 조회

```http
GET /api/web/logs/:plantId?page=1&limit=30
Authorization: Bearer <accessToken>
```

| 쿼리 | 기본값 | 범위 |
| --- | --- | --- |
| `page` | `1` | 1 이상 |
| `limit` | `30` | 1~100 |

예시:

```ts
const { data } = await api.get(
  `/api/web/logs/${plantId}?page=1&limit=100`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
```

응답은 `createdAt` 기준 최신순입니다.

```json
{
  "success": true,
  "logs": [
    {
      "_id": "logId",
      "plantId": "plantId",
      "degree": 25.4,
      "moisture_soil": 38.1,
      "moisture_air": 55.2,
      "rux": 480,
      "createdAt": "2026-07-25T00:00:00.000Z",
      "updatedAt": "2026-07-25T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 1008,
    "totalPages": 34
  }
}
```

`rux`는 조도 센서가 없는 RDK에서 `null`일 수 있습니다.

### 4.8 물 주기 요청

```http
POST /api/web/control/water
Authorization: Bearer <accessToken>
Content-Type: application/json
```

```json
{
  "plantId": "plantId",
  "volume": 150
}
```

`volume`은 물의 양 또는 펌프 작동 기준값으로 사용합니다. 0 이상 숫자여야 합니다.

성공 응답: `201 Created`

```json
{
  "success": true,
  "command": {
    "_id": "commandId",
    "plantId": "plantId",
    "requestedBy": "사용자 ObjectId",
    "type": "WATER",
    "volume": 150,
    "status": "PENDING",
    "dispatchedAt": null,
    "completedAt": null,
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

이 요청은 펌프를 즉시 제어하지 않고 `PENDING` 명령을 생성합니다. RDK가 다음 폴링에서 명령을 수신하고, 급수 완료 보고 후 이력이 생성됩니다.

### 4.9 성장 이벤트 타임라인

```http
POST /api/web/events
Authorization: Bearer <accessToken>
Content-Type: multipart/form-data
```

| multipart 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `plantId` | String | 예 | 식물 ObjectId |
| `title` | String | 예 | 최대 120자 |
| `content` | String | 예 | 최대 2,000자 |
| `eventDate` | ISO 8601 String | 아니오 | 생략 시 현재 시각 |
| `image` | JPEG/PNG/WebP 파일 | 아니오 | 최대 5 MB, 백엔드 디스크에 저장 |

프론트 요청 예시:

```ts
const formData = new FormData();
formData.append("plantId", plantId);
formData.append("title", "싹이 났어요 🌱");
formData.append("content", "작고 귀여운 싹이 흙 위로 올라왔어요.");
formData.append("eventDate", new Date().toISOString());
if (imageFile) formData.append("image", imageFile);

await api.post("/api/web/events", formData, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
```

이미지를 포함한 `FormData` 요청에서는 `Content-Type`을 직접 지정하지 않습니다. 브라우저가 multipart boundary를 포함한 헤더를 자동으로 추가합니다.

성공 응답: `201 Created`

```json
{
  "success": true,
  "event": {
    "_id": "eventId",
    "plantId": "plantId",
    "userId": "사용자 ObjectId",
    "title": "싹이 났어요 🌱",
    "content": "작고 귀여운 싹이 흙 위로 올라왔어요.",
    "imageUrl": "http://localhost:5000/uploads/events/uuid.jpg",
    "eventDate": "2026-07-27T00:30:00.000Z",
    "createdAt": "...",
    "updatedAt": "..."
  }
}
```

타임라인 조회:

```http
GET /api/web/events/:plantId?page=1&limit=30&order=desc
Authorization: Bearer <accessToken>
```

- `order=desc`(기본값)는 최신 이벤트부터, `order=asc`는 오래된 이벤트부터 반환합니다.
- 응답 형식은 `{ "success": true, "events": [...], "pagination": {...} }`입니다.

### 4.10 급수 이력 조회

```http
GET /api/web/water/:plantId?page=1&limit=30
Authorization: Bearer <accessToken>
```

응답은 실제로 RDK가 완료 처리한 기록이며 최신순입니다.

```json
{
  "success": true,
  "water": [
    {
      "_id": "waterId",
      "plantId": "plantId",
      "volume": 150,
      "commandId": "commandId",
      "createdAt": "2026-07-25T00:00:00.000Z",
      "updatedAt": "2026-07-25T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 30,
    "total": 5,
    "totalPages": 1
  }
}
```

현재 프론트용 개별 명령 상태 조회 API는 없습니다. 물 주기 버튼의 완료 여부는 이 급수 이력을 다시 조회해 확인할 수 있습니다.

### 4.11 내 활동 카운터 조회

```http
GET /api/web/activity
Authorization: Bearer <accessToken>
```

성장 기록 작성, 실시간 센서 조회, 물 주기 요청, 수확 기록 횟수를 사용자별로 반환합니다. 최초 조회 시에도 0으로 초기화된 활동 문서가 자동으로 생성됩니다.

```json
{
  "success": true,
  "activity": {
    "growthRecordCount": 8,
    "liveStreamViewCount": 18,
    "waterCount": 10,
    "harvestCount": 2,
    "lastGrowthRecordAt": "2026-07-27T10:00:00.000Z",
    "lastLiveStreamViewAt": "2026-07-28T01:00:00.000Z",
    "lastWaterAt": "2026-07-28T00:30:00.000Z",
    "lastHarvestAt": "2026-07-27T12:00:00.000Z"
  }
}
```

카운트 반영 기준은 다음과 같습니다.

- `POST /api/web/events`: `growthRecordCount` 증가
- `GET /api/web/plants/:plantId/current`: `liveStreamViewCount` 증가
- `POST /api/web/control/water`: `waterCount` 증가
- 아래 수확 API: `harvestCount` 증가

### 4.12 수확 기록 카운트

```http
POST /api/web/activity/harvest
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "plantId": "plantId"
}
```

해당 식물이 로그인 사용자 소유일 때만 수확 카운트를 1 증가시킵니다. 성공 시 `201 Created`와 갱신된 `activity`를 반환합니다.

### 4.13 알림 생성·조회·읽음 처리

알림 생성:

```http
POST /api/web/notifications
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "title": "급수가 완료되었어요",
  "type": "WATER",
  "content": "상추 화분의 급수 명령이 완료되었어요.",
  "notifyAt": "2026-07-28T09:00:00.000Z"
}
```

`notifyAt`을 생략하면 생성 시각이 저장됩니다. `type`은 대문자로 정규화되며, 예를 들어 `GROWTH`, `WATER`, `HARVEST`, `SENSOR`, `INFO`를 사용할 수 있습니다. 성공 시 `201 Created`와 `notification`을 반환합니다.

목록 조회:

```http
GET /api/web/notifications?page=1&limit=30&unreadOnly=true
Authorization: Bearer <accessToken>
```

`unreadOnly=true`이면 읽지 않은 알림만 반환합니다. 응답의 `unreadCount`는 필터와 상관없이 전체 미읽음 개수이므로 알림 배지에 바로 사용할 수 있습니다.

```json
{
  "success": true,
  "notifications": [
    {
      "_id": "notificationId",
      "notifyAt": "2026-07-28T09:00:00.000Z",
      "title": "급수가 완료되었어요",
      "type": "WATER",
      "content": "상추 화분의 급수 명령이 완료되었어요.",
      "isRead": false,
      "readAt": null,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "unreadCount": 3,
  "pagination": { "page": 1, "limit": 30, "total": 3, "totalPages": 1 }
}
```

읽음 처리:

```http
PATCH /api/web/notifications/:notificationId/read
Authorization: Bearer <accessToken>
```

성공 시 해당 알림의 `isRead`가 `true`, `readAt`이 현재 시각으로 갱신됩니다. 다른 사용자의 알림에는 접근할 수 없습니다.

## 5. RDK X5 전용 API

아래 API는 RDK가 호출하는 경로입니다. 프론트에서 직접 호출하지 않습니다.

### 5.1 센서 평균 로그 저장

```http
POST /api/rdk/logs
Content-Type: application/json
```

```json
{
  "plantId": "plantId",
  "degree": 25.4,
  "moisture_soil": 38.1,
  "moisture_air": 55.2,
  "rux": 480
}
```

- `rux`는 생략하거나 `null`로 보낼 수 있습니다.
- 수치 필드는 유한한 숫자여야 합니다.
- 성공 시 저장된 `log`와 함께 `201`이 반환됩니다.

### 5.2 물 주기 명령 폴링

```http
GET /api/rdk/command/:plantId
```

RDK가 주기적으로 호출합니다. 대기 중인 가장 오래된 명령이 있으면 `PENDING`에서 `DISPATCHED`로 바뀌며 반환됩니다.

명령이 있을 때:

```json
{
  "success": true,
  "command": {
    "id": "commandId",
    "type": "WATER",
    "volume": 150,
    "requestedAt": "2026-07-25T00:00:00.000Z"
  }
}
```

명령이 없을 때:

```json
{
  "success": true,
  "command": null
}
```

### 5.3 급수 완료 보고

```http
POST /api/rdk/water
Content-Type: application/json
```

```json
{
  "plantId": "plantId",
  "commandId": "RDK가 폴링으로 받은 command.id",
  "volume": 150
}
```

성공하면 `Water` 기록을 만들고 해당 명령을 `COMPLETED` 상태로 갱신합니다. 동일한 `commandId` 재전송은 중복 급수 이력을 만들지 않도록 처리됩니다.

## 6. RDK 게이트웨이와 실시간 센서·스트리밍 흐름

현재 RDK X5 Flask 서버는 `0.0.0.0:5000`에서 다음 기능을 제공합니다.

| RDK 로컬 경로 | 용도 | 프론트 직접 호출 |
| --- | --- | --- |
| `GET /api/rdk/current` | 최신 ESP32 센서값 JSON | 아니오. 백엔드 프록시 사용 |
| `GET /video_feed` | MJPEG 카메라 스트림 | 아니오. 식물 상세의 `streamingUrl` 사용 |
| `POST /api/rdk/pump` | 수동 펌프 ON/OFF | 아니오. RDK 명령 폴링이 처리 |

RDK 내부 동작:

1. ESP32 시리얼 값을 약 2초마다 수집하고 최신값을 메모리에 보관합니다.
2. 최근 10분(최대 300개) 센서값 평균을 10분마다 백엔드 `POST /api/rdk/logs`로 보냅니다.
3. 5초마다 백엔드 `GET /api/rdk/command/:plantId`를 폴링합니다.
4. 급수 명령이 있으면 펌프를 작동한 후 `POST /api/rdk/water`로 완료 보고합니다.
5. `GET /video_feed`는 MJPEG 형식의 카메라 영상을 제공합니다.

백엔드는 아래 환경변수로 RDK 주소를 알아야 합니다.

```env
RDK_CURRENT_API_URL=http://<RDK_X5_IP>:5000/api/rdk/current
RDK_STREAMING_BASE_URL=http://<RDK_X5_IP>/video_feed
PUBLIC_BASE_URL=http://<BACKEND_IP>:5000
```

중요: `/api/rdk/current`, `/video_feed`, `/api/rdk/pump`은 **RDK 머신의 Flask API**입니다. 프론트는 항상 백엔드의 JWT 보호 API를 사용해야 합니다.

- 최신 센서: `GET /api/web/plants/:plantId/current`
- 영상 주소: `GET /api/web/plants/:plantId`의 `plant.streamingUrl`
- 물 주기: `POST /api/web/control/water`
## 7. 데모 데이터

`npm run seed:demo`로 프론트 테스트용 데이터를 생성할 수 있습니다. 실행을 반복하면 데모 계정의 두 식물 데이터만 새로 생성합니다.

| 항목 | 값 |
| --- | --- |
| 이메일 | `demo@smartfarm.local` |
| 비밀번호 | `demo1234!` |
| 상추 `plantId` | `6a63a5195dca549788050772` |
| 토마토 plantId | 6a63a5195dca549788050771 |
| 스트리밍 포트 | 상추·토마토 모두 5000 (/video_feed) |
| 센서 로그 | 식물별 최근 7일, 10분 간격 |
| 급수 데이터 | 식물별 완료된 급수 명령·이력 5건 |
| 성장 이벤트 | 식물별 성장 타임라인 4건 |
| 사용자 활동 | 성장·실시간 조회·급수·수확 누적 카운터 1건 |
| 알림 | 성장·급수·수확·센서 관련 알림 4건 |

데모 로그인 후 예시:

```ts
const login = await api.post("/api/web/users/login", {
  email: "demo@smartfarm.local",
  pwd: "demo1234!",
});

const accessToken = login.data.accessToken;
const headers = { Authorization: `Bearer ${accessToken}` };

const lettuceLogs = await api.get(
  "/api/web/logs/6a63a5195dca549788050772?page=1&limit=30",
  { headers }
);
```

## 8. 프론트 데이터 흐름 요약

```text
로그인/회원가입
  → accessToken 수신
  ├─ GET /api/web/plants/with-records       (대시보드용 식물·급수·성장 기록 통합 조회)
  └─ GET /api/web/plants                    (개별 화면용 식물 목록)
       → plantId 선택
       ├─ GET /api/web/plants/:plantId          (식물 정보·스트리밍 URL)
       ├─ GET /api/web/plants/:plantId/current  (실시간 RDK 최신값)
       ├─ GET /api/web/logs/:plantId             (10분 평균 로그/차트)
       ├─ GET /api/web/events/:plantId           (성장 타임라인)
       ├─ GET /api/web/water/:plantId            (급수 이력)
       ├─ GET /api/web/activity                  (내 활동 카운터)
       ├─ GET /api/web/notifications             (알림/미읽음 배지)
       ├─ POST /api/web/activity/harvest         (수확 카운트)
       └─ POST /api/web/control/water            (급수 요청)
            → RDK 폴링
            → POST /api/rdk/water
            → GET /api/web/water/:plantId에 완료 이력 반영
```
