# Tools on Web

브라우저에서 바로 쓰는 도구 모음.

pnpm + Vite + React + TypeScript + MUI SPA이며, `main`에 푸시하면 GitHub Actions가
빌드해서 GitHub Pages로 배포합니다.

## 개발

```bash
pnpm install
pnpm dev      # http://127.0.0.1:5173
pnpm build    # 타입체크 + 번들 + 404.html 생성
pnpm lint
```

루트 `index.html`은 저장소에 없습니다. `vite.config.ts`가 설정 로드 시점에
[src/site.ts](src/site.ts)로부터 생성하며 gitignore 대상입니다. 제목·설명·테마색은
`src/site.ts`에서 고치세요.

## 도구 추가하기

[src/tools/registry.ts](src/tools/registry.ts)의 `TOOLS` 배열에 항목 하나만 추가하면
홈 화면의 카드와 라우팅이 함께 생성됩니다.

```ts
{
  path: '/my-tool',
  icon: '🧰',
  title: '내 도구',
  desc: '한 줄 설명',
  tags: ['태그'],
  component: lazy(() => import('./my-tool/MyTool')),
}
```

`lazy()`로 감싸면 해당 도구를 열기 전까지 번들을 내려받지 않습니다. 특히 Serial Tester는
esptool-js 때문에 180KB가 넘으므로 반드시 필요합니다.

## 배포 구성

- **Pages 소스**: 저장소 Settings → Pages → Source를 **GitHub Actions**로 설정
- **커스텀 도메인**: [public/CNAME](public/CNAME)에 `tools.mudev.cc`. DNS에 `tools` CNAME →
  `mu-software.github.io` 레코드 필요
- **SPA 딥링크**: 빌드 스크립트가 `dist/index.html`을 `dist/404.html`로 복사합니다.
  Pages가 없는 경로에 404.html을 돌려주면 그 안의 SPA가 라우팅을 이어받습니다

## 도구별 참고사항

### 화면 자 (`/ruler`)

브라우저는 실제 화면 밀도(PPI)를 알려주지 않습니다. CSS는 1px을 명목상 1/96인치로 정의할 뿐이고
`devicePixelRatio`는 배율일 뿐이라, 자를 실물 크기로 그리려면 **장치 추정**과 **사용자 보정**이
필요합니다. 도구는 다음 순서로 값을 정합니다.

1. UA Client Hints 모델명(`SM-S928B` 등) → 수록된 PPI
2. 논리 해상도 + 배율 → 수록된 기기
3. 플랫폼별 계열값(iPhone Retina, 안드로이드 신고 밀도, 윈도우·리눅스 배율 등)
   - 배율이 1보다 크면 해상도 표를 쓰지 않습니다. 15.6형 FHD 노트북을 125%로 쓰면 실제 픽셀이
     24형 모니터와 똑같은 1920×1080이라 크기를 구분할 수 없기 때문입니다. 대신 OS가 패널 밀도를
     보고 정한 배율 자체를 단서로 삼습니다(`108 × 배율`, 오차 ±5% 안팎)
   - macOS는 논리 해상도를 바꿀 수 있어 `CSS × dpr = 실제 픽셀`이 성립하지 않습니다. 패널의
     실제 픽셀 수를 들고 있다가 `패널 PPI × 프레임버퍼 / 패널 픽셀`로 환산하며, 14형·16형처럼
     크기만 다른 모델은 패널 화면비(0.5% 차이)로 가려냅니다
4. 사용자 보정(신용카드·화면 대각선·직접 입력). 보정값은 물리 픽셀 기준 PPI로 localStorage에
   저장하므로, 브라우저 확대·축소나 배율이 다른 모니터로 옮겨도 실제 길이가 유지됩니다

#### 장치 DB 갱신

[src/tools/ruler/devices.generated.ts](src/tools/ruler/devices.generated.ts)는 자동 생성
파일입니다. 직접 고치지 마세요. 빌드와는 무관하며(`pnpm build`는 이 스크립트를 부르지 않습니다),
[분기마다 한 번 GitHub Actions](.github/workflows/update-devices.yml)가 갱신합니다. 손으로 돌릴
때는 아래를 실행하거나, Actions 탭에서 `Update device DB`를 수동 실행하면 됩니다.

```bash
pnpm devices:update
```

워크플로는 1·4·7·10월 1일 09:00(KST)에 실행되며, 다시 생성 → 변경 여부 확인 → `pnpm build`로
검증 → `main`에 직접 커밋 순으로 동작합니다. 출처가 HTML 스크래핑이라 사이트 구조가 바뀌면 표가
비어 버릴 수 있는데, 수집량이 기준(Apple 20대·기타 100대·모델 코드 100개) 아래면 파일을 쓰지 않고
**액션이 실패합니다**. 그 경우 스크립트의 파서를 고쳐야 한다는 신호입니다.

