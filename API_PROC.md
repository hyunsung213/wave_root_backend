# 백엔드 API 점검·운영 절차

최종 점검 기준: 2026-10-09 (Asia/Seoul)

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
PUBLIC_BASE_URL=http://100.71.47.115:5000

# RDK X5 (Tailscale 주소; LAN 주소는 현장 네트워크 기준)
RDK_STREAM_BASE_URL=http://100.90.42.36:5001
RDK_STREAM_ADMIN_KEY=<스트림 할당 관리자 키>
RDK_API_KEY=<운영에서 RDK와 공유할 16자 이상 비밀키>
RDK_SENSOR_STALE_MS=180000
# Render 내부 Tailscale HTTP proxy의 host:port. 로컬에서 직접 Tailnet 접근 시 생략 가능
RDK_HTTP_PROXY_HOSTPORT=<private-tailscale-proxy-host>:1055

# Next.js origin. 여러 origin은 쉼표로 구분
FRONTEND_ORIGINS=http://localhost:3000

# 영속 볼륨에 연결된 이벤트 이미지 디렉터리
EVENT_UPLOAD_DIR=./uploads/events
```

현재 네트워크 역할:

| 장비 | 주소 | 확인할 경로 |
| --- | --- | --- |
| 백엔드 PC | Tailscale `100.71.47.115` | `http://100.71.47.115:5000/health` |
| RDK X5 | Tailscale `100.90.42.36` | 카메라·센서 할당 `:5001`; 센서 스냅샷은 백엔드로 outbound 전송. 구형 급수/UART `:5000` 서비스는 현재 비활성화 |
| C110 카메라 | LTE/T P-Link LAN 주소를 현장 입력 | `config/main.json`의 `cameras[].host` |

Render는 `PUBLIC_BASE_URL`이 없으면 `RENDER_EXTERNAL_URL`을 사용합니다. Render에서 RDK 사설 주소로 나가는 연결은 `RDK_HTTP_PROXY_HOSTPORT`에 설정한 내부 Tailscale 프록시를 통과해야 합니다. 센서 데이터는 RDK가 백엔드로 보내므로 센서 조회 API에서 RDK로 직접 접속하지 않습니다.

운영 `NODE_ENV=production`에서는 `MONGODB_URI`, `JWT_SECRET`, `RDK_API_KEY`, `RDK_STREAM_BASE_URL`, `RDK_STREAM_ADMIN_KEY`가 없거나 `replace-with-`로 시작하면 서버가 시작되지 않습니다. Render에서는 Tailscale 연결을 위해 프록시 host:port도 필요합니다.

### 배포 통신 설정

```text
브라우저/Next.js(Vercel) --HTTPS + Bearer JWT--> Render 백엔드
RDK X5 ----------------HTTPS + RDK API Key----> Render /api/rdk/current, /api/rdk/logs
브라우저 --단기 streamingUrl--> Render 백엔드 --내부 HTTP proxy + Tailscale--> RDK :5001
```

- Vercel의 `NEXT_PUBLIC_API_BASE_URL`은 Render 백엔드 origin(`https://<service>.onrender.com`)으로 지정하고, Render `FRONTEND_ORIGINS`에는 Vercel 운영 도메인을 정확히 등록합니다.
- 운영 프론트 origin `https://wave-root-client.vercel.app`은 백엔드 CORS 코드에서 항상 허용합니다. Preview/custom 도메인은 `FRONTEND_ORIGINS`에 별도로 추가합니다.
- RDK 환경 파일의 `BACKEND_API_BASE`는 `https://<service>.onrender.com/api/rdk`, `RDK_API_KEY`는 Render와 같은 값, `BACKEND_SENSOR_INTERVAL_SECONDS=60`입니다. 센서 업로드는 RDK에서 시작하는 HTTPS 연결이므로 RDK inbound port-forward를 만들지 않습니다.
- Render에는 같은 Render region의 private service로 Tailscale HTTP proxy를 준비합니다. 공식 Tailscale 컨테이너 설정은 `TS_USERSPACE=true`, `TS_OUTBOUND_HTTP_PROXY_LISTEN=:1055`, `TS_AUTHKEY=<ephemeral auth key>`입니다. Tailnet ACL/grant는 이 노드가 RDK의 스트림 API port `5001`에만 접근하도록 제한하고, Render backend의 `RDK_HTTP_PROXY_HOSTPORT`에 private service의 `host:1055`를 지정합니다.
- 식물 `streamingUrl`은 브라우저에 RDK IP를 노출하지 않는 백엔드 URL입니다. Render 백엔드가 단기 서명 ticket을 확인하고 Tailscale proxy를 통해 MJPEG 응답을 중계합니다.
- 이벤트 이미지는 현재 로컬 `EVENT_UPLOAD_DIR` 파일로 저장됩니다. Render 기본 filesystem은 재배포/재시작 후 보존되지 않으므로, 배포 운영에서는 이 경로에 persistent disk를 마운트하거나 object storage로 바꿔야 합니다. 저장 방식을 확정하기 전에는 이미지 영속성을 보장하는 운영 배포로 간주하지 않습니다.

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
| `POST` | `/api/web/plants` | 기존 일반 식물 생성 차단(`403`); 분양 식물은 관리자 주문 확인에서만 생성 |
| `GET` | `/api/web/plants` | 소유 식물 목록과 성장 계산값 반환 |
| `GET` | `/api/web/plants/:plantId` | 소유권 확인 후 상세 정보와 (카메라 할당 시) `streamingUrl` 반환 |
| `PATCH` | `/api/web/plants/:plantId` | 이름·품종·카메라/Zone·성장 목표일 수정 |
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

