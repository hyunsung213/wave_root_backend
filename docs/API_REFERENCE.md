# 스마트팜 백엔드 API 레퍼런스

프론트엔드(Next.js)가 호출할 API와 RDK X5가 호출할 API를 현재 백엔드 구현 기준으로 정리한 문서입니다.

## 1. 기본 정보

| 항목 | 값 |
| --- | --- |
| 개발 서버 기본 주소 | `http://localhost:5000` |
| 실제 서버 주소 | `https://<render-backend-host>` |
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

운영 환경의 `/api/rdk/*`에는 `X-RDK-API-Key: <RDK_API_KEY>` 또는 `Authorization: Bearer <RDK_API_KEY>`가 필요합니다. 개발 환경에서 키가 미설정이면 기존 하드웨어 테스트 호환을 위해 인증을 생략할 수 있습니다. RDK 전용 API는 프론트에서 직접 호출하지 않습니다.

### 2.1 API 빠른 목록

| 구분 | 메서드 | 경로 | 인증 | 용도 |
| --- | --- | --- | --- | --- |
| 공통 | GET | `/health` | 없음 | 서버 상태 확인 |
| 공통 | GET | `/health/ready` | 없음 | MongoDB readiness 확인 |
| 인증 | POST | `/api/web/users/signup` | 없음 | 회원가입 및 JWT 발급 |
| 인증 | POST | `/api/web/users/login` | 없음 | 로그인 및 JWT 발급 |
| 사용자 | GET | `/api/web/users/me` | Bearer JWT | 내 사용자 정보 조회 |
| 사용자 | PATCH | `/api/web/users/me` | Bearer JWT | 이름·전화번호 수정 |
| 사용자 | PATCH | `/api/web/users/password` | Bearer JWT | 현재 비밀번호 확인 후 변경 |
| 식물 | POST | `/api/web/plants` | Bearer JWT | 식물 생성·스트리밍 포트 저장 |
| 식물 | GET | `/api/web/plants` | Bearer JWT | 내 식물 목록 |
| 식물 | GET | `/api/web/plants/with-records` | Bearer JWT | 식물·급수·성장 기록 통합 조회 |
| 식물 | GET | `/api/web/plants/:plantId` | Bearer JWT | 단일 식물·스트리밍 URL 조회 |
| 식물 | PATCH | `/api/web/plants/:plantId` | Bearer JWT | 식물 정보·스트리밍 포트 수정 |
| 식물 | DELETE | `/api/web/plants/:plantId` | Bearer JWT | 식물 및 연결 기록 cascade 삭제 |
| 센서 | GET | `/api/web/plants/:plantId/current` | Bearer JWT | RDK 최신 센서값 조회 |
| 센서 | GET | `/api/web/logs/:plantId` | Bearer JWT | 10분 평균 센서 로그 조회 |
| 성장 | POST | `/api/web/events` | Bearer JWT | 성장 이벤트·이미지 등록 |
| 성장 | GET | `/api/web/events/:plantId` | Bearer JWT | 성장 타임라인 조회 |
| 성장 | DELETE | `/api/web/events/:eventId` | Bearer JWT | 이벤트 및 이미지 파일 삭제 |
| 급수 | POST | `/api/web/control/water` | Bearer JWT | 급수 명령 생성 |
| 급수 | GET | `/api/web/water/:plantId` | Bearer JWT | 완료된 급수 이력 조회 |
| 활동 | GET | `/api/web/activity` | Bearer JWT | 사용자 활동 카운터 조회 |
| 활동 | POST | `/api/web/activity/harvest` | Bearer JWT | 수확 카운터 증가 |
| 알림 | POST | `/api/web/notifications` | Bearer JWT | 알림 생성 |
| 알림 | GET | `/api/web/notifications` | Bearer JWT | 알림 목록·미읽음 수 조회 |
| 알림 | PATCH | `/api/web/notifications/:notificationId/read` | Bearer JWT | 알림 읽음 처리 |
| 이미지 | GET | `/uploads/events/:filename` | 없음 | 업로드된 이벤트 이미지 표시 |
| RDK | POST | `/api/rdk/current` | RDK API Key | 식물별 최신 센서 스냅샷 업서트 |
| RDK | POST | `/api/rdk/logs` | RDK API Key | 센서 평균 로그 저장 |
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
| `429` | API rate limit 초과 |
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
  "name": "홍길동",
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
    "name": "홍길동",
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
    "name": "홍길동",
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
### 4.3.3 프로필 수정

```http
PATCH /api/web/users/me
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "name": "새 이름",
  "phone": "010-1234-5678"
}
```