`GITHUB_TOKEN`으로 만든 커밋은 다른 워크플로를 깨우지 않으므로, 마지막에 배포 워크플로를 직접
호출합니다. 저장소 Settings → Actions → General에서 **Workflow permissions**가 `Read and write`
여야 푸시가 됩니다.

출처는 모두 공개 자료이며, 빌드 타임에 한 번만 받아 정적 파일로 굽습니다(런타임에 외부 요청을
보내지 않습니다).

| 출처 | 쓰임 |
| --- | --- |
| [ios-resolution.com](https://www.ios-resolution.com/) | iPhone·iPad 논리/물리 해상도와 PPI |
| [screensiz.es](https://screensiz.es/) | 제조사 무관 화면 크기와 PPI (2020년 전후까지) |
| [Play 콘솔 공개 기기 카탈로그](https://storage.googleapis.com/play_public/supported_devices.csv) | 안드로이드 모델 코드 ↔ 제품명 |
| [scripts/curated-devices.json](scripts/curated-devices.json) | 최신 안드로이드 기기 PPI (직접 관리) |

최신 안드로이드는 공개 DB가 따라오지 못하므로 `curated-devices.json`에 제품명과 PPI만 적어
두면, 스크립트가 Play 카탈로그를 거쳐 지역별 모델 코드 전부로 넓혀 줍니다. 갱신 후에는
경고로 뜨는 "카탈로그에서 못 찾은 제품명"을 확인하세요(제품명 표기가 바뀐 경우입니다).

### 시간대 변환기 (`/timezone`)

시간대 목록은 `Intl.supportedValuesOf('timeZone')`에서 가져오며, 없는 브라우저에서는 내장한
주요 시간대로 대체합니다. 벽시계 시각을 실제 시점으로 되돌릴 때는 오프셋 자체가 시점에 달려
있어 한 번 추정한 뒤 그 시점의 오프셋으로 다시 맞춥니다. 서머타임 경계에서 없는 시각은
전환 후 시각으로, 두 번 오는 시각은 앞쪽 것으로 해석됩니다.

### 인코딩 변환기 (`/encoding`)

입력을 한 번 바이트 배열로 되돌린 뒤 모든 표기를 다시 만드는 구조입니다. 그래서 어떤 형식으로
들어와도 나머지 전부가 한 화면에 함께 나옵니다. 코덱은 `codecs.ts`의 `CODECS` 배열이 전부이고,
`encode`/`decode` 한 쌍만 채우면 목록·입력 형식·결과 행에 함께 붙습니다.

- **자동 인식**: `detectCodec()`이 모양만 보고 고릅니다. `deadbeef`처럼 평문과 16진수 양쪽으로
  읽히는 입력이 있어 어떤 형식으로 읽었는지 칩으로 보여 주고, 선택으로 언제든 덮어쓸 수 있습니다
- **문자열 표현**: UTF-8로 읽히는 바이트에만 나옵니다. 이진 파일에서는 사유와 함께 비워 둡니다
- **`maxBytes`**: 2진수 표기는 바이트당 9글자라 큰 입력에서 문자열만 수십 MB가 됩니다. 코덱마다
  상한을 두고 넘으면 만들지 않습니다
- **미리보기**: 매직 넘버로 MIME을 추정(`media.ts`)해 이미지·음원·영상이면 Blob URL로 띄웁니다.
  Data URL도 같은 추정값을 씁니다

### JWT 파서 (`/jwt`)

점으로 나뉜 조각을 Base64URL로 풀어 헤더·페이로드를 보여 주고, `exp`·`nbf`로 지금 쓸 수 있는
토큰인지 판단합니다. 조각이 다섯이면 JWE라 페이로드를 열 수 없다고 알립니다.

서명 검증은 WebCrypto로 브라우저 안에서만 하며 HS·RS·PS·ES의 256/384/512를 다룹니다. HS 계열은
공유 비밀(평문·Base64·16진수), 나머지는 공개키를 PEM(SPKI) 또는 JWK로 받습니다. 개인키를 넣으면
거절합니다.

### Serial Tester (`/serial`)

- **WebSerial 플래셔 / WebUSB 디버그**: secure context가 필요하므로 HTTPS 배포에서 정상 동작
- **보드 제어(HTTP/WebSocket)**: 페이지가 HTTPS인데 보드는 `http://` · `ws://`라서 혼합
  콘텐츠로 차단됩니다. 브라우저 사이트 설정에서 "안전하지 않은 콘텐츠"를 허용하고,
  로컬 네트워크 접근(LNA) 권한을 수동으로 허용해야 합니다
