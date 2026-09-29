# 백엔드 API 점검·운영 절차

최종 점검 기준: 2026-09-29 (Asia/Seoul)

이 문서는 `main` 브랜치의 API 계약과 운영자가 확인해야 하는 항목을 정리한 문서입니다. 웹 프론트는 백엔드 주소에 `/api/web`를 붙여 호출하고, RDK X5는 `/api/rdk`를 호출합니다.

## 1. 공통 규칙

- 성공 응답: `{ "success": true, ... }`
- 오류 응답: `{ "success": false, "message": "..." }`
- 보호된 웹 API: `Authorization: Bearer <JWT>`
- RDK API 운영 인증: `X-RDK-API-Key: <RDK_API_KEY>` 또는 `Authorization: Bearer <RDK_API_KEY>`
- 잘못된 JWT, 만료 JWT, 다른 사용자의 리소스 접근은 각각 `401` 또는 `404`로 거부합니다.
- 모든 영속 모델은 `createdAt`, `updatedAt`을 자동 생성합니다.
- 모든 응답에는 `X-Request-Id`가 포함됩니다. 장애 신고 시 이 값을 함께 전달합니다.
- `/api` 전체에는 IP 기준 분당 300회 rate limit이 적용됩니다. 초과 시 `429`를 반환합니다.

## 2. 운영자가 입력할 환경값

`.env`에 실제 값을 입력합니다. 비밀키는 저장소에 커밋하지 않습니다.

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>/<database>?retryWrites=true&w=majority
JWT_SECRET=<긴 랜덤 문자열>
JWT_EXPIRES_IN=7d

# 백엔드 서버(현재 개발 PC 예시)
PUBLIC_BASE_URL=http://172.16.240.102:5000

# RDK X5 (Flask edge_server.py)
RDK_CURRENT_API_URL=http://172.16.240.191:5000/api/rdk/current
RDK_STREAMING_BASE_URL=http://172.16.240.191:5000/video_feed
RDK_CURRENT_TIMEOUT_MS=5000
RDK_API_KEY=<운영에서 RDK와 공유할 16자 이상 비밀키>

# Next.js origin. 여러 origin은 쉼표로 구분
FRONTEND_ORIGINS=http://localhost:3000

# 영속 볼륨에 연결된 이벤트 이미지 디렉터리
EVENT_UPLOAD_DIR=./uploads/events
```

현재 네트워크 역할:

| 장비 | 주소 | 확인할 경로 |
| --- | --- | --- |
| 백엔드 PC | `172.16.240.102` | `http://172.16.240.102:5000/health` |
| RDK X5 | `172.16.240.191` | `/api/rdk/current`, `/video_feed` |
| ESP32-CAM | `172.16.240.251` | RDK가 프록시하는 카메라 원본 |

운영 `NODE_ENV=production`에서는 `MONGODB_URI`, `JWT_SECRET`, `RDK_API_KEY`가 없거나 `replace-with-`로 시작하면 서버가 시작되지 않습니다.

## 3. 인증·사용자 API 점검

### 회원가입·로그인

```http
POST /api/web/users/signup
{ "name": "홍길동", "email": "user@example.com", "phone": "010-1234-5678", "pwd": "password1234" }
```

```http
POST /api/web/users/login
{ "email": "user@example.com", "pwd": "password1234" }
```

응답의 `accessToken`을 이후 Bearer 토큰으로 사용합니다.

### 내 정보 조회·수정

```http
GET /api/web/users/me
PATCH /api/web/users/me
Authorization: Bearer <token>
{ "name": "새 이름", "phone": "010-0000-0000" }
```

수정 API는 수정된 `user`를 반환합니다. 비밀번호는 JSON에 포함되지 않습니다.

### 비밀번호 변경

```http
PATCH /api/web/users/password
Authorization: Bearer <token>
{ "currentPwd": "현재비밀번호", "newPwd": "새비밀번호1234" }
```

성공하면 새 JWT가 반환되고, 변경 이전에 발급된 토큰은 무효화됩니다.

## 4. 식물·성장 데이터 API 점검

| 메서드 | 경로 | 점검 내용 |
| --- | --- | --- |
| `POST` | `/api/web/plants` | 이름·품종 생성. `streamingPort` 생략 시 `5000`, `growthTargetDays` 생략 시 `60` |
| `GET` | `/api/web/plants` | 소유 식물만 반환하며 `streamingUrl`, 성장 계산값 포함 |
| `GET` | `/api/web/plants/:plantId` | 소유권 확인 후 `streamingUrl` 반환 |
| `PATCH` | `/api/web/plants/:plantId` | 이름·품종·스트리밍 포트·성장 목표일 수정 |
| `DELETE` | `/api/web/plants/:plantId` | Event/Log/Water/Command와 이벤트 이미지 파일을 cascade 삭제 |
| `GET` | `/api/web/plants/with-records?recordLimit=30` | 식물별 최근 급수·이벤트를 한 번에 반환 (`1~100`) |

식물 응답에는 다음 성장 필드가 포함됩니다.

```json
{
  "createdAt": "2026-09-01T00:00:00.000Z",
  "growthTargetDays": 60,
  "growthDays": 28,
  "growthPercent": 47
}
```

성장 이벤트 생성:

```http
POST /api/web/events
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

필수 multipart 필드는 `plantId`, `title`, `content`; 선택 필드는 `eventDate`, `image`입니다. 이미지는 JPEG/PNG/WebP, 최대 5MB이며 `EVENT_UPLOAD_DIR`에 저장됩니다. DB 저장 실패 또는 이벤트/식물 삭제 시 업로드 파일도 정리합니다. `imageUrl`은 `PUBLIC_BASE_URL` 기준 절대 URL입니다.

```http
GET /api/web/events/:plantId?page=1&limit=30&order=desc
DELETE /api/web/events/:eventId
```

## 5. 센서·스트리밍 API 점검

프론트는 RDK에 직접 요청하지 않고 아래 백엔드 API를 사용합니다.

```http
GET /api/web/plants/:plantId/current
Authorization: Bearer <token>
```

성공 계약:

```json
{
  "success": true,
  "sensor": {
    "degree": 24.5,
    "moisture_air": 45.2,
    "moisture_soil": 2500,
    "rux": 1200,
    "timestamp": 1722253800
  }
}
```

백엔드는 `RDK_CURRENT_API_URL`을 `RDK_CURRENT_TIMEOUT_MS` 안에 호출하고, timeout·연결 실패·RDK 비정상 응답은 `503`으로 반환합니다. 센서 원시값 범위는 `degree -50~100`, `moisture_air 0~100`, `moisture_soil 0~4095`, `rux/lux 0~200000`입니다. RDK가 `lux`를 보내도 백엔드가 `rux`로 정규화합니다.

단일 식물 조회의 `plant.streamingUrl`은 `RDK_STREAMING_BASE_URL`의 호스트·경로에 식물의 `streamingPort`를 결합한 값입니다. 브라우저에서 직접 접근하려면 RDK X5의 포트가 프론트 네트워크에서 열려 있어야 합니다.

운영 RDK 직접 확인:

```bash
curl --noproxy "*" http://172.16.240.191:5000/api/rdk/current
curl --noproxy "*" -I http://172.16.240.191:5000/video_feed
```

## 6. 급수 명령 흐름 점검

```http
POST /api/web/control/water
Authorization: Bearer <token>
Idempotency-Key: <클라이언트 요청별 고유키>
{ "plantId": "...", "volume": 150 }
```

웹 API는 `PENDING` Command를 만들고, RDK가 다음 API를 폴링합니다.

```http
GET /api/rdk/command/:plantId
X-RDK-API-Key: <RDK_API_KEY>
```

펌프 동작 후 완료 보고:

```http
POST /api/rdk/water
X-RDK-API-Key: <RDK_API_KEY>
{ "plantId": "...", "commandId": "...", "volume": 150 }
```

완료 보고는 `commandId` unique 제약으로 재전송해도 Water 중복 기록을 만들지 않습니다. 같은 `Idempotency-Key`로 웹 명령을 재전송해도 기존 Command를 반환합니다.

## 7. 로그·물·알림·활동 API 점검

| 메서드 | 경로 | 비고 |
| --- | --- | --- |
| `GET` | `/api/web/logs/:plantId?page=1&limit=30` | RDK 10분 평균 로그, `page/limit` 엄격 검증 |
| `GET` | `/api/web/water/:plantId?page=1&limit=30` | 완료 급수 이력, `page/limit` 엄격 검증 |
| `GET` | `/api/web/activity` | 성장·실시간 조회·급수·수확 카운터 |
| `POST` | `/api/web/activity/harvest` | 소유 식물 수확 카운터 증가 |
| `POST` | `/api/web/notifications` | `GROWTH/WATER/HARVEST/SENSOR/INFO`만 허용 |
| `GET` | `/api/web/notifications?page=1&limit=30&unreadOnly=true` | `content`, `createdAt`, `isRead` 포함 |
| `PATCH` | `/api/web/notifications/:notificationId/read` | 이미 읽은 알림 재호출도 성공하는 멱등 처리 |

`page=0`, `page=abc`, `limit=abc`, 음수·소수·`limit>100`, `recordLimit>100`은 모두 `400`입니다.

## 8. 운영 readiness와 장애 분류

```http
GET /health
GET /health/ready
```

`/health`는 프로세스 생존, `/health/ready`는 MongoDB 연결 상태를 확인합니다. readiness가 `503`이면 DB 연결·MongoDB Atlas 네트워크 허용 IP·자격 증명을 먼저 확인합니다.

| 증상 | 확인 순서 |
| --- | --- |
| 센서 API `503` | `RDK_CURRENT_API_URL`, RDK X5 `ss -lntp`, `curl --noproxy "*"`, 같은 사설망 여부 |
| 스트림 이미지 미표시 | `plant.streamingUrl`, 브라우저에서 RDK IP:포트 접근, `/video_feed` 200 여부 |
| RDK API `401` | RDK 코드에 `X-RDK-API-Key` 추가, 백엔드와 동일한 `RDK_API_KEY`인지 확인 |
| API `401` | Bearer 토큰 만료·위조·비밀번호 변경 시각 확인 |
| API `404` | 식물·이벤트 소유권과 ObjectId 확인 |
| API `400` | JSON 타입, 날짜, 페이지네이션, 센서 범위 확인 |

추가 운영 권고: 다중 인스턴스 배포에서는 `EVENT_UPLOAD_DIR`을 공유 영속 볼륨 또는 S3 호환 object storage로 교체하고, rate limit·구조화 로그 수집기·백그라운드 작업 큐를 붙입니다.