`name`, `phone` 중 하나 이상을 보내야 합니다. `null`을 보내면 해당 값을 비울 수 있으며 성공 응답에는 수정된 `user`가 포함됩니다.

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
  "rdkCameraId": "c110-1",
  "rdkZone": 1,
  "growthTargetDays": 60
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
    "rdkCameraId": "c110-1",
    "rdkZone": 1,
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

프론트는 RDK에 직접 접근하지 않고 이 API로 식물 정보와 사용자별 `streamingUrl`을 받습니다. 백엔드는 RDK X5 스트림 서비스(기본 5001)의 카메라·Zone 할당 API를 호출합니다.

```json
{
  "success": true,
  "plant": {
    "_id": "plantId",
    "name": "상추",
    "type": "청상추",
    "rdkCameraId": "c110-1",
    "rdkZone": 1,
    "streamingUrl": "https://<backend-host>/api/web/plants/stream/<short-lived-ticket>"
  }
}
```

`streamingUrl`은 `<img src={streamingUrl}>`로 표시하는 식물별 MJPEG 주소입니다. URL은 백엔드 프록시를 가리키며 1시간짜리 서명 티켓을 사용합니다. 브라우저는 RDK의 Tailnet 주소를 직접 호출하지 않습니다. `rdkCameraId`와 `rdkZone`(1~144)은 카메라/영역을 지정합니다.

식물 생성·수정 시 카메라·Zone 설정:

```http
PATCH /api/web/plants/:plantId
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "rdkCameraId": "c110-1",
  "rdkZone": 1
}
```

`name`, `type`, `rdkCameraId`, `rdkZone`, `growthTargetDays` 중 최소 하나를 전달해야 합니다. 카메라·Zone을 `null`로 보내면 스트림을 해제하며 `streamingUrl`은 `null`이 됩니다.

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
      "rdkCameraId": "c110-1",
      "rdkZone": 1,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

### 4.5.1 식물별 급수·성장 기록 통합 조회

```http
GET /api/web/plants/with-records?recordLimit=30
Authorization: Bearer <accessToken>
```

로그인 사용자의 모든 식물을 기준으로 식물 정보, 최근 급수 이력(`waterRecords`), 성장 이벤트(`eventRecords`)를 한 번에 반환합니다. 각 기록 배열은 최신순이며 기본 30개로 제한됩니다. `recordLimit=1~100`으로 제한을 조정할 수 있습니다.

```json
{
  "success": true,
  "plants": [
    {
      "_id": "plantId",
      "name": "상추",
      "type": "청상추",
      "rdkCameraId": "c110-1",
      "rdkZone": 1,
      "growthTargetDays": 60,
      "growthDays": 12,
      "growthPercent": 20,
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

프론트는 RDK가 아니라 백엔드에 Bearer JWT로 요청합니다. RDK가 60초마다 `POST /api/rdk/current`로 보낸 plant별 센서 스냅샷을 MongoDB에서 읽어 반환합니다. 최신 스냅샷은 MongoDB에 별도 저장되는 10분 평균 로그와 다릅니다.

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
    "timestamp": 1791504000,
    "sampledAt": "2026-10-09T00:00:00.000Z"
  }
}
```

스냅샷이 아직 도착하지 않았거나 마지막 측정 시각이 180초보다 오래되면 `503`입니다. `rux`는 조도 센서가 없을 때 `null`일 수 있습니다.

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

`rux`는 조도 센서가 없는 RDK에서 `null`일 수 있습니다. `page`, `limit`, `recordLimit`은 양의 정수 문자열만 허용하며 0·음수·소수·문자열·최대치 초과는 `400`입니다.

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

동일 요청 재시도에 대한 중복 명령을 막으려면 `Idempotency-Key` 헤더를 추가합니다. 같은 사용자와 키로 다시 요청하면 기존 command를 `200`으로 반환합니다.

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
| `image` | JPEG/PNG/WebP 파일 | 아니오 | 최대 5 MB, `EVENT_UPLOAD_DIR` 영속 디렉터리에 저장 |

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

이벤트 삭제:

```http
DELETE /api/web/events/:eventId
Authorization: Bearer <accessToken>
```

이벤트 소유권을 확인한 뒤 DB 레코드와 이미지 파일을 함께 삭제합니다.

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

### 5.1 최신 센서 스냅샷 업로드

RDK는 활성 식물 할당별 최신 센서값을 60초마다 전송합니다. 같은 `plantId`는 unique 인덱스로 upsert되어 최신값 한 건만 유지합니다.