## 10. 분양 계좌이체·쿠폰 API

분양 상품의 ID·기본 가격은 `src/config/catalog.js`에 정의되고, 관리자 상태·가격·첫 수확 목표일 변경은 MongoDB `ProductAvailability`에 저장합니다. 서버에서 최종 가격을 계산하며 프론트에서 전달한 가격/할인액은 신뢰하지 않습니다. 주문 접수 단계에서는 식물을 만들지 않습니다. 관리자 주문 화면에서 입금 확인을 시작하면 RDK에서 현재 미배정인 카메라 영역 목록을 불러오고, 관리자가 하나를 선택해 주문 확정과 동시에 식물에 연결할 수 있습니다. 노드를 건너뛰거나 가용 노드가 없으면 주문만 확정할 수 있으며, 주문 목록의 `노드 연결` 동작으로 나중에 배정할 수 있습니다. 연결은 기존 관리자 식물 카메라 API로 RDK와 DB에 반영합니다.

분양 상태는 `available`(분양 진행 중), `upcoming`(분양 예정), `blocked`(분양 금지 중)입니다. 사용자용 목록은 `blocked`를 숨기고 `upcoming`을 비활성으로 표시합니다. 쿠폰 검증·주문 생성 API는 `upcoming`·`blocked`를 `409`로 거부합니다. 청경채(`bok_choy`)·얼갈이 배추(`young_napa_cabbage`)는 처음에는 `upcoming`이며 가격과 첫 수확 목표일이 미정입니다. 관리자가 두 값을 입력해야 `available`로 변경할 수 있습니다. 기존 주문은 상태·가격 변경 뒤에도 주문 당시 값으로 확정됩니다.

일반 사용자 `POST /api/web/plants`는 주문 우회 생성을 막기 위해 `403`을 반환합니다. 사용자 `PATCH /api/web/plants/:plantId`는 이름·종류·성장 목표일만 허용하고 카메라 ID/구역 수정은 관리자 엔드포인트로 제한합니다.

계좌이체 주문 활성화 전 Render 환경에 실제 은행·계좌·예금주를 설정합니다. 미설정/placeholder 상태에서는 금액이 0원인 주문만 접수되며, 유료 주문은 503으로 차단됩니다.

```env
DEPOSIT_BANK_NAME=<실제 은행명>
DEPOSIT_ACCOUNT_NUMBER=<실제 계좌번호>
DEPOSIT_ACCOUNT_HOLDER=<실제 예금주>
```

