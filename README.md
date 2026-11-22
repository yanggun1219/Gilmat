# 길맛 (Gilmat) v2.0 — 개인용 실서비스 PWA 배포 패키지

출발지 A에서 목적지 B로 이동하는 실제 자동차 경로 위의 **모든 맛집·카페·놀거리**를 실시간으로 탐색하고, **우회시간·Google 원본 평점·도착 시각 영업 여부·고속도로 IC 오탐 제외** 필터로 1초 만에 걸러내는 개인용 PWA(갤럭시 Z Fold8 최적화)입니다.

- **유지비 월 0원:** Cloudflare Pages 무료 플랜 + 카카오맵 REST(일 10만 건 무료) + Google Places API (New) Enterprise(월 1,000건 무료) + 한국관광공사 TourAPI(무료) 조합.
- **CORS·키 노출 방지:** 모든 API 호출은 `functions/api/` 서버리스 프록시에서 실행되며, API 키는 브라우저 코드에 노출되지 않습니다.

---

## 1. 무료 API 키 발급 (최초 1회, 약 10분)

1. **카카오 REST API 키 (필수)**
   - [카카오디벨로퍼스](https://developers.kakao.com) → 내 애플리케이션 → 앱 생성 → **앱 키 > REST API 키** 복사.
   - 같은 앱에서 **제품 설정 > 카카오맵** 활성화(첫 활성화 앱 1개에 일 100,000건 무료) 및 [카카오모빌리티 디벨로퍼스](https://developers.kakaomobility.com) 길찾기 API 활성화.
2. **Google Places API (New) 키 (평점·영업시간 필터용 권장)**
   - [Google Cloud Console](https://console.cloud.google.com) → 프로젝트 생성 → **Places API (New)** 사용 설정 → 사용자 인증 정보에서 API 키 생성.
   - **과금 0원 안전장치(필수 권장):** `API 및 서비스 > Places API (New) > 할당량(Quotas)`에서 일간/월간 호출 상한을 무료 한도(월 1,000건) 이하인 **월 900건**으로 잠가 두면 실수로 과금될 위험이 없습니다.
3. **한국관광공사 TourAPI 키 (놀거리 보강 · 선택)**
   - [공공데이터포털](https://www.data.go.kr/data/15101578/openapi.do) → `한국관광공사_국문 관광정보 서비스_GW` 활용 신청 → 일반 인증키(Decoding) 복사.

---

## 2. 로컬에서 10초 만에 바로 테스트하기 (Node.js 18+)

```bash
cp .env.example .env
# .env 파일을 열어 발급받은 KAKAO_REST_API_KEY, GOOGLE_PLACES_API_KEY 입력
node dev-server.mjs
```

브라우저에서 `http://localhost:8788`을 열고 `오패산로 46` → `인천국제공항 제1여객터미널`, 메뉴 키워드에 `고등어`나 `막국수`(또는 비워두고 전체 탐색)를 입력해 **경로 탐색**을 눌러 보세요.

---

## 3. Cloudflare Pages 무료 배포 (갤럭시 Z Fold8 PWA 설치)

1. 이 폴더(`gilmat-v2-pwa`)를 본인 GitHub 비공개(Private) 저장소에 올립니다.
2. [Cloudflare Dashboard](https://dash.cloudflare.com) → **Workers & Pages > Create > Pages > Connect to Git**에서 해당 저장소를 선택합니다.
3. 빌드 설정:
   - **Build command:** (비워둠)
   - **Build output directory:** `public`
   - (`functions/api/` 폴더는 Cloudflare Pages가 자동으로 서버리스 API로 인식합니다.)
4. **Settings > Environment variables**에 아래 비밀 변수를 추가하고 **Save & Redeploy** 합니다:
   - `KAKAO_REST_API_KEY`
   - `GOOGLE_PLACES_API_KEY`
   - `TOUR_API_KEY` (선택)
   - `MAX_GOOGLE_ENRICH_PER_SEARCH` = `35` (선택)
5. 배포된 `https://xxxx.pages.dev` 주소를 **갤럭시 Z Fold8 크롬**에서 열고 우측 상단 메뉴(⋮) → **홈 화면에 추가 / 앱 설치**를 누르면 단독 앱(PWA)으로 설치됩니다.

---

## 4. 프로젝트 구조

- `public/index.html` — Z Fold8 분할 화면 + 커버 화면 반응형 PWA 프론트엔드 (모달 스크롤 잠금, 지도 스택 격리, 원탭 내비 전송 포함)
- `public/manifest.json`, `public/sw.js`, `public/icon.svg` — Android PWA 설치 매니페스트 및 서비스 워커(카카오 약관 준수를 위해 `/api/` 응답은 캐시하지 않음)
- `functions/api/route-search.js` — 지오코딩 → 길찾기 폴리라인 → 도심/고속도로 IC 적응형 샘플링 → 카카오 로컬 + TourAPI 수집 → Google Places `FieldMask` 평점·영업시간 결합
- `functions/api/detour.js` — 선택한 후보 1곳의 실제 도로 경유 우회시간 온디맨드 정밀 계산
- `dev-server.mjs` — 로컬 검증용 무의존성 Node.js 서버