```http
POST /api/rdk/current
X-RDK-API-Key: <RDK_API_KEY>
Content-Type: application/json
```

```json
{
  "plantId": "<Plant ObjectId>",
  "degree": 24.5,
  "moisture_air": 45.2,
  "moisture_soil": 2900,
  "rux": 1200,
  "sampledAt": "2026-10-09T00:00:00.000Z"
}
```

`rux`는 조도 센서가 없으면 `null`일 수 있습니다. 과거 `sampledAt` 재전송은 최신 스냅샷을 덮어쓰지 않습니다.

### 5.2 센서 평균 로그 저장

```http
POST /api/rdk/logs
X-RDK-API-Key: <RDK_API_KEY>
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
- 운영 환경에서는 `X-RDK-API-Key: <RDK_API_KEY>` 헤더가 필요합니다. `degree`는 -50~100, `moisture_air`는 0~100, `moisture_soil`은 0~4095, `rux`는 0~200000 범위입니다.
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

RDK X5에서는 카메라 할당/스트림 서버(`:5001`)와 ESP32 수집 프로세스가 동작합니다. RDK가 공개 백엔드로 데이터를 먼저 보내며, 프론트가 RDK로 직접 연결하지 않습니다.

| RDK 로컬 경로 | 용도 | 프론트 직접 호출 |
| --- | --- | --- |
| `POST /api/rdk/current` (백엔드) | 최신 센서값 업로드 | RDK가 인증키와 함께 호출 |
| `GET /api/availability` (`:5001`) | 카메라·Zone 가용 목록 | 아니오. 백엔드가 할당 처리 |
| `GET /api/stream/<user-token>` (`:5001`) | 사용자별 MJPEG 스트림 | 아니오. 백엔드 스트림 프록시가 호출 |
| `GET /api/cameras/<camera_id>/raw` (`:5001`) | 보정·크롭 전 원본 JPEG 1프레임 | 아니오. 관리자 백엔드가 프록시 |
| `POST /api/rdk/pump` | 수동 펌프 ON/OFF | 아니오. RDK 명령 폴링이 처리 |

RDK 내부 동작:

1. ESP32 시리얼 값을 약 2초마다 읽고 최신값을 메모리에 보관합니다.
2. 활성 식물 카메라 할당을 따라 최신 스냅샷을 60초마다 백엔드 `POST /api/rdk/current`로 보냅니다.
3. 최근 센서 이력의 평균 로그는 10분마다 백엔드 `POST /api/rdk/logs`로 보냅니다.
4. `GET /api/stream/<user-token>`는 배정된 카메라 Zone의 MJPEG 영상을 제공합니다. Render 백엔드는 Tailscale HTTP 프록시로 이 스트림을 중계합니다.

백엔드는 아래 환경변수로 RDK 주소를 알아야 합니다.

```env
RDK_STREAM_BASE_URL=http://100.90.42.36:5001
RDK_STREAM_ADMIN_KEY=<스트림 할당 관리자 키>
RDK_HTTP_PROXY_HOSTPORT=<render-private-tailscale-proxy-host>:1055
PUBLIC_BASE_URL=https://<render-backend-host>
RDK_API_KEY=<RDK와 백엔드가 공유하는 긴 비밀키>
EVENT_UPLOAD_DIR=./uploads/events
```

RDK 최신 센서값은 RDK → Render의 `POST /api/rdk/current`로 전송됩니다. 카메라 프레임은 브라우저 → Render의 단기 티켓 URL → Render 내부 Tailscale HTTP 프록시 → RDK `:5001` 순서로 흐릅니다. RDK의 `:5000` 또는 `:5001`을 인터넷에 공개하지 않습니다.

- 최신 센서: `GET /api/web/plants/:plantId/current`
- 영상 주소: `GET /api/web/plants/:plantId`의 `plant.streamingUrl`
- 물 주기: `POST /api/web/control/water`

### 6.1 관리자 카메라 작업 화면

관리자 JWT를 사용하면 RDK에 등록된 카메라 목록과 원본·보정·6×3 영역 화면을 확인할 수 있습니다. 원본은 렌즈·원근 보정 및 셀 크롭 전의 전체 디코딩 화면입니다.

```http
GET /api/web/admin/cameras
Authorization: Bearer <관리자 JWT>
```

응답:

```json
{
  "success": true,
  "cameras": [
    { "cameraId": "c110-1", "zones": [1, 2, 3] }
  ]
}
```

```http
GET /api/web/admin/cameras/c110-1/frame/raw
GET /api/web/admin/cameras/c110-1/frame/corrected
GET /api/web/admin/cameras/c110-1/frame/grid
Authorization: Bearer <관리자 JWT>
```

성공 시 `image/jpeg` 단일 프레임을 반환합니다. 기존 `GET /api/web/admin/cameras/:cameraId/raw`도 원본 보기로 유지됩니다. 관리자 페이지는 선택한 카메라·화면 한 개만 약 1초 간격으로 갱신합니다.

```http
GET /api/web/admin/cameras/c110-1/status
Authorization: Bearer <관리자 JWT>
```

성공 응답은 `status.privacy_state`(`on`: 프라이버시 모드, `off`: 시청 가능, `error`: 제어 실패, `unconfigured`: 제어 미설정), 최근 원본 프레임 해상도 `source_width/source_height`, 출력 크기 `output_width/output_height`(항상 1280×720), 활성 프레임 레이트 `output_fps`(항상 15)를 포함합니다. 원본 해상도는 카메라 RTSP 연결 후에 채워집니다. 원본이 1280×720이 아니면 관리자 화면이 확인 경고를 표시합니다. 이 경고는 표시 전용이며 C110 원본 해상도를 직접 바꾸지는 않습니다.

```http
GET /api/web/admin/cameras/c110-1/profile
Authorization: Bearer <관리자 JWT>
```

현재 고정 송출 규격을 반환합니다. `fps`는 항상 15이고 `supportedFps`는 `[15]`입니다.

```http
PUT /api/web/admin/cameras/c110-1/profile
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
{ "fps": 15 }
```

이 PUT은 15 FPS 고정 규격을 확인하는 멱등 요청입니다. 다른 값은 `400`입니다. 모든 식물 스트림은 1280×720/15 FPS로 송출됩니다. 이는 RDK→시청자 출력 규격이며 C110 원본 RTSP 해상도나 카메라 내부 FPS를 바꾸지는 않습니다.

```http
GET /api/web/admin/cameras/c110-1/calibration
Authorization: Bearer <관리자 JWT>
```

기본 18칸 모드에서 응답의 `zones`는 1~18번 셀의 `[왼쪽, 위쪽, 오른쪽, 아래쪽]` 정규화 좌표(0~1)입니다. 사용자 지정 영역을 저장하면 현재 그린 영역만 반환됩니다.

```http
PUT /api/web/admin/cameras/c110-1/calibration
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
```

기본 18칸 모드에서만 GET 응답의 `zones` 전체를 복사해 수정한 다음 `{ "zones": 수정한전체좌표 }`로 보낼 수 있습니다. **1~18번을 모두** 포함해야 합니다. 서로 겹치거나 0~1 범위를 벗어난 셀은 `400`입니다. 사용자 지정 영역이 활성화된 카메라에서는 개별 셀 보정 PUT이 `409`이며 아래 영역 배치 API로 수정합니다.

#### 사용자 지정 식물 영역과 식물 매칭

관리자 페이지에서 `영역 편집 시작`을 누른 뒤 영상 **아래** 도구 영역의 삼각형 두 개를 보정 영상의 좌상단과 우하단으로 끌어 놓습니다. 빨간 사각형 **하나가 식물 영상 하나**이며 `식물 영역 추가`로 개수와 크기를 자유롭게 정할 수 있습니다(카메라당 최대 144개). 기존 6×3 자동 분할은 새 영역을 저장하기 전까지만 유지됩니다.

기본 18칸에 이미 배정된 식물이 있다면 편집 시작 시 그 칸의 번호와 위치를 먼저 가져옵니다. 기존 식물의 스트림을 유지한 채 크기를 조정하거나 새 영역을 추가할 수 있습니다. 배정된 영역을 삭제하려면 먼저 관리자 스트리밍 화면에서 해당 식물을 다른 영역으로 옮기거나 미배정해야 합니다.

```http
GET /api/web/admin/cameras/c110-1/grid-layouts
Authorization: Bearer <관리자 JWT>
```

```json
{
  "success": true,
  "cameraId": "c110-1",
  "grids": [{ "id": "grid-1", "anchors": [[0.02, 0.04], [0.48, 0.96]] }],
  "customized": true,
  "zoneCount": 1,
  "zoneIds": [1],
  "assignableZones": [1]
}
```

`zoneIds`와 `assignableZones`는 실제 응답에서 전체 번호 배열입니다. `grid-1`은 영역 1번, `grid-2`는 영역 2번이며 ID가 번호를 고정하므로 다른 영역을 추가하거나 삭제해도 기존 식물의 번호는 이동하지 않습니다.

```http
PUT /api/web/admin/cameras/c110-1/grid-layouts
Authorization: Bearer <관리자 JWT>
Content-Type: application/json