| 메서드 | 경로 | 인증 | 설명 |
| --- | --- | --- | --- |
| `GET` | `/api/web/catalog` | 없음 | 사용자에게 표시할 상품; 분양 금지 중 제외, 응답 `products: [{ id, name, price, growthTargetDays, status }]` |
| `GET` | `/api/web/admin/catalog` | 관리자 | 금지 중 포함 전체 상품 목록 |
| `PATCH` | `/api/web/admin/catalog/:productId` | 관리자 | `{ status, price?, growthTargetDays? }`; 가격 1~1,000,000원, 목표일 1~3,650일 정수 |
| `GET` | `/api/web/coupons` | 사용자 | 공개/내 계정에 발급된 사용 가능한 쿠폰 |
| `POST` | `/api/web/coupons/validate` | 사용자 | `{ productId, code }`; 서버 가격 기준 할인액·결제액 미리보기 |
| `POST` | `/api/web/orders` | 사용자 | `{ productId, plantName, depositorName, couponCode? }`; 계좌이체 주문 생성 |
| `GET` | `/api/web/orders` | 사용자 | 본인 주문 목록 |
| `GET` | `/api/web/orders/:orderId` | 사용자 | 본인 주문 상세 |
| `POST` | `/api/web/orders/:orderId/cancel` | 사용자 | 입금 대기 주문 취소; 해당 사용자의 쿠폰 사용 예약 해제 |
| `GET` | `/api/web/admin/orders` | 관리자 | 최근 500개 주문; `plantId`에 식물의 `rdkCameraId`, `rdkZone` 포함 |
| `POST` | `/api/web/admin/orders/:orderId/confirm` | 관리자 | 입금 확인; 안전한 재시도 가능한 식물 생성 후 확정 알림 |
| `GET` | `/api/web/admin/cameras` | 관리자 | RDK가 제공하는 미배정 카메라 영역 목록 |
| `GET` | `/api/web/admin/plants` | 관리자 | 식물별 현재 카메라·영역 배정을 포함한 목록; 노드 중복 방지에 사용 |
| `PATCH` | `/api/web/admin/plants/:plantId/camera` | 관리자 | `{ rdkCameraId, rdkZone }`로 RDK 및 DB에 노드 배정; 이미 사용 중이면 `409` |
| `GET` | `/api/web/admin/coupons` | 관리자 | 쿠폰/사용량/발급 대상 목록 |
| `GET` | `/api/web/admin/coupon-users` | 관리자 | 발급 대상 사용자 선택 목록 |
| `POST` | `/api/web/admin/coupons` | 관리자 | 쿠폰 생성. `userIds`를 포함하면 비공개 발급 및 사용자 알림 |
| `POST` | `/api/web/admin/coupons/:couponId/issue` | 관리자 | 기존 쿠폰을 사용자들에게 발급 |
| `PATCH` | `/api/web/admin/coupons/:couponId` | 관리자 | `{ isActive: boolean }`으로 쿠폰 사용 중지/재개 |
| `GET` | `/api/web/admin/alerts` | 관리자 | 알림 사용 여부와 Discord 웹훅 설정 여부 조회(웹훅 URL은 반환하지 않음) |
| `PATCH` | `/api/web/admin/alerts` | 관리자 | `{ signupAlerts?, orderAlerts?, cameraAlerts? }` 알림 설정 저장 |
| `POST` | `/api/web/admin/alerts/test` | 관리자 | Discord 테스트 메시지 전송 |
| `GET` | `/api/web/admin/cameras/status` | 관리자 | 전체 RDK 카메라의 reader/프레임 연결 상태 조회 |

쿠폰은 `percent`(1–100 정수) 또는 `fixed`(원 단위 정수) 할인입니다. 활성 상태, 유효기간 및 비공개 쿠폰 발급 계정을 확인합니다. 같은 쿠폰은 **사용자마다 1회**만 주문에 적용할 수 있습니다. 주문 접수 시 사용이 예약되고 입금 대기 주문을 취소하면 다시 사용할 수 있으며, 확정 후에는 재사용할 수 없습니다. 서로 다른 사용자에게는 동일한 쿠폰 코드를 발급할 수 있습니다. 관리자 생성 요청의 `maxUses`는 지원하지 않으며 전달하면 `400`입니다. 기존 쿠폰의 전체 사용 한도 값도 적용하지 않습니다.

쿠폰은 선택 표시 이름(`name`, 최대 60자)을 설정할 수 있고 쿠폰 코드(`code`)는 ASCII 영문·숫자·하이픈·밑줄 3~32자입니다. 표시 이름은 checkout에서 보이고 코드로 적용합니다.

## Discord 관리자 이벤트 알림

서버 환경변수 `DISCORD_WEBHOOK_URL`에 비공개 Discord 채널의 HTTPS incoming webhook URL을 설정합니다. 관리자 `/admin/`의 **알림 설정**에서 가입·신규 주문·카메라 끊김/복구 알림을 각각 켜거나 끄고 테스트 메시지를 보낼 수 있습니다. 실제 웹훅 주소는 API에 반환되지 않습니다. 설정 기본값은 모두 활성입니다. 카메라 장애 감시는 30초 간격으로 검사하고, RDK 프레임 리더가 활성인데 2회 연속(통상 약 60초) 프레임이 끊겼을 때 알립니다. 유휴 또는 프라이버시 모드 상태는 장애 알림 대상이 아닙니다. `GET /api/cameras/status` RDK camera-status-list 엔드포인트가 필요합니다.

새 주문 응답은 화면에 계좌 정보를 포함하며, 주문 생성 자체는 결제 완료를 뜻하지 않습니다. 관리자가 실제 입금을 확인하기 전까지 사용자의 식물 목록에는 해당 주문 식물이 없어야 합니다. 관리자 주문 API의 `GET /api/web/admin/cameras`는 RDK가 현재 미배정으로 보고한 카메라·영역 쌍을 반환합니다. 관리자 UI는 `GET /api/web/admin/plants`의 DB 배정 현황도 대조한 뒤 선택지를 표시하고, 입금 확인 후 `POST /api/web/admin/orders/:orderId/confirm`으로 생성된 `plant._id`에 선택한 노드를 `PATCH /api/web/admin/plants/:plantId/camera`로 연결합니다. 노드 선택/연결을 건너뛴 확정 주문은 재시도 가능한 `노드 연결` 버튼을 표시합니다.

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

RDK는 활성 식물 카메라 할당을 기준으로 센서를 연결하고 60초마다 아래 API로 최신 스냅샷을 백엔드에 전송합니다. 이 경로는 아웃바운드 HTTPS이므로 LTE 라우터에서 RDK의 포트를 외부에 공개할 필요가 없습니다.

```http
POST /api/rdk/current
X-RDK-API-Key: <RDK_API_KEY>
Content-Type: application/json
```

```json
{
  "plantId": "<MongoDB Plant ObjectId>",
  "degree": 24.5,
  "moisture_air": 45.2,
  "moisture_soil": 2500,
  "rux": 1200,
  "sampledAt": "2026-10-09T00:00:00.000Z"
}
```

같은 식물 스냅샷은 `plantId` unique 인덱스로 upsert되므로 반복 전송해도 스냅샷 문서가 누적되지 않습니다. 과거 시각의 재전송은 최신 스냅샷을 덮어쓰지 않습니다. 원시값 범위는 `degree -50~100`, `moisture_air 0~100`, `moisture_soil 0~4095`, `rux 0~200000`이며 조도 센서가 없으면 `rux: null`을 보낼 수 있습니다.

웹 `GET /api/web/plants/:plantId/current`는 MongoDB에 마지막으로 수신된 스냅샷을 반환합니다. 데이터가 없거나 마지막 측정 시각이 180초보다 오래되면 일관되게 `503`을 반환합니다. 프론트는 기존처럼 Bearer JWT로 호출하면 됩니다.

센서 이력의 10분 평균 로그는 기존처럼 RDK가 `POST /api/rdk/logs`로 별도 전송합니다. 실시간 화면 스냅샷과 평균 로그는 서로 다른 용도입니다.

단일 식물 조회의 `plant.streamingUrl`은 브라우저에서 Render 백엔드의 스트림 프록시를 가리킵니다. 백엔드는 RDK에 카메라·Zone을 배정하고 1시간짜리 서명 티켓을 발급합니다. 이미지 요청은 이 티켓으로 백엔드에 도착하고, 백엔드가 Tailscale HTTP 프록시를 통해 RDK의 `GET /api/stream/:token`을 연결합니다. 따라서 브라우저가 `100.x` Tailnet IP나 RDK 포트에 직접 접근하지 않습니다. 카메라 설정 또는 할당이 없으면 `streamingUrl`은 `null`입니다. 사용자 지정 영역은 각 사각 영역마다 하나의 식물 영상을 생성합니다(카메라당 최대 144개).

관리자 페이지의 `카메라 설정` 화면은 다음 백엔드 API를 사용합니다.

```http
GET /api/web/admin/cameras
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/raw
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/frame/:mode
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/calibration
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/grid-layouts
Authorization: Bearer <관리자 JWT>

PUT /api/web/admin/cameras/:cameraId/grid-layouts
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
{ "grids": [{ "id": "grid-1", "anchors": [[0.02,0.04],[0.48,0.96]] }, { "id": "grid-2", "anchors": [[0.52,0.04],[0.98,0.96]] }] }

PATCH /api/web/admin/plants/:plantId/camera
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
{ "rdkCameraId": "c110-1", "rdkZone": 2 }

GET /api/web/admin/cameras/:cameraId/perspective
Authorization: Bearer <관리자 JWT>

PUT /api/web/admin/cameras/:cameraId/perspective
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
{ "corners": [[0.12,0.16],[0.88,0.12],[0.92,0.86],[0.08,0.9]] }

DELETE /api/web/admin/cameras/:cameraId/perspective
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/status
Authorization: Bearer <관리자 JWT>

GET /api/web/admin/cameras/:cameraId/profile
Authorization: Bearer <관리자 JWT>

PUT /api/web/admin/cameras/:cameraId/profile
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
{ "fps": 15 }

PUT /api/web/admin/cameras/:cameraId/calibration
Authorization: Bearer <관리자 JWT>
Content-Type: application/json
```