{
  "grids": [
    { "id": "grid-1", "anchors": [[0.02, 0.04], [0.48, 0.96]] },
    { "id": "grid-2", "anchors": [[0.52, 0.04], [0.98, 0.96]] }
  ]
}
```

좌표는 0~1 정규화 값입니다. 겹치는 영역, 뒤집힌/너무 작은 영역, 중복 ID는 `400`입니다. 사용 중인 식물 칸이 사라지는 변경은 `409`입니다. 저장 후 RDK의 `grid_layouts.json`에 유지되고 관리자 영역 영상, 배정 가능 칸 수, 사용자별 영상 크롭에 즉시 적용됩니다. 각 영역은 좌상단·우하단 두 점으로 정의한 직사각형입니다.

```http
PATCH /api/web/admin/plants/:plantId/camera
Authorization: Bearer <관리자 JWT>
Content-Type: application/json

{ "rdkCameraId": "c110-1", "rdkZone": 20 }
```

관리자 `스트리밍` 화면에서 식물의 카메라와 빈 칸을 선택하면 이 API가 해당 식물 소유자에게 보여줄 영역을 배정합니다. 응답 `plant`에는 수정된 `rdkCameraId`, `rdkZone`, `streamingUrl`이 포함됩니다. 다른 식물이나 사용자 배정이 점유한 칸은 `409`입니다. `{ "rdkCameraId": null, "rdkZone": null }`은 배정을 해제합니다.

#### 베드 4점 평면화

원본 영상에서 베드 모서리 4점을 잡아 직사각형으로 펼칩니다. 관리자 페이지의 `베드 평면화` 탭에서 영상 **아래** 도구 영역의 원 4개를 좌상단→우상단→우하단→좌하단 위치로 끌어 놓고 다시 조정할 수 있습니다. 좌표는 원본 화면 기준 0~1 정규화 값이며 네 점은 볼록 사각형이어야 합니다.

```http
GET /api/web/admin/cameras/c110-1/perspective
Authorization: Bearer <관리자 JWT>
```

```json
{
  "success": true,
  "cameraId": "c110-1",
  "corners": [[0, 0], [1, 0], [1, 1], [0, 1]],
  "customized": false
}
```

```http
PUT /api/web/admin/cameras/c110-1/perspective
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
```

```json
{
  "corners": [[0.12, 0.16], [0.88, 0.12], [0.92, 0.86], [0.08, 0.9]]
}
```

저장 후 보정 프레임과 사용자별 식물 화면에 즉시 적용되며 RDK의 `perspective.json`에 유지됩니다. 수동 4점 설정이 활성화된 동안에는 추정 렌즈 계수와 자동 영역 검출을 섞지 않고 원본 기준 homography를 적용합니다. `DELETE /api/web/admin/cameras/:cameraId/perspective`는 수동 설정을 지우고 기존 설정 파일의 렌즈/자동 보정 경로로 복귀합니다. 평면화는 원근 투영을 보정하지만 광각 렌즈의 방사형 왜곡까지 교정하는 렌즈 캘리브레이션은 아닙니다.

RDK는 해당 카메라 영상 요청이 30초 동안 없으면 RTSP 캡처를 닫습니다. RDK의 `CAMERA_PRIVACY_COMMAND`를 설정하면 서비스 시작 시 프라이버시 모드를 켜고 시청 시작/유휴 종료에 맞춰 전환합니다. C110의 실제 전원은 유지됩니다. 제어 실패는 status API에 나타나며, RDK에 연결된 시청자만 감지합니다. 출력 영상은 `1280×720, 15 FPS`로 고정됩니다. C110 원본 RTSP 해상도는 Tapo 앱에서 별도로 설정하고 status API에서 확인해야 합니다. 출력 FPS 고정은 카메라→RDK 원본 RTSP 설정과 별개입니다.
## 7. 데모 데이터

`npm run seed:demo`로 프론트 테스트용 데이터를 생성할 수 있습니다. 실행을 반복하면 전용 데모 계정의 네 식물과 관련 기록을 새로 생성하고, 기존 미배정 데모 식물에는 예시 카메라·Zone을 채웁니다.

| 항목 | 값 |
| --- | --- |
| 이메일 | `demo@smartfarm.local` |
| 비밀번호 | `demo1234!` |
| 식물 | 상추·토마토·딸기·바질 |
| 스트리밍 설정 | `c110-1` Zone 1/2, `c110-3` Zone 1, `c110-4` Zone 1 |
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