`:mode`는 `raw`, `corrected`, `grid` 중 하나입니다. Calibration PUT 본문은 1~18번 좌표를 모두 포함하며 RDK가 범위와 겹침을 검증·저장합니다. 관리자 화면은 선택한 카메라 영상 한 개만 갱신하며 5초 간격으로 프라이버시 상태와 해상도를 조회합니다. status 응답의 `source_width/height`가 1280×720이 아니면 화면에 확인 경고가 뜹니다. 이 경고는 표시 전용이며 C110 원본 해상도 변경은 Tapo 앱에서 해야 합니다. 영상 요청이 끊긴 뒤 기본 30초가 지나면 RDK가 RTSP 캡처를 닫고 `CAMERA_PRIVACY_COMMAND`가 구성된 경우 C110 프라이버시 모드도 켭니다. 새 요청 시 프라이버시 모드를 해제합니다. 출력 규격은 1280×720/15 FPS로 고정이며 profile PUT은 이 값을 확인하는 멱등 요청입니다. 다른 FPS 값은 400입니다.

베드 원근 보정은 `corners`에 원본 프레임 기준 정규화 좌표 네 점을 좌상단→우상단→우하단→좌하단 순서로 전달합니다. PUT은 4점이 만드는 베드 영역을 직사각형으로 평면화하고 RDK에 저장·즉시 적용합니다. DELETE는 기존 렌즈/자동 보정 설정으로 복귀합니다. 관리자 UI의 `베드 평면화` 탭에서 영상 아래 원 4개를 원본 위로 끌어 놓고 다시 조정할 수 있습니다. 이 보정은 원근 변환이며 렌즈의 방사형 왜곡 자체를 제거하는 광학 캘리브레이션과는 구분됩니다.

기본 18칸 모드의 Calibration PUT은 1~18번 좌표를 모두 포함합니다. 사용자 지정 영역을 저장한 후에는 개별 셀 PUT 대신 grid-layouts PUT을 사용합니다. 두 삼각형이 만든 빨간 사각형 하나가 하나의 식물 영상이며 `grid-1`은 영역 1번, `grid-2`는 영역 2번입니다. 이미 식물에 배정된 칸이 사라지는 변경은 409이며 먼저 관리자 스트리밍 화면에서 식물을 다른 칸으로 옮겨야 합니다. 배치된 영역은 RDK의 `grid_layouts.json`에 재시작 후에도 유지됩니다.

`status` 응답에는 `privacy_state`(`on`, `off`, `error`, `unconfigured`), `source_width/height`, `output_width/height`가 포함됩니다. `unconfigured` 또는 `error`이면 카메라 송출이 중단됐다고 간주하면 안 됩니다.

운영 RDK 직접 확인:

```bash
curl --noproxy "*" http://100.90.42.36:5001/api/availability
curl --noproxy "*" -H 'X-Admin-Key: <ADMIN_API_KEY>' http://100.90.42.36:5001/api/cameras/c110-1/status
curl --noproxy "*" -H 'X-Admin-Key: <ADMIN_API_KEY>' http://100.90.42.36:5001/api/cameras/c110-1/profile
curl --noproxy "*" -X PUT -H 'X-Admin-Key: <ADMIN_API_KEY>' -H 'Content-Type: application/json' -d '{"fps":15}' http://100.90.42.36:5001/api/cameras/c110-1/profile
```

센서값 확인은 Render 백엔드 `GET /api/web/plants/:plantId/current`에 사용자 Bearer JWT로 요청합니다. 값이 없거나 오래됐으면 RDK 서비스 로그에서 `BACKEND_API_BASE`, `RDK_API_KEY`, `BACKEND_SENSOR_INTERVAL_SECONDS`, 센서 시리얼 상태를 확인합니다. Render에서 RDK 스트림 연결은 내부 Tailscale HTTP proxy를 거칩니다.

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
| 센서 API `503` | RDK `BACKEND_API_BASE`/`RDK_API_KEY`, 활성 식물의 카메라 할당, `smartfarm-main` 센서·전송 로그, 스냅샷의 `sampledAt` |
| 스트림 이미지 미표시 | `plant.streamingUrl`, RDK `:5001/api/availability`, C110 host/계정 및 카메라 로그 |
| RDK API `401` | RDK 코드에 `X-RDK-API-Key` 추가, 백엔드와 동일한 `RDK_API_KEY`인지 확인 |
| API `401` | Bearer 토큰 만료·위조·비밀번호 변경 시각 확인 |
| API `404` | 식물·이벤트 소유권과 ObjectId 확인 |
| API `400` | JSON 타입, 날짜, 페이지네이션, 센서 범위 확인 |

추가 운영 권고: 다중 인스턴스 배포에서는 `EVENT_UPLOAD_DIR`을 공유 영속 볼륨 또는 S3 호환 object storage로 교체하고, rate limit·구조화 로그 수집기·백그라운드 작업 큐를 붙입니다.

## 9. 2026-10-09 실환경 통합 점검 결과

| 구간 | 결과 | 확인 사항 |
| --- | --- | --- |
| 로컬 백엔드 | 통과 | 오래된 Node 프로세스를 현재 소스로 재시작. `/health/ready` 반환, 보호 프로필 무인증 요청은 401, 유효한 RDK 키로 형식 오류 요청 시 `/api/rdk/current`가 400 반환. `npm test` 17/17 통과. |
| RDK 센서 전송 코드 | 배포 완료, 실센서 미확인 | RDK `smartfarm-main`에 식물별 최신 스냅샷을 60초마다 `/api/rdk/current`로 보내는 최신 코드를 반영하고 재시작함. 백엔드 MongoDB에는 현재 `SensorSnapshot` 0건. RDK에서 `/dev/ttyUSB0`, `/dev/ttyACM*`가 없고 USB 목록에는 허브만 있어 실제 센서 데이터가 없어 전송 성공은 확인할 수 없음. |
| RDK 카메라 | 부분 통과 | SSH 연결, `smartfarm-main` active, `/api/availability` HTTP 200. 4대 모두 RTSP 554 포트 접속 가능하고 상태 API HTTP 200, 출력 1280×720/15 FPS. `c110-1`의 원본·보정·그리드 JPEG가 모두 HTTP 200으로 확인됨. LTE 사용량을 줄이기 위해 나머지 3대는 실제 프레임을 열지 않음. 30초 무요청 후 reader가 종료되는 것을 확인함. |
| 카메라 프라이버시 | 미설정 | 네 카메라 모두 `privacy_state=unconfigured`. 미시청 시 RDK의 RTSP reader는 닫히지만 Tapo 프라이버시 모드가 켜졌다는 뜻은 아님. |
| 프론트엔드 로컬 | 통과 | ESLint와 Next.js production build 통과. |
| Vercel Preview | 페이지 전달만 통과 | `/`, `/login` HTTP 200. 배포 JS에 `http://localhost:5000` 기본값이 포함되어 실제 원격 API 호출은 사용할 수 없음. `NEXT_PUBLIC_API_BASE_URL`을 확인/변경할 권한은 403이고 Render 공개 URL도 아직 없음. Production 배포는 기존 초기 커밋 상태이므로 최신 Preview와 다름. |
| Render 백엔드 | 미배포 | Render 서비스 URL, 대시보드/CLI 권한, RDK 스트림용 Tailscale HTTP proxy 설정이 없어 외부 API 연결은 완료할 수 없음. |

급수는 이번 점검에서 호출하지 않았습니다. 구형 급수·UART 서비스 `smartfarm-rdk`는 급수 제외 및 `/dev/ttyUSB0` 경합 방지를 위해 중지하고 부팅 자동시작을 해제했습니다. DB의 기존 급수 명령은 삭제하거나 변경하지 않았으며 전체 식물에 `PENDING` 9건이 남아 있습니다. 급수 서비스를 다시 켜기 전 이 명령을 정리할지 확인해야 합니다. 실서비스 센서 확인에는 RDK에 센서를 연결해 실제 serial device 경로를 확인한 뒤 `smartfarm-main` 로그와 `SensorSnapshot.sampledAt`을 확인해야 합니다. 완전한 Vercel→Render→RDK 통합은 Render URL과 Vercel 환경변수 권한이 준비된 뒤 재점검합니다.

